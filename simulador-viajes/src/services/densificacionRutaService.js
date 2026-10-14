// Densifica el trazado de una ruta (feature 012-velocidad-rpm-verosimil, research.md D-04):
// inserta puntos intermedios donde dos vertices consecutivos del trazado original (de OSRM o
// de datos ya capturados/hechos a mano) estan mas separados de lo recorrible, a la velocidad
// maxima verosimil del tramo, en un ciclo de simulacion. Corre una sola vez al generar/cargar
// la ruta (research.md D-05) - avanceRuta.js sigue avanzando un punto por ciclo sin cambios.
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

function interpolarLineal(a, b, fraccion) {
  return {
    lat: a.lat + (b.lat - a.lat) * fraccion,
    lon: a.lon + (b.lon - a.lon) * fraccion,
  };
}

// `puntos` es el array completo [p0, p1, ..., pN]; el segmento `i` va de `puntos[i]` a
// `puntos[i+1]`. `velocidadPorSegmentoKmh` es un numero fijo (toda la ruta a una sola
// velocidad objetivo, ver research.md D-05) o una funcion `(indiceSegmento) -> velocidadKmh`
// (una velocidad distinta por segmento, ver research.md D-02/D-03).
export function densificarTrazado(puntos, { cicloSegundos, velocidadPorSegmentoKmh }) {
  const resolverVelocidad =
    typeof velocidadPorSegmentoKmh === 'function'
      ? velocidadPorSegmentoKmh
      : () => velocidadPorSegmentoKmh;

  const resultado = [puntos[0]];

  for (let i = 0; i < puntos.length - 1; i += 1) {
    const a = puntos[i];
    const b = puntos[i + 1];
    const distanciaKm = haversineKm(a, b);
    const velocidadKmh = resolverVelocidad(i);
    const distanciaMaximaKm = (velocidadKmh * cicloSegundos) / 3600;

    if (distanciaKm > distanciaMaximaKm && distanciaMaximaKm > 0) {
      const subTramos = Math.ceil(distanciaKm / distanciaMaximaKm);
      for (let sub = 1; sub < subTramos; sub += 1) {
        resultado.push(interpolarLineal(a, b, sub / subTramos));
      }
    }

    resultado.push(b);
  }

  return resultado;
}
