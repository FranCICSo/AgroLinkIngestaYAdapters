// Sintetiza temperatura/humedad del segmento BLE para carga refrigerada (caso de
// referencia: medias reses). Tres modos (research.md D-06): normal (estable alrededor del
// setpoint), apertura_puerta (pico y recuperacion exponencial) y falla_compresor (sube
// sostenido sin recuperacion, cruza el umbral de alerta). FR-013, FR-015, FR-016, FR-017.

const INCREMENTO_APERTURA_PUERTA_C = 1;
const TOPE_APERTURA_PUERTA_C = 4; // por encima del setpoint (spec, US2)
const INCREMENTO_FALLA_COMPRESOR_C = 0.15;
const FACTOR_RECUPERACION = 0.37; // ~63% de la diferencia recuperada por lectura
const BATERIA_MV = 3012; // sin modelar descarga - fuera de alcance (research.md D-06)

function ruido(amplitud) {
  return (Math.random() * 2 - 1) * amplitud;
}

// modo: 'normal' | 'apertura_puerta' | 'falla_compresor'
export function sintetizarBle({ tipoCarga, setpointTempC, setpointHumedadPct, temperaturaAnterior, modo }) {
  if (tipoCarga !== 'refrigerada') return null;

  const anterior = temperaturaAnterior ?? setpointTempC;
  let temperaturaC;

  if (modo === 'falla_compresor') {
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
