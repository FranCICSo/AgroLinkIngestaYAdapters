// Sintetiza los campos CAN que el equipo real de referencia no reportaba de forma
// confiable (research.md D-05): RPM en funcion de la velocidad, combustible %/consumido en
// funcion de la distancia recorrida (el % con recarga, ver abajo), presion de aceite segun marcha/ralenti. FR-008.
//
// Rango de RPM (feature 012-velocidad-rpm-verosimil, research.md D-07): ralenti 600-800,
// crucero en ruta (velocidad maxima verosimil, 80 km/h) 1200-1800 - nunca el techo RPM_MAX,
// que antes se alcanzaba ya a 60 km/h (700 - 50 + 60*25 = 2200) por una formula pensada para
// velocidades sin acotar. RPM_POR_KMH=10 da 700 + 80*10 = 1500 a velocidad maxima de ruta.

const RPM_RALENTI_BASE = 700;
const RPM_MAX = 2200;
const RPM_POR_KMH = 10;

const COMBUSTIBLE_CONSUMIDO_L_POR_KM = 0.35;

// Feature 016 (ampliacion, research.md D-15): nivel del tanque. Baja con la distancia y, cuando
// la trama anterior quedo debajo de `recargaDebajoPct`, el camion cargo combustible entre esa
// trama y esta: se parte de 100 %. Sin nivel anterior (camion nuevo o proceso reiniciado) se
// sortea un nivel inicial entre el umbral y 100 %, para que la flota no arranque pareja.
export const COMBUSTIBLE_DEFAULTS = Object.freeze({ pctPorKm: 0.05, recargaDebajoPct: 7 });
const TANQUE_LLENO_PCT = 100;

export function nivelCombustibleInicial(recargaDebajoPct, rng = Math.random) {
  return Number((recargaDebajoPct + rng() * (TANQUE_LLENO_PCT - recargaDebajoPct)).toFixed(2));
}

export function sintetizarCombustiblePct({ anteriorPct, distanciaKm, config = COMBUSTIBLE_DEFAULTS, rng = Math.random }) {
  const recargado = anteriorPct != null && anteriorPct < config.recargaDebajoPct;
  const base = anteriorPct == null
    ? nivelCombustibleInicial(config.recargaDebajoPct, rng)
    : recargado ? TANQUE_LLENO_PCT : anteriorPct;
  const pct = Math.max(0, Number((base - distanciaKm * config.pctPorKm).toFixed(2)));
  return { combustiblePct: pct, recargado };
}

const PRESION_ACEITE_MARCHA_KPA = 380;
const PRESION_ACEITE_RALENTI_KPA = 90;

function ruido(amplitud) {
  return (Math.random() * 2 - 1) * amplitud;
}

export function sintetizarCan({
  velocidadKmh,
  distanciaKm,
  combustiblePctAnterior = null,
  combustibleConsumidoLAnterior = 0,
  combustible = COMBUSTIBLE_DEFAULTS,
  rng = Math.random,
}) {
  if (!Number.isFinite(velocidadKmh) || velocidadKmh < 0) {
    throw new Error(`velocidadKmh invalida para sintetizar CAN: ${velocidadKmh}`);
  }
  if (!Number.isFinite(distanciaKm) || distanciaKm < 0) {
    throw new Error(`distanciaKm invalida para sintetizar CAN: ${distanciaKm}`);
  }

  const detenido = velocidadKmh === 0;

  const rpm = detenido
    ? Math.round(RPM_RALENTI_BASE + ruido(20))
    : Math.min(RPM_MAX, Math.round(RPM_RALENTI_BASE + velocidadKmh * RPM_POR_KMH));

  const { combustiblePct, recargado } = sintetizarCombustiblePct({
    anteriorPct: combustiblePctAnterior,
    distanciaKm,
    config: combustible,
    rng,
  });
  const combustibleConsumidoL = Number(
    (combustibleConsumidoLAnterior + distanciaKm * COMBUSTIBLE_CONSUMIDO_L_POR_KM).toFixed(2),
  );

  const presionAceiteKpa = Math.round(
    (detenido ? PRESION_ACEITE_RALENTI_KPA : PRESION_ACEITE_MARCHA_KPA) +
      ruido(detenido ? 10 : 15),
  );

  return { rpm, combustiblePct, combustibleRecargado: recargado, combustibleConsumidoL, presionAceiteKpa };
}
