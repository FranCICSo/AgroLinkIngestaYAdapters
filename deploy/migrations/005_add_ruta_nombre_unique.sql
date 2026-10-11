-- Agrega una restriccion UNIQUE sobre simulador.ruta.nombre (feature
-- 011-generar-ruta-simulada, research.md D-03): el servicio de generacion de rutas
-- rechaza un nombre duplicado (FR-008) dejando que Postgres sea quien detecte el
-- conflicto en el INSERT (23505 unique_violation), en vez de un SELECT previo propenso a
-- una condicion de carrera (TOCTOU) entre dos generaciones casi simultaneas.
--
-- Idempotente: si la restriccion ya existe (por ejemplo, porque un volumen nuevo ya la
-- trae desde deploy/db/03-schema-simulador.sql), esta migracion no hace nada salvo
-- quedar registrada en public.schema_migrations (mismo patron que la migracion 001).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ruta_nombre_unique'
          AND conrelid = 'simulador.ruta'::regclass
    ) THEN
        ALTER TABLE simulador.ruta
            ADD CONSTRAINT ruta_nombre_unique UNIQUE (nombre);
    END IF;
END $$;
