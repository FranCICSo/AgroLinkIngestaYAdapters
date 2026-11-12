import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarViajeParaCamion, SETPOINT_HUMEDAD_DEFAULT_PCT } from '../../src/services/iniciarViajeService.js';

function fakePool({ camionExistente = null, ultimoOdometro = null } = {}) {
  const llamadas = [];
  return {
    llamadas,
    query: async (sql, params) => {
      llamadas.push({ sql, params });
      if (/SELECT id, nombre, tipo_carga, odometro_inicial_km, activo\s+FROM simulador\.camion/.test(sql)) {
        return { rows: camionExistente ? [camionExistente] : [] };
      }
      if (/INSERT INTO simulador\.camion/.test(sql)) {
        return { rows: [{ id: params[0], nombre: params[1], odometro_inicial_km: params[5] }] };
      }
      if (/UPDATE simulador\.camion\s+SET tipo_carga/.test(sql)) {
        return { rows: [] };
      }
      if (/UPDATE simulador\.viaje SET estado = 'finalizado'/.test(sql)) {
        return { rows: [] };
      }
      if (/ORDER BY id DESC/.test(sql)) {
        return { rows: ultimoOdometro === null ? [] : [{ odometro_actual_km: ultimoOdometro }] };
      }
      if (/INSERT INTO simulador\.viaje/.test(sql)) {
        return {
          rows: [{ id: 9, camion_id: params[0], ruta_id: params[1], sentido: 'ida', estado: 'en_curso' }],
        };
      }
      throw new Error(`query no esperada en el test: ${sql}`);
    },
  };
}

test('crea el camion si no existia y arranca el viaje con el odometro inicial', async () => {
  const pool = fakePool();

  const resultado = await iniciarViajeParaCamion(pool, {
    camion: { id: '900005', nombre: 'Camion 5', odometroInicialKm: 500 },
    rutaId: 7,
  });

  assert.equal(resultado.dispositivoId, '900005');
  assert.equal(resultado.rutaId, 7);
  assert.equal(resultado.estado, 'en_curso');

  const insertCamion = pool.llamadas.find((l) => /INSERT INTO simulador\.camion/.test(l.sql));
  assert.ok(insertCamion, 'debe insertar el camion nuevo');

  const insertViaje = pool.llamadas.find((l) => /INSERT INTO simulador\.viaje/.test(l.sql));
  assert.equal(insertViaje.params[2], 500);
});

test('reusa un camion existente sin reinsertarlo y cierra su viaje previo', async () => {
  const pool = fakePool({
    camionExistente: { id: '900004', nombre: 'Camion 4', odometro_inicial_km: 12000 },
    ultimoOdometro: 345.6,
  });

  const resultado = await iniciarViajeParaCamion(pool, {
    camion: { id: '900004' },
    rutaId: 5,
  });

  assert.equal(resultado.dispositivoId, '900004');

  const insertCamion = pool.llamadas.find((l) => /INSERT INTO simulador\.camion/.test(l.sql));
  assert.equal(insertCamion, undefined, 'no debe reinsertar un camion ya existente');

  const finalizar = pool.llamadas.find((l) => /SET estado = 'finalizado'/.test(l.sql));
  assert.ok(finalizar, 'debe cerrar el viaje en_curso previo del camion');

  const insertViaje = pool.llamadas.find((l) => /INSERT INTO simulador\.viaje/.test(l.sql));
  assert.equal(insertViaje.params[2], 345.6, 'debe continuar desde el ultimo odometro conocido');
});

test('un odometro explicito en el request manda sobre el ultimo odometro del simulador', async () => {
  const pool = fakePool({
    camionExistente: { id: 'tel-demo-003', nombre: 'Camion demo', odometro_inicial_km: 0 },
    ultimoOdometro: 345.6,
  });

  await iniciarViajeParaCamion(pool, {
    camion: { id: 'tel-demo-003', odometroInicialKm: 184400 },
    rutaId: 5,
  });

  const insertViaje = pool.llamadas.find((l) => /INSERT INTO simulador\.viaje/.test(l.sql));
  assert.equal(insertViaje.params[2], 184400);
});

test('alta de camion con carga refrigerada: guarda setpoint y humedad por defecto', async () => {
  const pool = fakePool();

  await iniciarViajeParaCamion(pool, {
    camion: { id: '900006', tipoCarga: 'refrigerada', setpointTempC: 4 },
    rutaId: 7,
  });

  const insertCamion = pool.llamadas.find((l) => /INSERT INTO simulador\.camion/.test(l.sql));
  // (id, nombre, tipo_carga, setpoint_temp_c, setpoint_humedad_pct, odometro_inicial_km)
  assert.deepEqual(insertCamion.params.slice(2, 5), ['refrigerada', 4, SETPOINT_HUMEDAD_DEFAULT_PCT]);
});

test('camion existente cargado como seca pasa a refrigerada cuando el viaje lo informa', async () => {
  const pool = fakePool({
    camionExistente: { id: '900002', nombre: 'Camion 2', tipo_carga: 'seca', odometro_inicial_km: 0 },
  });

  await iniciarViajeParaCamion(pool, {
    camion: { id: '900002', tipoCarga: 'refrigerada', setpointTempC: 3.5, setpointHumedadPct: 90 },
    rutaId: 5,
  });

  const update = pool.llamadas.find((l) => /UPDATE simulador\.camion\s+SET tipo_carga/.test(l.sql));
  assert.ok(update, 'debe actualizar la carga del camion existente');
  assert.deepEqual(update.params, ['900002', 'refrigerada', 3.5, 90]);
});

test('camion existente refrigerado vuelve a seca y limpia los setpoints', async () => {
  const pool = fakePool({
    camionExistente: { id: '900002', nombre: 'Camion 2', tipo_carga: 'refrigerada', odometro_inicial_km: 0 },
  });

  await iniciarViajeParaCamion(pool, { camion: { id: '900002', tipoCarga: 'seca' }, rutaId: 5 });

  const update = pool.llamadas.find((l) => /UPDATE simulador\.camion\s+SET tipo_carga/.test(l.sql));
  assert.deepEqual(update.params, ['900002', 'seca', null, null]);
});

test('sin tipoCarga en el request no toca la carga de un camion existente', async () => {
  const pool = fakePool({
    camionExistente: { id: '900002', nombre: 'Camion 2', tipo_carga: 'refrigerada', odometro_inicial_km: 0 },
  });

  await iniciarViajeParaCamion(pool, { camion: { id: '900002' }, rutaId: 5 });

  const update = pool.llamadas.find((l) => /UPDATE simulador\.camion\s+SET tipo_carga/.test(l.sql));
  assert.equal(update, undefined);
});
