# Quickstart: Almacenar el odómetro en kilómetros

Valida que el odómetro se persiste y se calcula en kilómetros de punta a punta —
ingesta (`rinho-receptor`), consulta de estado (`/estado`) y reporte de viaje
(`/api/v1/reportes/viaje`) — sin la doble conversión km→m→km que existía antes de esta
feature. Ver contratos en `contracts/` y decisiones en `research.md` (D-01 a D-05).

## Prerrequisitos

- Stack local levantado según `deploy/README.md`.
- **Si el volumen de Postgres ya existía antes de esta feature**: correr a mano la
  migración de `research.md` D-04 antes de levantar el servicio Java:

  ```sql
  ALTER TABLE telemetria.lectura_telemetria
      RENAME COLUMN odometro_m TO odometro_km;
  ALTER TABLE telemetria.lectura_telemetria
      ALTER COLUMN odometro_km TYPE DOUBLE PRECISION USING odometro_km / 1000.0;
  ```

- **Si el volumen es nuevo**: no hace falta nada extra, `deploy/db/01-schema.sql` ya
  define `odometro_km DOUBLE PRECISION` desde el primer arranque.

## Escenario 1 — Odómetro de ECU (ya en km, sin conversión)

1. Enviar (o insertar directamente) una lectura cuyo bus CAN informe el odómetro de ECU
   (identificador `B`) en kilómetros — por ejemplo, `B=66010`.
2. Verificar en la base: `SELECT odometro_km, odometro_origen FROM
   telemetria.lectura_telemetria WHERE dispositivo_id = '...' ORDER BY momento_evento
   DESC LIMIT 1;` → `odometro_km = 66010`, `odometro_origen = 'ECU'`.
3. `curl http://localhost:8082/api/v1/vehiculos/{dispositivoId}/estado`
4. **Esperado**: `canBus.odometroKm` es `66010.0`, igual al valor persistido, sin
   ninguna diferencia de magnitud.

## Escenario 2 — Odómetro de GPS (nativamente en metros, se convierte a km)

1. Enviar una lectura sin odómetro de ECU pero con posición GPS y su contador de
   distancia nativo (por ejemplo, un valor crudo equivalente a 150.000 metros).
2. Verificar en la base: `odometro_km = 150.0`, `odometro_origen = 'GPS'`.

## Escenario 3 — Reporte de viaje coherente con la nueva unidad

1. Con al menos dos lecturas del mismo dispositivo en un rango, con odómetro conocido
   en ambas.
2. `curl "http://localhost:8080/api/v1/reportes/viaje?camionId=...&desde=...&hasta=..."`
   (red interna de Docker Compose).
3. **Esperado**: `distanciaKm` es la resta directa de los `odometro_km` de la última
   lectura menos la primera del rango (ya no hay campo `distanciaM`), y
   `tasaConsumoPromedio` da el mismo resultado numérico que antes de esta feature para
   el mismo conjunto de datos.

## Validación de consistencia (SC-002, SC-003)

- Para cualquier lectura migrada desde antes de esta feature, `odometro_km * 1000`
  debe reproducir el valor que tenía `odometro_m` antes de la migración.
- Para el mismo conjunto de lecturas, `distanciaKm` del reporte de viaje después de esta
  feature debe ser igual a `distanciaM / 1000` calculado antes de esta feature.

## Pruebas automatizadas equivalentes

- `rinho-receptor`: `node --test rinho-receptor/test/lecturaMapper.test.js` — cubre
  `resolveOdometro` para origen ECU y GPS.
- Java: `mvn -pl . test -Dtest=EstadoVehiculoServiceTest,ReporteViajeServiceTest,LecturaTelemetriaRepositoryIntegrationTest`.
