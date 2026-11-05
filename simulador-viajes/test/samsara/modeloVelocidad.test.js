import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearEstadoVelocidad, avanzarVelocidad } from '../../src/samsara/modeloVelocidad.js';
import { detectarCruce } from '../../src/samsara/detectorExceso.js';
import { rngSembrado } from './rngSembrado.js';

const PARAMS = { umbralKmh: 100, excesosPorHora: 0.3125, cicloMs: 5000 };
const OCHO_HORAS_MS = 8 * 3600 * 1000;

// Simula un vehiculo con viaje en curso y devuelve los excesos detectados con su duracion.
function simular(semilla, params, duracionMs) {
  const rng = rngSembrado(semilla);
  let estado = crearEstadoVelocidad(rng);
  let abierto = null;
  const excesos = [];
  let maxFueraDeExceso = 0;
  for (let t = 0; t <= duracionMs; t += params.cicloMs) {
    estado = avanzarVelocidad(estado, params, rng, t);
    const cruce = detectarCruce(abierto, estado.velocidadKmh, params.umbralKmh, new Date(t));
    abierto = cruce.excesoAbierto;
    if (cruce.evento === 'ENDED') {
      excesos.push((cruce.endTime.getTime() - cruce.startTime.getTime()) / 1000);
    }
    if (!abierto && !estado.rafaga) {
      maxFueraDeExceso = Math.max(maxFueraDeExceso, estado.velocidadKmh);
    }
  }
  return { excesos, maxFueraDeExceso };
}

test('es determinista con el mismo rng sembrado', () => {
  assert.deepEqual(simular(7, PARAMS, 3600_000), simular(7, PARAMS, 3600_000));
});

test('sin rafagas (lambda = 0) nunca cruza el umbral en 8 h: los conductores no van rapido siempre', () => {
  for (let semilla = 1; semilla <= 20; semilla++) {
    const { excesos, maxFueraDeExceso } = simular(semilla, { ...PARAMS, excesosPorHora: 0 }, OCHO_HORAS_MS);
    assert.equal(excesos.length, 0);
    assert.ok(maxFueraDeExceso < PARAMS.umbralKmh);
  }
});

test('con la tasa por defecto, el promedio en 8 h de viaje queda entre 1 y 4 excesos por vehiculo (SC-002)', () => {
  const vehiculos = 200;
  let total = 0;
  for (let semilla = 1; semilla <= vehiculos; semilla++) {
    total += simular(semilla, PARAMS, OCHO_HORAS_MS).excesos.length;
  }
  const promedio = total / vehiculos;
  assert.ok(promedio >= 1 && promedio <= 4, `promedio ${promedio}`);
});

test('cada exceso dura entre 20 s y ~3 min', () => {
  const duraciones = [];
  for (let semilla = 1; semilla <= 50; semilla++) {
    duraciones.push(...simular(semilla, { ...PARAMS, excesosPorHora: 6 }, 3600_000).excesos);
  }
  assert.ok(duraciones.length > 50);
  for (const d of duraciones) {
    assert.ok(d >= 20 && d <= 190, `duracion ${d} s`);
  }
});

test('subir la tasa produce mas excesos (demo corta)', () => {
  const base = simular(3, PARAMS, 3600_000).excesos.length;
  const demo = simular(3, { ...PARAMS, excesosPorHora: 12 }, 3600_000).excesos.length;
  assert.ok(demo > base);
});
