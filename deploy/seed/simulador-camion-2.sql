-- Seed del camion 2 (feature 009-simulador-viajes): segundo camion de ejemplo, con carga
-- refrigerada (medias reses) para poder demostrar el segmento BLE (temperatura/humedad)
-- sin tocar el camion 1. Ruta ilustrativa dentro de CABA/GBA (Mercado Central -> zona
-- norte), armada a mano -no capturada de un dispositivo real como la ruta del camion 1-,
-- con una parada de entrega a mitad de camino. Idempotente: no duplica si ya existe.
--
-- Trazado densificado a 27 puntos (feature 012-velocidad-rpm-verosimil, research.md D-05):
-- los 9 puntos originales (armados a mano, muy espaciados) se recorrian en un solo ciclo de
-- 60 s cada uno, con saltos de varios km - mismo problema de velocidad inverosimil que en
-- camion-1. Se agregaron 18 puntos intermedios (interpolacion lineal) para que ningun
-- sub-tramo supere 1 km (60 km/h * 60 s), y se reindexo la parada contra el nuevo arreglo.
-- Generado con simulador-viajes/scripts/densificar-seed.js.

INSERT INTO simulador.camion
  (id, nombre, tipo_carga, setpoint_temp_c, setpoint_humedad_pct, odometro_inicial_km, activo)
VALUES
  ('900002', 'Camion 2 - medias reses', 'refrigerada', 2.5, 87, 45000, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO simulador.ruta (id, nombre, puntos, paradas)
SELECT 2, 'Mercado Central -> zona norte (ilustrativa, con 1 parada)',
       '[{"lat":-34.665,"lon":-58.556},{"lat":-34.659333333333336,"lon":-58.547999999999995},{"lat":-34.653666666666666,"lon":-58.54},{"lat":-34.648,"lon":-58.532},{"lat":-34.64275000000001,"lon":-58.524249999999995},{"lat":-34.6375,"lon":-58.51649999999999},{"lat":-34.63225,"lon":-58.50875},{"lat":-34.627,"lon":-58.501},{"lat":-34.6215,"lon":-58.494},{"lat":-34.616,"lon":-58.486999999999995},{"lat":-34.6105,"lon":-58.48},{"lat":-34.605,"lon":-58.473},{"lat":-34.59733333333333,"lon":-58.467333333333336},{"lat":-34.589666666666666,"lon":-58.461666666666666},{"lat":-34.582,"lon":-58.456},{"lat":-34.575,"lon":-58.452000000000005},{"lat":-34.568,"lon":-58.448},{"lat":-34.561,"lon":-58.444},{"lat":-34.555,"lon":-58.44233333333334},{"lat":-34.549,"lon":-58.440666666666665},{"lat":-34.543,"lon":-58.439},{"lat":-34.537333333333336,"lon":-58.442},{"lat":-34.531666666666666,"lon":-58.445},{"lat":-34.526,"lon":-58.448},{"lat":-34.521,"lon":-58.452666666666666},{"lat":-34.516000000000005,"lon":-58.45733333333334},{"lat":-34.511,"lon":-58.462}]'::jsonb,
       '[{"indice":17,"duracionMin":6}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM simulador.ruta WHERE id = 2);
SELECT setval(pg_get_serial_sequence('simulador.ruta', 'id'), GREATEST((SELECT MAX(id) FROM simulador.ruta), 1));

INSERT INTO simulador.viaje (camion_id, ruta_id, sentido, indice_actual, odometro_actual_km, estado)
SELECT '900002', 2, 'ida', 0, 45000, 'en_curso'
WHERE NOT EXISTS (
  SELECT 1 FROM simulador.viaje WHERE camion_id = '900002' AND estado = 'en_curso'
);
