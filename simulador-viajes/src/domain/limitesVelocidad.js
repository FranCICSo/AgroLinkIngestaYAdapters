// Topes de velocidad verosimil para un camion en Argentina (Ley Nacional de Transito 24.449,
// art. 51): 80 km/h en ruta/zona rural/autopista, 60 km/h como techo unico de "zona urbana"
// (el valor mas permisivo de avenida, ver spec.md Assumptions). Fuente unica para que el
// resampler de rutas (densificacionRutaService.js) y el seed offline no dupliquen estos valores.

export const VELOCIDAD_MAX_URBANA_KMH = 60;
export const VELOCIDAD_MAX_RUTA_KMH = 80;
