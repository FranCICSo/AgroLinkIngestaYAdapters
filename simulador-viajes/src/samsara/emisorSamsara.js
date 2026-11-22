// Emisor de webhooks Samsara simulado (spec 015-samsara-webhook-exceso-velocidad, US2): por cada
// vehiculo Samsara con viaje en curso lleva una velocidad interna y envia SevereSpeedingStarted /
// SevereSpeedingEnded solo cuando cruza el umbral (FR-015/FR-016). Separado de la simulacion
// Rinho: no comparte lista de vehiculos ni envio de tramas (FR-013/FR-014).
//
// El estado vive en memoria (research.md D-09), como `estadoPorCamion` en index.js: si el
// proceso se reinicia, los viajes en curso se pierden hasta el proximo aviso de inicio.
import { buscarVehiculoSamsara, buscarVehiculoSamsaraPorIdOPatente } from './vehiculosSamsara.js';
import { crearEstadoVelocidad, avanzarVelocidad } from './modeloVelocidad.js';
import { detectarCruce, forzarFin } from './detectorExceso.js';
import { construirPayload } from './payloadSamsara.js';

const TRIP_CODE_MAX = 64;

// Exceso forzado a mano (POST /samsara/vehiculos/{vehiculo}/exceso): cuanto dura la rafaga y
// cuanto pasa el umbral. La velocidad tarda un ciclo en cruzarlo, asi que el exceso informado
// dura un poco menos que la rafaga.
export const EXCESO_MANUAL_DURACION_S_DEFAULT = 90;
export const EXCESO_MANUAL_DURACION_S_MIN = 20;
export const EXCESO_MANUAL_DURACION_S_MAX = 600;
const EXCESO_MANUAL_EXTRA_KMH = 10;

function respuesta(status, body) {
  return { status, body };
}

/**
 * @param config bloque `samsara` de loadConfig (umbralKmh, excesosPorHora, cicloMs, orgId, webhookId)
 * @param webhookClient { enviar(payload) } (webhookClient.js)
 */
