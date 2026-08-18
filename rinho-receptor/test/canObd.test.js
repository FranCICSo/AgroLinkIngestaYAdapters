import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCanSection } from '../src/protocol/canObd.js';

test('caso de campos vacios (ejemplo canonico del fabricante)', () => {
  const result = parseCanSection('1=,2=,3=,B=,14=,15=,2A=,2C=');
  assert.equal(result.get('1'), '');
  assert.equal(result.get('15'), '');
  assert.equal(result.size, 8);
});

test('caso con valores poblados (trama real, seccion 5-bis del contrato)', () => {
  const result = parseCanSection(
    '1=1M8GDM9A_KP042788,2=2200,3=45,B=66010,14=30000,15=75,2A=90,2C=340',
  );
  assert.equal(result.get('15'), '75');
  assert.equal(result.get('B'), '66010');
  assert.equal(result.get('2A'), '90');
});

test('IDs de 1 y 2 caracteres hex conviven en la misma seccion', () => {
  const result = parseCanSection('1=x,B=y,2A=z');
  assert.ok(result.has('1'));
  assert.ok(result.has('B'));
  assert.ok(result.has('2A'));
});

test('los valores se leen como strings opacos, no como numeros', () => {
  const result = parseCanSection('1=1M8GDM9A_KP042788,15=75');
  assert.equal(typeof result.get('1'), 'string');
  assert.equal(result.get('1'), '1M8GDM9A_KP042788');
  // Si se coercionara a numero, el VIN alfanumerico daria NaN y enmascararia el
  // descarte del Principio V en vez de dejar evidencia de que habia un VIN.
  assert.notEqual(Number.isNaN(result.get('1')), true);
});

test('un ID CAN desconocido (no listado en D-04) se conserva igual', () => {
  const result = parseCanSection('99=valor-desconocido,15=75');
  assert.equal(result.get('99'), 'valor-desconocido');
});
