// Temperatura del refrigerante del motor (campo CAN 2A) de cada trama simulada. Feature
// 016-alerta-temperatura-motor, research.md D-01 / FR-001, FR-002, FR-005, FR-006.
//
// Tres modos, mismo patron que sintesisBle.js (temperatura anterior en memoria):
//   normal             -> se acerca al objetivo (88 C en marcha, 84 C en ralenti), acotado a
//                         [80, 95] C: nunca alcanza el umbral de alerta (105 C por defecto).
//   sobrecalentamiento -> sube `subidaCPorTrama` por trama hasta `picoC` y oscila ahi.
//   enfriamiento       -> fuera de falla pero por encima de la banda normal: baja
//                         ENFRIAMIENTO_C_POR_TRAMA por trama (mas rapido que la subida, para que
//                         la alerta se resuelva sola en pocos minutos - SC-005).
// La salida es entera: la ingesta guarda SMALLINT y expone Integer.

export const BANDA_NORMAL_MIN_C = 80;
export const BANDA_NORMAL_MAX_C = 95;
const OBJETIVO_MARCHA_C = 88;
const OBJETIVO_RALENTI_C = 84;
const FACTOR_ACERCAMIENTO = 0.3;
const RUIDO_C = 0.5;
// 1.5 y no 2: base es entera (valor anterior emitido) y el redondeo de base + paso agrega hasta
// 0.5, asi que la diferencia emitida queda en <= 2 C.
const MAX_PASO_NORMAL_C = 1.5;
export const ENFRIAMIENTO_C_POR_TRAMA = 3;

function ruido(rng) {
  return (rng() * 2 - 1) * RUIDO_C;
}

function acotar(valor, min, max) {
  return Math.min(max, Math.max(min, valor));
}

// activa: la falla de motor esta vigente en esta trama (ver fallaMotor.estadoFallaMotor).
export function determinarModoMotor({ activa, temperaturaAnterior }) {
  if (activa) return 'sobrecalentamiento';
  if (temperaturaAnterior != null && temperaturaAnterior > BANDA_NORMAL_MAX_C) return 'enfriamiento';
  return 'normal';
}

// temperaturaAnterior: ultimo valor emitido para este camion en este viaje (null al arrancar).
// ralenti: el camion esta detenido en esta trama.
// config: { subidaCPorTrama, picoC } (loadMotorConfig).
export function sintetizarTemperaturaMotor({ temperaturaAnterior, ralenti, modo, config, rng = Math.random }) {
  const objetivo = ralenti ? OBJETIVO_RALENTI_C : OBJETIVO_MARCHA_C;
  const anterior = temperaturaAnterior ?? objetivo;
  let temperatura;

  if (modo === 'sobrecalentamiento') {
    temperatura = anterior >= config.picoC
      ? config.picoC + ruido(rng)
      : Math.min(config.picoC, anterior + config.subidaCPorTrama);
  } else if (modo === 'enfriamiento') {
    temperatura = Math.max(BANDA_NORMAL_MAX_C, anterior - ENFRIAMIENTO_C_POR_TRAMA);
  } else {
    // Normal. Partiendo de un valor fuera de la banda (no deberia pasar: el enfriamiento la
    // devuelve a 95), se acota igual para garantizar FR-002.
    // El paso se acota a MAX_PASO_NORMAL_C para que dos tramas consecutivas no difieran en mas
    // de 2 C (FR-002), aun sumando el redondeo.
    const base = acotar(anterior, BANDA_NORMAL_MIN_C, BANDA_NORMAL_MAX_C);
    const paso = acotar((objetivo - base) * FACTOR_ACERCAMIENTO + ruido(rng), -MAX_PASO_NORMAL_C, MAX_PASO_NORMAL_C);
    temperatura = acotar(base + paso, BANDA_NORMAL_MIN_C, BANDA_NORMAL_MAX_C);
  }

  return Math.round(temperatura);
}
