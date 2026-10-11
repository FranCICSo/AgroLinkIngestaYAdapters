import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enRangoReservado } from '../../src/domain/rangoDispositivoSimulado.js';

test('acepta un id numerico dentro de 900001-900999', () => {
  assert.equal(enRangoReservado('900001'), true);
  assert.equal(enRangoReservado('900999'), true);
});

test('rechaza un id numerico fuera de 900001-900999 (podria ser un IMEI real corto)', () => {
  assert.equal(enRangoReservado('900000'), false);
  assert.equal(enRangoReservado('901000'), false);
  assert.equal(enRangoReservado('12345'), false);
});

test('rechaza un IMEI real de 15 digitos', () => {
  assert.equal(enRangoReservado('860693084873877'), false);
});

test('acepta cualquier id con un caracter no numerico: no puede ser un IMEI real', () => {
  assert.equal(enRangoReservado('tra-demo-004'), true);
  assert.equal(enRangoReservado('geo-demo-001'), true);
});

test('rechaza id vacio, null o undefined', () => {
  assert.equal(enRangoReservado(''), false);
  assert.equal(enRangoReservado(null), false);
  assert.equal(enRangoReservado(undefined), false);
});
