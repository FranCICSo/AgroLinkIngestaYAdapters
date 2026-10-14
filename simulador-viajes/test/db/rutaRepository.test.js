import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertarRuta } from '../../src/db/rutaRepository.js';

function fakePool(queryImpl) {
  return { query: queryImpl };
}

test('inserta una ruta nueva y devuelve la fila persistida', async () => {
  const puntos = [{ lat: -34.6467, lon: -58.4894 }, { lat: -34.6037, lon: -58.3816 }];
  const pool = fakePool(async (sql, params) => {
    assert.match(sql, /INSERT INTO simulador\.ruta/);
    const [nombre] = params;
    return { rows: [{ id: 1, nombre, puntos, paradas: [] }] };
  });

  const resultado = await insertarRuta(pool, { nombre: 'Ruta demo A', puntos, paradas: [] });

  assert.equal(resultado.ok, true);
  assert.equal(resultado.ruta.id, 1);
  assert.equal(resultado.ruta.nombre, 'Ruta demo A');
});

test('traduce un nombre duplicado (23505) sin dejar una fila parcial', async () => {
  const pool = fakePool(async () => {
    const err = new Error('duplicate key value violates unique constraint "ruta_nombre_unique"');
    err.code = '23505';
    throw err;
  });

  const resultado = await insertarRuta(pool, {
    nombre: 'Ruta demo A',
    puntos: [{ lat: 0, lon: 0 }],
    paradas: [],
  });

  assert.deepEqual(resultado, { ok: false, motivo: 'nombre_duplicado' });
});

test('propaga cualquier otro error de Postgres sin interpretarlo como duplicado', async () => {
  const pool = fakePool(async () => {
    const err = new Error('conexion perdida');
    err.code = '08006';
    throw err;
  });

  await assert.rejects(
    () => insertarRuta(pool, { nombre: 'Ruta demo B', puntos: [], paradas: [] }),
    /conexion perdida/,
  );
});
