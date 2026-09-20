# Data Model: Almacenar el odómetro en kilómetros

## Entidad afectada: `LecturaTelemetria` / `telemetria.lectura_telemetria`

| Campo / Columna | Antes | Después |
|---|---|---|
| `odometroM` / `odometro_m` | `Long` / `BIGINT`, metros, nullable | *(eliminado)* |
| `odometroKm` / `odometro_km` | *(no existía)* | `Double` / `DOUBLE PRECISION`, kilómetros, nullable |
| `odometroOrigen` / `odometro_origen` | `ECU \| GPS \| null` | Sin cambios |
| *(resto de las columnas)* | Sin cambios | Sin cambios |

**Regla de derivación en la ingesta** (`resolveOdometro`, `rinho-receptor`):
- Origen ECU (CAN id `B`, ya en km): `odometroKm = Number(valorCrudo)` — sin conversión.
- Origen GPS (campo nativo en metros, `odometroGpsM`): `odometroKm = odometroGpsM / 1000`.

**Invariante**: para cualquier lectura, el valor de `odometro_km` representa la misma
distancia real que representaba `odometro_m` antes de este cambio, dividida por 1000
(spec, SC-002).

## Entidad derivada afectada: `ReporteViaje` (`ReporteViajeDto`)

| Campo | Antes | Después |
|---|---|---|
| `distanciaM` | `long`, metros | *(eliminado)* |
| `distanciaKm` | *(no existía)* | `double`, kilómetros |
| `tasaConsumoPromedio` | `combustibleConsumidoPct / (distanciaM / 1000.0)` | `combustibleConsumidoPct / distanciaKm` (mismo resultado numérico) |
| *(resto de los campos)* | Sin cambios | Sin cambios |

**Invariante**: para el mismo conjunto de lecturas, `distanciaKm` calculado después de
este cambio es igual a `distanciaM` calculado antes, dividido por 1000 (spec, SC-003).

## Entidad no afectada en su forma externa: `CanBus` (bloque de `EstadoVehiculo`)

`CanBusDto.odometroKm` (introducido en la feature 004) no cambia de nombre, tipo ni
unidad. Solo cambia su implementación interna: `EstadoVehiculoService.mapearCanBus` deja
de dividir por 1000 (porque `LecturaTelemetria.getOdometroKm()` ya devuelve kilómetros)
y pasa el valor directamente. El contrato JSON de `/estado` no cambia de forma.

## Migración de datos existentes

No hay migraciones versionadas (el proyecto no usa Flyway/Liquibase). Para una base ya
inicializada, la migración es una sentencia manual documentada en `research.md` (D-04) y
en `quickstart.md`: `RENAME COLUMN` + `ALTER COLUMN ... TYPE DOUBLE PRECISION USING
odometro_km / 1000.0`. Para una base nueva, `deploy/db/01-schema.sql` ya define la
columna en su forma final.
