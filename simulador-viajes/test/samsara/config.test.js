import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSamsaraConfig } from '../../src/config.js';

const HABILITADO = { SAMSARA_EMISOR_HABILITADO: 'true', SAMSARA_WEBHOOK_URL: 'http://ingesta:8083/api/v1/proveedores/samsara/webhook' };

test('deshabilitado por defecto y sin validar el resto', () => {
  const c = loadSamsaraConfig({ SAMSARA_LIMITE_KMH: '-5' });
  assert.equal(c.habilitado, false);
});

test('habilitado con defaults: umbral 80 + 20 = 100 km/h', () => {
  const c = loadSamsaraConfig(HABILITADO);
  assert.equal(c.habilitado, true);
  assert.equal(c.umbralKmh, 100);
  assert.equal(c.cicloMs, 5000);
  assert.equal(c.excesosPorHora, 0.3125);
});

test('acepta limite, margen y tasa configurados', () => {
  const c = loadSamsaraConfig({ ...HABILITADO, SAMSARA_LIMITE_KMH: '60', SAMSARA_MARGEN_KMH: '15', SAMSARA_EXCESOS_POR_HORA: '6' });
  assert.equal(c.umbralKmh, 75);
  assert.equal(c.excesosPorHora, 6);
});

test('rechaza configuraciones sin sentido', () => {
  assert.throws(() => loadSamsaraConfig({ ...HABILITADO, SAMSARA_MARGEN_KMH: '0' }), /MARGEN/);
  assert.throws(() => loadSamsaraConfig({ ...HABILITADO, SAMSARA_LIMITE_KMH: '-1' }), /LIMITE/);
  assert.throws(() => loadSamsaraConfig({ ...HABILITADO, SAMSARA_EXCESOS_POR_HORA: '-1' }), /EXCESOS/);
  assert.throws(() => loadSamsaraConfig({ ...HABILITADO, SAMSARA_CICLO_MS: '100' }), /CICLO/);
  assert.throws(() => loadSamsaraConfig({ ...HABILITADO, SAMSARA_LIMITE_KMH: 'abc' }), /numero/);
  assert.throws(() => loadSamsaraConfig({ SAMSARA_EMISOR_HABILITADO: 'true' }), /WEBHOOK_URL/);
});
