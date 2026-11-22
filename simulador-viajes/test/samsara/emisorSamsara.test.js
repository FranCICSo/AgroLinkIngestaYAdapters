import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearEmisorSamsara } from '../../src/samsara/emisorSamsara.js';
import { crearRutaHttpServer } from '../../src/http/rutaHttpServer.js';

const ID = '281474977000101';
const logMudo = { info() {}, warn() {}, error() {} };

// rng que fuerza una rafaga en el primer ciclo y despues deja la velocidad estable.
function fakeRng() {
  return () => 0.0;
}

function armar({ rng = () => 0.5, reloj } = {}) {
  const enviados = [];
  let ahoraMs = reloj ?? Date.UTC(2026, 10, 4, 13, 0, 0);
  const emisor = crearEmisorSamsara({
    config: { umbralKmh: 100, excesosPorHora: 0.3125, cicloMs: 5000, orgId: '1001', webhookId: 'agrolink-poc' },
    webhookClient: { enviar: async (p) => { enviados.push(p); return { resultado: 'aceptado', status: 200 }; } },
    log: logMudo,
    rng,
    ahora: () => new Date(ahoraMs),
  });
  return { emisor, enviados, avanzar: (ms) => { ahoraMs += ms; } };
}

const INICIO = { vehiculoId: ID, tripCode: 'VIAJE-1', inicioViaje: '2026-11-04T09:40:00-03:00' };

test('inicio valido arranca, repetido no cambia nada y valida los datos', async () => {
  const { emisor } = armar();
  assert.equal((await emisor.iniciarViaje(INICIO)).status, 202);
  const repetido = await emisor.iniciarViaje(INICIO);
  assert.equal(repetido.status, 200);
  assert.equal(repetido.body.efecto, 'SIN_CAMBIOS');
  assert.equal((await emisor.iniciarViaje({ ...INICIO, vehiculoId: '900001' })).status, 404);
  assert.equal((await emisor.iniciarViaje({ ...INICIO, inicioViaje: 'ayer' })).status, 400);
  assert.equal((await emisor.iniciarViaje({ vehiculoId: ID })).status, 400);
});

test('sin viaje en curso el ciclo no envia nada', async () => {
  const { emisor, enviados } = armar({ rng: fakeRng() });
  await emisor.ciclo();
  assert.equal(enviados.length, 0);
});

test('con una rafaga envia Started y, al detener el viaje, Ended inmediato con las mismas horas', async () => {
  const { emisor, enviados, avanzar } = armar({ rng: fakeRng() });
  await emisor.iniciarViaje(INICIO);

  for (let i = 0; i < 6 && enviados.length === 0; i++) {
    avanzar(5000);
    await emisor.ciclo();
  }
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].eventType, 'SevereSpeedingStarted');
  assert.equal(enviados[0].data.data.tripStartTime, '2026-11-04T12:40:00.000Z');

  avanzar(3000);
  const r = await emisor.detenerViaje({ vehiculoId: ID, tripCode: 'VIAJE-1', motivo: 'COMPLETADO' });
  assert.equal(r.body.efecto, 'DETENIDA');
  assert.equal(enviados.length, 2);
  assert.equal(enviados[1].eventType, 'SevereSpeedingEnded');
  assert.equal(enviados[1].data.data.startTime, enviados[0].data.data.startTime);
  assert.equal(enviados[1].data.data.tripStartTime, enviados[0].data.data.tripStartTime);

  avanzar(5000);
  await emisor.ciclo();
  assert.equal(enviados.length, 2);
  assert.deepEqual(emisor.vehiculosEnCurso(), []);
});

test('un viaje nuevo del mismo vehiculo reemplaza al anterior y cierra su exceso abierto', async () => {
  const { emisor, enviados, avanzar } = armar({ rng: fakeRng() });
  await emisor.iniciarViaje(INICIO);
  for (let i = 0; i < 6 && enviados.length === 0; i++) {
    avanzar(5000);
    await emisor.ciclo();
  }
  const r = await emisor.iniciarViaje({ ...INICIO, tripCode: 'VIAJE-2' });
  assert.equal(r.status, 202);
  assert.equal(enviados.at(-1).eventType, 'SevereSpeedingEnded');
  assert.deepEqual(emisor.vehiculosEnCurso().map((v) => v.tripCode), ['VIAJE-2']);
});

test('detener un viaje desconocido o de otro tripCode no tiene efecto', async () => {
  const { emisor } = armar();
  await emisor.iniciarViaje(INICIO);
  assert.equal((await emisor.detenerViaje({ vehiculoId: ID, tripCode: 'OTRO' })).body.efecto, 'SIN_SIMULACION_EN_CURSO');
  assert.equal((await emisor.detenerViaje({ vehiculoId: 'x', tripCode: 'VIAJE-1' })).status, 404);
  assert.equal(emisor.vehiculosEnCurso().length, 1);
});

test('las rutas HTTP Samsara responden 503 / SIN_SIMULACION con el emisor deshabilitado y delegan si esta habilitado', async () => {
  const pedir = async (server, path, body) => {
    await new Promise((r) => server.listen(0, r));
    const { port } = server.address();
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    } finally {
      await new Promise((r) => server.close(r));
    }
  };

  const sinEmisor = () => crearRutaHttpServer(null, 'http://osrm', null);
  assert.equal((await pedir(sinEmisor(), '/samsara/viajes', INICIO)).status, 503);
  const det = await pedir(sinEmisor(), '/samsara/viajes/VIAJE-1/detencion', { vehiculoId: ID });
  assert.equal(det.status, 200);
  assert.equal(det.body.efecto, 'SIN_SIMULACION_EN_CURSO');

  const { emisor } = armar();
  const conEmisor = () => crearRutaHttpServer(null, 'http://osrm', emisor);
  assert.equal((await pedir(conEmisor(), '/samsara/viajes', INICIO)).status, 202);
  const detenido = await pedir(conEmisor(), '/samsara/viajes/VIAJE-1/detencion', { vehiculoId: ID });
  assert.equal(detenido.body.efecto, 'DETENIDA');
});

