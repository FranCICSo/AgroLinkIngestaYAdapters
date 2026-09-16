# Data Model: Odómetro en kilómetros en la consulta de estado

Esta feature no agrega entidades nuevas ni cambia el modelo de persistencia. Cambia
únicamente la forma de un campo derivado en el DTO de salida de la consulta de estado.

## Entidad afectada: `CanBus` (bloque de `EstadoVehiculo`)

Representa el estado del bus CAN/vehículo más reciente conocido, expuesto por
`GET /api/v1/vehiculos/{dispositivoId}/estado` (ver contrato en `contracts/`).

| Campo | Antes (feature 003) | Después (esta feature) |
|---|---|---|
| `odometroM` | `Long`, metros, puede ser `null` | *(eliminado)* |
| `odometroKm` | *(no existía)* | `Double`, kilómetros, puede ser `null` |
| `odometroOrigen` | `ECU \| GPS \| null` | Sin cambios |
| *(resto de los campos de `CanBus`)* | Sin cambios | Sin cambios |

**Regla de derivación**: `odometroKm = odometroM / 1000.0` cuando `odometroM` es
conocido; `odometroKm = null` cuando `odometroM` es `null` (research.md D-03, D-04).

**Invariante**: `odometroKm * 1000` reproduce, sin pérdida significativa, el valor de
`odometro_m` de la lectura de telemetría usada para responder (spec, SC-002).

## Entidad no afectada: `LecturaTelemetria` (persistencia)

La columna `odometro_m` (metros, `BIGINT`) y el campo `odometroOrigen` de
`LecturaTelemetria` no cambian de tipo, unidad ni semántica. Siguen siendo la fuente de
verdad interna usada tanto por esta consulta de estado como por `ReporteViajeService`
(cálculo de deltas de viaje en metros, fuera del alcance de esta feature).

## Sin cambios de esquema de base de datos

No hay migraciones asociadas a esta feature: no se agrega, renombra ni elimina ninguna
columna. El cambio es exclusivamente de mapeo en la capa de adaptación
(`EstadoVehiculoService`) y de contrato (`CanBusDto` / OpenAPI).
