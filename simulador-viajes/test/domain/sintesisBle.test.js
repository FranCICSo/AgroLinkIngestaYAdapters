import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sintetizarBle, objetivoDesvio } from '../../src/domain/sintesisBle.js';

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

// --- Feature 019: desvio termico manual (research.md D-03) ---

const rango = { ...base, setpointTempC: 5, umbralMinC: 2, umbralMaxC: 8 };

function serie({ desde, tramas, ...params }) {
  const temperaturas = [];
  let temperatura = desde;
  for (let i = 0; i < tramas; i += 1) {
    temperatura = sintetizarBle({ ...params, temperaturaAnterior: temperatura }).temperaturaC;
    temperaturas.push(temperatura);
  }
  return temperaturas;
}

test('objetivoDesvio: unos grados fuera del umbral, o respecto del setpoint sin umbrales', () => {
  assert.equal(objetivoDesvio({ sentido: 'arriba', umbralMinC: 2, umbralMaxC: 8, setpointTempC: 5 }), 12);
  assert.equal(objetivoDesvio({ sentido: 'abajo', umbralMinC: 2, umbralMaxC: 8, setpointTempC: 5 }), -2);
  assert.equal(objetivoDesvio({ sentido: 'arriba', umbralMinC: null, umbralMaxC: null, setpointTempC: 2.5 }), 10.5);
  assert.equal(objetivoDesvio({ sentido: 'abajo', umbralMinC: null, umbralMaxC: null, setpointTempC: 2.5 }), -5.5);
  assert.equal(
    objetivoDesvio({ sentido: 'arriba', umbralMinC: 2, umbralMaxC: 8, setpointTempC: 5, config: { margenC: 3, sinUmbralesC: 8 } }),
    11,
  );
});

test('desvio arriba: sale del rango en <= 3 tramas y pasa el margen de 2 C desde la segunda', () => {
  for (let corrida = 0; corrida < 50; corrida += 1) {
    const t = serie({ ...rango, desde: 5, tramas: 3, modo: 'desvio_termico', sentido: 'arriba' });
    assert.ok(t.some((x) => x > 8), `debe salir del rango: ${t}`);
    assert.ok(t[1] > 10 && t[2] > 10, `debe quedar >= 2 C por encima del maximo: ${t}`);
  }
});

test('desvio arriba sostenido: 200 tramas cerca del objetivo, sin crecer sin tope', () => {
  const t = serie({ ...rango, desde: 5, tramas: 200, modo: 'desvio_termico', sentido: 'arriba' });
  for (const x of t.slice(5)) {
    assert.ok(x >= 11.5 && x <= 12.5, `fuera de [11.5, 12.5]: ${x}`);
  }
});

test('desvio abajo: queda por debajo del minimo y se sostiene cerca de -2 C', () => {
  const t = serie({ ...rango, desde: 5, tramas: 200, modo: 'desvio_termico', sentido: 'abajo' });
  assert.ok(t.slice(0, 3).some((x) => x < 2), `debe salir del rango en <= 3 tramas: ${t.slice(0, 3)}`);
  for (const x of t.slice(5)) {
    assert.ok(x >= -2.5 && x <= -1.5, `fuera de [-2.5, -1.5]: ${x}`);
  }
});

test('desvio sin umbrales conocidos: usa el setpoint con el margen fijo', () => {
  const t = serie({
    ...base,
    setpointTempC: 2.5,
    umbralMinC: null,
    umbralMaxC: null,
    desde: 2.5,
    tramas: 30,
    modo: 'desvio_termico',
    sentido: 'arriba',
  });
  assert.ok(Math.abs(t.at(-1) - 10.5) <= 0.5, `debe acercarse a 10.5: ${t.at(-1)}`);
});

test('al cerrar el desvio, el modo normal vuelve al rango en <= 5 tramas', () => {
  for (const [sentido, desde] of [['arriba', 12], ['abajo', -2]]) {
    const t = serie({ ...rango, desde, tramas: 5, modo: 'normal' });
    assert.ok(t.some((x) => x >= 2 && x <= 8), `${sentido}: debe volver a [2, 8]: ${t}`);
    assert.ok(t.at(-1) >= 2 && t.at(-1) <= 8, `${sentido}: debe quedar en el rango: ${t}`);
  }
});
