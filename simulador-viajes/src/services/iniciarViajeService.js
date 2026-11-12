// Pone en marcha un camion simulado sobre una ruta recien creada: da de alta el camion si
// no existia, cierra cualquier viaje 'en_curso' que tuviera (invariante: a lo sumo uno a la
// vez) y abre el viaje nuevo. A partir del proximo ciclo (<=60s) el daemon (src/index.js) lo
// relee de la base y empieza a emitir tramas para este dispositivoId.
import { obtenerCamion, insertarCamion, actualizarCargaCamion } from '../db/camionRepository.js';
import {
  finalizarViajesEnCurso,
  obtenerUltimoOdometro,
  insertarViaje,
  contarPuntosRuta,
} from '../db/viajeRepository.js';
import { sorteoFallaMotorActivo, sortearFallaMotorConfigurado } from '../domain/fallaMotor.js';

// Humedad relativa por defecto para carga refrigerada cuando el llamador no la informa
// (AgroLinkBackend solo tiene umbrales de temperatura). Rango tipico de carne refrigerada.
export const SETPOINT_HUMEDAD_DEFAULT_PCT = 88;

function resolverCarga(camion) {
  if (camion.tipoCarga === 'refrigerada') {
    return {
      tipoCarga: 'refrigerada',
      setpointTempC: camion.setpointTempC,
      setpointHumedadPct: camion.setpointHumedadPct ?? SETPOINT_HUMEDAD_DEFAULT_PCT,
    };
  }
  return { tipoCarga: camion.tipoCarga ?? 'seca', setpointTempC: null, setpointHumedadPct: null };
}

export async function iniciarViajeParaCamion(pool, { camion, rutaId }) {
  const existente = await obtenerCamion(pool, camion.id);
  const carga = resolverCarga(camion);

  if (!existente) {
    await insertarCamion(pool, {
      id: camion.id,
      nombre: camion.nombre ?? camion.id,
      odometroInicialKm: camion.odometroInicialKm ?? 0,
      ...carga,
    });
  } else if (camion.tipoCarga !== undefined) {
    // Sin tipoCarga en el request (llamadores previos) se conserva la carga del camion.
    await actualizarCargaCamion(pool, { id: camion.id, ...carga });
  }

  await finalizarViajesEnCurso(pool, camion.id);

  // Un odometro explicito en el request (p. ej. el que AgroLinkBackend ancla al iniciar el
  // viaje) manda sobre el que el simulador traia acumulado: la telemetria tiene que contar
  // desde el valor que ve el backend, no desde el ultimo viaje simulado de este camion.
  const odometroPrevio = await obtenerUltimoOdometro(pool, camion.id);
  const odometroActualKm =
    camion.odometroInicialKm ?? odometroPrevio ?? existente?.odometro_inicial_km ?? 0;

  // Feature 016 (FR-003a): cada viaje nuevo sortea si tendra sobrecalentamiento de motor. Con el
  // sorteo apagado (probabilidad 0 o sin configurar) ni siquiera se cuentan los puntos.
  const fallaMotor = sorteoFallaMotorActivo()
    ? sortearFallaMotorConfigurado(await contarPuntosRuta(pool, rutaId))
    : null;

  const viaje = await insertarViaje(pool, { camionId: camion.id, rutaId, odometroActualKm, fallaMotor });

  return {
    dispositivoId: camion.id,
    viajeId: viaje.id,
    rutaId: viaje.ruta_id,
    estado: viaje.estado,
  };
}
