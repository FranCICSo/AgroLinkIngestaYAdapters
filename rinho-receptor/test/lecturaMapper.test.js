import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mapFrameToLectura } from '../src/domain/lecturaMapper.js';
import { parseGpsSection } from '../src/protocol/eqParser.js';
import { parseCanSection } from '../src/protocol/canObd.js';

const VENDOR_FRAME =
  '>REQ00000000000000-2780656-064296830000117F00000010836F1130112FFFF1117;1=,2=,3=,B=,14=,15=,2A=,2C=;ID=2326;*01<';
const REAL_FRAME =
  '>REQ00210918170359-2778100-064258570001517F000000000049D13010900001516;1=1M8GDM9A_KP042788,2=2200,3=45,B=66010,14=30000,15=75,2A=90,2C=340;ID=037883;*01<';

function buildLectura(fullFrame, deviceId, msgNum = null) {
  const body = fullFrame.slice(4, fullFrame.indexOf(';ID='));
  const [gpsText, canText] = body.split(';');
  const gps = parseGpsSection(gpsText);
  const can = parseCanSection(canText || '');
  return mapFrameToLectura({ deviceId, gps, can, payloadCrudo: fullFrame, msgNum });
}

test('caso completo (CAN poblado): mapea los campos de dominio, incluido VIN/RPM/combustible consumido/temp/presion', () => {
  const lectura = buildLectura(REAL_FRAME, '037883');
  assert.equal(lectura.dispositivoId, '037883');
  assert.equal(lectura.latitud, -27.781);
  assert.equal(lectura.longitud, -64.25857);
  assert.equal(lectura.velocidadKmh, 0);
  assert.equal(lectura.combustiblePct, 75);
  assert.equal(lectura.vin, '1M8GDM9A_KP042788');
  assert.equal(lectura.rpm, 2200);
  assert.equal(lectura.combustibleConsumidoL, 30000);
  assert.equal(lectura.temperaturaRefrigeranteC, 90);
  assert.equal(lectura.presionAceiteKpa, 340);
  assert.equal(lectura.estadoInterpretacion, 'COMPLETA');
  assert.equal(lectura.camposFaltantes.length, 0);
});

test('fallback de odometro: CAN B (ECU, km) tiene prioridad sobre GPS (metros)', () => {
  const lectura = buildLectura(REAL_FRAME, '037883');
  // CAN B = 66010 km, ya en la unidad de almacenamiento: sin conversion (D-01, D-02).
  assert.equal(lectura.odometroKm, 66010);
  assert.equal(lectura.odometroOrigen, 'ECU');
});

test('sin dato CAN B: usa el campo GPS (nativamente en metros) como fallback, convertido a km', () => {
  const lectura = buildLectura(VENDOR_FRAME, '2326');
  assert.equal(lectura.odometroKm, 0x010836f1 / 1000);
  assert.equal(lectura.odometroOrigen, 'GPS');
});

test('combustible ausente (CAN 15 vacio) es normal, no anomalia: PARCIAL con campo listado', () => {
  const lectura = buildLectura(VENDOR_FRAME, '2326');
  assert.equal(lectura.combustiblePct, null);
  assert.equal(lectura.estadoInterpretacion, 'PARCIAL');
  assert.ok(lectura.camposFaltantes.includes('combustiblePct'));
});

test('el VIN (CAN 1) ya no se descarta: se captura como campo propio, string opaco sin convertir a numero', () => {
  // El VIN ya no se descarta (spec 003, Clarifications, sesion 2026-09-13): la cita previa
  // a "Principio V" era una interpretacion demasiado amplia de esa regla (protege datos
  // personales de choferes, no identificadores de vehiculo). payload_crudo SIEMPRE
  // conservo el VIN byte a byte (FR-003); ahora tambien queda en el campo de dominio.
  const lectura = buildLectura(REAL_FRAME, '037883');
  assert.equal(lectura.vin, '1M8GDM9A_KP042788');
  assert.equal(typeof lectura.vin, 'string');
  assert.equal(lectura.datosCan['1'], undefined); // promovido: no se duplica en datos_can
});

test('vin ausente (CAN 1 vacio) es normal, no anomalia: PARCIAL con campo listado', () => {
  const lectura = buildLectura(VENDOR_FRAME, '2326');
  assert.equal(lectura.vin, null);
  assert.ok(lectura.camposFaltantes.includes('vin'));
});

