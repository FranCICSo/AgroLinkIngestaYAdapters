import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirTrama } from '../../src/protocol/frameBuilder.js';
import { parseDatagram } from '../../../rinho-receptor/src/protocol/frame.js';

const base = {
  camionId: '900001',
  vin: 'LGWEEUA55TL612021',
  momentoEvento: new Date('2026-09-28T20:59:43Z'),
  lat: -34.76065,
  lon: -58.35666,
  velocidadKmh: 24,
  rumboGrados: 224,
  ignicionEncendida: true,
  odometroKm: 150200,
  can: {
    rpm: 1050,
    velocidadRuedaKmh: 24,
    odometroEcuKm: null,
    combustibleConsumidoL: 12.4,
    combustiblePct: 84.85,
    temperaturaRefrigeranteC: null,
    presionAceiteKpa: 380,
  },
  msgNum: 142,
};

test('la trama con CAN y sin BLE tiene el checksum valido y sin segmento BLE', () => {
  const trama = construirTrama({ ...base, ble: null });
  const [parsed] = parseDatagram(trama);

  assert.equal(parsed.checksumValid, true);
  assert.equal(parsed.deviceId, '900001');
  assert.equal(parsed.msgNum, '0142');
  assert.ok(!parsed.body.includes('T0='), 'no debe agregar un segmento BLE de mas');
});

test('la trama con BLE lo agrega en la posicion 2, despues del CAN', () => {
  const trama = construirTrama({
    ...base,
    ble: { temperaturaC: 2.5, humedadPct: 87.0, bateria: 3012 },
  });
  const [parsed] = parseDatagram(trama);

  assert.equal(parsed.checksumValid, true);
  const segmentos = parsed.body.split(';');
  assert.equal(segmentos.length, 3, 'GPS, CAN y BLE deben ser 3 segmentos');
  assert.match(segmentos[2], /^T0=2\.5,H0=87,B0=3012$/);
});

test('la seccion GPS mide exactamente 66 caracteres', () => {
  const trama = construirTrama({ ...base, ble: null });
  const [parsed] = parseDatagram(trama);
  const gpsSection = parsed.body.slice('REQ'.length, 'REQ'.length + 66);
  assert.equal(gpsSection.length, 66);
});
