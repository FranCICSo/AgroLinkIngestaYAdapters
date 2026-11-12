import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMotorConfig, loadCombustibleConfig } from '../../src/config.js';

test('defaults: 5 %, 20-40 min, +2 C por trama, pico 115 C', () => {
  assert.deepEqual(loadMotorConfig({}), {
    probabilidadPct: 5,
    duracionMinMin: 20,
    duracionMaxMin: 40,
    subidaCPorTrama: 2,
    picoC: 115,
  });
});

test('acepta valores configurados, incluida probabilidad 0 y 100', () => {
  assert.equal(loadMotorConfig({ MOTOR_FALLA_PROBABILIDAD_PCT: '0' }).probabilidadPct, 0);
  assert.equal(loadMotorConfig({ MOTOR_FALLA_PROBABILIDAD_PCT: '100' }).probabilidadPct, 100);
  const c = loadMotorConfig({ MOTOR_FALLA_DURACION_MIN_MIN: '5', MOTOR_FALLA_DURACION_MAX_MIN: '5', MOTOR_PICO_C: '120' });
  assert.equal(c.duracionMinMin, 5);
  assert.equal(c.duracionMaxMin, 5);
  assert.equal(c.picoC, 120);
});

test('rechaza configuraciones sin sentido', () => {
  assert.throws(() => loadMotorConfig({ MOTOR_FALLA_PROBABILIDAD_PCT: '-1' }), /PROBABILIDAD/);
  assert.throws(() => loadMotorConfig({ MOTOR_FALLA_PROBABILIDAD_PCT: '101' }), /PROBABILIDAD/);
  assert.throws(() => loadMotorConfig({ MOTOR_FALLA_DURACION_MIN_MIN: '0' }), /DURACION_MIN_MIN/);
  assert.throws(() => loadMotorConfig({ MOTOR_FALLA_DURACION_MIN_MIN: '30', MOTOR_FALLA_DURACION_MAX_MIN: '10' }), /DURACION_MAX_MIN/);
  assert.throws(() => loadMotorConfig({ MOTOR_SUBIDA_C_POR_TRAMA: '0' }), /SUBIDA/);
  assert.throws(() => loadMotorConfig({ MOTOR_PICO_C: '105' }), /PICO/);
  assert.throws(() => loadMotorConfig({ MOTOR_PICO_C: 'abc' }), /numero/);
  assert.throws(() => loadMotorConfig({ MOTOR_FALLA_DURACION_MIN_MIN: '2.5' }), /entero/);
});

test('combustible: defaults 0,05 % por km y recarga debajo de 7 %', () => {
  assert.deepEqual(loadCombustibleConfig({}), { pctPorKm: 0.05, recargaDebajoPct: 7 });
  assert.deepEqual(
    loadCombustibleConfig({ COMBUSTIBLE_PCT_POR_KM: '0.5', COMBUSTIBLE_RECARGA_DEBAJO_PCT: '15' }),
    { pctPorKm: 0.5, recargaDebajoPct: 15 },
  );
});

test('combustible: rechaza configuraciones sin sentido', () => {
  assert.throws(() => loadCombustibleConfig({ COMBUSTIBLE_PCT_POR_KM: '0' }), /PCT_POR_KM/);
  assert.throws(() => loadCombustibleConfig({ COMBUSTIBLE_PCT_POR_KM: '-1' }), /PCT_POR_KM/);
  assert.throws(() => loadCombustibleConfig({ COMBUSTIBLE_RECARGA_DEBAJO_PCT: '0' }), /RECARGA/);
  assert.throws(() => loadCombustibleConfig({ COMBUSTIBLE_RECARGA_DEBAJO_PCT: '100' }), /RECARGA/);
});
