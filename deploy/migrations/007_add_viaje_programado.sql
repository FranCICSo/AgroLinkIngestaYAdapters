-- Feature 013-autostart-simulacion-viaje: planificacion de simulaciones a arrancar en el
-- horario de comienzo del viaje. Esquema nuevo (`ingesta`), separado de `telemetria`
-- (insert-only, Principio IV) y de `simulador` (sin acceso de escritura para
-- agrolink-ingesta, ver specs/013-autostart-simulacion-viaje/research.md D-02).

CREATE SCHEMA IF NOT EXISTS ingesta;

CREATE TABLE IF NOT EXISTS ingesta.viaje_programado (
    id                          BIGSERIAL       PRIMARY KEY,
    trip_code                   VARCHAR(50)     UNIQUE NOT NULL,
    iot_device_id               VARCHAR(20)     NOT NULL,
    estimated_start_date_time   TIMESTAMP       NOT NULL,
    origen_lat                  NUMERIC(9,6)    NOT NULL,
    origen_lon                  NUMERIC(9,6)    NOT NULL,
    destino_lat                 NUMERIC(9,6)    NOT NULL,
    destino_lon                 NUMERIC(9,6)    NOT NULL,
    nombre_ruta                 VARCHAR(100)    NOT NULL,
    estado                      VARCHAR(12)     NOT NULL CHECK (estado IN ('PENDIENTE', 'DISPARADO', 'CANCELADO', 'ERROR')),
    ultimo_error                TEXT,
    creado_en                   TIMESTAMP       NOT NULL DEFAULT now(),
    actualizado_en              TIMESTAMP       NOT NULL DEFAULT now()
);

-- Consulta principal del poller (ViajeSimuladoScheduler): filas pendientes cuyo horario ya
-- llego, ordenadas implicitamente por el indice.
CREATE INDEX IF NOT EXISTS viaje_programado_pendiente_idx
  ON ingesta.viaje_programado (estimated_start_date_time)
  WHERE estado = 'PENDIENTE';

-- Sin DELETE: cancelar es un cambio de estado a 'CANCELADO' (FR-010), nunca un borrado de fila
-- (misma convencion de auditabilidad que el resto del proyecto).
GRANT USAGE ON SCHEMA ingesta TO agrolink_ingesta;
GRANT SELECT, INSERT, UPDATE ON ingesta.viaje_programado TO agrolink_ingesta;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ingesta TO agrolink_ingesta;
