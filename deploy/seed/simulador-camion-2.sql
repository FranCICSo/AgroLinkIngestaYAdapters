-- Seed del camion 2 (feature 009-simulador-viajes): segundo camion de ejemplo, con carga
-- refrigerada (medias reses) para poder demostrar el segmento BLE (temperatura/humedad)
-- sin tocar el camion 1. Ruta ilustrativa dentro de CABA/GBA (Mercado Central -> zona
-- norte), armada a mano -no capturada de un dispositivo real como la ruta del camion 1-,
-- con una parada de entrega a mitad de camino. Idempotente: no duplica si ya existe.

INSERT INTO simulador.camion
  (id, nombre, tipo_carga, setpoint_temp_c, setpoint_humedad_pct, odometro_inicial_km, activo)
VALUES
  ('900002', 'Camion 2 - medias reses', 'refrigerada', 2.5, 87, 45000, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO simulador.ruta (id, nombre, puntos, paradas)
SELECT 2, 'Mercado Central -> zona norte (ilustrativa, con 1 parada)',
       '[{"lat":-34.665,"lon":-58.556},{"lat":-34.648,"lon":-58.532},{"lat":-34.627,"lon":-58.501},{"lat":-34.605,"lon":-58.473},{"lat":-34.582,"lon":-58.456},{"lat":-34.561,"lon":-58.444},{"lat":-34.543,"lon":-58.439},{"lat":-34.526,"lon":-58.448},{"lat":-34.511,"lon":-58.462}]'::jsonb,
       '[{"indice":5,"duracionMin":6}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM simulador.ruta WHERE id = 2);
SELECT setval(pg_get_serial_sequence('simulador.ruta', 'id'), GREATEST((SELECT MAX(id) FROM simulador.ruta), 1));

INSERT INTO simulador.viaje (camion_id, ruta_id, sentido, indice_actual, odometro_actual_km, estado)
SELECT '900002', 2, 'ida', 0, 45000, 'en_curso'
WHERE NOT EXISTS (
  SELECT 1 FROM simulador.viaje WHERE camion_id = '900002' AND estado = 'en_curso'
);
