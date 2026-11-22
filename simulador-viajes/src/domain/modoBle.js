// Modo de sintesis BLE de la trama segun la falla de carga del viaje (sintesisBle.js). Separado
// de index.js para poder testearlo (feature 019, T017).
export function determinarModoBle(viaje, resultado) {
  // Feature 019: el desvio manual no espera un indice, vale desde la trama siguiente a activarlo.
  if (viaje.fallaTipo === 'desvio_termico') {
    return 'desvio_termico';
  }
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
