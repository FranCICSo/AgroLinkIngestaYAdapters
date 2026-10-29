import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarRuta } from '../../src/services/routeGenerationService.js';
import { VELOCIDAD_MAX_RUTA_KMH } from '../../src/domain/limitesVelocidad.js';

const ORIGEN = { lat: -34.6467, lon: -58.4894 };
const DESTINO = { lat: -34.6037, lon: -58.3816 };

function fakePool() {
  const filas = [];
  return {
    filas,
    query: async (sql, params) => {
      if (/INSERT INTO simulador\.ruta/.test(sql)) {
        const [nombre, puntosJson, paradasJson] = params;
        if (filas.some((f) => f.nombre === nombre)) {
          const err = new Error('duplicate key value violates unique constraint');
          err.code = '23505';
          throw err;
        }
        const fila = {
          id: filas.length + 1,
          nombre,
          puntos: JSON.parse(puntosJson),
          paradas: JSON.parse(paradasJson),
        };
        filas.push(fila);
        return { rows: [fila] };
      }
      // Soporte minimo para el flujo opcional de `camion` (iniciarViajeService.js):
      // sin camiones previos, siempre crea uno nuevo y el viaje arranca en_curso.
      if (/FROM simulador\.camion/.test(sql)) {
        return { rows: [] };
      }
      if (/INSERT INTO simulador\.camion/.test(sql)) {
        return { rows: [{ id: params[0] }] };
      }
      if (/SET estado = 'finalizado'/.test(sql)) {
        return { rows: [] };
      }
      if (/ORDER BY id DESC/.test(sql)) {
        return { rows: [] };
      }
      if (/INSERT INTO simulador\.viaje/.test(sql)) {
        return {
          rows: [{ id: 1, camion_id: params[0], ruta_id: params[1], sentido: 'ida', estado: 'en_curso' }],
        };
      }
      throw new Error(`query no esperada en el test: ${sql}`);
    },
  };
}

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

function respuestaOsrmOk() {
  // Anotacion de velocidad por segmento (research.md D-02): primer tramo "urbano" (15 m/s =
  // 54 km/h), segundo tramo por encima del tope legal de ruta (25 m/s = 90 km/h), para
  // ejercitar tanto la clasificacion implicita ciudad/ruta (D-03) como el tope de FR-002.
  return new Response(
    JSON.stringify({
      code: 'Ok',
      routes: [
        {
          geometry: {
            coordinates: [
              [ORIGEN.lon, ORIGEN.lat],
              [-58.42, -34.62],
              [DESTINO.lon, DESTINO.lat],
            ],
          },
          legs: [
            {
              annotation: {
                speed: [15, 25],
              },
            },
          ],
        },
      ],
    }),
    { status: 200 },
  );
}

test('genera y persiste una ruta con origen/destino validos y OSRM devolviendo una ruta completa', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => respuestaOsrmOk());
  const pool = fakePool();

  const resultado = await generarRuta(pool, 'http://osrm.local', {
    nombre: 'Ruta demo A',
    origen: ORIGEN,
    destino: DESTINO,
  });

  assert.equal(resultado.ok, true);
  assert.equal(resultado.ruta.nombre, 'Ruta demo A');
  // El trazado crudo de OSRM tiene 3 puntos muy separados entre si (varios km); con la
  // densificacion (FR-001) el resultado persistido tiene mas puntos, nunca menos.
  assert.ok(
    resultado.ruta.puntos.length > 3,
    `se esperaban mas de 3 puntos tras densificar, hubo ${resultado.ruta.puntos.length}`,
  );
  assert.deepEqual(resultado.ruta.puntos[0], ORIGEN);
  assert.deepEqual(resultado.ruta.puntos.at(-1), DESTINO);

  // FR-002: ningun par de puntos consecutivos implica una velocidad por encima del tope legal
  // de ruta (80 km/h) en un ciclo de simulacion (cicloSegundos default = 60 s en config.js).
  const cicloSegundos = 60;
  const umbralMaximoKm = (VELOCIDAD_MAX_RUTA_KMH * cicloSegundos) / 3600;
  for (let i = 1; i < resultado.ruta.puntos.length; i += 1) {
    const d = haversineKm(resultado.ruta.puntos[i - 1], resultado.ruta.puntos[i]);
    assert.ok(
      d <= umbralMaximoKm + 1e-9,
      `sub-tramo ${i} mide ${d} km, por encima del umbral de ruta ${umbralMaximoKm} km`,
    );
  }
});

