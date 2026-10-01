-- Agrega las columnas propias de CAN bus introducidas en la feature 003
-- (can-fields-expansion): vin, rpm, combustible_consumido_l, temperatura_refrigerante_c
-- y presion_aceite_kpa. Igual que la migracion 001, esto retroactivea en produccion un
-- cambio de deploy/db/01-schema.sql que nunca se aplico ahi porque ese script solo corre
-- una vez, contra un volumen vacio (deploy/README.md SS2.5) — la base de produccion se
-- inicializo antes de que existiera este sistema de migraciones (feature
-- 007-cicd-deploy-ghcr) y antes de la feature 003, asi que jamas recibio este cambio.
--
-- Idempotente: `ADD COLUMN IF NOT EXISTS` no falla si la columna ya existe (volumen
-- nuevo, inicializado directo con la version actual de 01-schema.sql).
ALTER TABLE telemetria.lectura_telemetria
    ADD COLUMN IF NOT EXISTS vin VARCHAR(20),
    ADD COLUMN IF NOT EXISTS rpm SMALLINT,
    ADD COLUMN IF NOT EXISTS combustible_consumido_l NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS temperatura_refrigerante_c SMALLINT,
    ADD COLUMN IF NOT EXISTS presion_aceite_kpa SMALLINT;
