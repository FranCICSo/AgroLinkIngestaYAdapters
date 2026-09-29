import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBleSection } from '../src/protocol/bleSection.js';

test('caso completo: tres pares del slot 0 como strings opacos', () => {
  const ble = parseBleSection('T0=23.5,H0=45.0,B0=3012');
  assert.equal(ble.size, 3);
  assert.equal(ble.get('T0'), '23.5');
  assert.equal(ble.get('H0'), '45.0');
  assert.equal(ble.get('B0'), '3012');
});

test('valor vacio (sin lectura del sensor) se conserva como string vacio', () => {
  const ble = parseBleSection('T0=,H0=45.0');
  assert.equal(ble.get('T0'), '');
  assert.equal(ble.get('H0'), '45.0');
});

test('segmento vacio o ausente: mapa vacio', () => {
  assert.equal(parseBleSection('').size, 0);
  assert.equal(parseBleSection(undefined).size, 0);
});

test('par sin "=" (mal formado) se ignora sin romper el resto', () => {
  const ble = parseBleSection('basura,T0=20');
  assert.equal(ble.size, 1);
  assert.equal(ble.get('T0'), '20');
});

test('claves de otros slots se devuelven: el filtrado es del mapper', () => {
  const ble = parseBleSection('T0=20,T1=21');
  assert.equal(ble.get('T1'), '21');
});
