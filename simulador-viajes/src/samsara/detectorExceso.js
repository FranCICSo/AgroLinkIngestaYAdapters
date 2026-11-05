// Deteccion de cruces del umbral de exceso de velocidad severo (spec 015, FR-016; research.md
// D-08). Puro: solo hay evento cuando la velocidad interna cruza el umbral; mientras queda del
// mismo lado, no se envia nada (SC-004). Un exceso dura al menos 20 s antes de poder terminar,
// para no generar rafagas de inicio/fin cuando la velocidad oscila alrededor del umbral.

export const DURACION_MINIMA_MS = 20_000;

/**
 * @param excesoAbierto null | { startTime: Date }
 * @returns { evento: null | 'STARTED' | 'ENDED', excesoAbierto, startTime?, endTime? }
 */
export function detectarCruce(excesoAbierto, velocidadKmh, umbralKmh, ahora) {
  if (!excesoAbierto) {
    if (velocidadKmh > umbralKmh) {
      return { evento: 'STARTED', excesoAbierto: { startTime: ahora }, startTime: ahora };
    }
    return { evento: null, excesoAbierto: null };
  }
  const transcurridoMs = ahora.getTime() - excesoAbierto.startTime.getTime();
  if (velocidadKmh <= umbralKmh && transcurridoMs >= DURACION_MINIMA_MS) {
    return { evento: 'ENDED', excesoAbierto: null, startTime: excesoAbierto.startTime, endTime: ahora };
  }
  return { evento: null, excesoAbierto };
}

/** Fin forzado por fin de viaje (FR-021b): sin minima de 20 s. */
export function forzarFin(excesoAbierto, ahora) {
  if (!excesoAbierto) {
    return { evento: null, excesoAbierto: null };
  }
  return { evento: 'ENDED', excesoAbierto: null, startTime: excesoAbierto.startTime, endTime: ahora };
}
