-- Feature 016-alerta-temperatura-motor (data-model.md §1): falla de sobrecalentamiento de motor
-- por viaje simulado. Independiente de falla_tipo/falla_indice_disparo (fallas de carga, FR-004):
-- un viaje puede tener las dos a la vez. La activan el sorteo al crear el viaje (origen 'azar',
-- con indice de disparo y duracion al azar) o el endpoint HTTP interno del simulador (origen
-- 'manual', sin duracion). Solo toca configuracion del simulador, nunca telemetria (Principio IV).
-- Idempotente: ADD COLUMN IF NOT EXISTS. Los GRANT existentes sobre la tabla cubren las columnas.
ALTER TABLE simulador.viaje
    ADD COLUMN IF NOT EXISTS falla_motor_origen         VARCHAR(6)
        CHECK (falla_motor_origen IN ('azar', 'manual')),
    ADD COLUMN IF NOT EXISTS falla_motor_indice_disparo INTEGER,
    ADD COLUMN IF NOT EXISTS falla_motor_duracion_min   INTEGER
        CHECK (falla_motor_duracion_min > 0),
    ADD COLUMN IF NOT EXISTS falla_motor_activada_en    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS falla_motor_desactivada_en TIMESTAMPTZ;
