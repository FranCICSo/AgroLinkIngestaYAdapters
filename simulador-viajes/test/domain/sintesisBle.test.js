import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sintetizarBle } from '../../src/domain/sintesisBle.js';

const base = { tipoCarga: 'refrigerada', setpointTempC: 2.5, setpointHumedadPct: 87 };

test('operacion normal: temperatura y humedad estables alrededor del setpoint', () => {
  const ble = sintetizarBle({ ...base, temperaturaAnterior: 2.5, modo: 'normal' });
  assert.ok(Math.abs(ble.temperaturaC - 2.5) <= 1, 'debe quedar cerca del setpoint');
  assert.ok(Math.abs(ble.humedadPct - 87) <= 3);
});

test('apertura de puerta: la temperatura sube por encima del setpoint', () => {
  const primero = sintetizarBle({ ...base, temperaturaAnterior: 2.5, modo: 'apertura_puerta' });
  assert.ok(primero.temperaturaC > 2.5);

  const segundo = sintetizarBle({ ...base, temperaturaAnterior: primero.temperaturaC, modo: 'apertura_puerta' });
  assert.ok(segundo.temperaturaC >= primero.temperaturaC, 'sigue subiendo mientras dura la parada');
});

test('recuperacion tras la apertura: vuelve a acercarse al setpoint en modo normal', () => {
  const pico = sintetizarBle({ ...base, temperaturaAnterior: 2.5, modo: 'apertura_puerta' });
  const recuperando = sintetizarBle({ ...base, temperaturaAnterior: pico.temperaturaC, modo: 'normal' });
  assert.ok(recuperando.temperaturaC < pico.temperaturaC, 'debe acercarse de nuevo al setpoint');
});

test('falla de compresor: sube sostenido y termina cruzando el umbral de alerta (7C)', () => {
  let temperatura = 3;
  for (let i = 0; i < 40; i += 1) {
    const ble = sintetizarBle({ ...base, temperaturaAnterior: temperatura, modo: 'falla_compresor' });
    temperatura = ble.temperaturaC;
  }
  assert.ok(temperatura > 7, 'debe cruzar el umbral de alerta tras suficientes lecturas');
});

test('camion sin carga refrigerada no emite datos BLE', () => {
  const ble = sintetizarBle({ tipoCarga: 'seca', modo: 'normal' });
  assert.equal(ble, null);
});
