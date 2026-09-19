-- Schema de telemetria: hypertable insert-only (Constitucion, Principio IV).
-- Ver especificacion completa en specs/001-ingesta-adaptacion-telemetria/data-model.md

CREATE SCHEMA IF NOT EXISTS telemetria;
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE telemetria.lectura_telemetria (
    id                      BIGSERIAL       NOT NULL,
    dispositivo_id          VARCHAR(20)     NOT NULL,
    momento_evento          TIMESTAMPTZ     NOT NULL,
    momento_recepcion       TIMESTAMPTZ     NOT NULL DEFAULT now(),
    latitud                 NUMERIC(9,6),
    longitud                NUMERIC(9,6),
    velocidad_kmh           NUMERIC(5,1),
    rumbo_grados            SMALLINT,
    -- En kilometros desde la feature 005 (antes odometro_m, en metros). Migracion manual
    -- para un volumen ya inicializado: specs/005-odometer-storage-km/research.md (D-04).
    odometro_km             DOUBLE PRECISION,
    odometro_origen         VARCHAR(3)      CHECK (odometro_origen IN ('ECU', 'GPS')),
    combustible_pct         NUMERIC(5,2),
    vin                     VARCHAR(20),
    rpm                     SMALLINT,
    combustible_consumido_l NUMERIC(10,2),
    temperatura_refrigerante_c SMALLINT,
    presion_aceite_kpa      SMALLINT,
    ignicion                BOOLEAN,
    tension_bateria_v       NUMERIC(4,1),
    satelites               SMALLINT,
    estado_interpretacion   VARCHAR(8)      NOT NULL CHECK (estado_interpretacion IN ('COMPLETA', 'PARCIAL')),
    campos_faltantes        TEXT[],
    datos_can               JSONB,
    payload_crudo           TEXT            NOT NULL,
    frame_hash              CHAR(64)        NOT NULL,
    msg_num                 VARCHAR(4),
    reporte_id              VARCHAR(2),
    PRIMARY KEY (id, momento_evento)
);

-- momento_evento es la columna de particionamiento (fecha/hora de la trama, no de
-- recepcion): una lectura atrasada se ubica en su chunk cronologico real, nunca sobrescribe
-- una mas reciente (Principio VII).
SELECT create_hypertable('telemetria.lectura_telemetria', 'momento_evento');

COMMENT ON TABLE telemetria.lectura_telemetria IS
  'Lecturas de telemetria, insert-only e inmutables (Principio IV). Ningun camino de '
  'codigo emite UPDATE ni DELETE; los GRANT de 02-roles.sql lo impiden a nivel de motor.';
