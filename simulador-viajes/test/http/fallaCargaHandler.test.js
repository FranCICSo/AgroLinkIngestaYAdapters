import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearFallaCargaHandler } from '../../src/http/fallaCargaHandler.js';

const AHORA = new Date('2026-11-22T14:00:00Z');

function camionRefrigerado(over = {}) {
  return {
    id: '900002',
    activo: true,
    tipoCarga: 'refrigerada',
    setpointTempC: 5,
    umbralMinC: 2,
    umbralMaxC: 8,
    ...over,
  };
}

function viaje(over = {}) {
  return {
    id: 41,
    fallaTipo: null,
    fallaCargaSentido: null,
    fallaCargaActivadaEn: null,
    fallaCargaDesactivadaEn: null,
    ...over,
  };
}

function armar({ camion = camionRefrigerado(), viajeEnCurso = viaje(), temperatura = 5.2 } = {}) {
  const llamadas = [];
  const logs = [];
  const repo = {
    obtenerCamionConCargaYViajeEnCurso: async () => ({ camion, viaje: viajeEnCurso }),
    activarDesvioTermico: async (_pool, viajeId, sentido, ahora) => llamadas.push(['activar', viajeId, sentido, ahora]),
    cerrarFallaCarga: async (_pool, viajeId, ahora) => llamadas.push(['cerrar', viajeId, ahora]),
  };
  const log = { info: (msg, datos) => logs.push({ msg, datos }), warn() {}, error() {} };
  const handler = crearFallaCargaHandler({ pool: {}, repo, temperaturaDe: () => temperatura, reloj: () => AHORA, log });
  const pedir = async (method, url = '/camiones/900002/falla-carga') => {
    let respuesta;
    await handler({ method, url }, {}, (_res, status, body) => {
      respuesta = { status, body };
    });
    return respuesta;
  };
  return { pedir, llamadas, logs };
}

// --- POST: activar (contrato §1) ---

test('POST sin falla: ACTIVADA hacia arriba por defecto, 4 C por encima del maximo', async () => {
  const { pedir, llamadas, logs } = armar();

  const r = await pedir('POST');

  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { camionId: '900002', viajeId: 41, efecto: 'ACTIVADA', sentido: 'arriba', objetivoC: 12 });
  assert.deepEqual(llamadas, [['activar', 41, 'arriba', AHORA]]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].datos.efecto, 'ACTIVADA');
  assert.equal(logs[0].datos.sentido, 'arriba');
});

test('POST ?sentido=abajo: 4 C por debajo del minimo', async () => {
  const { pedir, llamadas } = armar();

  const r = await pedir('POST', '/camiones/900002/falla-carga?sentido=abajo');

  assert.equal(r.body.efecto, 'ACTIVADA');
  assert.equal(r.body.sentido, 'abajo');
  assert.equal(r.body.objetivoC, -2);
  assert.deepEqual(llamadas[0].slice(0, 3), ['activar', 41, 'abajo']);
});

test('POST sin umbrales conocidos: objetivo respecto del setpoint con el margen fijo', async () => {
  const { pedir } = armar({ camion: camionRefrigerado({ setpointTempC: 2.5, umbralMinC: null, umbralMaxC: null }) });

  const r = await pedir('POST');

  assert.equal(r.body.objetivoC, 10.5);
});

test('POST con una falla de carga cargada por SQL: la reemplaza', async () => {
  const { pedir, llamadas, logs } = armar({ viajeEnCurso: viaje({ fallaTipo: 'falla_compresor' }) });

  const r = await pedir('POST');

  assert.equal(r.body.efecto, 'ACTIVADA');
  assert.equal(r.body.reemplaza, 'falla_compresor');
  assert.equal(llamadas.length, 1);
  assert.equal(logs[0].datos.reemplaza, 'falla_compresor');
});

