import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCargaDesvioConfig } from '../../src/config.js';

test('desvio de carga: defaults 4 C fuera del umbral y 8 C del setpoint sin umbrales', () => {
  assert.deepEqual(loadCargaDesvioConfig({}), { margenC: 4, sinUmbralesC: 8 });
});

test('desvio de carga: acepta valores configurados', () => {
  assert.deepEqual(
    loadCargaDesvioConfig({ CARGA_DESVIO_MARGEN_C: '2.5', CARGA_DESVIO_SIN_UMBRALES_C: '10' }),
    { margenC: 2.5, sinUmbralesC: 10 },
  );
});

test('desvio de carga: rechaza un margen que no deja 2 C fuera del umbral', () => {
  assert.throws(() => loadCargaDesvioConfig({ CARGA_DESVIO_MARGEN_C: '2.4' }), /CARGA_DESVIO_MARGEN_C/);
  assert.throws(() => loadCargaDesvioConfig({ CARGA_DESVIO_MARGEN_C: 'mucho' }), /numero/);
});

test('desvio de carga: rechaza un margen sin umbrales no positivo o no numerico', () => {
  assert.throws(() => loadCargaDesvioConfig({ CARGA_DESVIO_SIN_UMBRALES_C: '0' }), /CARGA_DESVIO_SIN_UMBRALES_C/);
  assert.throws(() => loadCargaDesvioConfig({ CARGA_DESVIO_SIN_UMBRALES_C: 'x' }), /numero/);
});
