// Test de llegada tardia (FR-012 / Principio VII, T067). Requiere una TimescaleDB real
// contra el schema de deploy/db/*.sql: es un test de integracion, no unitario, porque el
// comportamiento que verifica -que el motor no reordene ni pise filas- vive en la base, no
// en codigo JS. Se salta automaticamente si no hay variables de entorno de conexion (p.ej.
// en `npm test` sin el stack de docker compose levantado); corre de punta a punta en CI o
// en la validacion de quickstart.md contra el compose real.
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

function lecturaFixture(dispositivoId, momentoEvento, marcador) {
  const payloadCrudo = `fixture-${marcador}-${Math.random()}`;
  return {
    dispositivoId,
    momentoEvento,
    latitud: -27.78,
    longitud: -64.26,
    velocidadKmh: 42,
    rumboGrados: 90,
    odometroM: 1000,
    odometroOrigen: 'GPS',
    combustiblePct: 50,
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

test('FR-012: una lectura con momento_evento anterior se persiste sin pisar filas mas recientes y queda ordenada cronologicamente', { skip: !canRunIntegration() }, async () => {
  const config = loadConfig();
  const pool = createPool(config.db);
  const repository = createLecturaRepository(pool, config.dedupCacheTtlMs);
  // dispositivo_id es VARCHAR(20): el prefijo de fixture debe caber junto al timestamp.
  const dispositivoId = `t${Date.now()}`.slice(0, 20);

  try {
    const nueva = lecturaFixture(dispositivoId, new Date('2026-08-15T12:00:00Z'), 'nueva');
    await repository.persist(nueva);

    const snapshotAntes = await pool.query(
      'SELECT * FROM lectura_telemetria WHERE dispositivo_id = $1 ORDER BY momento_evento',
      [dispositivoId],
    );

    // Trama del dispositivo llegada despues, pero con hora ANTERIOR (bufferizada durante
    // una desconexion celular y descargada al reconectar).
    const tardia = lecturaFixture(dispositivoId, new Date('2026-08-15T08:00:00Z'), 'tardia');
    const result = await repository.persist(tardia);
    assert.equal(result.inserted, true);

    const snapshotDespues = await pool.query(
      'SELECT * FROM lectura_telemetria WHERE dispositivo_id = $1 AND payload_crudo = $2',
      [dispositivoId, snapshotAntes.rows[0].payload_crudo],
    );
    // La fila mas reciente queda BYTE A BYTE intacta (no solo "sigue existiendo").
    assert.deepEqual(snapshotDespues.rows[0], snapshotAntes.rows[0]);

    const ordenado = await pool.query(
      'SELECT payload_crudo FROM lectura_telemetria WHERE dispositivo_id = $1 ORDER BY momento_evento',
      [dispositivoId],
    );
    assert.equal(ordenado.rows.length, 2);
    assert.equal(ordenado.rows[0].payload_crudo, tardia.payloadCrudo); // la mas vieja, primera
    assert.equal(ordenado.rows[1].payload_crudo, nueva.payloadCrudo);
  } finally {
    // Sin cleanup por DELETE: el rol rinho_receptor no tiene ese GRANT (Principio IV, la
    // inmutabilidad la garantiza el motor). Las filas de fixture quedan con un
    // dispositivo_id unico por timestamp, sin interferir con corridas futuras.
    await closePool(pool);
  }
});
