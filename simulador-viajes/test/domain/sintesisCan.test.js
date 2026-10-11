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

test('combustible nunca baja del piso configurado en un viaje largo', () => {
  const can = sintetizarCan({
    velocidadKmh: 20,
    distanciaKm: 5000,
    combustiblePctAnterior: 1,
    combustibleConsumidoLAnterior: 0,
    combustiblePctMinimo: 5,
  });

  assert.equal(can.combustiblePct, 5);
});

test('datos invalidos (velocidad negativa) lanzan un error explicito', () => {
  assert.throws(() => sintetizarCan({ velocidadKmh: -5, distanciaKm: 1 }));
});
