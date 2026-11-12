import { loadConfig } from './config.js';
import { log } from './log.js';
import { createPool, closePool } from './db/pool.js';
import { obtenerViajesEnCurso, actualizarProgresoViaje, finalizarYCrearVuelta } from './db/flotaRepository.js';
import { avanzar } from './domain/avanceRuta.js';
import { sintetizarCan } from './domain/sintesisCan.js';
import { sintetizarBle } from './domain/sintesisBle.js';
import { construirTrama } from './protocol/frameBuilder.js';
import { crearUdpClient } from './net/udpClient.js';
import { iniciarRutaHttpServer } from './http/rutaHttpServer.js';
import { crearEmisorSamsara } from './samsara/emisorSamsara.js';
import { crearWebhookClient } from './samsara/webhookClient.js';
import { sintetizarTemperaturaMotor, determinarModoMotor } from './domain/sintesisTemperaturaMotor.js';
import {
  estadoFallaMotor,
  configurarSorteoFallaMotor,
  sortearFallaMotorConfigurado,
} from './domain/fallaMotor.js';
import { registrarTemperaturaMotor } from './domain/registroTemperaturaMotor.js';
import { marcarFallaMotorActivada, marcarFallaMotorDesactivada } from './db/viajeRepository.js';

// Estado que no vive en `simulador.viaje` (combustible/temperatura BLE acumulados,
// contador de msgNum): se pierde si el proceso se reinicia, a diferencia de posicion y
// odometro (persistidos en la DB - ver spec, Edge Cases). Alcance aceptado para esta PoC.
const estadoPorCamion = new Map();

// Feature 016: subida y pico del sobrecalentamiento de motor (loadMotorConfig), fijados en main().
let motorConfig = null;
// Feature 016, ampliacion: consumo y umbral de recarga del tanque (loadCombustibleConfig).
let combustibleConfig = undefined;

function proximoMsgNum(camionId) {
  const estado = estadoPorCamion.get(camionId) ?? {};
  const siguiente = ((estado.msgNum ?? 0) + 1) % 10000;
  estadoPorCamion.set(camionId, { ...estado, msgNum: siguiente });
  return siguiente;
}

function determinarModoBle(viaje, resultado) {
  if (viaje.fallaTipo === 'falla_compresor' && resultado.siguienteIndice >= viaje.fallaIndiceDisparo) {
    return 'falla_compresor';
  }
  if (
    viaje.fallaTipo === 'apertura_puerta' &&
    resultado.enParadaEntrega &&
    resultado.siguienteIndice === viaje.fallaIndiceDisparo
  ) {
    return 'apertura_puerta';
  }
  return 'normal';
}

// Feature 016 (data-model.md §1): resuelve el estado de la falla de motor del viaje, persiste
// sus transiciones automaticas (pendiente -> activa al llegar al indice; activa -> terminada al
// cumplir la duracion) y sintetiza la temperatura de esta trama. La temperatura anterior solo
// vale dentro del mismo viaje: un viaje nuevo arranca en la banda normal (FR-008).
async function sintetizarMotor(pool, { camion, viaje, estado, resultado }) {
  const ahora = new Date();
  const estadoFalla = estadoFallaMotor(viaje, { ahora, indice: viaje.indiceActual });

  if (estadoFalla === 'por_activar') {
    await marcarFallaMotorActivada(pool, viaje.id, ahora);
    log.info('Sobrecalentamiento de motor activado (al azar)', {
      camionId: camion.id,
      viajeId: viaje.id,
      indice: viaje.indiceActual,
      duracionMin: viaje.fallaMotorDuracionMin,
    });
  } else if (estadoFalla === 'terminada' && viaje.fallaMotorDesactivadaEn == null) {
    await marcarFallaMotorDesactivada(pool, viaje.id, ahora);
    log.info('Sobrecalentamiento de motor terminado por duracion', { camionId: camion.id, viajeId: viaje.id });
  }

  const temperaturaAnterior = estado.viajeIdMotor === viaje.id ? estado.temperaturaMotorC : null;
  const activa = estadoFalla === 'activa' || estadoFalla === 'por_activar';
  return sintetizarTemperaturaMotor({
    temperaturaAnterior,
    ralenti: resultado.gps.velocidadKmh === 0,
    modo: determinarModoMotor({ activa, temperaturaAnterior }),
    config: motorConfig,
  });
}

