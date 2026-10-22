-- Odometro de partida que AgroLinkBackend ancla al iniciar el viaje (km). Se reenvia a
-- simulador-viajes para que la simulacion cuente desde ese valor y no desde el ultimo viaje
-- simulado del camion. Opcional: NULL mantiene el comportamiento anterior.
ALTER TABLE ingesta.viaje_programado
    ADD COLUMN IF NOT EXISTS odometro_inicial_km NUMERIC(12,3);
