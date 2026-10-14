// Cliente OSRM (research.md D-01, D-06): llama a un servidor OSRM gratuito (self-hosted o
// demo publico, ver spec.md § Assumptions) para trazar una ruta sobre calles reales.
//
// Unifica en un unico resultado de fallo los tres casos de research.md D-06: timeout, HTTP
// no-200, y respuesta 200 con `body.code !== "Ok"` (p.ej. "NoRoute") - el llamador
// (routeGenerationService) no necesita distinguirlos, solo loguear el detalle concreto.
//
// `annotations=speed` (feature 012-velocidad-rpm-verosimil, research.md D-02): pide ademas la
// velocidad que el profile de OSRM ya infiere para cada segmento entre dos coordenadas
// consecutivas de la geometria completa - esa es la velocidad "tipica" por tipo de via que usa
// routeGenerationService.js para densificar el trazado (research.md D-03), sin necesidad de
// una clasificacion manual "ciudad/ruta". Unidad: OSRM expresa `annotation.speed` en m/s
// (misma unidad base que `distance` en metros y `duration` en segundos) - se convierte a km/h
// antes de devolverla.
const TIMEOUT_MS = 5000;
const MS_A_KMH = 3.6;

export async function obtenerRutaOsrm(baseUrl, coordenadas) {
  const path = coordenadas.map(({ lat, lon }) => `${lon},${lat}`).join(';');
  const url = `${baseUrl}/route/v1/driving/${path}?overview=full&geometries=geojson&annotations=speed`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    return {
      ok: false,
      detalle: `OSRM no respondio dentro de ${TIMEOUT_MS} ms o fallo la conexion: ${err.message}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    return { ok: false, detalle: `OSRM respondio HTTP ${response.status}` };
  }

  const body = await response.json();
  if (body.code !== 'Ok') {
    return { ok: false, detalle: `OSRM no pudo trazar un camino: ${body.code}` };
  }

  const puntos = body.routes[0].geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));

  // Un `leg` por cada par de waypoints consecutivos del pedido (origen/paradas/destino); sus
  // arrays de `annotation.speed` son contiguos y juntos cubren todos los segmentos entre los
  // puntos de `geometry` (uno de longitud `puntos.length - 1` en total).
  const velocidadesMs = body.routes[0].legs.flatMap((leg) => leg.annotation?.speed ?? []);
  const velocidadPorSegmentoKmh = (indiceSegmento) =>
    (velocidadesMs[indiceSegmento] ?? 0) * MS_A_KMH;

  return { ok: true, puntos, velocidadPorSegmentoKmh };
}
