// Velocidad interna de un vehiculo Samsara simulado (spec 015-samsara-webhook-exceso-velocidad,
// FR-015; research.md D-07). Nunca se envia: Samsara tampoco la manda en estos eventos. Solo
// decide cuando hay un cruce de umbral (detectorExceso.js).
//
// Dos regimenes de un proceso Ornstein-Uhlenbeck discretizado de forma exacta (estable con
// cualquier paso):
// - normal: media 72 km/h, desvio ~5 km/h, tope umbral - 1. Nunca cruza el umbral: el conductor
//   no va rapido siempre.
// - rafaga: objetivo umbral + U(3, 15) por U(20, 170) s. Empieza con probabilidad
//   1 - exp(-lambda * dt) por ciclo (Poisson de tasa `excesosPorHora`), asi la frecuencia de
//   excesos la fija lambda y no la calibracion fina del ruido (SC-002).
// Puro: el aleatorio (`rng`, uniforme en [0, 1)) y la hora se inyectan para tests deterministas.

export const VELOCIDAD_BASE_KMH = 72;
const DESVIO_NORMAL_KMH = 5;
const DESVIO_RAFAGA_KMH = 2;
const THETA_NORMAL_POR_S = 0.05; // reversion lenta: crucero
const THETA_RAPIDA_POR_S = 0.3; // acelerar hacia la rafaga o frenar al terminarla
const RAFAGA_EXTRA_MIN_KMH = 3;
const RAFAGA_EXTRA_MAX_KMH = 15;
export const RAFAGA_DURACION_MIN_MS = 20_000;
export const RAFAGA_DURACION_MAX_MS = 170_000;
// Sin rafaga nueva hasta un minuto despues de la anterior: si empezara en el mismo ciclo en que
// termino la previa, la velocidad nunca bajaria del umbral y dos rafagas serian un exceso largo.
export const ENFRIAMIENTO_MS = 60_000;

function uniforme(rng, min, max) {
  return min + (max - min) * rng();
}

// Box-Muller sobre el rng inyectado.
function normal(rng) {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function pasoOu(valor, objetivo, theta, desvio, dtS, rng) {
  const decaimiento = Math.exp(-theta * dtS);
  const ruido = desvio * Math.sqrt(1 - decaimiento * decaimiento) * normal(rng);
  return objetivo + (valor - objetivo) * decaimiento + ruido;
}

export function crearEstadoVelocidad(rng) {
  return { velocidadKmh: VELOCIDAD_BASE_KMH + DESVIO_NORMAL_KMH * normal(rng) * 0.5, rafaga: null, sinRafagaHastaMs: 0 };
}

/**
 * @param estado { velocidadKmh, rafaga: null | { objetivoKmh, terminaEnMs, alcanzada }, sinRafagaHastaMs }
 * @param params { umbralKmh, excesosPorHora, cicloMs }
 * @returns nuevo estado (no muta el recibido)
 */
export function avanzarVelocidad(estado, { umbralKmh, excesosPorHora, cicloMs }, rng, ahoraMs) {
  const dtS = cicloMs / 1000;
  let rafaga = estado.rafaga;
  let sinRafagaHastaMs = estado.sinRafagaHastaMs ?? 0;

  if (rafaga && ahoraMs >= rafaga.terminaEnMs) {
    rafaga = null;
    sinRafagaHastaMs = ahoraMs + ENFRIAMIENTO_MS;
  }
  if (!rafaga && excesosPorHora > 0 && ahoraMs >= sinRafagaHastaMs) {
    const probabilidad = 1 - Math.exp((-excesosPorHora * dtS) / 3600);
    if (rng() < probabilidad) {
      rafaga = {
        objetivoKmh: umbralKmh + uniforme(rng, RAFAGA_EXTRA_MIN_KMH, RAFAGA_EXTRA_MAX_KMH),
        terminaEnMs: ahoraMs + uniforme(rng, RAFAGA_DURACION_MIN_MS, RAFAGA_DURACION_MAX_MS),
        alcanzada: false,
      };
    }
  }

  let velocidadKmh;
  if (rafaga) {
    velocidadKmh = pasoOu(estado.velocidadKmh, rafaga.objetivoKmh, THETA_RAPIDA_POR_S, DESVIO_RAFAGA_KMH, dtS, rng);
    // Una vez arriba del umbral, la rafaga no baja por ruido: un solo exceso por rafaga.
    if (rafaga.alcanzada) {
      velocidadKmh = Math.max(velocidadKmh, umbralKmh + 1);
    } else if (velocidadKmh > umbralKmh) {
      rafaga = { ...rafaga, alcanzada: true };
    }
  } else {
    const theta = estado.velocidadKmh > umbralKmh - 3 ? THETA_RAPIDA_POR_S : THETA_NORMAL_POR_S;
    velocidadKmh = pasoOu(estado.velocidadKmh, VELOCIDAD_BASE_KMH, theta, DESVIO_NORMAL_KMH, dtS, rng);
    // Fuera de una rafaga el conductor nunca supera el umbral.
    velocidadKmh = Math.min(velocidadKmh, umbralKmh - 1);
  }

  return { velocidadKmh: Math.max(0, velocidadKmh), rafaga, sinRafagaHastaMs };
}