async function procesarCamion(pool, udpClient, entry) {
  const { camion, ruta, viaje } = entry;
  const estado = estadoPorCamion.get(camion.id) ?? {};

  const resultado = avanzar({
    ruta,
    sentido: viaje.sentido,
    indiceActual: viaje.indiceActual,
    odometroActualKm: viaje.odometroActualKm,
  });

  // FR-014/research.md D-07: al llegar al final, finaliza el viaje y genera
  // automaticamente el de vuelta - este ciclo no emite trama para este camion.
  if (resultado.completado) {
    // Feature 016 (FR-008): la vuelta no hereda la falla de motor; tiene su propio sorteo.
    const fallaMotorVuelta = sortearFallaMotorConfigurado(ruta.puntos.length);
    const nuevoViaje = await finalizarYCrearVuelta(pool, viaje, fallaMotorVuelta);
    log.info('Viaje completado: generado el viaje de vuelta automatico', {
      camionId: camion.id,
      viajeAnteriorId: viaje.id,
      nuevoViajeId: nuevoViaje.id,
      nuevoSentido: nuevoViaje.sentido,
      fallaMotor: fallaMotorVuelta ? 'azar' : null,
    });
    return;
  }

  const distanciaKm = resultado.odometroKm - viaje.odometroActualKm;
  const can = sintetizarCan({
    velocidadKmh: resultado.gps.velocidadKmh,
    distanciaKm,
    combustiblePctAnterior: estado.combustiblePct,
    combustibleConsumidoLAnterior: estado.combustibleConsumidoL,
    combustible: combustibleConfig,
  });
  if (can.combustibleRecargado) {
    log.info('Camion simulado cargo combustible: tanque al 100 %', {
      camionId: camion.id,
      viajeId: viaje.id,
      nivelAnteriorPct: estado.combustiblePct,
    });
  }

  const temperaturaMotorC = await sintetizarMotor(pool, { camion, viaje, estado, resultado });

  // FR-017: sin carga refrigerada, ble queda null y frameBuilder no agrega el segmento.
  const ble =
    camion.tipoCarga === 'refrigerada'
      ? sintetizarBle({
          tipoCarga: camion.tipoCarga,
          setpointTempC: camion.setpointTempC,
          setpointHumedadPct: camion.setpointHumedadPct,
          temperaturaAnterior: estado.temperaturaBleC,
          modo: determinarModoBle(viaje, resultado),
        })
      : null;

  const msgNum = proximoMsgNum(camion.id);
  const trama = construirTrama({
    camionId: camion.id,
    vin: camion.vin,
    momentoEvento: new Date(),
    lat: resultado.gps.lat,
    lon: resultado.gps.lon,
    velocidadKmh: resultado.gps.velocidadKmh,
    rumboGrados: resultado.gps.rumboGrados,
    ignicionEncendida: resultado.gps.ignicionEncendida,
    odometroKm: resultado.odometroKm,
    can: {
      rpm: can.rpm,
      velocidadRuedaKmh: Math.round(resultado.gps.velocidadKmh),
      odometroEcuKm: null,
      combustibleConsumidoL: can.combustibleConsumidoL,
      combustiblePct: can.combustiblePct,
      temperaturaRefrigeranteC: temperaturaMotorC,
      presionAceiteKpa: can.presionAceiteKpa,
    },
    ble,
    msgNum,
  });

  estadoPorCamion.set(camion.id, {
    msgNum,
    combustiblePct: can.combustiblePct,
    combustibleConsumidoL: can.combustibleConsumidoL,
    temperaturaBleC: ble ? ble.temperaturaC : estado.temperaturaBleC,
    temperaturaMotorC,
    viajeIdMotor: viaje.id,
  });
  registrarTemperaturaMotor(camion.id, temperaturaMotorC);

  const ack = await udpClient.enviarConReintentos(trama, {
    deviceId: camion.id,
    msgNum: String(msgNum).padStart(4, '0'),
    camionId: camion.id,
    viajeId: viaje.id,
  });
  if (!ack) {
    log.warn('Ciclo continua pese a trama sin confirmar', { camionId: camion.id, viajeId: viaje.id });
  }

  // La posicion/odometro avanzan haya llegado el ACK o no: el ACK solo confirma que el
  // receptor persistio la lectura, no condiciona el avance del viaje simulado.
  await actualizarProgresoViaje(pool, viaje.id, {
    indiceActual: resultado.siguienteIndice,
    odometroActualKm: resultado.odometroKm,
  });
}