test('rechaza la generacion cuando origen y destino estan a una distancia trivial, sin llamar a OSRM', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => respuestaOsrmOk());
  const pool = fakePool();

  const resultado = await generarRuta(pool, 'http://osrm.local', {
    nombre: 'Ruta demo B',
    origen: ORIGEN,
    destino: { lat: ORIGEN.lat + 0.00001, lon: ORIGEN.lon },
  });

  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, 'validacion');
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(pool.filas.length, 0);
});

test('rechaza la generacion cuando OSRM responde sin ruta (code != Ok), sin persistir nada', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ code: 'NoRoute' }), { status: 200 }),
  );
  const pool = fakePool();

  const resultado = await generarRuta(pool, 'http://osrm.local', {
    nombre: 'Ruta demo C',
    origen: ORIGEN,
    destino: DESTINO,
  });

  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, 'trazado_no_disponible');
  assert.equal(pool.filas.length, 0);
});

test('rechaza la generacion cuando OSRM no responde (timeout/conexion), sin persistir nada', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('fetch failed');
  });
  const pool = fakePool();

  const resultado = await generarRuta(pool, 'http://osrm.local', {
    nombre: 'Ruta demo D',
    origen: ORIGEN,
    destino: DESTINO,
  });

  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, 'trazado_no_disponible');
  assert.equal(pool.filas.length, 0);
});

test('rechaza con nombre_duplicado si ya existe una ruta con ese nombre', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => respuestaOsrmOk());
  const pool = fakePool();

  await generarRuta(pool, 'http://osrm.local', {
    nombre: 'Ruta demo E',
    origen: ORIGEN,
    destino: DESTINO,
  });
  const segundaVez = await generarRuta(pool, 'http://osrm.local', {
    nombre: 'Ruta demo E',
    origen: ORIGEN,
    destino: DESTINO,
  });

  assert.equal(segundaVez.ok, false);
  assert.equal(segundaVez.motivo, 'nombre_duplicado');
  assert.equal(pool.filas.length, 1);
});

test('rechaza un camion.id numerico fuera del rango reservado, sin llamar a OSRM ni persistir nada', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => respuestaOsrmOk());
  const pool = fakePool();

  const resultado = await generarRuta(pool, 'http://osrm.local', {
    nombre: 'Ruta demo F',
    origen: ORIGEN,
    destino: DESTINO,
    // Numerico y fuera de 900001-900999: podria confundirse con un IMEI real corto, se rechaza.
    camion: { id: '12345' },
  });

  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, 'validacion');
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(pool.filas.length, 0);
});

test('rechaza un camion.odometroInicialKm negativo o no numerico, sin llamar a OSRM ni persistir nada', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => respuestaOsrmOk());
  const pool = fakePool();

  for (const odometroInicialKm of [-1, 'abc', Number.NaN]) {
    const resultado = await generarRuta(pool, 'http://osrm.local', {
      nombre: 'Ruta demo F2',
      origen: ORIGEN,
      destino: DESTINO,
      camion: { id: 'tel-demo-003', odometroInicialKm },
    });

    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, 'validacion');
  }
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(pool.filas.length, 0);
});

test('con camion.id numerico en el rango reservado, persiste la ruta y arranca un viaje en_curso', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => respuestaOsrmOk());
  const pool = fakePool();

  const resultado = await generarRuta(pool, 'http://osrm.local', {
    nombre: 'Ruta demo G',
    origen: ORIGEN,
    destino: DESTINO,
    camion: { id: '900005', odometroInicialKm: 10 },
  });

  assert.equal(resultado.ok, true);
  assert.equal(resultado.viaje.dispositivoId, '900005');
  assert.equal(resultado.viaje.rutaId, resultado.ruta.id);
  assert.equal(resultado.viaje.estado, 'en_curso');
});

test('con camion.id no numerico (calca un iotDeviceId de AgroLinkBackend), persiste y arranca el viaje', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => respuestaOsrmOk());
  const pool = fakePool();

  const resultado = await generarRuta(pool, 'http://osrm.local', {
    nombre: 'Ruta demo H',
    origen: ORIGEN,
    destino: DESTINO,
    // No puramente numerico: no puede confundirse con un IMEI real, se acepta aunque no
    // este en el rango 900001-900999 (research.md, feature 011, actualizacion tra-demo-004).
    camion: { id: 'tra-demo-004' },
  });

  assert.equal(resultado.ok, true);
  assert.equal(resultado.viaje.dispositivoId, 'tra-demo-004');
  assert.equal(resultado.viaje.estado, 'en_curso');
});
