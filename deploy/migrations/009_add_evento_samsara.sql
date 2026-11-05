-- Feature 015-samsara-webhook-exceso-velocidad: notificaciones webhook de Samsara
-- (SevereSpeedingStarted/Ended), guardadas tal como llegaron (research.md D-02). Es dato
-- crudo de un proveedor de telemetria, por eso vive en `telemetria` y es insert-only
-- (Principio IV): agrolink_ingesta recibe SELECT/INSERT solo sobre esta tabla.
--
-- momento_evento sale del `eventTime` del sobre (o de la recepcion si falta): un reintento
-- de Samsara trae el mismo eventId + eventTime y choca contra el indice unico, que tiene
-- que incluir la columna de particionamiento por exigencia de TimescaleDB (research.md D-03).

CREATE TABLE IF NOT EXISTS telemetria.evento_samsara (
    id                   BIGSERIAL       NOT NULL,
    momento_evento       TIMESTAMPTZ     NOT NULL,
    momento_recepcion    TIMESTAMPTZ     NOT NULL DEFAULT now(),
    event_id             TEXT,
    tipo_evento          TEXT,
    samsara_vehiculo_id  TEXT,
    patente              TEXT,
    inicio_exceso        TIMESTAMPTZ,
    fin_exceso           TIMESTAMPTZ,
    inicio_viaje         TIMESTAMPTZ,
    payload_crudo        JSONB           NOT NULL,
    PRIMARY KEY (id, momento_evento)
);

SELECT create_hypertable('telemetria.evento_samsara', 'momento_evento', if_not_exists => TRUE);

-- Idempotencia ante reintentos (FR-004). Sin eventId no hay como deduplicar: se guarda igual.
CREATE UNIQUE INDEX IF NOT EXISTS evento_samsara_event_id_uq
  ON telemetria.evento_samsara (event_id, momento_evento)
  WHERE event_id IS NOT NULL;

-- Consulta por cursor de AgroLinkBackend (FR-004a, research.md D-04).
CREATE INDEX IF NOT EXISTS evento_samsara_id_idx
  ON telemetria.evento_samsara (id);

COMMENT ON TABLE telemetria.evento_samsara IS
  'Notificaciones webhook de Samsara, insert-only e inmutables (Principio IV). Feature 015.';

GRANT SELECT, INSERT ON telemetria.evento_samsara TO agrolink_ingesta;
GRANT USAGE, SELECT ON SEQUENCE telemetria.evento_samsara_id_seq TO agrolink_ingesta;
