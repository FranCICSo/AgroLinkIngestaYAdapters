import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarCamion, finalizarYCrearVuelta } from '../../src/db/flotaRepository.js';

test('acepta un camion con id dentro del rango reservado 900001-900999', () => {
  const { valido } = validarCamion({ id: '900001', tipoCarga: 'seca' });
  assert.equal(valido, true);
});

test('rechaza un camion cuyo id no matchea el rango reservado', () => {
  const { valido, motivo } = validarCamion({ id: '860693084873877', tipoCarga: 'seca' });
  assert.equal(valido, false);
  assert.match(motivo, /rango reservado/);
});

test('acepta un camion con id no numerico (calca un iotDeviceId de AgroLinkBackend)', () => {
  const { valido } = validarCamion({ id: 'tra-demo-004', tipoCarga: 'seca' });
  assert.equal(valido, true);
});

test('rechaza un camion refrigerado sin setpoint de temperatura o humedad', () => {
  const { valido, motivo } = validarCamion({
    id: '900002',
    tipoCarga: 'refrigerada',
    setpointTempC: null,
    setpointHumedadPct: 87,
  });
  assert.equal(valido, false);
  assert.match(motivo, /setpoint/);
});

test('acepta un camion refrigerado con ambos setpoints', () => {
  const { valido } = validarCamion({
    id: '900002',
    tipoCarga: 'refrigerada',
    setpointTempC: 2.5,
    setpointHumedadPct: 87,
  });
  assert.equal(valido, true);
});

// Feature 014 (Historia 3): un viaje detenido por HTTP mientras el ciclo lo procesaba no revive.
function poolConCliente(rowCountFinalizado) {
  const sentencias = [];
  const client = {
    query: async (sql) => {
      sentencias.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
      if (/^UPDATE simulador\.viaje SET estado = 'finalizado'/.test(sql.trim())) {
        return { rowCount: rowCountFinalizado, rows: [] };
      }
      if (/^INSERT/.test(sql.trim())) {
        return { rows: [{ id: 99, sentido: 'vuelta' }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  return { pool: { connect: async () => client }, sentencias };
}

const VIAJE = { id: 41, camionId: '900002', rutaId: 3, sentido: 'ida', odometroActualKm: 120 };

test('finalizarYCrearVuelta: viaje ya detenido -> no crea la vuelta y devuelve null', async () => {
  const { pool, sentencias } = poolConCliente(0);
  assert.equal(await finalizarYCrearVuelta(pool, VIAJE), null);
  assert.ok(!sentencias.some((s) => s.startsWith('INSERT')), 'no debe insertar el viaje de vuelta');
  assert.ok(sentencias.includes('ROLLBACK'));
});

test('finalizarYCrearVuelta: viaje en curso -> crea la vuelta', async () => {
  const { pool, sentencias } = poolConCliente(1);
  const nuevo = await finalizarYCrearVuelta(pool, VIAJE);
  assert.equal(nuevo.id, 99);
  assert.ok(sentencias.some((s) => s.startsWith('INSERT')));
  assert.ok(sentencias.includes('COMMIT'));
});