// Activacion manual del exceso (POST /samsara/vehiculos/{vehiculo}/exceso). Con rng = 0.5 el
// azar nunca arranca una rafaga, asi que todo exceso que aparezca es el forzado.
async function correrCiclos(emisor, avanzar, n) {
  for (let i = 0; i < n; i++) {
    avanzar(5000);
    await emisor.ciclo();
  }
}

test('forzar un exceso por patente envia Started enseguida y Ended al terminar la duracion', async () => {
  const { emisor, enviados, avanzar } = armar();
  await emisor.iniciarViaje(INICIO);
  await correrCiclos(emisor, avanzar, 3);
  assert.equal(enviados.length, 0);

  const r = emisor.forzarExceso({ vehiculo: 'agl007', duracionS: 30 });
  assert.equal(r.status, 202);
  assert.equal(r.body.efecto, 'FORZADO');
  assert.equal(r.body.vehiculoId, ID);
  assert.equal(r.body.tripCode, 'VIAJE-1');

  // La velocidad sube hacia el objetivo en uno o dos ciclos (5-10 s).
  await correrCiclos(emisor, avanzar, 2);
  assert.deepEqual(enviados.map((p) => p.eventType), ['SevereSpeedingStarted']);

  await correrCiclos(emisor, avanzar, 10);
  assert.deepEqual(enviados.map((p) => p.eventType), ['SevereSpeedingStarted', 'SevereSpeedingEnded']);
  const { startTime, endTime } = enviados[1].data.data;
  const duracionS = (Date.parse(endTime) - Date.parse(startTime)) / 1000;
  assert.ok(duracionS >= 15 && duracionS <= 35, `duracion ${duracionS}s`);
});

test('forzar un exceso funciona aunque la tasa al azar sea 0, tambien por id Samsara', async () => {
  const enviados = [];
  let ahoraMs = Date.UTC(2026, 10, 4, 13, 0, 0);
  const emisor = crearEmisorSamsara({
    config: { umbralKmh: 100, excesosPorHora: 0, cicloMs: 5000, orgId: '1001', webhookId: 'agrolink-poc' },
    webhookClient: { enviar: async (p) => { enviados.push(p); return { resultado: 'aceptado', status: 200 }; } },
    log: logMudo,
    rng: () => 0.0,
    ahora: () => new Date(ahoraMs),
  });
  await emisor.iniciarViaje(INICIO);
  assert.equal(emisor.forzarExceso({ vehiculo: ID }).status, 202);
  for (let i = 0; i < 2; i++) {
    ahoraMs += 5000;
    await emisor.ciclo();
  }
  assert.equal(enviados[0]?.eventType, 'SevereSpeedingStarted');
});

test('forzar un exceso valida vehiculo, viaje en curso y duracion, y no duplica uno en curso', async () => {
  const { emisor, avanzar } = armar();
  assert.equal(emisor.forzarExceso({ vehiculo: 'AAA111' }).status, 404);
  const sinViaje = emisor.forzarExceso({ vehiculo: 'AGL007' });
  assert.equal(sinViaje.status, 409);
  assert.equal(sinViaje.body.error, 'sin_viaje_en_curso');

  await emisor.iniciarViaje(INICIO);
  assert.equal(emisor.forzarExceso({ vehiculo: 'AGL007', duracionS: 5 }).status, 400);
  assert.equal(emisor.forzarExceso({ vehiculo: 'AGL007', duracionS: '60' }).status, 400);
  assert.equal(emisor.forzarExceso({ vehiculo: 'AGL007', duracionS: 601 }).status, 400);

  assert.equal(emisor.forzarExceso({ vehiculo: 'AGL007' }).status, 202);
  await correrCiclos(emisor, avanzar, 1);
  const repetido = emisor.forzarExceso({ vehiculo: 'AGL007' });
  assert.equal(repetido.status, 200);
  assert.equal(repetido.body.efecto, 'YA_EN_EXCESO');
});

test('la ruta HTTP de exceso manual responde 503 sin emisor y delega con la patente y la duracion', async () => {
  const pedir = async (server, path, body) => {
    await new Promise((r) => server.listen(0, r));
    const { port } = server.address();
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    } finally {
      await new Promise((r) => server.close(r));
    }
  };

  const sinEmisor = await pedir(crearRutaHttpServer(null, 'http://osrm', null), '/samsara/vehiculos/AGL007/exceso');
  assert.equal(sinEmisor.status, 503);

  const { emisor } = armar();
  const server = () => crearRutaHttpServer(null, 'http://osrm', emisor);
  assert.equal((await pedir(server(), '/samsara/vehiculos/AGL007/exceso')).status, 409);
  await emisor.iniciarViaje(INICIO);
  const forzado = await pedir(server(), '/samsara/vehiculos/AGL007/exceso', { duracionS: 45 });
  assert.equal(forzado.status, 202);
  assert.equal(forzado.body.duracionS, 45);
  assert.equal(forzado.body.patente, 'AGL007');
});
