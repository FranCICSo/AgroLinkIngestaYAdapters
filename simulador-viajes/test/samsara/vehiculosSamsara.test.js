import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VEHICULOS_SAMSARA, buscarVehiculoSamsara } from '../../src/samsara/vehiculosSamsara.js';
import { enRangoReservado } from '../../src/domain/rangoDispositivoSimulado.js';

test('busca un vehiculo Samsara por su id y devuelve null fuera de la lista', () => {
  assert.equal(buscarVehiculoSamsara('281474977000101').patente, 'AGL007');
  assert.equal(buscarVehiculoSamsara('900001'), null);
});

test('ningun id Samsara puede darse de alta como camion Rinho simulado (listas disjuntas)', () => {
  for (const v of VEHICULOS_SAMSARA) {
    assert.equal(enRangoReservado(v.id), false, `${v.id} cae en el rango de camiones Rinho`);
  }
});

test('ids, patentes y VIN son unicos', () => {
  for (const campo of ['id', 'patente', 'vin']) {
    const valores = VEHICULOS_SAMSARA.map((v) => v[campo]);
    assert.equal(new Set(valores).size, valores.length);
  }
});
