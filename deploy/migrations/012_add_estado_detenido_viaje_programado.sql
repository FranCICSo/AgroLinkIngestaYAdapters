-- Feature 014-simulacion-ruta-del-viaje, Historia 3: la detencion de una simulacion Rinho (viaje
-- completado o cancelado en AgroLink) deja la fila en estado 'DETENIDO'. Ademas de registrar la
-- detencion, un inicio tardio del mismo tripCode se rechaza (solo PENDIENTE es modificable).
-- El CHECK de 007 es inline, asi que Postgres lo nombro viaje_programado_estado_check.
ALTER TABLE ingesta.viaje_programado DROP CONSTRAINT IF EXISTS viaje_programado_estado_check;
ALTER TABLE ingesta.viaje_programado ADD CONSTRAINT viaje_programado_estado_check
    CHECK (estado IN ('PENDIENTE', 'DISPARADO', 'CANCELADO', 'ERROR', 'DETENIDO'));
