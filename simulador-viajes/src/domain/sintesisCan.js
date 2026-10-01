// Sintetiza los campos CAN que el equipo real de referencia no reportaba de forma
// confiable (research.md D-05): RPM en funcion de la velocidad, combustible %/consumido en
// funcion de la distancia recorrida, presion de aceite segun marcha/ralenti. FR-008.

const RPM_RALENTI_BASE = 750;
const RPM_MAX = 2200;
const RPM_POR_KMH = 25;

const COMBUSTIBLE_PCT_POR_KM = 0.05;
const COMBUSTIBLE_CONSUMIDO_L_POR_KM = 0.35;

const PRESION_ACEITE_MARCHA_KPA = 380;
const PRESION_ACEITE_RALENTI_KPA = 90;

function ruido(amplitud) {
  return (Math.random() * 2 - 1) * amplitud;
}

export function sintetizarCan({
  velocidadKmh,
  distanciaKm,
  combustiblePctAnterior = 85,
  combustibleConsumidoLAnterior = 0,
  combustiblePctMinimo = 5,
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
    : Math.min(RPM_MAX, Math.round(RPM_RALENTI_BASE - 50 + velocidadKmh * RPM_POR_KMH));

  const combustiblePct = Math.max(
    combustiblePctMinimo,
    Number((combustiblePctAnterior - distanciaKm * COMBUSTIBLE_PCT_POR_KM).toFixed(2)),
  );
  const combustibleConsumidoL = Number(
    (combustibleConsumidoLAnterior + distanciaKm * COMBUSTIBLE_CONSUMIDO_L_POR_KM).toFixed(2),
  );

  const presionAceiteKpa = Math.round(
    (detenido ? PRESION_ACEITE_RALENTI_KPA : PRESION_ACEITE_MARCHA_KPA) +
      ruido(detenido ? 10 : 15),
  );

  return { rpm, combustiblePct, combustibleConsumidoL, presionAceiteKpa };
}
