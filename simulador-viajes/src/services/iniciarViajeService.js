// Pone en marcha un camion simulado sobre una ruta recien creada: da de alta el camion si
// no existia, cierra cualquier viaje 'en_curso' que tuviera (invariante: a lo sumo uno a la
// vez) y abre el viaje nuevo. A partir del proximo ciclo (<=60s) el daemon (src/index.js) lo
// relee de la base y empieza a emitir tramas para este dispositivoId.
import { obtenerCamion, insertarCamion } from '../db/camionRepository.js';
import { finalizarViajesEnCurso, obtenerUltimoOdometro, insertarViaje } from '../db/viajeRepository.js';

export async function iniciarViajeParaCamion(pool, { camion, rutaId }) {
  const existente = await obtenerCamion(pool, camion.id);

  if (!existente) {
    await insertarCamion(pool, {
      id: camion.id,
      nombre: camion.nombre ?? camion.id,
      tipoCarga: camion.tipoCarga ?? 'seca',
      odometroInicialKm: camion.odometroInicialKm ?? 0,
      setpointTempC: camion.setpointTempC,
      setpointHumedadPct: camion.setpointHumedadPct,
    });
  }

  await finalizarViajesEnCurso(pool, camion.id);

  // Un odometro explicito en el request (p. ej. el que AgroLinkBackend ancla al iniciar el
  // viaje) manda sobre el que el simulador traia acumulado: la telemetria tiene que contar
  // desde el valor que ve el backend, no desde el ultimo viaje simulado de este camion.
  const odometroPrevio = await obtenerUltimoOdometro(pool, camion.id);
  const odometroActualKm =
    camion.odometroInicialKm ?? odometroPrevio ?? existente?.odometro_inicial_km ?? 0;

  const viaje = await insertarViaje(pool, { camionId: camion.id, rutaId, odometroActualKm });

  return {
    dispositivoId: camion.id,
    viajeId: viaje.id,
    rutaId: viaje.ruta_id,
    estado: viaje.estado,
  };
}
