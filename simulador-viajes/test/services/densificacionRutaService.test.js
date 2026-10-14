import { test } from 'node:test';
import assert from 'node:assert/strict';
import { densificarTrazado } from '../../src/services/densificacionRutaService.js';

const RADIO_TIERRA_KM = 6371;

function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const senoLat = Math.sin(dLat / 2);
  const senoLon = Math.sin(dLon / 2);
  const h =
    senoLat * senoLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * senoLon * senoLon;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function distanciaMaximaKm(velocidadKmh, cicloSegundos) {
  return (velocidadKmh * cicloSegundos) / 3600;
}

test('trazado sin saltos grandes queda sin cambios (no-op)', () => {
  // ~500 m entre A y B (0.0045 grados de latitud), muy por debajo del umbral de 1 km
  // (60 km/h * 60 s = 1000 m).
  const puntos = [
    { lat: -34.6, lon: -58.4 },
    { lat: -34.6045, lon: -58.4 },
  ];

  const resultado = densificarTrazado(puntos, { cicloSegundos: 60, velocidadPorSegmentoKmh: 60 });

  assert.deepEqual(resultado, puntos);
});

test('un salto mayor al recorrible en un ciclo se densifica con puntos intermedios', () => {
  // ~2500 m entre A y B (0.02245 grados de latitud aprox), muy por encima del umbral de 1 km.
  const a = { lat: -34.6, lon: -58.4 };
  const b = { lat: -34.62245, lon: -58.4 };
  assert.ok(haversineKm(a, b) > 2.4 && haversineKm(a, b) < 2.6, 'fixture debe rondar 2.5 km');

  const resultado = densificarTrazado([a, b], { cicloSegundos: 60, velocidadPorSegmentoKmh: 60 });

  // Umbral = 1 km; 2.5 km requiere al menos 2 puntos intermedios (3 sub-tramos).
  assert.ok(resultado.length >= 4, `se esperaban al menos 4 puntos, hubo ${resultado.length}`);
  assert.deepEqual(resultado[0], a, 'el primer punto no cambia');
  assert.deepEqual(resultado[resultado.length - 1], b, 'el ultimo punto no cambia');

  const umbralKm = distanciaMaximaKm(60, 60);
  for (let i = 1; i < resultado.length; i += 1) {
    const d = haversineKm(resultado[i - 1], resultado[i]);
    assert.ok(
      d <= umbralKm + 1e-9,
      `sub-tramo ${i} mide ${d} km, por encima del umbral ${umbralKm} km`,
    );
  }
});

test('dos puntos identicos no agregan puntos ni lanzan error', () => {
  const punto = { lat: -34.6, lon: -58.4 };

  const resultado = densificarTrazado([punto, { ...punto }], {
    cicloSegundos: 60,
    velocidadPorSegmentoKmh: 60,
  });

  assert.deepEqual(resultado, [punto, { ...punto }]);
});

test('acepta velocidadPorSegmentoKmh como funcion por indice de segmento', () => {
  const a = { lat: -34.6, lon: -58.4 };
  const b = { lat: -34.62245, lon: -58.4 }; // ~2.5 km
  const c = { lat: -34.6229, lon: -58.4 }; // ~50 m mas, no-op a cualquier velocidad razonable

  const velocidadesLlamadas = [];
  const resultado = densificarTrazado([a, b, c], {
    cicloSegundos: 60,
    velocidadPorSegmentoKmh: (indice) => {
      velocidadesLlamadas.push(indice);
      return 60;
    },
  });

  assert.deepEqual(velocidadesLlamadas, [0, 1]);
  assert.deepEqual(resultado[0], a);
  assert.deepEqual(resultado[resultado.length - 1], c);
  // El punto b no debe duplicarse en el limite entre el primer y el segundo segmento.
  assert.equal(resultado.filter((p) => p.lat === b.lat && p.lon === b.lon).length, 1);
});
