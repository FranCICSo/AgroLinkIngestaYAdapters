import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarCruce, forzarFin } from '../../src/samsara/detectorExceso.js';

const t = (s) => new Date(Date.UTC(2026, 10, 4, 13, 0, s));

test('sin cruce no hay evento, de ningun lado del umbral', () => {
  assert.equal(detectarCruce(null, 99.9, 100, t(0)).evento, null);
  assert.equal(detectarCruce({ startTime: t(0) }, 110, 100, t(30)).evento, null);
});

test('cruce hacia arriba emite STARTED con la hora del cruce', () => {
  const r = detectarCruce(null, 100.1, 100, t(5));
  assert.equal(r.evento, 'STARTED');
  assert.deepEqual(r.excesoAbierto, { startTime: t(5) });
});

test('cruce hacia abajo emite ENDED solo despues de 20 s (histeresis)', () => {
  const abierto = { startTime: t(0) };
  const temprano = detectarCruce(abierto, 95, 100, t(15));
  assert.equal(temprano.evento, null);
  assert.equal(temprano.excesoAbierto, abierto);

  const r = detectarCruce(abierto, 95, 100, t(20));
  assert.equal(r.evento, 'ENDED');
  assert.deepEqual(r.startTime, t(0));
  assert.deepEqual(r.endTime, t(20));
  assert.equal(r.excesoAbierto, null);
});

test('el fin forzado por fin de viaje ignora la minima de 20 s', () => {
  const r = forzarFin({ startTime: t(0) }, t(3));
  assert.equal(r.evento, 'ENDED');
  assert.deepEqual(r.endTime, t(3));
  assert.equal(forzarFin(null, t(3)).evento, null);
});
