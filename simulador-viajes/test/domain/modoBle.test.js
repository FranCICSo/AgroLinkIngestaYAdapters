import { test } from 'node:test';
import assert from 'node:assert/strict';
import { determinarModoBle } from '../../src/domain/modoBle.js';

const enRuta = { siguienteIndice: 10, enParadaEntrega: false };

test('desvio termico manual: modo desvio_termico sin importar el indice', () => {
  assert.equal(determinarModoBle({ fallaTipo: 'desvio_termico', fallaIndiceDisparo: null }, enRuta), 'desvio_termico');
});

test('falla de compresor: desde el indice de disparo en adelante', () => {
  const viaje = { fallaTipo: 'falla_compresor', fallaIndiceDisparo: 10 };
  assert.equal(determinarModoBle(viaje, { siguienteIndice: 9, enParadaEntrega: false }), 'normal');
  assert.equal(determinarModoBle(viaje, enRuta), 'falla_compresor');
});

test('apertura de puerta: solo en la parada del indice de disparo', () => {
  const viaje = { fallaTipo: 'apertura_puerta', fallaIndiceDisparo: 10 };
  assert.equal(determinarModoBle(viaje, { siguienteIndice: 10, enParadaEntrega: true }), 'apertura_puerta');
  assert.equal(determinarModoBle(viaje, enRuta), 'normal');
});

test('sin falla de carga: normal', () => {
  assert.equal(determinarModoBle({ fallaTipo: null, fallaIndiceDisparo: null }, enRuta), 'normal');
});