// FR-004/US3: relee `simulador.camion`/`simulador.viaje` completos en cada ciclo (en vez
// de cachear la flota en memoria) para que agregar, editar o desactivar un camion tenga
// efecto sin reiniciar el proceso (research.md D-04). Los camiones se procesan en
// paralelo (Promise.all): la espera de reintentos de uno no bloquea a los demas (SC-002).
async function ejecutarCiclo(pool, udpClient) {
  const flota = await obtenerViajesEnCurso(pool);
  await Promise.all(
    flota.map((entry) =>
      procesarCamion(pool, udpClient, entry).catch((err) => {
        log.error('Fallo procesando un camion simulado', {
          camionId: entry.camion.id,
          error: err.message,
        });
      }),
    ),
  );
}

async function main() {
  const config = loadConfig();
  motorConfig = config.motor;
  combustibleConfig = config.combustible;
  configurarSorteoFallaMotor(config.motor);
  const pool = createPool(config.db);
  const udpClient = crearUdpClient(config.receptor);

  log.info('simulador-viajes arrancado', {
    receptorHost: config.receptor.host,
    receptorPort: config.receptor.port,
    apuntarAProduccion: config.apuntarAProduccion,
    cicloMs: config.cicloMs,
    motor: config.motor,
    combustible: config.combustible,
  });

  const ejecutar = () =>
    ejecutarCiclo(pool, udpClient).catch((err) => {
      log.error('Fallo inesperado en el ciclo del simulador', { error: err.message });
    });

  ejecutar();
  const intervalo = setInterval(ejecutar, config.cicloMs);

  // Feature 015: emisor de webhooks Samsara, independiente de la simulacion Rinho (FR-020).
  // Recibe los avisos de viaje por el servidor HTTP de abajo, asi que sin PUERTO_HTTP no tiene
  // como enterarse de un viaje en curso.
  let emisorSamsara = null;
  if (config.samsara.habilitado) {
    if (!config.puertoHttp) {
      log.warn('Emisor Samsara habilitado sin PUERTO_HTTP: no puede recibir avisos de viaje');
    }
    emisorSamsara = crearEmisorSamsara({
      config: config.samsara,
      webhookClient: crearWebhookClient({ url: config.samsara.webhookUrl }),
      log,
    });
    emisorSamsara.arrancar();
  }

  // FR-005/T009: opcional - solo si PUERTO_HTTP esta definida. No se publica al host en
  // deploy/compose.yaml (research.md D-04, FR-006): alcanzable solo dentro de la red de
  // Docker compose, nunca directamente desde el frontend de AgroLink.
  const rutaHttpServer = config.puertoHttp
    ? iniciarRutaHttpServer(pool, { osrmBaseUrl: config.osrmBaseUrl, puertoHttp: config.puertoHttp, emisorSamsara })
    : null;

  const shutdown = async (signal) => {
    log.info('Apagando simulador-viajes', { signal });
    clearInterval(intervalo);
    emisorSamsara?.detener();
    if (rutaHttpServer) {
      await new Promise((resolve) => rutaHttpServer.close(resolve));
    }
    await udpClient.cerrar();
    await closePool(pool);
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.error('Fallo fatal al arrancar simulador-viajes', { error: err.message });
  process.exit(1);
});
