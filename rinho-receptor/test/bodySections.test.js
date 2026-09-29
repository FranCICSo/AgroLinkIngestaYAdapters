import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBody } from '../src/protocol/bodySections.js';

const GPS = '00000000000000-2780656-064296830000117F00000010836F1130112FFFF1117';

test('solo GPS: CAN y BLE vacios, sin extras', () => {
  assert.deepEqual(splitBody(`REQ${GPS}`), {
    gpsText: GPS,
    canText: '',
    bleText: '',
    extraSegments: [],
  });
});

test('GPS + CAN (EQ estandar): BLE vacio', () => {
  const { gpsText, canText, bleText } = splitBody(`REQ${GPS};15=75,B=66010`);
  assert.equal(gpsText, GPS);
  assert.equal(canText, '15=75,B=66010');
  assert.equal(bleText, '');
});

test('GPS + CAN + BLE', () => {
  const { canText, bleText, extraSegments } = splitBody(`REQ${GPS};15=75;T0=23.5,H0=45.0,B0=3012`);
  assert.equal(canText, '15=75');
  assert.equal(bleText, 'T0=23.5,H0=45.0,B0=3012');
  assert.deepEqual(extraSegments, []);
});

test('CAN vacio con BLE presente: el BLE conserva su posicion', () => {
  const { canText, bleText } = splitBody(`REQ${GPS};;T0=1`);
  assert.equal(canText, '');
  assert.equal(bleText, 'T0=1');
});

test('cuarto segmento en adelante va a extraSegments', () => {
  const { bleText, extraSegments } = splitBody(`REQ${GPS};15=75;T0=1;XX;YY`);
  assert.equal(bleText, 'T0=1');
  assert.deepEqual(extraSegments, ['XX', 'YY']);
});

test('B0 en la posicion CAN es CAN, nunca BLE (identificacion posicional)', () => {
  const { canText, bleText } = splitBody(`REQ${GPS};B0=5`);
  assert.equal(canText, 'B0=5');
  assert.equal(bleText, '');
});
