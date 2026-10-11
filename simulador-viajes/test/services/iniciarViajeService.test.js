import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarViajeParaCamion } from '../../src/services/iniciarViajeService.js';

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
