-- Feature 019-falla-carga-refrigerada-http (data-model.md §1 y §2): desvio termico manual de la
-- carga refrigerada, activable y cerrable por HTTP (/camiones/{id}/falla-carga).
--   * simulador.viaje: nuevo valor 'desvio_termico' en falla_tipo (sigue habiendo como mucho una
--     falla de carga por viaje), mas sentido y horas de activacion/cierre.
--   * simulador.camion: umbrales termicos del viaje refrigerado en curso (llegan de
--     agrolink-ingesta junto con el setpoint), para ubicar la temperatura desviada.
-- Solo toca configuracion del simulador, nunca telemetria (Principio IV). Idempotente.
ALTER TABLE simulador.viaje
    ADD COLUMN IF NOT EXISTS falla_carga_sentido        VARCHAR(5)
        CHECK (falla_carga_sentido IN ('arriba', 'abajo')),
    ADD COLUMN IF NOT EXISTS falla_carga_activada_en    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS falla_carga_desactivada_en TIMESTAMPTZ;

ALTER TABLE simulador.camion
    ADD COLUMN IF NOT EXISTS umbral_min_c NUMERIC(4,1),
    ADD COLUMN IF NOT EXISTS umbral_max_c NUMERIC(4,1);

-- El CHECK de falla_tipo se definio inline (nombre autogenerado, normalmente
-- viaje_falla_tipo_check). Se busca por definicion y no por nombre, para no dejar un check viejo
-- que rechace 'desvio_termico' en un entorno donde se llame distinto (plan.md, Riesgos).
DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'simulador.viaje'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%falla_tipo%'
    LOOP
        EXECUTE format('ALTER TABLE simulador.viaje DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE simulador.viaje
    ADD CONSTRAINT viaje_falla_tipo_check
        CHECK (falla_tipo IN ('apertura_puerta', 'falla_compresor', 'desvio_termico'));
