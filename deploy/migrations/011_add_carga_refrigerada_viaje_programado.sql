-- Carga refrigerada del viaje (umbrales termicos que AgroLinkBackend define en el viaje, °C).
-- Se reenvian a simulador-viajes para que el camion simulado emita el segmento BLE de
-- temperatura. Ambos NULL = carga no refrigerada (comportamiento anterior).
ALTER TABLE ingesta.viaje_programado
    ADD COLUMN IF NOT EXISTS umbral_termico_min_c NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS umbral_termico_max_c NUMERIC(5,2);
