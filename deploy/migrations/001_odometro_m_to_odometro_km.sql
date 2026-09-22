-- Renombra lectura_telemetria.odometro_m (metros) a odometro_km (kilometros) y
-- reinterpreta cada valor ya persistido dividiendolo por 1000, sin perder magnitud
-- (feature 005-odometer-storage-km, research.md D-04).
--
-- Nota sobre la regla 4 de deploy/migrations/README.md ("nunca tocar valores de una
-- lectura ya guardada"): ALTER COLUMN ... TYPE ... USING reescribe cada fila, pero es
-- una reinterpretacion de unidad aplicada por igual a toda la tabla -no una correccion
-- de negocio sobre datos mal recibidos- y no cambia que distancia real representa cada
-- lectura. Este caso ya fue evaluado explicitamente contra el Principio IV de la
-- constitucion en el plan de la feature 005 (Constitution Check) antes de que existiera
-- este sistema de migraciones versionadas.
--
-- Idempotente: si la columna ya se llama odometro_km (por ejemplo, porque ya se aplico
-- a mano en produccion antes de que este archivo existiera, o porque deploy/db/01-schema.sql
-- ya la crea asi en un volumen nuevo), esta migracion no hace nada salvo quedar
-- registrada en public.schema_migrations.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'telemetria'
          AND table_name = 'lectura_telemetria'
          AND column_name = 'odometro_m'
    ) THEN
        ALTER TABLE telemetria.lectura_telemetria
            RENAME COLUMN odometro_m TO odometro_km;
        ALTER TABLE telemetria.lectura_telemetria
            ALTER COLUMN odometro_km TYPE DOUBLE PRECISION USING odometro_km / 1000.0;
    END IF;
END $$;
