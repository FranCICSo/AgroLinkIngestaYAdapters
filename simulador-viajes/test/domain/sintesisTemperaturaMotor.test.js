import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sintetizarTemperaturaMotor,
  determinarModoMotor,
  BANDA_NORMAL_MIN_C,
  BANDA_NORMAL_MAX_C,
} from '../../src/domain/sintesisTemperaturaMotor.js';
import { rngSembrado } from '../samsara/rngSembrado.js';

const CONFIG = { subidaCPorTrama: 2, picoC: 115 };

function serie({ desde, modo, tramas, ralenti = false, rng = rngSembrado(7) }) {
  const valores = [];
  let anterior = desde;
  for (let i = 0; i < tramas; i += 1) {
    anterior = sintetizarTemperaturaMotor({ temperaturaAnterior: anterior, ralenti, modo, config: CONFIG, rng });
    valores.push(anterior);
  }
  return valores;
}

test('normal: 1000 tramas siempre en [80, 95], enteras y con pasos de <= 2 C (FR-002)', () => {
  const rng = rngSembrado(42);
  let anterior = null;
  for (let i = 0; i < 1000; i += 1) {
    const t = sintetizarTemperaturaMotor({ temperaturaAnterior: anterior, ralenti: i % 7 === 0, modo: 'normal', config: CONFIG, rng });
    assert.ok(Number.isInteger(t), `no entero: ${t}`);
    assert.ok(t >= BANDA_NORMAL_MIN_C && t <= BANDA_NORMAL_MAX_C, `fuera de banda: ${t}`);
    if (anterior != null) assert.ok(Math.abs(t - anterior) <= 2, `salto de ${anterior} a ${t}`);
    anterior = t;
  }
});

test('normal sin dato previo arranca cerca del objetivo de marcha (88 C)', () => {
  const t = sintetizarTemperaturaMotor({ temperaturaAnterior: null, ralenti: false, modo: 'normal', config: CONFIG, rng: () => 0.5 });
  assert.equal(t, 88);
});

test('sobrecalentamiento: desde 88 C supera 105 en <= 9 tramas y 110 en <= 11', () => {
  const valores = serie({ desde: 88, modo: 'sobrecalentamiento', tramas: 11 });
  assert.ok(valores.findIndex((v) => v >= 105) <= 8, valores.join(','));
  assert.ok(valores[10] >= 110, valores.join(','));
});

test('sobrecalentamiento: se estabiliza alrededor del pico sin seguir subiendo (FR-005)', () => {
  const valores = serie({ desde: 88, modo: 'sobrecalentamiento', tramas: 40 });
  for (const v of valores.slice(15)) {
    assert.ok(v >= 114 && v <= 116, `fuera del pico: ${v}`);
  }
});

test('enfriamiento: de 115 C a menos de 100 C en <= 7 tramas, gradual (FR-006)', () => {
  const valores = serie({ desde: 115, modo: 'enfriamiento', tramas: 7 });
  assert.ok(valores[0] > 110, 'no puede volver a la normalidad en una sola trama');
  assert.ok(valores[6] < 100, valores.join(','));
  assert.ok(valores.every((v) => v >= BANDA_NORMAL_MAX_C));
});

test('determinarModoMotor', () => {
  assert.equal(determinarModoMotor({ activa: true, temperaturaAnterior: 90 }), 'sobrecalentamiento');
  assert.equal(determinarModoMotor({ activa: false, temperaturaAnterior: 110 }), 'enfriamiento');
  assert.equal(determinarModoMotor({ activa: false, temperaturaAnterior: 95 }), 'normal');
  assert.equal(determinarModoMotor({ activa: false, temperaturaAnterior: null }), 'normal');
});
