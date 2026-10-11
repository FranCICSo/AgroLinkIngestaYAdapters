import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listarCamionesConEstado } from '../../src/db/camionRepository.js';

function fakePool(queryImpl) {
  return { query: queryImpl };
}

test('marca enRangoReservado=true para un dispositivoId dentro de 900001-900999', async () => {
  const pool = fakePool(async (sql) => {
    assert.match(sql, /FROM simulador\.camion/);
    return {
      rows: [
        { id: '900001', nombre: 'Camion demo', activo: true, viaje_en_curso: true },
      ],
    };
  });

  const camiones = await listarCamionesConEstado(pool);

  assert.deepEqual(camiones, [
    {
      dispositivoId: '900001',
      nombre: 'Camion demo',
      activo: true,
      viajeEnCurso: true,
      enRangoReservado: true,
    },
  ]);
});

test('marca enRangoReservado=false para un dispositivoId fuera del rango reservado', async () => {
  const pool = fakePool(async () => ({
    rows: [
      { id: '860693084873877', nombre: 'Camion real', activo: false, viaje_en_curso: false },
    ],
  }));

  const camiones = await listarCamionesConEstado(pool);

  assert.equal(camiones[0].enRangoReservado, false);
  assert.equal(camiones[0].viajeEnCurso, false);
});

test('devuelve una lista vacía cuando no hay camiones configurados', async () => {
  const pool = fakePool(async () => ({ rows: [] }));

  const camiones = await listarCamionesConEstado(pool);

  assert.deepEqual(camiones, []);
});
