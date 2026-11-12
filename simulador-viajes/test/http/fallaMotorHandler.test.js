import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearFallaMotorHandler } from '../../src/http/fallaMotorHandler.js';

const AHORA = new Date('2026-11-10T14:00:00Z');
const logMudo = { info() {}, warn() {}, error() {} };

function viaje(over = {}) {
  return {
    id: 41,
    indiceActual: 10,
    fallaMotorOrigen: null,
    fallaMotorIndiceDisparo: null,
    fallaMotorDuracionMin: null,
    fallaMotorActivadaEn: null,
    fallaMotorDesactivadaEn: null,
    ...over,
  };
}

function armar({ camion = { id: '900002', activo: true }, viajeEnCurso = viaje(), temperatura = 109 } = {}) {
  const llamadas = [];
  const repo = {
    obtenerCamionYViajeEnCurso: async () => ({ camion, viaje: viajeEnCurso }),
    activarFallaMotorManual: async (_pool, viajeId, ahora) => llamadas.push(['activar', viajeId, ahora]),
    marcarFallaMotorDesactivada: async (_pool, viajeId, ahora) => llamadas.push(['desactivar', viajeId, ahora]),
  };
  const handler = crearFallaMotorHandler({ pool: {}, repo, temperaturaDe: () => temperatura, reloj: () => AHORA, log: logMudo });
  const pedir = async (method, url = '/camiones/900002/falla-motor') => {
    let respuesta;
    await handler({ method, url }, {}, (_res, status, body) => {
      respuesta = { status, body };
    });
    return respuesta;
  };
  return { pedir, llamadas };
}

test('POST sin falla: ACTIVADA manual y persiste la activacion', async () => {
  const { pedir, llamadas } = armar();
  const r = await pedir('POST');
  assert.deepEqual(r, { status: 200, body: { camionId: '900002', viajeId: 41, efecto: 'ACTIVADA', origen: 'manual' } });
  assert.deepEqual(llamadas, [['activar', 41, AHORA]]);
});

test('POST sobre una pendiente al azar la reemplaza por una manual inmediata', async () => {
  const { pedir, llamadas } = armar({
    viajeEnCurso: viaje({ fallaMotorOrigen: 'azar', fallaMotorIndiceDisparo: 99, fallaMotorDuracionMin: 20 }),
  });
  assert.equal((await pedir('POST')).body.efecto, 'ACTIVADA');
  assert.equal(llamadas.length, 1);
});

test('POST con una falla activa: YA_ACTIVA sin cambios', async () => {
  const { pedir, llamadas } = armar({
    viajeEnCurso: viaje({ fallaMotorOrigen: 'azar', fallaMotorIndiceDisparo: 5, fallaMotorDuracionMin: 30, fallaMotorActivadaEn: AHORA }),
  });
  assert.deepEqual((await pedir('POST')).body, { camionId: '900002', viajeId: 41, efecto: 'YA_ACTIVA', origen: 'azar' });
  assert.equal(llamadas.length, 0);
});

test('DELETE con una activa: DESACTIVADA', async () => {
  const { pedir, llamadas } = armar({ viajeEnCurso: viaje({ fallaMotorOrigen: 'manual', fallaMotorActivadaEn: AHORA }) });
  assert.equal((await pedir('DELETE')).body.efecto, 'DESACTIVADA');
  assert.deepEqual(llamadas, [['desactivar', 41, AHORA]]);
});

test('DELETE con una pendiente: la cancela', async () => {
  const { pedir, llamadas } = armar({
    viajeEnCurso: viaje({ fallaMotorOrigen: 'azar', fallaMotorIndiceDisparo: 99, fallaMotorDuracionMin: 20 }),
  });
  assert.equal((await pedir('DELETE')).body.efecto, 'DESACTIVADA');
  assert.equal(llamadas.length, 1);
});

test('DELETE sin falla o ya terminada: YA_INACTIVA', async () => {
  assert.equal((await armar().pedir('DELETE')).body.efecto, 'YA_INACTIVA');
  const terminada = armar({ viajeEnCurso: viaje({ fallaMotorOrigen: 'manual', fallaMotorActivadaEn: AHORA, fallaMotorDesactivadaEn: AHORA }) });
  assert.equal((await terminada.pedir('DELETE')).body.efecto, 'YA_INACTIVA');
  assert.equal(terminada.llamadas.length, 0);
});

test('GET informa estado, fin de la falla al azar y ultima temperatura', async () => {
  const { pedir } = armar({
    viajeEnCurso: viaje({ fallaMotorOrigen: 'azar', fallaMotorIndiceDisparo: 5, fallaMotorDuracionMin: 28, fallaMotorActivadaEn: AHORA }),
  });
  const r = await pedir('GET');
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, 'activa');
  assert.deepEqual(r.body.terminaEn, new Date('2026-11-10T14:28:00Z'));
  assert.equal(r.body.ultimaTemperaturaC, 109);
});

test('GET de una falla que llego a su indice pero sin persistir: pendiente', async () => {
  const { pedir } = armar({ viajeEnCurso: viaje({ fallaMotorOrigen: 'azar', fallaMotorIndiceDisparo: 5, fallaMotorDuracionMin: 28 }) });
  assert.equal((await pedir('GET')).body.estado, 'pendiente');
});

test('errores: 404, 409 (sin viaje o inactivo), 400, 405', async () => {
  assert.equal((await armar({ camion: null, viajeEnCurso: null }).pedir('POST')).status, 404);
  assert.equal((await armar({ viajeEnCurso: null }).pedir('POST')).body.error, 'sin_viaje_en_curso');
  assert.equal((await armar({ camion: { id: '900002', activo: false } }).pedir('POST')).status, 409);
  assert.equal((await armar().pedir('POST', '/camiones//falla-motor')).status, 400);
  assert.equal((await armar().pedir('POST', '/camiones/90%2000/falla-motor')).status, 400);
  assert.equal((await armar().pedir('PUT')).status, 405);
});
