import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sintetizarCan } from '../../src/domain/sintesisCan.js';

test('camion en marcha: RPM y presion coherentes con la velocidad, combustible bajando', () => {
  const can = sintetizarCan({
    velocidadKmh: 24,
    distanciaKm: 0.4,
    combustiblePctAnterior: 85,
    combustibleConsumidoLAnterior: 0,
  });

  assert.ok(can.rpm >= 700 && can.rpm <= 2200);
  assert.ok(can.combustiblePct < 85, 'el combustible debe bajar al recorrer distancia');
  assert.ok(can.combustibleConsumidoL > 0);
  assert.ok(can.presionAceiteKpa > 200, 'presion en marcha debe ser alta');
});

test('camion detenido: ralenti y presion baja, sin consumir combustible extra', () => {
  const can = sintetizarCan({
    velocidadKmh: 0,
    distanciaKm: 0,
    combustiblePctAnterior: 50,
    combustibleConsumidoLAnterior: 10,
  });

  assert.ok(can.rpm >= 600 && can.rpm <= 800, 'ralenti esperado 600-800 (research.md D-07)');
  assert.equal(can.combustiblePct, 50);
  assert.equal(can.combustibleConsumidoL, 10);
  assert.ok(can.presionAceiteKpa < 150, 'presion en ralenti debe ser baja');
});

test('velocidad de crucero en ruta (80 km/h): RPM en rango de crucero realista', () => {
  const can = sintetizarCan({ velocidadKmh: 80, distanciaKm: 1.33 });

  assert.ok(
    can.rpm >= 1200 && can.rpm <= 1800,
    `RPM de crucero en ruta esperado 1200-1800, fue ${can.rpm} (research.md D-07)`,
  );
});

test('ninguna velocidad dentro del rango verosimil (0-80 km/h) alcanza el RPM maximo configurado', () => {
  for (let velocidadKmh = 0; velocidadKmh <= 80; velocidadKmh += 5) {
    const can = sintetizarCan({ velocidadKmh, distanciaKm: 1 });
    assert.ok(
      can.rpm < 2200,
      `a ${velocidadKmh} km/h el RPM fue ${can.rpm}, alcanzo el techo configurado (2200)`,
    );
  }
});

test('combustible: debajo del umbral de recarga, la trama siguiente parte de 100 %', () => {
  const combustible = { pctPorKm: 0.05, recargaDebajoPct: 7 };
  const antes = sintetizarCan({ velocidadKmh: 80, distanciaKm: 1.4, combustiblePctAnterior: 7.05, combustible });
  assert.equal(antes.combustiblePct, 6.98, 'la trama que cruza el umbral informa el nivel bajo');
  assert.equal(antes.combustibleRecargado, false);

  const despues = sintetizarCan({
    velocidadKmh: 80,
    distanciaKm: 1.4,
    combustiblePctAnterior: antes.combustiblePct,
    combustibleConsumidoLAnterior: 100,
    combustible,
  });
  assert.equal(despues.combustibleRecargado, true);
  assert.equal(despues.combustiblePct, 99.93);
  assert.ok(despues.combustibleConsumidoL > 100, 'el consumo acumulado (CAN 14) no se reinicia al cargar');
});

test('combustible: exactamente en el umbral todavia no recarga', () => {
  const can = sintetizarCan({ velocidadKmh: 0, distanciaKm: 0, combustiblePctAnterior: 7 });
  assert.equal(can.combustiblePct, 7);
  assert.equal(can.combustibleRecargado, false);
});

test('combustible: recorrido larguisimo en una trama no da un nivel negativo', () => {
  const can = sintetizarCan({ velocidadKmh: 20, distanciaKm: 5000, combustiblePctAnterior: 50 });
  assert.equal(can.combustiblePct, 0);
});

test('combustible: sin nivel anterior se sortea uno entre el umbral y 100 %', () => {
  const combustible = { pctPorKm: 0.05, recargaDebajoPct: 7 };
  assert.equal(sintetizarCan({ velocidadKmh: 0, distanciaKm: 0, combustible, rng: () => 0 }).combustiblePct, 7);
  assert.equal(sintetizarCan({ velocidadKmh: 0, distanciaKm: 0, combustible, rng: () => 0.5 }).combustiblePct, 53.5);
  for (let i = 0; i < 200; i++) {
    const { combustiblePct } = sintetizarCan({ velocidadKmh: 0, distanciaKm: 0, combustible });
    assert.ok(combustiblePct >= 7 && combustiblePct <= 100, `nivel inicial fuera de rango: ${combustiblePct}`);
  }
});

test('combustible: el ritmo de consumo es configurable', () => {
  const can = sintetizarCan({
    velocidadKmh: 60,
    distanciaKm: 10,
    combustiblePctAnterior: 80,
    combustible: { pctPorKm: 0.5, recargaDebajoPct: 7 },
  });
  assert.equal(can.combustiblePct, 75);
});

test('combustible: un viaje largo baja hasta debajo del umbral, recarga y vuelve a bajar', () => {
  const combustible = { pctPorKm: 0.05, recargaDebajoPct: 7 };
  let pct = 20;
  let recargas = 0;
  let minimo = 100;
  for (let i = 0; i < 400; i++) {
    const can = sintetizarCan({ velocidadKmh: 80, distanciaKm: 1.33, combustiblePctAnterior: pct, combustible });
    if (can.combustibleRecargado) recargas += 1;
    minimo = Math.min(minimo, can.combustiblePct);
    pct = can.combustiblePct;
  }
  assert.equal(recargas, 1);
  assert.ok(minimo < 7 && minimo > 6.9, `el minimo informado debe quedar apenas debajo de 7, fue ${minimo}`);
  // 400 tramas x 1,33 km x 0,05 = 26,6 %: 13 % hasta el umbral y ~13,6 % despues de cargar.
  assert.ok(pct > 85 && pct < 88, `nivel final esperado ~86,4 %, fue ${pct}`);
});

test('datos invalidos (velocidad negativa) lanzan un error explicito', () => {
  assert.throws(() => sintetizarCan({ velocidadKmh: -5, distanciaKm: 1 }));
});
