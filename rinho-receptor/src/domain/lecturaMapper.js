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

// Los que quedan en columnas propias no se duplican en datos_can (D-04). Velocidad de
// rueda (CAN_VELOCIDAD_RUEDA) es el unico identificador soportado que NO se promueve
// (spec 003, Clarifications): sigue viajando solo dentro de datos_can.
const CAN_IDS_PROMOVIDOS = new Set([
  CAN_VIN,
  CAN_RPM,
  CAN_ODOMETRO_ECU_KM,
  CAN_COMBUSTIBLE_CONSUMIDO,
  CAN_COMBUSTIBLE_PCT,
  CAN_TEMP_REFRIGERANTE,
  CAN_PRESION_ACEITE,
]);

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
      // El ECU ya reporta en km (feature 005, research.md D-01/D-02): sin conversion.
      return { odometroKm: km, odometroOrigen: 'ECU' };
    }
  }
  // Fallback: campo GPS, nativamente en metros. Se convierte a km, la unidad de
  // almacenamiento (feature 005). No mezclar unidades entre origenes.
  return { odometroKm: gps.odometroGpsM / 1000, odometroOrigen: 'GPS' };
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

// El VIN es alfanumerico (p. ej. "1M8GDM9A_KP042788"): nunca se convierte a numero, se
// trata como string opaco (contrato rinho-eq-frame.md, discrepancia (c)). Ya no se
// descarta (spec 003, Clarifications, sesion 2026-09-13): la cita previa a "Principio V"
// para descartarlo era una interpretacion demasiado amplia de esa regla (protege datos
// personales de choferes, no identificadores de vehiculo).
function resolveVin(can, camposFaltantes) {
  const raw = can.get(CAN_VIN);
  if (raw === undefined || raw === '') {
    camposFaltantes.push('vin');
    return null;
  }
  return raw;
}

function resolveRpm(can, camposFaltantes) {
  const raw = can.get(CAN_RPM);
  if (raw === undefined || raw === '') {
    camposFaltantes.push('rpm');
    return null;
  }
  const rpm = Number(raw);
  if (Number.isNaN(rpm)) {
    camposFaltantes.push('rpm');
    return null;
  }
  return rpm;
}

// Unidad confirmada en litros (spec 003, Clarifications, sesion 2026-09-13). Sin chequeo
// de rango: se expone tal como lo reporta el vehiculo (spec, Edge Cases).
function resolveCombustibleConsumido(can, camposFaltantes) {
  const raw = can.get(CAN_COMBUSTIBLE_CONSUMIDO);
  if (raw === undefined || raw === '') {
    camposFaltantes.push('combustibleConsumidoL');
    return null;
  }
  const litros = Number(raw);
  if (Number.isNaN(litros)) {
    camposFaltantes.push('combustibleConsumidoL');
    return null;
  }
  return litros;
}

function resolveTemperaturaRefrigerante(can, camposFaltantes) {
  const raw = can.get(CAN_TEMP_REFRIGERANTE);
  if (raw === undefined || raw === '') {
    camposFaltantes.push('temperaturaRefrigeranteC');
    return null;
  }
  const temp = Number(raw);
  if (Number.isNaN(temp)) {
    camposFaltantes.push('temperaturaRefrigeranteC');
    return null;
  }
  return temp;
}

function resolvePresionAceite(can, camposFaltantes) {
  const raw = can.get(CAN_PRESION_ACEITE);
  if (raw === undefined || raw === '') {
    camposFaltantes.push('presionAceiteKpa');
    return null;
  }
  const presion = Number(raw);
  if (Number.isNaN(presion)) {
    camposFaltantes.push('presionAceiteKpa');
    return null;
  }
  return presion;
}

function buildDatosCan(can) {
  const datosCan = {};
  for (const [id, value] of can.entries()) {
    if (CAN_IDS_PROMOVIDOS.has(id)) continue; // ya tienen columna propia (D-04)
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

  const { odometroKm, odometroOrigen } = resolveOdometro(gps, can, camposFaltantes);
  const combustiblePct = resolveCombustiblePct(can, camposFaltantes);
  const vin = resolveVin(can, camposFaltantes);
  const rpm = resolveRpm(can, camposFaltantes);
  const combustibleConsumidoL = resolveCombustibleConsumido(can, camposFaltantes);
  const temperaturaRefrigeranteC = resolveTemperaturaRefrigerante(can, camposFaltantes);
  const presionAceiteKpa = resolvePresionAceite(can, camposFaltantes);
  const datosCan = buildDatosCan(can);

  return {
    dispositivoId: deviceId,
    momentoEvento,
    latitud,
    longitud,
    velocidadKmh,
    rumboGrados: gps.rumboGrados,
    odometroKm,
    odometroOrigen,
    combustiblePct,
    vin,
    rpm,
    combustibleConsumidoL,
    temperaturaRefrigeranteC,
    presionAceiteKpa,
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
