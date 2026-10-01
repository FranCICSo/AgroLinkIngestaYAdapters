// Ida y vuelta de las columnas BLE contra una TimescaleDB real (feature 008, hallazgo C1
// de /speckit-analyze): detecta un corrimiento de placeholders en el INSERT de
// lecturaRepository, que ningun test unitario ve. Mismo patron que lecturaTardia.test.js:
// se salta si no hay variables de entorno de conexion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createPool, closePool } from '../src/db/pool.js';
import { createLecturaRepository } from '../src/db/lecturaRepository.js';

const canRunIntegration = () => {
  try {
    loadConfig();
    return true;
  } catch {
    return false;
  }
};

function lecturaFixture(dispositivoId, ble) {
  const payloadCrudo = `fixture-ble-${Math.random()}`;
  return {
    dispositivoId,
    momentoEvento: new Date('2026-09-27T12:00:00Z'),
    latitud: -27.78,
    longitud: -64.26,
    velocidadKmh: 42,
    rumboGrados: 90,
    odometroKm: 1000,
    odometroOrigen: 'GPS',
    combustiblePct: 50,
    vin: null,
    rpm: null,
    combustibleConsumidoL: null,
    temperaturaRefrigeranteC: null,
    presionAceiteKpa: 340,
    ...ble,
    ignicion: true,
    tensionBateriaV: 12.5,
    satelites: 8,
    estadoInterpretacion: 'COMPLETA',
    camposFaltantes: [],
    datosCan: {},
    payloadCrudo,
    frameHash: crypto.createHash('sha256').update(payloadCrudo).digest('hex'),
    msgNum: null,
    reporteId: '00',
  };
}

const SELECT_BLE = `
  SELECT ble_temperatura_c, ble_humedad_pct, ble_bateria, presion_aceite_kpa, ignicion, reporte_id
  FROM lectura_telemetria WHERE frame_hash = $1
`;

test('columnas BLE: los valores vuelven en su columna, sin corrimiento de placeholders', { skip: !canRunIntegration() }, async () => {
  const config = loadConfig();
  const pool = createPool(config.db);
  const repository = createLecturaRepository(pool, config.dedupCacheTtlMs);
  const dispositivoId = `b${Date.now()}`.slice(0, 20);

  try {
    const conBle = lecturaFixture(dispositivoId, {
      bleTemperaturaC: 23.5,
      bleHumedadPct: 45,
      bleBateria: 3012,
    });
    await repository.persist(conBle);
    const { rows: [fila] } = await pool.query(SELECT_BLE, [conBle.frameHash]);
    // pg devuelve NUMERIC como string para no perder precision.
    assert.equal(Number(fila.ble_temperatura_c), 23.5);
    assert.equal(Number(fila.ble_humedad_pct), 45);
    assert.equal(Number(fila.ble_bateria), 3012);
    // Vecinos del bloque BLE en el INSERT: un corrimiento los romperia primero.
    assert.equal(fila.presion_aceite_kpa, 340);
    assert.equal(fila.ignicion, true);
    assert.equal(fila.reporte_id, '00');

    const sinBle = lecturaFixture(dispositivoId, {
      bleTemperaturaC: null,
      bleHumedadPct: null,
      bleBateria: null,
    });
    await repository.persist(sinBle);
    const { rows: [filaNula] } = await pool.query(SELECT_BLE, [sinBle.frameHash]);
    assert.equal(filaNula.ble_temperatura_c, null);
    assert.equal(filaNula.ble_humedad_pct, null);
    assert.equal(filaNula.ble_bateria, null);
  } finally {
    // Sin DELETE: el rol rinho_receptor no tiene ese GRANT (Principio IV).
    await closePool(pool);
  }
});
