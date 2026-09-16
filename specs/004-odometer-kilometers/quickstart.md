# Quickstart: Odómetro en kilómetros en la consulta de estado

Valida que `GET /api/v1/vehiculos/{dispositivoId}/estado` expone el odómetro en
kilómetros (`canBus.odometroKm`) en vez de metros (`canBus.odometroM`), sin cambiar el
almacenamiento interno. Ver contrato completo en `contracts/agrolink-vehiculo-estado-api.yaml`
y reglas de conversión en `research.md` (D-01 a D-04).

## Prerrequisitos

- Stack local levantado según `deploy/README.md` (Postgres/TimescaleDB + el servicio
  Spring Boot de este repo).
- Al menos una lectura de telemetría persistida con `odometro_m` conocido para un
  `dispositivo_id` de prueba (puede insertarse a mano en `lectura_telemetria` o
  enviarse vía el receptor Rinho, como en el quickstart de la feature 002/003).

## Escenario 1 — Odómetro conocido, origen ECU

1. Insertar (o recibir vía receptor) una lectura con `dispositivo_id = '2326'`,
   `odometro_m = 66010000`, `odometro_origen = 'ECU'`.
2. `curl http://localhost:8082/api/v1/vehiculos/2326/estado`
3. **Esperado**: `canBus.odometroKm` es `66010.0` (no `66010000`), `canBus.odometroOrigen`
   es `"ECU"`, y la respuesta **no** incluye ningún campo `odometroM`.

## Escenario 2 — Odómetro conocido, origen GPS

1. Insertar una lectura con `odometro_m` conocido y `odometro_origen = 'GPS'` para otro
   dispositivo de prueba.
2. Consultar su estado.
3. **Esperado**: `canBus.odometroKm` refleja el valor en km y `canBus.odometroOrigen` es
   `"GPS"`, sin cambios respecto del comportamiento previo salvo la unidad.

## Escenario 3 — Odómetro desconocido

1. Insertar una lectura sin `odometro_m` (`null`) para un dispositivo de prueba.
2. Consultar su estado.
3. **Esperado**: `canBus.odometroKm` es `null` (no `0.0`) y `canBus.odometroOrigen`
   también es `null`.

## Validación de precisión (SC-002)

Para cualquier lectura con `odometro_m` conocido, verificar que
`canBus.odometroKm * 1000` reproduce el valor de `odometro_m` original de esa lectura,
sin pérdida significativa (ver research.md D-03).

## Prueba automatizada equivalente

`EstadoVehiculoServiceTest` (paquete `ar.utn.agrolink.ingesta.estado`) cubre estos tres
escenarios a nivel de servicio, sin necesidad de levantar el stack completo:
`mvn -pl . test -Dtest=EstadoVehiculoServiceTest`.