test('POST con el desvio ya activo: YA_ACTIVA, conserva el sentido vigente y no escribe', async () => {
  const { pedir, llamadas } = armar({
    viajeEnCurso: viaje({ fallaTipo: 'desvio_termico', fallaCargaSentido: 'arriba', fallaCargaActivadaEn: AHORA }),
  });

  const r = await pedir('POST', '/camiones/900002/falla-carga?sentido=abajo');

  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { camionId: '900002', viajeId: 41, efecto: 'YA_ACTIVA', sentido: 'arriba' });
  assert.deepEqual(llamadas, []);
});

test('POST con sentido no reconocido: 400 validacion, sin escribir', async () => {
  const { pedir, llamadas } = armar();

  const r = await pedir('POST', '/camiones/900002/falla-carga?sentido=costado');

  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'validacion');
  assert.deepEqual(llamadas, []);
});

// --- Errores comunes (contrato §1 y §4) ---

test('camionId invalido: 400 validacion', async () => {
  const { pedir } = armar();

  const r = await pedir('POST', '/camiones/90%20002/falla-carga');

  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'validacion');
});

test('camion inexistente: 404 camion_no_encontrado', async () => {
  const { pedir } = armar({ camion: null, viajeEnCurso: null });

  const r = await pedir('POST');

  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'camion_no_encontrado');
});

test('camion sin viaje en curso o inactivo: 409 sin_viaje_en_curso', async () => {
  for (const caso of [{ viajeEnCurso: null }, { camion: camionRefrigerado({ activo: false }) }]) {
    const { pedir, llamadas } = armar(caso);

    const r = await pedir('POST');

    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'sin_viaje_en_curso');
    assert.deepEqual(llamadas, []);
  }
});

test('camion con carga seca: 409 sin_carga_refrigerada', async () => {
  const { pedir, llamadas } = armar({ camion: camionRefrigerado({ tipoCarga: 'seca' }) });

  const r = await pedir('POST');

  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'sin_carga_refrigerada');
  assert.deepEqual(llamadas, []);
});

test('metodo no soportado: 405', async () => {
  const { pedir } = armar();

  const r = await pedir('PUT');

  assert.equal(r.status, 405);
  assert.equal(r.body.error, 'metodo_no_permitido');
});

// --- DELETE: cerrar (contrato §2) ---

test('DELETE con el desvio activo: DESACTIVADA y persiste el cierre', async () => {
  const { pedir, llamadas, logs } = armar({
    viajeEnCurso: viaje({ fallaTipo: 'desvio_termico', fallaCargaSentido: 'arriba' }),
  });

  const r = await pedir('DELETE');

  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { camionId: '900002', viajeId: 41, efecto: 'DESACTIVADA', tipoCerrado: 'desvio_termico' });
  assert.deepEqual(llamadas, [['cerrar', 41, AHORA]]);
  assert.equal(logs[0].datos.tipoCerrado, 'desvio_termico');
});

test('DELETE con una falla de carga cargada por SQL: tambien la cierra', async () => {
  for (const fallaTipo of ['falla_compresor', 'apertura_puerta']) {
    const { pedir, llamadas } = armar({ viajeEnCurso: viaje({ fallaTipo }) });

    const r = await pedir('DELETE');

    assert.equal(r.body.efecto, 'DESACTIVADA');
    assert.equal(r.body.tipoCerrado, fallaTipo);
    assert.equal(llamadas.length, 1);
  }
});

test('DELETE sin falla de carga: YA_INACTIVA, sin escribir', async () => {
  const { pedir, llamadas } = armar();

  const r = await pedir('DELETE');

  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { camionId: '900002', viajeId: 41, efecto: 'YA_INACTIVA' });
  assert.deepEqual(llamadas, []);
});

