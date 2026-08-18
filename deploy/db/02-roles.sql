-- Roles de aplicacion. Ningun rol recibe UPDATE ni DELETE sobre lectura_telemetria:
-- la inmutabilidad (Principio IV) la garantiza el motor, no una convencion de codigo.
--
-- Las contrasenas se inyectan por variable de entorno desde deploy/.env al arrancar el
-- contenedor de timescaledb (nunca hardcodeadas aqui). \getenv es un meta-comando de psql
-- (los scripts de docker-entrypoint-initdb.d se ejecutan con psql, no con un cliente SQL
-- puro), disponible desde PostgreSQL 9.4.

\getenv rinho_receptor_password RINHO_RECEPTOR_DB_PASSWORD
\getenv agrolink_ingesta_password AGROLINK_INGESTA_DB_PASSWORD

CREATE ROLE rinho_receptor LOGIN PASSWORD :'rinho_receptor_password';
CREATE ROLE agrolink_ingesta LOGIN PASSWORD :'agrolink_ingesta_password';

GRANT USAGE ON SCHEMA telemetria TO rinho_receptor;
GRANT USAGE ON SCHEMA telemetria TO agrolink_ingesta;

-- El receptor UDP escribe lecturas nuevas, nunca las modifica.
GRANT SELECT, INSERT ON telemetria.lectura_telemetria TO rinho_receptor;

-- El servicio de reportes es estrictamente de solo lectura.
GRANT SELECT ON telemetria.lectura_telemetria TO agrolink_ingesta;

-- BIGSERIAL requiere USAGE sobre la secuencia para poder insertar.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA telemetria TO rinho_receptor;

-- Deduplicacion (D-07): incluye la columna de particionamiento porque TimescaleDB lo
-- exige en todo indice unico sobre una hypertable.
CREATE UNIQUE INDEX lectura_dedup_uq
  ON telemetria.lectura_telemetria (dispositivo_id, momento_evento, frame_hash);

-- Consulta principal del reporte de viaje: camion + rango temporal (FR-005).
CREATE INDEX lectura_camion_tiempo_idx
  ON telemetria.lectura_telemetria (dispositivo_id, momento_evento DESC);