export function crearEmisorSamsara({ config, webhookClient, log, rng = Math.random, ahora = () => new Date() }) {
  // vehiculoId -> { vehiculo, tripCode, inicioViaje: Date, velocidad: {velocidadKmh, rafaga}, excesoAbierto }
  const enCurso = new Map();
  let intervalo = null;
  let cicloEnCurso = false;

  async function enviar(evento, entrada, fechas) {
    const payload = construirPayload(
      evento,
      entrada.vehiculo,
      { ...fechas, tripStartTime: entrada.inicioViaje },
      { orgId: config.orgId, webhookId: config.webhookId },
    );
    const r = await webhookClient.enviar(payload);
    const campos = {
      eventType: payload.eventType,
      eventId: payload.eventId,
      vehiculoId: entrada.vehiculo.id,
      patente: entrada.vehiculo.patente,
      tripCode: entrada.tripCode,
      // Solo en el log, nunca en el payload: Samsara no informa la velocidad en estos eventos.
      velocidadInternaKmh: Math.round(entrada.velocidad.velocidadKmh),
      resultado: r.resultado,
      status: r.status,
    };
    if (r.resultado === 'aceptado') {
      log.info('Webhook Samsara enviado', campos);
    } else {
      log.warn('Webhook Samsara no aceptado', { ...campos, error: r.error, cuerpo: r.cuerpo });
    }
    return r;
  }

  async function cerrarExcesoForzado(entrada) {
    const fin = forzarFin(entrada.excesoAbierto, ahora());
    entrada.excesoAbierto = null;
    if (fin.evento) {
      await enviar('ENDED', entrada, { startTime: fin.startTime, endTime: fin.endTime });
    }
  }

  async function iniciarViaje({ vehiculoId, tripCode, inicioViaje } = {}) {
    if (typeof vehiculoId !== 'string' || typeof tripCode !== 'string' || typeof inicioViaje !== 'string') {
      return respuesta(400, { error: 'validacion', detalle: 'vehiculoId, tripCode e inicioViaje son obligatorios' });
    }
    if (tripCode.length < 1 || tripCode.length > TRIP_CODE_MAX) {
      return respuesta(400, { error: 'validacion', detalle: `tripCode debe tener 1..${TRIP_CODE_MAX} caracteres` });
    }
    const inicio = new Date(inicioViaje);
    if (Number.isNaN(inicio.getTime())) {
      return respuesta(400, { error: 'validacion', detalle: 'inicioViaje no es una fecha ISO-8601 valida' });
    }
    const vehiculo = buscarVehiculoSamsara(vehiculoId);
    if (!vehiculo) {
      log.warn('Aviso de viaje para un vehiculo fuera de la lista Samsara, ignorado', { vehiculoId, tripCode });
      return respuesta(404, { error: 'vehiculo_no_samsara' });
    }

    const actual = enCurso.get(vehiculoId);
    if (actual && actual.tripCode === tripCode) {
      return respuesta(200, { vehiculoId, tripCode, efecto: 'SIN_CAMBIOS' });
    }
    if (actual) {
      // Un viaje nuevo reemplaza al anterior y cierra su exceso abierto (spec, Edge Cases).
      enCurso.delete(vehiculoId);
      await cerrarExcesoForzado(actual);
      log.info('Viaje Samsara reemplazado por uno nuevo', { vehiculoId, anterior: actual.tripCode, nuevo: tripCode });
    }

    enCurso.set(vehiculoId, {
      vehiculo,
      tripCode,
      inicioViaje: inicio,
      velocidad: crearEstadoVelocidad(rng),
      excesoAbierto: null,
    });
    log.info('Simulando vehiculo Samsara', { vehiculoId, patente: vehiculo.patente, tripCode });
    return respuesta(202, { vehiculoId, tripCode, efecto: 'ARRANCADA' });
  }

  async function detenerViaje({ vehiculoId, tripCode, motivo } = {}) {
    if (typeof vehiculoId !== 'string' || !buscarVehiculoSamsara(vehiculoId)) {
      return respuesta(404, { error: 'vehiculo_no_samsara' });
    }
    const actual = enCurso.get(vehiculoId);
    if (!actual || actual.tripCode !== tripCode) {
      return respuesta(200, { vehiculoId, tripCode, efecto: 'SIN_SIMULACION_EN_CURSO' });
    }
    enCurso.delete(vehiculoId);
    await cerrarExcesoForzado(actual);
    log.info('Vehiculo Samsara detenido', { vehiculoId, tripCode, motivo });
    return respuesta(200, { vehiculoId, tripCode, efecto: 'DETENIDA' });
  }

  // Activacion manual: arranca una rafaga ya, sin esperar al azar ni al enfriamiento. El ciclo
  // normal la toma desde el proximo paso, asi que Started y Ended salen como en un exceso al azar.
  function forzarExceso({ vehiculo: valor, duracionS = EXCESO_MANUAL_DURACION_S_DEFAULT } = {}) {
    const vehiculo = buscarVehiculoSamsaraPorIdOPatente(valor);
    if (!vehiculo) {
      return respuesta(404, { error: 'vehiculo_no_samsara', detalle: `"${valor}" no es un vehiculo Samsara simulado` });
    }
    if (
      typeof duracionS !== 'number' ||
      !Number.isFinite(duracionS) ||
      duracionS < EXCESO_MANUAL_DURACION_S_MIN ||
      duracionS > EXCESO_MANUAL_DURACION_S_MAX
    ) {
      return respuesta(400, {
        error: 'validacion',
        detalle: `duracionS debe ser un numero entre ${EXCESO_MANUAL_DURACION_S_MIN} y ${EXCESO_MANUAL_DURACION_S_MAX}`,
      });
    }
    const base = { vehiculoId: vehiculo.id, patente: vehiculo.patente };
    const entrada = enCurso.get(vehiculo.id);
    if (!entrada) {
      return respuesta(409, {
        error: 'sin_viaje_en_curso',
        detalle: `${vehiculo.patente} no tiene un viaje Samsara en curso: inicia un viaje primero`,
      });
    }
    if (entrada.velocidad.rafaga || entrada.excesoAbierto) {
      return respuesta(200, { ...base, tripCode: entrada.tripCode, efecto: 'YA_EN_EXCESO' });
    }
    const terminaEn = new Date(ahora().getTime() + duracionS * 1000);
    entrada.velocidad = {
      ...entrada.velocidad,
      rafaga: { objetivoKmh: config.umbralKmh + EXCESO_MANUAL_EXTRA_KMH, terminaEnMs: terminaEn.getTime(), alcanzada: false },
    };
    log.info('Exceso Samsara forzado a mano', { ...base, tripCode: entrada.tripCode, duracionS });
    return respuesta(202, { ...base, tripCode: entrada.tripCode, efecto: 'FORZADO', duracionS, terminaEn: terminaEn.toISOString() });
  }

  async function ciclo() {
    if (cicloEnCurso) return;
    cicloEnCurso = true;
    try {
      const momento = ahora();
      const envios = [];
      for (const entrada of enCurso.values()) {
        entrada.velocidad = avanzarVelocidad(entrada.velocidad, config, rng, momento.getTime());
        const cruce = detectarCruce(entrada.excesoAbierto, entrada.velocidad.velocidadKmh, config.umbralKmh, momento);
        entrada.excesoAbierto = cruce.excesoAbierto;
        if (cruce.evento) {
          envios.push(enviar(cruce.evento, entrada, { startTime: cruce.startTime, endTime: cruce.endTime }));
        }
      }
      await Promise.all(envios);
    } finally {
      cicloEnCurso = false;
    }
  }

  return {
    iniciarViaje,
    detenerViaje,
    forzarExceso,
    ciclo,
    arrancar() {
      intervalo = setInterval(() => {
        ciclo().catch((err) => log.error('Fallo inesperado en el ciclo del emisor Samsara', { error: err.message }));
      }, config.cicloMs);
      log.info('Emisor Samsara arrancado', { umbralKmh: config.umbralKmh, excesosPorHora: config.excesosPorHora, cicloMs: config.cicloMs });
    },
    detener() {
      if (intervalo) clearInterval(intervalo);
      intervalo = null;
    },
    vehiculosEnCurso() {
      return [...enCurso.values()].map((e) => ({ vehiculoId: e.vehiculo.id, tripCode: e.tripCode, excesoAbierto: e.excesoAbierto }));
    },
  };
}