test('solo velocidad de rueda (CAN 3) queda en datos_can: los demas IDs soportados ya tienen columna propia', () => {
  const lectura = buildLectura(REAL_FRAME, '037883');
  assert.equal(lectura.datosCan['3'], '45');
  assert.equal(lectura.datosCan['1'], undefined);
  assert.equal(lectura.datosCan['2'], undefined);
  assert.equal(lectura.datosCan['14'], undefined);
  assert.equal(lectura.datosCan['2A'], undefined);
  assert.equal(lectura.datosCan['2C'], undefined);
});

test('rpm (CAN 2): completo, ausente e invalido', () => {
  const completo = buildLectura(REAL_FRAME, '037883');
  assert.equal(completo.rpm, 2200);

  const ausente = buildLectura(VENDOR_FRAME, '2326');
  assert.equal(ausente.rpm, null);
  assert.ok(ausente.camposFaltantes.includes('rpm'));

  const invalido = buildLectura(REAL_FRAME.replace('2=2200', '2=ABC'), '037883');
  assert.equal(invalido.rpm, null);
  assert.ok(invalido.camposFaltantes.includes('rpm'));
});

test('combustible consumido / "Odolitro" (CAN 14, litros): completo, ausente e invalido', () => {
  const completo = buildLectura(REAL_FRAME, '037883');
  assert.equal(completo.combustibleConsumidoL, 30000);

  const ausente = buildLectura(VENDOR_FRAME, '2326');
  assert.equal(ausente.combustibleConsumidoL, null);
  assert.ok(ausente.camposFaltantes.includes('combustibleConsumidoL'));

  const invalido = buildLectura(REAL_FRAME.replace('14=30000', '14=ABC'), '037883');
  assert.equal(invalido.combustibleConsumidoL, null);
  assert.ok(invalido.camposFaltantes.includes('combustibleConsumidoL'));
});

test('temperatura de refrigerante (CAN 2A): completo, ausente e invalido', () => {
  const completo = buildLectura(REAL_FRAME, '037883');
  assert.equal(completo.temperaturaRefrigeranteC, 90);

  const ausente = buildLectura(VENDOR_FRAME, '2326');
  assert.equal(ausente.temperaturaRefrigeranteC, null);
  assert.ok(ausente.camposFaltantes.includes('temperaturaRefrigeranteC'));

  const invalido = buildLectura(REAL_FRAME.replace('2A=90', '2A=ABC'), '037883');
  assert.equal(invalido.temperaturaRefrigeranteC, null);
  assert.ok(invalido.camposFaltantes.includes('temperaturaRefrigeranteC'));
});

test('presion de aceite (CAN 2C): completo, ausente e invalido', () => {
  const completo = buildLectura(REAL_FRAME, '037883');
  assert.equal(completo.presionAceiteKpa, 340);

  const ausente = buildLectura(VENDOR_FRAME, '2326');
  assert.equal(ausente.presionAceiteKpa, null);
  assert.ok(ausente.camposFaltantes.includes('presionAceiteKpa'));

  const invalido = buildLectura(REAL_FRAME.replace('2C=340', '2C=ABC'), '037883');
  assert.equal(invalido.presionAceiteKpa, null);
  assert.ok(invalido.camposFaltantes.includes('presionAceiteKpa'));
});

test('un ID CAN desconocido igual se conserva en datos_can (salvo los IDs promovidos a columna)', () => {
  const full = REAL_FRAME.replace('2C=340', '2C=340,99=misterioso');
  const lectura = buildLectura(full, '037883');
  assert.equal(lectura.datosCan['99'], 'misterioso');
});

test('dato invalido: latitud fuera de rango -> campo NULL + PARCIAL + campos_faltantes', () => {
  const gps = parseGpsSection(
    '00210918170359-9990000-064258570001517F000000000049D13010900001516',
  );
  const can = parseCanSection('15=75');
  const lectura = mapFrameToLectura({
    deviceId: '037883',
    gps,
    can,
    payloadCrudo: 'x',
    msgNum: null,
  });
  assert.equal(lectura.latitud, null);
  assert.equal(lectura.estadoInterpretacion, 'PARCIAL');
  assert.ok(lectura.camposFaltantes.includes('latitud'));
});

test('dato invalido: velocidad negativa -> campo NULL + PARCIAL', () => {
  const gps = parseGpsSection(REAL_FRAME.slice(4, 4 + 66).replace('000151', '-01151'));
  const can = parseCanSection('15=75');
  const lectura = mapFrameToLectura({
    deviceId: '037883',
    gps,
    can,
    payloadCrudo: 'x',
    msgNum: null,
  });
  assert.equal(lectura.velocidadKmh, null);
  assert.ok(lectura.camposFaltantes.includes('velocidadKmh'));
});

