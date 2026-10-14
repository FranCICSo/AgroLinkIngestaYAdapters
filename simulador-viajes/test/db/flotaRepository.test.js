import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarCamion } from '../../src/db/flotaRepository.js';

test('acepta un camion con id dentro del rango reservado 900001-900999', () => {
  const { valido } = validarCamion({ id: '900001', tipoCarga: 'seca' });
  assert.equal(valido, true);
});

test('rechaza un camion cuyo id no matchea el rango reservado', () => {
  const { valido, motivo } = validarCamion({ id: '860693084873877', tipoCarga: 'seca' });
  assert.equal(valido, false);
  assert.match(motivo, /rango reservado/);
});

test('acepta un camion con id no numerico (calca un iotDeviceId de AgroLinkBackend)', () => {
  const { valido } = validarCamion({ id: 'tra-demo-004', tipoCarga: 'seca' });
  assert.equal(valido, true);
});

test('rechaza un camion refrigerado sin setpoint de temperatura o humedad', () => {
  const { valido, motivo } = validarCamion({
    id: '900002',
    tipoCarga: 'refrigerada',
    setpointTempC: null,
    setpointHumedadPct: 87,
  });
  assert.equal(valido, false);
  assert.match(motivo, /setpoint/);
});

test('acepta un camion refrigerado con ambos setpoints', () => {
  const { valido } = validarCamion({
    id: '900002',
    tipoCarga: 'refrigerada',
    setpointTempC: 2.5,
    setpointHumedadPct: 87,
  });
  assert.equal(valido, true);
});
