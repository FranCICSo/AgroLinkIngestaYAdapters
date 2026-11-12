import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sortearFallaMotor,
  estadoFallaMotor,
  finFallaMotor,
  configurarSorteoFallaMotor,
  sortearFallaMotorConfigurado,
} from '../../src/domain/fallaMotor.js';
import { rngSembrado } from '../samsara/rngSembrado.js';

const BASE = { cantidadPuntos: 500, probabilidadPct: 5, duracionMinMin: 20, duracionMaxMin: 40 };

test('5 %: de 200 viajes, entre 4 y 18 tienen falla, con indice en [10 %, 70 %] y duracion en rango', () => {
  const rng = rngSembrado(2026);
  const sorteos = Array.from({ length: 200 }, () => sortearFallaMotor({ ...BASE, rng })).filter(Boolean);
  assert.ok(sorteos.length >= 4 && sorteos.length <= 18, `con falla: ${sorteos.length}`);
  for (const s of sorteos) {
    assert.equal(s.origen, 'azar');
    assert.ok(s.indiceDisparo >= 50 && s.indiceDisparo <= 350, `indice ${s.indiceDisparo}`);
    assert.ok(s.duracionMin >= 20 && s.duracionMin <= 40 && Number.isInteger(s.duracionMin));
  }
  assert.ok(new Set(sorteos.map((s) => s.indiceDisparo)).size > 1, 'el disparo no es siempre el mismo');
});

test('0 % nunca sortea; 100 % siempre', () => {
  const rng = rngSembrado(1);
  for (let i = 0; i < 200; i += 1) {
    assert.equal(sortearFallaMotor({ ...BASE, probabilidadPct: 0, rng }), null);
    assert.ok(sortearFallaMotor({ ...BASE, probabilidadPct: 100, rng }));
  }
});

test('ruta sin puntos suficientes no sortea', () => {
  assert.equal(sortearFallaMotor({ ...BASE, cantidadPuntos: 1, probabilidadPct: 100 }), null);
});

test('sin configurar, el sorteador global no sortea; configurado, usa la config', () => {
  configurarSorteoFallaMotor(null);
  assert.equal(sortearFallaMotorConfigurado(500), null);
  configurarSorteoFallaMotor({ probabilidadPct: 100, duracionMinMin: 20, duracionMaxMin: 20 }, rngSembrado(3));
  assert.equal(sortearFallaMotorConfigurado(500).duracionMin, 20);
  configurarSorteoFallaMotor(null);
});

const AHORA = new Date('2026-11-10T14:00:00Z');
const viaje = (over) => ({
  fallaMotorOrigen: null,
  fallaMotorIndiceDisparo: null,
  fallaMotorDuracionMin: null,
  fallaMotorActivadaEn: null,
  fallaMotorDesactivadaEn: null,
  ...over,
});

test('estadoFallaMotor: transiciones de data-model.md §1', () => {
  assert.equal(estadoFallaMotor(viaje(), { ahora: AHORA, indice: 0 }), 'sin_falla');

  const azar = viaje({ fallaMotorOrigen: 'azar', fallaMotorIndiceDisparo: 30, fallaMotorDuracionMin: 20 });
  assert.equal(estadoFallaMotor(azar, { ahora: AHORA, indice: 29 }), 'pendiente');
  assert.equal(estadoFallaMotor(azar, { ahora: AHORA, indice: 30 }), 'por_activar');

  const activada = { ...azar, fallaMotorActivadaEn: new Date(AHORA.getTime() - 19 * 60_000) };
  assert.equal(estadoFallaMotor(activada, { ahora: AHORA, indice: 40 }), 'activa');
  const vencida = { ...azar, fallaMotorActivadaEn: new Date(AHORA.getTime() - 20 * 60_000) };
  assert.equal(estadoFallaMotor(vencida, { ahora: AHORA, indice: 40 }), 'terminada');

  const manual = viaje({ fallaMotorOrigen: 'manual', fallaMotorActivadaEn: new Date('2026-11-01T00:00:00Z') });
  assert.equal(estadoFallaMotor(manual, { ahora: AHORA, indice: 0 }), 'activa', 'la manual no tiene duracion');
  assert.equal(
    estadoFallaMotor({ ...manual, fallaMotorDesactivadaEn: AHORA }, { ahora: AHORA, indice: 0 }),
    'terminada',
  );
});

test('finFallaMotor solo para azar activada', () => {
  const activadaEn = new Date('2026-11-10T14:00:00Z');
  assert.deepEqual(
    finFallaMotor(viaje({ fallaMotorOrigen: 'azar', fallaMotorDuracionMin: 28, fallaMotorActivadaEn: activadaEn })),
    new Date('2026-11-10T14:28:00Z'),
  );
  assert.equal(finFallaMotor(viaje({ fallaMotorOrigen: 'manual', fallaMotorActivadaEn: activadaEn })), null);
});
