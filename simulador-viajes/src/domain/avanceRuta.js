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

// Velocidad urbana realista base para camiones de distribucion (35-45 km/h)
const VELOCIDAD_URBANA_OBJETIVO_KMH = 40;

export function avanzar({ ruta, sentido, indiceActual, odometroActualKm, cicloSegundos = 60 }) {
  const itinerario = construirItinerario(ruta, sentido, cicloSegundos);
  const indiceClamp = Math.min(indiceActual, itinerario.length - 1);
  const puntoActual = itinerario[indiceClamp];

  if (indiceClamp >= itinerario.length - 1) {
    return {
      completado: true,
      siguienteIndice: null,
      odometroKm: odometroActualKm,
      gps: { lat: puntoActual.lat, lon: puntoActual.lon, velocidadKmh: 0, rumboGrados: 0, ignicionEncendida: false },
      enParadaEntrega: puntoActual.enParada,
    };
  }

  // Si el punto actual o inmediato es una parada de entrega y el camion debe permanecer detenido:
  const puntoInmediato = itinerario[indiceClamp + 1];
  const esParadaDetenido = puntoInmediato.enParada && haversineKm(puntoActual, puntoInmediato) < 0.001;
  if (esParadaDetenido) {
    return {
      completado: false,
      siguienteIndice: indiceClamp + 1,
      odometroKm: odometroActualKm,
      gps: {
        lat: puntoInmediato.lat,
        lon: puntoInmediato.lon,
        velocidadKmh: 0,
        rumboGrados: 0,
        ignicionEncendida: false,
      },
      enParadaEntrega: true,
    };
  }

  // Variacion realista de velocidad (+/- 3 km/h pseudo-aleatoria)
  const ruidoVelocidad = (Math.random() * 6 - 3);
  const velocidadObjetivo = Math.max(25, VELOCIDAD_URBANA_OBJETIVO_KMH + ruidoVelocidad);
  const distanciaMaximaKm = velocidadObjetivo * (cicloSegundos / 3600);

  let distanciaAcumuladaKm = 0;
  let cursor = indiceClamp;

  while (cursor < itinerario.length - 1) {
    const p1 = itinerario[cursor];
    const p2 = itinerario[cursor + 1];

    // Si encontramos una parada en el camino, nos detenemos en ella
    if (p2.enParada && cursor > indiceClamp) {
      break;
    }

    const dTramo = haversineKm(p1, p2);
    if (distanciaAcumuladaKm + dTramo > distanciaMaximaKm && cursor > indiceClamp) {
      break;
    }

    distanciaAcumuladaKm += dTramo;
    cursor += 1;
  }

  const puntoAlcanzado = itinerario[cursor];
  const completado = cursor >= itinerario.length - 1;
  const velocidadEfectivaKmh = completado && distanciaAcumuladaKm === 0
    ? 0
    : Math.max(15, Math.round(distanciaAcumuladaKm / (cicloSegundos / 3600) || velocidadObjetivo));

  return {
    completado,
    siguienteIndice: completado ? null : cursor,
    odometroKm: odometroActualKm + distanciaAcumuladaKm,
    gps: {
      lat: puntoAlcanzado.lat,
      lon: puntoAlcanzado.lon,
      velocidadKmh: velocidadEfectivaKmh,
      rumboGrados: rumbo(puntoActual, puntoAlcanzado),
      ignicionEncendida: true,
    },
    enParadaEntrega: puntoAlcanzado.enParada,
  };
}
