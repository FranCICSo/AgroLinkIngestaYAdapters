import crypto from 'node:crypto';

// Crudo (GPS parseado + CAN parseado) -> Lectura de Telemetria normalizada.
// Es el unico punto donde el formato Rinho se traduce al modelo de dominio de AgroLink
// (Constitucion, Principio I): nada aguas abajo de esta funcion conoce la trama original.

const CAN_VIN = '1';
const CAN_RPM = '2';
const CAN_VELOCIDAD_RUEDA = '3';
const CAN_ODOMETRO_ECU_KM = 'B';
const CAN_COMBUSTIBLE_CONSUMIDO = '14';
const CAN_COMBUSTIBLE_PCT = '15';
const CAN_TEMP_REFRIGERANTE = '2A';
const CAN_PRESION_ACEITE = '2C';

// Los que quedan en columnas propias no se duplican en datos_can (D-04).
const CAN_IDS_PROMOVIDOS = new Set([CAN_VIN, CAN_ODOMETRO_ECU_KM, CAN_COMBUSTIBLE_PCT]);

function isValidLatitud(v) {
  return v >= -90 && v <= 90;
}
function isValidLongitud(v) {
  return v >= -180 && v <= 180;
}
function isValidVelocidad(v) {
  return v >= 0 && v <= 200;
}
function isValidCombustible(v) {
  return v >= 0 && v <= 100;
}

function resolveMomentoEvento(gps, camposFaltantes, horaUtcOffsetHours) {
  if (gps.fechaHoraEnCeros) {
    camposFaltantes.push('momentoEvento');
    return new Date(); // hora de recepcion (D-08)
  }
  // gps.mes/dia vienen 1-indexados; Date usa mes 0-indexado.
  //
  // El contrato del fabricante documenta este campo como UTC (contracts/rinho-eq-frame.md
  // §3, verificado contra la trama de referencia oficial). horaUtcOffsetHours existe SOLO
  // como parche de despliegue para un equipo concreto configurado con hora local en vez de
  // UTC (D-12, research.md) — el default es 0 (protocolo tal cual documentado). Sumar horas
  // corrige de local a UTC real; Date.UTC hace el acarreo de dia/mes/anio automaticamente si
  // se pasa de 23h.
  return new Date(
    Date.UTC(gps.anio, gps.mes - 1, gps.dia, gps.hora + horaUtcOffsetHours, gps.minuto, gps.segundo),
  );
}

function resolveOdometro(gps, can, camposFaltantes) {
  const ecuKmRaw = can.get(CAN_ODOMETRO_ECU_KM);
  if (ecuKmRaw !== undefined && ecuKmRaw !== '') {
    const km = Number(ecuKmRaw);
    if (!Number.isNaN(km)) {
      return { odometroM: Math.round(km * 1000), odometroOrigen: 'ECU' };
    }
  }
  // Fallback: campo GPS, ya en metros (D-05). No mezclar unidades: ECU en km, GPS en metros.
  return { odometroM: gps.odometroGpsM, odometroOrigen: 'GPS' };
}

function resolveCombustiblePct(can, camposFaltantes) {
  const raw = can.get(CAN_COMBUSTIBLE_PCT);
  if (raw === undefined || raw === '') {
    camposFaltantes.push('combustiblePct');
    return null; // ausente es el caso normal (FR-002/FR-004), no una anomalia
  }
  const pct = Number(raw);
  if (Number.isNaN(pct) || !isValidCombustible(pct)) {
    camposFaltantes.push('combustiblePct');
    return null;
  }
  return pct;
}

function buildDatosCan(can) {
  const datosCan = {};
  for (const [id, value] of can.entries()) {
    if (CAN_IDS_PROMOVIDOS.has(id)) continue; // VIN descartado; ECU-km y combustible ya en columnas
    datosCan[id] = value;
  }
  return datosCan;
}

export function mapFrameToLectura({ deviceId, gps, can, payloadCrudo, msgNum, horaUtcOffsetHours = 0 }) {
  const camposFaltantes = [];

  const momentoEvento = resolveMomentoEvento(gps, camposFaltantes, horaUtcOffsetHours);

  let latitud = gps.latitud;
  if (!isValidLatitud(latitud)) {
    camposFaltantes.push('latitud');
    latitud = null;
  }

  let longitud = gps.longitud;
  if (!isValidLongitud(longitud)) {
    camposFaltantes.push('longitud');
    longitud = null;
  }

  let velocidadKmh = gps.velocidadKmh;
  if (!isValidVelocidad(velocidadKmh)) {
    camposFaltantes.push('velocidadKmh');
    velocidadKmh = null;
  }

  const { odometroM, odometroOrigen } = resolveOdometro(gps, can, camposFaltantes);
  const combustiblePct = resolveCombustiblePct(can, camposFaltantes);
  const datosCan = buildDatosCan(can);

  return {
    dispositivoId: deviceId,
    momentoEvento,
    latitud,
    longitud,
    velocidadKmh,
    rumboGrados: gps.rumboGrados,
    odometroM,
    odometroOrigen,
    combustiblePct,
    ignicion: gps.ignicion,
    tensionBateriaV: gps.tensionBateriaV,
    satelites: gps.satelites,
    estadoInterpretacion: camposFaltantes.length > 0 ? 'PARCIAL' : 'COMPLETA',
    camposFaltantes,
    datosCan,
    // Byte a byte, sin trim ni normalizacion (FR-003).
    payloadCrudo,
    frameHash: crypto.createHash('sha256').update(payloadCrudo).digest('hex'),
    msgNum: msgNum || null,
    reporteId: gps.reporteId,
  };
}
