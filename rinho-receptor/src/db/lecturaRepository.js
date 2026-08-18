import { log } from '../log.js';

// Segunda barrera de deduplicacion en memoria por (dispositivo_id, frame_hash), con TTL.
// Necesaria porque el indice unico de base incluye momento_evento, y una trama sin fix de
// hora GPS usa la hora de recepcion como momento_evento (D-08) -> dos reintentos de la
// MISMA trama sin fix pueden caer en momento_evento distintos y el indice unico no los
// atrapa (D-07).
class DedupCache {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.entries = new Map(); // key -> expiresAt
  }

  key(dispositivoId, frameHash) {
    return `${dispositivoId}:${frameHash}`;
  }

  has(dispositivoId, frameHash) {
    const k = this.key(dispositivoId, frameHash);
    const expiresAt = this.entries.get(k);
    if (expiresAt === undefined) return false;
    if (Date.now() > expiresAt) {
      this.entries.delete(k);
      return false;
    }
    return true;
  }

  remember(dispositivoId, frameHash) {
    const k = this.key(dispositivoId, frameHash);
    this.entries.set(k, Date.now() + this.ttlMs);
  }
}

const INSERT_SQL = `
  INSERT INTO lectura_telemetria (
    dispositivo_id, momento_evento, latitud, longitud, velocidad_kmh, rumbo_grados,
    odometro_m, odometro_origen, combustible_pct, ignicion, tension_bateria_v, satelites,
    estado_interpretacion, campos_faltantes, datos_can, payload_crudo, frame_hash,
    msg_num, reporte_id
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
  ON CONFLICT (dispositivo_id, momento_evento, frame_hash) DO NOTHING
  RETURNING id
`;

export function createLecturaRepository(pool, dedupCacheTtlMs) {
  const dedupCache = new DedupCache(dedupCacheTtlMs);

  return {
    // Devuelve { inserted: boolean, deduplicated: boolean }. Ambos casos (fila nueva o ya
    // existente) son exito de persistencia a efectos del ACK (US2, T025).
    async persist(lectura) {
      if (dedupCache.has(lectura.dispositivoId, lectura.frameHash)) {
        log.info('Trama deduplicada por cache en memoria', {
          dispositivoId: lectura.dispositivoId,
        });
        return { inserted: false, deduplicated: true };
      }

      const result = await pool.query(INSERT_SQL, [
        lectura.dispositivoId,
        lectura.momentoEvento,
        lectura.latitud,
        lectura.longitud,
        lectura.velocidadKmh,
        lectura.rumboGrados,
        lectura.odometroM,
        lectura.odometroOrigen,
        lectura.combustiblePct,
        lectura.ignicion,
        lectura.tensionBateriaV,
        lectura.satelites,
        lectura.estadoInterpretacion,
        lectura.camposFaltantes,
        JSON.stringify(lectura.datosCan),
        lectura.payloadCrudo,
        lectura.frameHash,
        lectura.msgNum,
        lectura.reporteId,
      ]);

      dedupCache.remember(lectura.dispositivoId, lectura.frameHash);

      return { inserted: result.rowCount > 0, deduplicated: result.rowCount === 0 };
    },
  };
}
