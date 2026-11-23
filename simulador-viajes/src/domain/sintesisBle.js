// Sintetiza temperatura/humedad del segmento BLE para carga refrigerada (caso de
// referencia: medias reses). Tres modos de la feature 009, mas el desvio termico manual de la
// feature 019. Los tres originales (research.md D-06): normal (estable alrededor del
// setpoint), apertura_puerta (pico y recuperacion exponencial) y falla_compresor (sube
// sostenido sin recuperacion, cruza el umbral de alerta). FR-013, FR-015, FR-016, FR-017.

const INCREMENTO_APERTURA_PUERTA_C = 1;
const TOPE_APERTURA_PUERTA_C = 4; // por encima del setpoint (spec, US2)
const INCREMENTO_FALLA_COMPRESOR_C = 0.15;
const FACTOR_RECUPERACION = 0.37; // ~63% de la diferencia recuperada por lectura
const BATERIA_MV = 3012; // sin modelar descarga - fuera de alcance (research.md D-06)

// Feature 019 (research.md D-03): desvio termico manual. Cada trama recorre el 60 % de lo que
// falta hasta el objetivo, asi sale del rango en 1-2 tramas sin un escalon inverosimil.
const FACTOR_ACERCAMIENTO_DESVIO = 0.6;
export const CARGA_DESVIO_DEFAULTS = Object.freeze({ margenC: 4, sinUmbralesC: 8 });

function ruido(amplitud) {
  return (Math.random() * 2 - 1) * amplitud;
}

// Temperatura hacia la que va la carga con el desvio activo: `margenC` grados por fuera del
// umbral del lado pedido o, si el camion no tiene umbrales, `sinUmbralesC` grados del setpoint
// (FR-015).
export function objetivoDesvio({ sentido, umbralMinC, umbralMaxC, setpointTempC, config = CARGA_DESVIO_DEFAULTS }) {
  const conUmbrales = umbralMinC != null && umbralMaxC != null;
  const objetivo = conUmbrales
    ? sentido === 'abajo'
      ? umbralMinC - config.margenC
      : umbralMaxC + config.margenC
    : sentido === 'abajo'
      ? setpointTempC - config.sinUmbralesC
      : setpointTempC + config.sinUmbralesC;
  return Number(objetivo.toFixed(2));
}

// modo: 'normal' | 'apertura_puerta' | 'falla_compresor' | 'desvio_termico'
// umbralMinC/umbralMaxC/sentido/config solo se usan en 'desvio_termico'.
export function sintetizarBle({
  tipoCarga,
  setpointTempC,
  setpointHumedadPct,
  temperaturaAnterior,
  modo,
  umbralMinC = null,
  umbralMaxC = null,
  sentido = 'arriba',
  config = CARGA_DESVIO_DEFAULTS,
}) {
  if (tipoCarga !== 'refrigerada') return null;

  const anterior = temperaturaAnterior ?? setpointTempC;
  let temperaturaC;

  if (modo === 'desvio_termico') {
    const objetivo = objetivoDesvio({ sentido, umbralMinC, umbralMaxC, setpointTempC, config });
    temperaturaC = anterior + (objetivo - anterior) * FACTOR_ACERCAMIENTO_DESVIO + ruido(0.3);
  } else if (modo === 'falla_compresor') {
    temperaturaC = anterior + INCREMENTO_FALLA_COMPRESOR_C;
  } else if (modo === 'apertura_puerta') {
    const objetivo = setpointTempC + TOPE_APERTURA_PUERTA_C;
    temperaturaC = Math.min(objetivo, anterior + INCREMENTO_APERTURA_PUERTA_C);
  } else {
    const diferencia = anterior - setpointTempC;
    temperaturaC = setpointTempC + diferencia * FACTOR_RECUPERACION + ruido(0.3);
  }

  return {
    temperaturaC: Number(temperaturaC.toFixed(2)),
    humedadPct: Number((setpointHumedadPct + ruido(2)).toFixed(2)),
    bateria: BATERIA_MV,
  };
}
