// Genera y persiste una fila de simulador.ruta a partir de origen/destino (feature
// 011-generar-ruta-simulada), reemplazando el INSERT manual. Un unico servicio detras de
// los dos entry points (HTTP y CLI - research.md D-05): ninguno de los dos duplica esta
// logica.
import { log } from '../log.js';
import { obtenerRutaOsrm } from '../net/osrmClient.js';
import { insertarRuta } from '../db/rutaRepository.js';
import { densificarTrazado } from './densificacionRutaService.js';
import { VELOCIDAD_MAX_RUTA_KMH } from '../domain/limitesVelocidad.js';
import { enRangoReservado } from '../domain/rangoDispositivoSimulado.js';
import { iniciarViajeParaCamion } from './iniciarViajeService.js';

const TIPOS_CARGA_VALIDOS = ['seca', 'refrigerada'];

// Mismo default que `avanzar()` en avanceRuta.js (feature 012-velocidad-rpm-verosimil,
// research.md D-04): el ciclo de simulacion que gobierna cuanta distancia es "recorrible" al
// densificar el trazado.
const CICLO_SEGUNDOS_DEFAULT = 60;

// FR-009 / research.md D-02: descarta "mismo punto" o un error de tipeo en una coordenada
// sin rechazar trayectos urbanos cortos legitimos.
const DISTANCIA_MINIMA_METROS = 50;
const RADIO_TIERRA_METROS = 6371000;

function aRadianes(grados) {
  return (grados * Math.PI) / 180;
}

function distanciaHaversineMetros(a, b) {
  const dLat = aRadianes(b.lat - a.lat);
  const dLon = aRadianes(b.lon - a.lon);
  const lat1 = aRadianes(a.lat);
  const lat2 = aRadianes(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_METROS * Math.asin(Math.sqrt(Math.min(1, h)));
}

function validarCamion(camion) {
  if (!camion.id || !enRangoReservado(camion.id)) {
    return {
      valido: false,
      detalle: 'camion.id es obligatorio y debe estar en el rango reservado 900001-900999',
    };
  }
  if (camion.tipoCarga !== undefined && !TIPOS_CARGA_VALIDOS.includes(camion.tipoCarga)) {
    return {
      valido: false,
      detalle: `camion.tipoCarga debe ser uno de: ${TIPOS_CARGA_VALIDOS.join(', ')}`,
    };
  }
  if (
    camion.odometroInicialKm !== undefined &&
    camion.odometroInicialKm !== null &&
    !(Number.isFinite(camion.odometroInicialKm) && camion.odometroInicialKm >= 0)
  ) {
    return { valido: false, detalle: 'camion.odometroInicialKm debe ser un numero >= 0' };
  }
  return { valido: true };
}

function validarEntrada({ nombre, origen, destino, paradas, camion }) {
  if (!nombre || nombre.trim() === '') {
    return { valido: false, detalle: 'nombre no puede estar vacio' };
  }
  if (distanciaHaversineMetros(origen, destino) < DISTANCIA_MINIMA_METROS) {
    return {
      valido: false,
      detalle: `origen y destino estan a menos de ${DISTANCIA_MINIMA_METROS} m entre si`,
    };
  }
  for (const parada of paradas) {
    if (
      typeof parada.lat !== 'number' ||
      typeof parada.lon !== 'number' ||
      !(parada.duracionMin > 0)
    ) {
      return {
        valido: false,
        detalle: 'cada parada requiere lat/lon numericos y duracionMin > 0',
      };
    }
  }
  if (camion !== undefined) {
    const validacionCamion = validarCamion(camion);
    if (!validacionCamion.valido) {
      return validacionCamion;
    }
  }
  return { valido: true };
}

// research.md D-07: la geometria completa que devuelve OSRM no necesariamente repite la
// coordenada exacta de una parada como vertice propio; se graba el indice del punto mas
// cercano dentro de `puntos`, mismo shape que ya consume avanceRuta.js (feature 009).
// Exportada para reutilizarla en scripts/densificar-seed.js (feature 012-velocidad-rpm-verosimil,
// research.md D-05): mismo criterio de "punto mas cercano" para remapear `paradas` tras
// densificar, tanto para una ruta nueva (este archivo) como para los datos ya sembrados.
export function indiceMasCercano(puntos, objetivo) {
  let mejorIndice = 0;
  let mejorDistancia = Infinity;
  puntos.forEach((punto, indice) => {
    const distancia = distanciaHaversineMetros(punto, objetivo);
    if (distancia < mejorDistancia) {
      mejorDistancia = distancia;
      mejorIndice = indice;
    }
  });
  return mejorIndice;
}

export async function generarRuta(pool, osrmBaseUrl, input) {
  const { nombre, origen, destino, paradas = [], camion } = input;

  const validacion = validarEntrada({ nombre, origen, destino, paradas, camion });
  if (!validacion.valido) {
    log.warn('Generacion de ruta rechazada por validacion', {
      nombre,
      origen,
      destino,
      motivo: validacion.detalle,
    });
    return { ok: false, motivo: 'validacion', detalle: validacion.detalle };
  }

  const coordenadas = [origen, ...paradas, destino];
  const resultadoOsrm = await obtenerRutaOsrm(osrmBaseUrl, coordenadas);
  if (!resultadoOsrm.ok) {
    log.warn('Generacion de ruta rechazada: OSRM no pudo trazar un camino', {
      nombre,
      origen,
      destino,
      detalle: resultadoOsrm.detalle,
    });
    return { ok: false, motivo: 'trazado_no_disponible', detalle: resultadoOsrm.detalle };
  }

  // Feature 012-velocidad-rpm-verosimil: densificar ANTES de resolver los indices de parada
  // (research.md D-04), para que `indiceMasCercano` ya busque sobre el trazado final - si se
  // hiciera al reves, los indices de parada quedarian apuntando al trazado viejo.
  const puntos = densificarTrazado(resultadoOsrm.puntos, {
    cicloSegundos: CICLO_SEGUNDOS_DEFAULT,
    velocidadPorSegmentoKmh: (indiceSegmento) =>
      Math.min(resultadoOsrm.velocidadPorSegmentoKmh(indiceSegmento), VELOCIDAD_MAX_RUTA_KMH),
  });
  const paradasConIndice = paradas.map((parada) => ({
    indice: indiceMasCercano(puntos, parada),
    duracion_min: parada.duracionMin,
  }));

  const resultadoInsert = await insertarRuta(pool, { nombre, puntos, paradas: paradasConIndice });
  if (!resultadoInsert.ok) {
    log.warn('Generacion de ruta rechazada: nombre duplicado', { nombre });
    return resultadoInsert;
  }

  if (!camion) {
    return { ok: true, ruta: resultadoInsert.ruta };
  }

  // La ruta ya quedo persistida: si este paso fallara, no se deshace (mismo criterio que el
  // resto del servicio no hace rollback manual, ver research.md D-03 de la feature 011) - es
  // el camino feliz, ya validado arriba (camion.id en rango reservado).
  const viaje = await iniciarViajeParaCamion(pool, { camion, rutaId: resultadoInsert.ruta.id });
  log.info('Viaje iniciado sobre la ruta nueva', {
    rutaId: resultadoInsert.ruta.id,
    dispositivoId: viaje.dispositivoId,
  });

  return { ok: true, ruta: resultadoInsert.ruta, viaje };
}
