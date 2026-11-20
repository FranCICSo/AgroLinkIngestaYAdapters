import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearDetencionHandler, RUTA_DETENCION } from '../../src/http/detencionHandler.js';

const logMudo = { info() {}, warn() {}, error() {} };

function armar({ existe = true, finalizados = [41], body = { tripCode: 'VIAJE-1', motivo: 'COMPLETADO' } } = {}) {
  const llamadas = [];
  const logs = [];
  const repo = {
    existeCamion: async (_pool, camionId) => {
      llamadas.push(['existe', camionId]);
      return existe;
    },
    finalizarViajesEnCurso: async (_pool, camionId) => {
      llamadas.push(['finalizar', camionId]);
      return finalizados;
    },
  };
  const log = { ...logMudo, info: (msg, datos) => logs.push([msg, datos]) };
  const handler = crearDetencionHandler({ pool: {}, repo, leerBody: async () => body, log });
  const pedir = async (method = 'POST', url = '/camiones/900002/detencion') => {
    let respuesta;
    await handler({ method, url }, {}, (_res, status, cuerpo) => {
      respuesta = { status, body: cuerpo };
    });
    return respuesta;
  };
  return { pedir, llamadas, logs };
}

test('con viaje en curso: lo finaliza y responde DETENIDA', async () => {
  const { pedir, llamadas, logs } = armar();
  const r = await pedir();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { camionId: '900002', viajesFinalizados: [41], efecto: 'DETENIDA' });
  assert.deepEqual(llamadas, [['existe', '900002'], ['finalizar', '900002']]);
  assert.equal(logs[0][1].tripCode, 'VIAJE-1', 'el tripCode del cuerpo queda en el log');
});

test('sin viaje en curso: idempotente, 200 SIN_VIAJE_EN_CURSO', async () => {
  const { pedir } = armar({ finalizados: [] });
  const r = await pedir();
  assert.equal(r.status, 200);
  assert.equal(r.body.efecto, 'SIN_VIAJE_EN_CURSO');
});

test('camion inexistente: 404 y no toca viajes', async () => {
  const { pedir, llamadas } = armar({ existe: false });
  const r = await pedir();
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'camion_no_encontrado');
  assert.deepEqual(llamadas, [['existe', '900002']]);
});

test('un cuerpo invalido no impide detener', async () => {
  const llamadas = [];
  const repo = {
    existeCamion: async () => true,
    finalizarViajesEnCurso: async () => {
      llamadas.push('finalizar');
      return [7];
    },
  };
  const handler = crearDetencionHandler({
    pool: {},
    repo,
    leerBody: async () => {
      throw new SyntaxError('no es JSON');
    },
    log: logMudo,
  });
  let respuesta;
  await handler({ method: 'POST', url: '/camiones/geo-demo-001/detencion' }, {}, (_r, status, body) => {
    respuesta = { status, body };
  });
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.body.efecto, 'DETENIDA');
  assert.deepEqual(llamadas, ['finalizar']);
});

test('metodo distinto de POST: 405', async () => {
  const { pedir, llamadas } = armar();
  const r = await pedir('GET');
  assert.equal(r.status, 405);
  assert.deepEqual(llamadas, []);
});

test('camionId invalido: 400', async () => {
  const { pedir } = armar();
  const r = await pedir('POST', '/camiones/90%2000/detencion');
  assert.equal(r.status, 400);
});

test('la ruta matchea solo /camiones/{id}/detencion', () => {
  assert.ok(RUTA_DETENCION.test('/camiones/900002/detencion'));
  assert.ok(RUTA_DETENCION.test('/camiones/tra-demo-004/detencion/'));
  assert.ok(!RUTA_DETENCION.test('/samsara/viajes/T-1/detencion'));
  assert.ok(!RUTA_DETENCION.test('/camiones/900002/falla-motor'));
});
