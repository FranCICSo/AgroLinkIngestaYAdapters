// Falla de sobrecalentamiento de motor por viaje simulado. Feature 016-alerta-temperatura-motor,
// research.md D-03 y data-model.md §1 (FR-003a, FR-003d, FR-008).
//
// Funciones puras: el sorteo recibe el rng y el estado recibe "ahora", para tests
// deterministas. La persistencia vive en db/viajeRepository.js y db/flotaRepository.js.

// El disparo cae entre el 10 % y el 70 % de los puntos de la ruta: nunca en el arranque, ni tan
// al final que el viaje termine antes de mostrar la alerta.
export const FRACCION_DISPARO_MIN = 0.1;
export const FRACCION_DISPARO_MAX = 0.7;

function enteroUniforme(min, max, rng) {
  return min + Math.floor(rng() * (max - min + 1));
}

// Devuelve null (el viaje no tendra falla al azar) o
// { origen: 'azar', indiceDisparo, duracionMin }.
export function sortearFallaMotor({ cantidadPuntos, probabilidadPct, duracionMinMin, duracionMaxMin, rng = Math.random }) {
  if (!(probabilidadPct > 0) || !(cantidadPuntos > 1)) return null;
  if (rng() * 100 >= probabilidadPct) return null;

  const desde = Math.max(1, Math.floor(cantidadPuntos * FRACCION_DISPARO_MIN));
  const hasta = Math.max(desde, Math.floor(cantidadPuntos * FRACCION_DISPARO_MAX));
  return {
    origen: 'azar',
    indiceDisparo: enteroUniforme(desde, hasta, rng),
    duracionMin: enteroUniforme(duracionMinMin, duracionMaxMin, rng),
  };
}

// Sorteador configurado al arrancar el proceso (loadMotorConfig). Lo usa iniciarViajeService,
// que corre detras de POST /rutas y del CLI. Sin configurar no sortea nunca, asi que los tests y
// usos que no lo configuran quedan sin falla al azar.
let configSorteo = null;

export function configurarSorteoFallaMotor(motorConfig, rng = Math.random) {
  configSorteo = motorConfig ? { ...motorConfig, rng } : null;
}

export function sortearFallaMotorConfigurado(cantidadPuntos) {
  if (!configSorteo) return null;
  return sortearFallaMotor({
    cantidadPuntos,
    probabilidadPct: configSorteo.probabilidadPct,
    duracionMinMin: configSorteo.duracionMinMin,
    duracionMaxMin: configSorteo.duracionMaxMin,
    rng: configSorteo.rng,
  });
}

export function sorteoFallaMotorActivo() {
  return configSorteo != null && configSorteo.probabilidadPct > 0;
}

// viaje: { fallaMotorOrigen, fallaMotorIndiceDisparo, fallaMotorDuracionMin,
//          fallaMotorActivadaEn: Date|null, fallaMotorDesactivadaEn: Date|null }
// indice: indice de avance actual del viaje. ahora: Date.
// -> 'sin_falla' | 'pendiente' | 'activa' | 'terminada'
export function estadoFallaMotor(viaje, { ahora, indice }) {
  const origen = viaje.fallaMotorOrigen ?? null;
  if (origen == null) return 'sin_falla';
  if (viaje.fallaMotorDesactivadaEn != null) return 'terminada';

  if (viaje.fallaMotorActivadaEn == null) {
    // Solo una falla 'azar' queda pendiente de su indice; 'manual' se activa al crearse.
    if (origen === 'azar' && indice < viaje.fallaMotorIndiceDisparo) return 'pendiente';
    return origen === 'azar' ? 'por_activar' : 'activa';
  }

  if (origen === 'azar' && ahora >= finFallaMotor(viaje)) return 'terminada';
  return 'activa';
}

// Momento en que termina una falla 'azar' ya activada (null para 'manual' o sin activar).
export function finFallaMotor(viaje) {
  if (viaje.fallaMotorOrigen !== 'azar' || viaje.fallaMotorActivadaEn == null) return null;
  return new Date(new Date(viaje.fallaMotorActivadaEn).getTime() + viaje.fallaMotorDuracionMin * 60_000);
}
