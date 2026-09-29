-- Schema de configuracion mutable del simulador de viajes (feature 009-simulador-viajes).
-- A diferencia de `telemetria` (insert-only, Principio IV), estas tablas se editan en
-- caliente (INSERT/UPDATE) para administrar la flota simulada sin redeploy (FR-004).
-- Ver especificacion completa en specs/009-simulador-viajes/data-model.md

CREATE SCHEMA IF NOT EXISTS simulador;

-- Camion ficticio. El id vive en el rango reservado 900001-900999 (research.md D-02):
-- nunca puede coincidir con un IMEI real de 15 digitos, asi que no hace falta una columna
-- "simulado" aparte ni tocar el schema de telemetria para distinguirlos (spec US5).
CREATE TABLE IF NOT EXISTS simulador.camion (
    id                      VARCHAR(6)      PRIMARY KEY,
    nombre                  VARCHAR(50)     NOT NULL,
    vin                     VARCHAR(20),
    tipo_carga              VARCHAR(20)     NOT NULL CHECK (tipo_carga IN ('seca', 'refrigerada')),
    -- Solo tienen sentido si tipo_carga = 'refrigerada' (medias reses: ~1-4 C, ~85-90%
    -- humedad). La validacion de "obligatorio si refrigerada" la hace el simulador al leer
    -- la fila (data-model.md SS1), no un CHECK, para poder loguear el motivo en vez de que
    -- una edicion a mano falle al insertar.
    setpoint_temp_c         NUMERIC(4,1),
    setpoint_humedad_pct    NUMERIC(5,2),
    odometro_inicial_km     NUMERIC(10,3)   NOT NULL,
    activo                  BOOLEAN         NOT NULL DEFAULT true
);

-- Ruta real (GPS) que un camion recorre. puntos/paradas van en JSONB porque siempre se
-- leen completos por camion y nunca se consultan por campo individual (research.md D-.. /
-- Principio III aplicado por analogia a diseno de datos: sin necesidad demostrada de
-- normalizar en tablas hijas).
CREATE TABLE IF NOT EXISTS simulador.ruta (
    id                      SERIAL          PRIMARY KEY,
    nombre                  VARCHAR(100)    NOT NULL,
    -- [{ "lat": number, "lon": number }, ...] en orden de recorrido "ida".
    puntos                  JSONB           NOT NULL,
    -- [{ "indice": number, "duracion_min": number }, ...] paradas de entrega sobre `puntos`.
    paradas                 JSONB           NOT NULL DEFAULT '[]'::jsonb
);

-- Instancia de recorrido de un camion sobre una ruta. Un camion tiene a lo sumo un viaje
-- 'en_curso' a la vez (invariante de aplicacion, no UNIQUE: permite corregir un estado
-- inconsistente a mano sin pelear con una restriccion - data-model.md SS3).
CREATE TABLE IF NOT EXISTS simulador.viaje (
    id                      SERIAL          PRIMARY KEY,
    camion_id               VARCHAR(6)      NOT NULL REFERENCES simulador.camion(id),
    ruta_id                 INTEGER         NOT NULL REFERENCES simulador.ruta(id),
    sentido                 VARCHAR(6)      NOT NULL CHECK (sentido IN ('ida', 'vuelta')),
    indice_actual           INTEGER         NOT NULL DEFAULT 0,
    odometro_actual_km      NUMERIC(10,3)   NOT NULL,
    estado                  VARCHAR(12)     NOT NULL CHECK (estado IN ('en_curso', 'finalizado')),
    -- Fallas planificadas de carga refrigerada (FR-015/FR-016). Como mucho una por viaje en
    -- esta primera version (spec, Edge Cases).
    falla_tipo              VARCHAR(20)     CHECK (falla_tipo IN ('apertura_puerta', 'falla_compresor')),
    falla_indice_disparo    INTEGER
);

CREATE INDEX IF NOT EXISTS viaje_camion_estado_idx ON simulador.viaje (camion_id, estado);

COMMENT ON SCHEMA simulador IS
  'Configuracion mutable del simulador de viajes (feature 009): camiones, rutas y viajes '
  'ficticios. Nunca contiene telemetria real ni escribe en el schema telemetria.';

-- Rol de aplicacion del simulador: SELECT/INSERT/UPDATE acotado a este schema unicamente.
-- Deliberadamente SIN ningun GRANT sobre telemetria.* - el simulador nunca inserta
-- telemetria directo, solo la envia por UDP al receptor real (plan.md, Constraints).
-- CREATE ROLE no admite IF NOT EXISTS: se hace idempotente con \if de psql (evaluado del
-- lado del cliente) en vez de un DO $$ $$ - dentro de un bloque dollar-quoted psql NO
-- sustituye :'variable', asi que un DO server-side no puede ver la contrasena sin pasos
-- extra. Este script se re-aplica en cada `make simulador`, no solo en el init de un
-- volumen nuevo.
\getenv simulador_viajes_password SIMULADOR_VIAJES_DB_PASSWORD

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simulador_viajes') AS crear_rol \gset
\if :crear_rol
CREATE ROLE simulador_viajes LOGIN PASSWORD :'simulador_viajes_password';
\else
\echo 'Rol simulador_viajes ya existe, se omite CREATE ROLE.'
\endif
GRANT USAGE ON SCHEMA simulador TO simulador_viajes;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA simulador TO simulador_viajes;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA simulador TO simulador_viajes;