test('DELETE con camion inexistente, sin viaje o con carga seca: mismos errores que POST', async () => {
  const casos = [
    [{ camion: null, viajeEnCurso: null }, 404, 'camion_no_encontrado'],
    [{ viajeEnCurso: null }, 409, 'sin_viaje_en_curso'],
    [{ camion: camionRefrigerado({ tipoCarga: 'seca' }) }, 409, 'sin_carga_refrigerada'],
  ];
  for (const [caso, status, error] of casos) {
    const { pedir } = armar(caso);
    const r = await pedir('DELETE');
    assert.equal(r.status, status);
    assert.equal(r.body.error, error);
  }
});

test('DELETE ignora un sentido invalido en la query: solo valida en POST', async () => {
  const { pedir } = armar();

  const r = await pedir('DELETE', '/camiones/900002/falla-carga?sentido=costado');

  assert.equal(r.status, 200);
});

// --- GET: consultar (contrato §3) ---

test('GET sin falla de carga: inactivo, con el rango y la ultima temperatura emitida', async () => {
  const { pedir, llamadas } = armar({ temperatura: 5.2 });

  const r = await pedir('GET');

  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    camionId: '900002',
    viajeId: 41,
    estado: 'inactivo',
    fallaTipo: null,
    sentido: null,
    objetivoC: null,
    activadaEn: null,
    desactivadaEn: null,
    umbralMinC: 2,
    umbralMaxC: 8,
    setpointTempC: 5,
    ultimaTemperaturaC: 5.2,
  });
  assert.deepEqual(llamadas, []);
});

test('GET con el desvio activo: sentido, objetivo y hora de activacion', async () => {
  const { pedir } = armar({
    viajeEnCurso: viaje({ fallaTipo: 'desvio_termico', fallaCargaSentido: 'abajo', fallaCargaActivadaEn: AHORA }),
    temperatura: -1.8,
  });

  const r = await pedir('GET');

  assert.equal(r.body.estado, 'activo');
  assert.equal(r.body.sentido, 'abajo');
  assert.equal(r.body.objetivoC, -2);
  assert.equal(r.body.activadaEn, AHORA.toISOString());
  assert.equal(r.body.ultimaTemperaturaC, -1.8);
});

test('GET con una falla cargada por SQL: otra_falla, sin sentido ni objetivo', async () => {
  const { pedir } = armar({ viajeEnCurso: viaje({ fallaTipo: 'falla_compresor' }) });

  const r = await pedir('GET');

  assert.equal(r.body.estado, 'otra_falla');
  assert.equal(r.body.fallaTipo, 'falla_compresor');
  assert.equal(r.body.sentido, null);
  assert.equal(r.body.objetivoC, null);
});

test('GET despues de cerrar: inactivo con la hora de cierre informada', async () => {
  const CIERRE = new Date('2026-11-22T14:30:00Z');
  const { pedir } = armar({
    viajeEnCurso: viaje({ fallaCargaSentido: 'arriba', fallaCargaActivadaEn: AHORA, fallaCargaDesactivadaEn: CIERRE }),
  });

  const r = await pedir('GET');

  assert.equal(r.body.estado, 'inactivo');
  assert.equal(r.body.activadaEn, AHORA.toISOString());
  assert.equal(r.body.desactivadaEn, CIERRE.toISOString());
  assert.equal(r.body.sentido, null);
  assert.equal(r.body.objetivoC, null);
});

test('GET sin umbrales ni temperatura emitida: nulls', async () => {
  const { pedir } = armar({ camion: camionRefrigerado({ umbralMinC: null, umbralMaxC: null }), temperatura: null });

  const r = await pedir('GET');

  assert.equal(r.body.umbralMinC, null);
  assert.equal(r.body.umbralMaxC, null);
  assert.equal(r.body.ultimaTemperaturaC, null);
});

test('GET con camion inexistente o sin viaje: 404 / 409', async () => {
  assert.equal((await armar({ camion: null, viajeEnCurso: null }).pedir('GET')).status, 404);
  assert.equal((await armar({ viajeEnCurso: null }).pedir('GET')).status, 409);
});
