import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  finalizarViajesEnCurso,
  obtenerUltimoOdometro,
  insertarViaje,
} from '../../src/db/viajeRepository.js';

function fakePool(queryImpl) {
  return { query: queryImpl };
}

test('finalizarViajesEnCurso actualiza solo los viajes en_curso del camion dado', async () => {
  const pool = fakePool(async (sql, params) => {
    assert.match(sql, /UPDATE simulador\.viaje SET estado = 'finalizado'/);
    assert.deepEqual(params, ['900005']);
    return { rows: [] };
  });

  await finalizarViajesEnCurso(pool, '900005');
});

test('obtenerUltimoOdometro devuelve el odometro del viaje mas reciente', async () => {
  const pool = fakePool(async () => ({ rows: [{ odometro_actual_km: 1234.5 }] }));

  const odometro = await obtenerUltimoOdometro(pool, '900005');

  assert.equal(odometro, 1234.5);
});

test('obtenerUltimoOdometro devuelve null si el camion nunca tuvo un viaje', async () => {
  const pool = fakePool(async () => ({ rows: [] }));

  const odometro = await obtenerUltimoOdometro(pool, '900005');

  assert.equal(odometro, null);
});

test('insertarViaje crea el viaje en_curso con sentido ida e indice 0', async () => {
  const pool = fakePool(async (sql, params) => {
    assert.match(sql, /INSERT INTO simulador\.viaje/);
    assert.deepEqual(params, ['900005', 7, 100]);
    return {
      rows: [{ id: 1, camion_id: '900005', ruta_id: 7, sentido: 'ida', estado: 'en_curso' }],
    };
  });

  const viaje = await insertarViaje(pool, { camionId: '900005', rutaId: 7, odometroActualKm: 100 });

  assert.equal(viaje.estado, 'en_curso');
  assert.equal(viaje.ruta_id, 7);
});
