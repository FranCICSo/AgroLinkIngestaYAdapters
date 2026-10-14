import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatearTabla } from '../../scripts/listar-camiones-activos.js';

test('formatea una fila por camion con sus columnas', () => {
  const salida = formatearTabla([
    { dispositivoId: '900001', nombre: 'Camion demo', activo: true, viajeEnCurso: true, enRangoReservado: true },
  ]);

  assert.match(salida, /dispositivoId/);
  assert.match(salida, /900001/);
  assert.match(salida, /si/);
});

test('distingue si/no para activo, viajeEnCurso y enRangoReservado', () => {
  const salida = formatearTabla([
    {
      dispositivoId: '860693084873877',
      nombre: 'Camion real',
      activo: false,
      viajeEnCurso: false,
      enRangoReservado: false,
    },
  ]);

  assert.match(salida, /860693084873877/);
  assert.match(salida, /no/);
});

test('devuelve un mensaje explicito cuando no hay camiones configurados', () => {
  const salida = formatearTabla([]);

  assert.match(salida, /sin camiones configurados/);
});
