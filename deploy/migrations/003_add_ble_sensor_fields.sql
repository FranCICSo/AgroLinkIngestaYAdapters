-- Agrega las columnas de lecturas de sensores BLE del slot 0 introducidas en la feature
-- 008 (ble-sensor-ingestion): ble_temperatura_c, ble_humedad_pct y ble_bateria. Llegan en
-- un tercer segmento opcional de la trama (reporte de usuario que emula EQ, ver
-- specs/008-ble-sensor-ingestion/contracts/rinho-ble-segment.md).
--
-- NUMERIC sin precision ni escala a proposito (research.md D-05): un tipo acotado haria
-- fallar el INSERT ante un valor fuera de rango, el receptor no enviaria ACK y el equipo
-- reintentaria la misma trama indefinidamente. Sin escala tampoco se redondea lo que
-- mando el sensor. ble_bateria no lleva unidad en el nombre: la documentacion del
-- fabricante la da como % en un lugar y como mV en otro, sin verificar con hardware.
--
-- Solo agrega columnas nullable sin DEFAULT: ninguna fila existente se modifica
-- (Principio IV). Idempotente: `ADD COLUMN IF NOT EXISTS` no falla si la columna ya existe
-- (volumen nuevo, inicializado directo con la version actual de 01-schema.sql).
ALTER TABLE telemetria.lectura_telemetria
    ADD COLUMN IF NOT EXISTS ble_temperatura_c NUMERIC,
    ADD COLUMN IF NOT EXISTS ble_humedad_pct NUMERIC,
    ADD COLUMN IF NOT EXISTS ble_bateria NUMERIC;