test('dato invalido: combustible > 100 -> campo NULL + PARCIAL', () => {
  const gps = parseGpsSection(REAL_FRAME.slice(4, 4 + 66));
  const can = parseCanSection('15=150');
  const lectura = mapFrameToLectura({
    deviceId: '037883',
    gps,
    can,
    payloadCrudo: 'x',
    msgNum: null,
  });
  assert.equal(lectura.combustiblePct, null);
  assert.ok(lectura.camposFaltantes.includes('combustiblePct'));
});

test('fecha/hora en ceros -> momento_evento de recepcion + PARCIAL', () => {
  const gps = parseGpsSection(
    '00000000000000-2780656-064296830000117F00000010836F1130112FFFF1117',
  );
  const can = parseCanSection('15=,2=,3=,B=,14=,2A=,2C=,1=');
  const before = Date.now();
  const lectura = mapFrameToLectura({
    deviceId: '2326',
    gps,
    can,
    payloadCrudo: 'x',
    msgNum: null,
  });
  const after = Date.now();
  assert.ok(lectura.momentoEvento.getTime() >= before);
  assert.ok(lectura.momentoEvento.getTime() <= after);
  assert.equal(lectura.estadoInterpretacion, 'PARCIAL');
  assert.ok(lectura.camposFaltantes.includes('momentoEvento'));
});

test('horaUtcOffsetHours default (0): el campo hora se toma tal cual, como UTC (D-12)', () => {
  // REAL_FRAME trae fecha 21/09/18, hora 17:03:59 (documentado como UTC en el contrato).
  const lectura = buildLectura(REAL_FRAME, '037883');
  assert.equal(lectura.momentoEvento.toISOString(), '2018-09-21T17:03:59.000Z');
});

test('horaUtcOffsetHours != 0: parche de despliegue (D-12) para equipo con hora local', () => {
  const body = REAL_FRAME.slice(4, REAL_FRAME.indexOf(';ID='));
  const [gpsText, canText] = body.split(';');
  const gps = parseGpsSection(gpsText);
  const can = parseCanSection(canText || '');
  const lectura = mapFrameToLectura({
    deviceId: '037883',
    gps,
    can,
    payloadCrudo: REAL_FRAME,
    msgNum: null,
    horaUtcOffsetHours: 3,
  });
  // 17:03:59 local (UTC-3) + 3h = 20:03:59 UTC real.
  assert.equal(lectura.momentoEvento.toISOString(), '2018-09-21T20:03:59.000Z');
});

test('horaUtcOffsetHours: el acarreo de dia funciona (Date.UTC normaliza el overflow)', () => {
  const body = REAL_FRAME.slice(4, REAL_FRAME.indexOf(';ID='));
  const [gpsText, canText] = body.split(';');
  // Forzar una hora cercana a medianoche para probar el acarreo de dia/mes.
  const gpsTextTarde = gpsText.replace('170359', '223000');
  const gps = parseGpsSection(gpsTextTarde);
  const can = parseCanSection(canText || '');
  const lectura = mapFrameToLectura({
    deviceId: '037883',
    gps,
    can,
    payloadCrudo: REAL_FRAME,
    msgNum: null,
    horaUtcOffsetHours: 3,
  });
  // 22:30:00 local (21/09) + 3h = 01:30:00 UTC del dia siguiente (22/09).
  assert.equal(lectura.momentoEvento.toISOString(), '2018-09-22T01:30:00.000Z');
});

test('REGRESION: la velocidad NO se convierte de nudos a km/h (trampa historica)', () => {
  const lectura = buildLectura(REAL_FRAME, '037883');
  // La trama trae velocidad "000" (0 km/h). Si alguien reintrodujera x1.852, seguiria
  // dando 0 para este caso puntual, asi que se prueba con una trama de velocidad != 0.
  const gps = parseGpsSection(REAL_FRAME.slice(4, 4 + 66).replace('000151', '100151'));
  const can = parseCanSection('15=75');
  const l2 = mapFrameToLectura({ deviceId: '037883', gps, can, payloadCrudo: 'x', msgNum: null });
  assert.equal(l2.velocidadKmh, 100); // NO 100 * 1.852 = 185.2
});

test('payload_crudo es identico byte a byte a la trama de entrada', () => {
  const lectura = buildLectura(REAL_FRAME, '037883');
  assert.equal(lectura.payloadCrudo, REAL_FRAME);
});

test('frame_hash es el SHA-256 del payload crudo', () => {
  const lectura = buildLectura(REAL_FRAME, '037883');
  const expected = crypto.createHash('sha256').update(REAL_FRAME).digest('hex');
  assert.equal(lectura.frameHash, expected);
});
