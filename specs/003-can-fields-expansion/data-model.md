# Phase 1 — Data Model: Exposición estructurada de campos CAN bus

**Feature**: `003-can-fields-expansion` | **Date**: 2026-09-13 (revisado tras Clarifications)

## Entidad: Lectura de Telemetría (ampliada)

Misma tabla, `telemetria.lectura_telemetria` (feature 001), mismo régimen insert-only /
inmutable (Principio IV). Se agregan cinco columnas nuevas, escritas por el receptor
(`rinho-receptor`, research.md D-02):

| Columna | Tipo SQL | Tipo dominio (Java) | Origen CAN | Regla |
|---------|----------|----------------------|------------|-------|
| `vin` | `VARCHAR(20)` (nullable) | `String` | `1` | `NULL` si el vehículo no reportó VIN en esa lectura. Nunca se convierte a número (es alfanumérico). Sin validación de formato. |
| `rpm` | `SMALLINT` (nullable) | `Integer` | `2` | `NULL` si no reportado. Sin validación de rango físico (Edge Cases). |
| `combustible_consumido_l` | `NUMERIC(10,2)` (nullable) | `Double` | `14` | `NULL` si no reportado. Unidad confirmada: litros (Clarifications, sesión 2026-09-13). Sin validación de rango. |
| `temperatura_refrigerante_c` | `SMALLINT` (nullable) | `Integer` | `2A` | `NULL` si no reportado. Sin validación de rango físico. |
| `presion_aceite_kpa` | `SMALLINT` (nullable) | `Integer` | `2C` | `NULL` si no reportado. Sin validación de rango físico. |

Los cinco identificadores (`1`, `2`, `14`, `2A`, `2C`) se agregan a `CAN_IDS_PROMOVIDOS` en
`lecturaMapper.js`: a partir de esta feature ya no aparecen duplicados dentro del JSON
`datos_can` de una lectura nueva. `3` (velocidad de rueda) es el único identificador CAN
soportado que **sigue** viajando solo dentro de `datos_can`, sin columna propia
(Clarifications). Las columnas ya mapeadas (`odometro_m`, `odometro_origen`,
`combustible_pct`, `tension_bateria_v`) no cambian de fuente ni de tipo — `tension_bateria_v`
solo cambia de **bloque de respuesta**, ver más abajo.

### Cambio de esquema

```sql
ALTER TABLE telemetria.lectura_telemetria
    ADD COLUMN vin                        VARCHAR(20),
    ADD COLUMN rpm                         SMALLINT,
    ADD COLUMN combustible_consumido_l     NUMERIC(10,2),
    ADD COLUMN temperatura_refrigerante_c  SMALLINT,
    ADD COLUMN presion_aceite_kpa          SMALLINT;
```

Ver `research.md` D-01 para cómo se aplica. No se agrega ningún índice: ninguna consulta
nueva filtra ni ordena por estas columnas.

---

## Entidad derivada: Estado de Vehículo — bloques `canBus` y `dispositivo` (reestructurados)

No se persiste — se calcula a demanda sobre la misma fila que ya resuelve
`GET /api/v1/vehiculos/{dispositivoId}/estado` (feature 002, sin cambios en la búsqueda).
Cambia la forma de dos bloques: `canBus` gana seis campos (cinco columnas nuevas más
`tensionBateriaV` reubicado) y pierde `datosCanCrudos`; `dispositivo` pierde
`tensionBateriaV`.

```text
CanBus (antes, esta feature)             CanBus (ahora)
├── odometroM                            ├── vin                        [NUEVO — columna]
├── odometroOrigen                       ├── rpm                        [NUEVO — columna]
├── combustiblePct                       ├── velocidadRuedaKmh          (sin cambios — a demanda desde datos_can, id "3")
└── datosCanCrudos          [ELIMINADO]  ├── odometroM                   (sin cambios)
                                          ├── odometroOrigen               (sin cambios)
                                          ├── combustibleConsumidoL       [NUEVO — columna, litros]
                                          ├── combustiblePct               (sin cambios)
                                          ├── temperaturaRefrigeranteC    (sin cambios respecto de la versión anterior)
                                          ├── presionAceiteKpa            (sin cambios respecto de la versión anterior)
                                          └── tensionBateriaV             [REUBICADO desde dispositivo]

DispositivoInfo (antes)                  DispositivoInfo (ahora)
├── dispositivoId                        ├── dispositivoId                (sin cambios)
├── momentoEvento                        ├── momentoEvento                (sin cambios)
├── momentoRecepcion                     ├── momentoRecepcion             (sin cambios)
├── ignicion                             ├── ignicion                     (sin cambios)
├── tensionBateriaV        [ELIMINADO — pasa a canBus]
├── satelites                            ├── satelites                    (sin cambios)
├── estadoInterpretacion                 ├── estadoInterpretacion         (sin cambios)
└── camposFaltantes                      └── camposFaltantes              (sin cambios)
```

| Campo (`canBus`) | Tipo | Fuente | Regla de "no informado" |
|-------|------|--------|--------------------------|
| `vin` | `String`, nullable | columna `vin` | `null` si la lectura no tiene VIN |
| `rpm` | `Integer`, nullable | columna `rpm` | `null` si la lectura no tiene RPM |
| `velocidadRuedaKmh` | `Integer`, nullable | `datos_can["3"]`, leído a demanda (`DatosCanCrudoReader`) | `null` si la clave falta, está vacía o no es numérica |
| `odometroM` | `Long`, nullable | columna `odometro_m` (sin cambios) | sin cambios |
| `odometroOrigen` | `ECU \| GPS`, nullable | columna `odometro_origen` (sin cambios) | sin cambios |
| `combustibleConsumidoL` | `Double`, nullable | columna `combustible_consumido_l` | `null` si la lectura no tiene el dato. Unidad: litros. |
| `combustiblePct` | `Double`, nullable | columna `combustible_pct` (sin cambios) | sin cambios |
| `temperaturaRefrigeranteC` | `Integer`, nullable | columna `temperatura_refrigerante_c` | `null` si la lectura no tiene el dato |
| `presionAceiteKpa` | `Integer`, nullable | columna `presion_aceite_kpa` | `null` si la lectura no tiene el dato |
| `tensionBateriaV` | `Double`, nullable | columna `tension_bateria_v` (ya existente, feature 001/002) | sin cambios de origen — solo cambia de bloque de respuesta |

`datosCanCrudos` deja de existir en la respuesta (FR-007). El bloque `dispositivo` pierde
`tensionBateriaV` (FR-009) — sus demás campos no cambian. El bloque `posicion` no cambia.

### Reglas de validación (sin cambios respecto de la feature 002)

| Regla | Acción si falla | Requisito |
|-------|------------------|-----------|
| Identificador de dispositivo no vacío / no solo espacios | `400` | FR-009 (feature 002) |
| Existe al menos una lectura para ese identificador | si no, `404` | FR-007/FR-008 (feature 002) |

Esta feature no agrega reglas de validación nuevas sobre la entrada de la consulta; solo
cambia la forma de su salida.

### Ciclo de vida

Sin cambios respecto de la feature 002: `lectura persistida → consultada bajo demanda →
serializada → descartada`. Solo `velocidadRuedaKmh` se recalcula en cada consulta a
partir del `datos_can` ya persistido; el resto de los campos de `canBus` viene
directamente de columnas ya resueltas al momento de la ingesta.
