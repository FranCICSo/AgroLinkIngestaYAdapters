import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avanzar } from '../../src/domain/avanceRuta.js';

const rutaSimple = {
  puntos: [
    { lat: -34.6, lon: -58.4 },
    { lat: -34.61, lon: -58.41 },
    { lat: -34.62, lon: -58.42 },
  ],
  paradas: [{ indice: 1, duracionMin: 2 }],
};

test('avanza entre dos puntos consecutivos con velocidad e ignicion coherentes', () => {
  const resultado = avanzar({
    ruta: { puntos: rutaSimple.puntos, paradas: [] },
    sentido: 'ida',
    indiceActual: 0,
    odometroActualKm: 100,
    cicloSegundos: 60,
  });

  assert.equal(resultado.completado, false);
  assert.equal(resultado.gps.lat, -34.61);
  assert.equal(resultado.gps.lon, -58.41);
  assert.ok(resultado.gps.velocidadKmh > 0, 'velocidad debe ser positiva en movimiento');
  assert.equal(resultado.gps.ignicionEncendida, true);
  assert.ok(resultado.odometroKm > 100, 'el odometro debe acumular distancia recorrida');
});

test('mantiene velocidad 0 e ignicion apagada mientras dura una parada', () => {
  const resultado = avanzar({
    ruta: rutaSimple,
    sentido: 'ida',
    indiceActual: 1,
    odometroActualKm: 100.5,
    cicloSegundos: 60,
  });

  assert.equal(resultado.gps.velocidadKmh, 0);
  assert.equal(resultado.gps.ignicionEncendida, false);
  assert.equal(resultado.enParadaEntrega, true);
  assert.equal(resultado.odometroKm, 100.5, 'no debe sumar distancia mientras esta detenido');
});

test('al completar la ruta marca completado sin avanzar mas', () => {
  const rutaCorta = { puntos: [{ lat: -34.6, lon: -58.4 }, { lat: -34.61, lon: -58.41 }], paradas: [] };
  const resultado = avanzar({
    ruta: rutaCorta,
    sentido: 'ida',
    indiceActual: 1,
    odometroActualKm: 100,
    cicloSegundos: 60,
  });

  assert.equal(resultado.completado, true);
  assert.equal(resultado.siguienteIndice, null);
});

test('recorre la ruta en sentido inverso cuando sentido = vuelta', () => {
  const rutaCorta = { puntos: [{ lat: -34.6, lon: -58.4 }, { lat: -34.7, lon: -58.5 }], paradas: [] };
  const resultado = avanzar({
    ruta: rutaCorta,
    sentido: 'vuelta',
    indiceActual: 0,
    odometroActualKm: 0,
    cicloSegundos: 60,
  });

  // En sentido vuelta el orden se invierte: arranca en -34.7/-58.5 y el siguiente punto es
  // -34.6/-58.4 (el primero de `puntos`).
  assert.equal(resultado.gps.lat, -34.6);
  assert.equal(resultado.gps.lon, -58.4);
});
