// Avanza un camion simulado sobre su ruta: posicion/velocidad/rumbo/odometro coherentes
// con el recorrido y el tiempo entre tramas (FR-006), velocidad 0 + ignicion apagada
// durante una parada de entrega (FR-007), y deteccion de fin de ruta para el viaje de
// vuelta automatico (FR-014, resuelto por quien llama via db/flotaRepository.js).
//
// `ruta.paradas` declara en que indice de `ruta.puntos` (orden "ida") hay una entrega y
// cuantos minutos dura. Para simular esa espera sin agregar columnas nuevas a
// `simulador.viaje`, se expande la ruta en un "itinerario" donde el punto de parada se
// repite tantos ciclos como haga falta (research.md no lo documenta como decision aparte
// porque es un detalle interno de esta funcion, no una decision de schema).

const RADIO_TIERRA_KM = 6371;

function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const senoLat = Math.sin(dLat / 2);
  const senoLon = Math.sin(dLon / 2);
  const h =
    senoLat * senoLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * senoLon * senoLon;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function rumbo(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function construirItinerario(ruta, sentido, cicloSegundos) {
  const puntosOrden = sentido === 'ida' ? ruta.puntos : [...ruta.puntos].reverse();
  const totalPuntos = puntosOrden.length;

  const duracionPorIndice = new Map();
  for (const parada of ruta.paradas || []) {
    const indiceEnOrden = sentido === 'ida' ? parada.indice : totalPuntos - 1 - parada.indice;
    duracionPorIndice.set(indiceEnOrden, parada.duracionMin ?? parada.duracion_min ?? 5);
  }

  const itinerario = [];
  puntosOrden.forEach((punto, idx) => {
    const esParada = duracionPorIndice.has(idx);
    itinerario.push({ lat: punto.lat, lon: punto.lon, enParada: esParada });
    if (esParada) {
      const ticksTotales = Math.max(1, Math.round((duracionPorIndice.get(idx) * 60) / cicloSegundos));
      for (let i = 1; i < ticksTotales; i += 1) {
        itinerario.push({ lat: punto.lat, lon: punto.lon, enParada: true });
      }
    }
  });
  return itinerario;
}

export function avanzar({ ruta, sentido, indiceActual, odometroActualKm, cicloSegundos = 60 }) {
  const itinerario = construirItinerario(ruta, sentido, cicloSegundos);
  const indiceClamp = Math.min(indiceActual, itinerario.length - 1);
  const puntoActual = itinerario[indiceClamp];
  const siguienteIndice = indiceClamp + 1;

  if (siguienteIndice >= itinerario.length) {
    return {
      completado: true,
      siguienteIndice: null,
      odometroKm: odometroActualKm,
      gps: { lat: puntoActual.lat, lon: puntoActual.lon, velocidadKmh: 0, rumboGrados: 0, ignicionEncendida: false },
      enParadaEntrega: puntoActual.enParada,
    };
  }

  const puntoSiguiente = itinerario[siguienteIndice];
  const distanciaKm = haversineKm(puntoActual, puntoSiguiente);
  const detenido = puntoSiguiente.enParada && distanciaKm < 0.001;

  return {
    completado: false,
    siguienteIndice,
    odometroKm: detenido ? odometroActualKm : odometroActualKm + distanciaKm,
    gps: {
      lat: puntoSiguiente.lat,
      lon: puntoSiguiente.lon,
      velocidadKmh: detenido ? 0 : distanciaKm / (cicloSegundos / 3600),
      rumboGrados: detenido ? 0 : rumbo(puntoActual, puntoSiguiente),
      ignicionEncendida: !detenido,
    },
    enParadaEntrega: puntoSiguiente.enParada,
  };
}
