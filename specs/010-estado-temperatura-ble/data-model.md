# Phase 1 — Data Model: Temperatura del sensor BLE en la consulta de estado

**Feature**: `010-estado-temperatura-ble` | **Date**: 2026-09-29

No hay entidad ni columna nueva: la columna `ble_temperatura_c` ya existe desde la feature
008. Esta feature solo hace visible ese dato en dos capas de lectura, sin tocar la ingesta
ni el esquema.

---

## 1. `LecturaTelemetria` (entidad JPA, `agrolink-ingesta`)

Agregar un campo, mapeado a la columna ya existente:

| Campo Java | Columna | Tipo | Null |
|---|---|---|---|
| `bleTemperaturaC` | `ble_temperatura_c` | `Double` | sí |

Mismo patrón que `temperaturaRefrigeranteC`/`presionAceiteKpa` (`@Column`, sin setter —
la entidad es `@Immutable`, Principio IV). Se agrega el getter `getBleTemperaturaC()`.

## 2. `CanBusDto` (`agrolink-ingesta`, bloque de respuesta)

Agregar un componente al record, al final (orden no significativo en JSON, pero se
mantiene el orden de declaración existente + el campo nuevo al final para minimizar el
diff):

| Campo | Tipo | Regla |
|---|---|---|
| `bleTemperaturaC` | `Double` (nullable) | `null` si la lectura más reciente no tiene temperatura de sensor BLE (research.md D-02). Nunca 0 por ausencia. |

## 3. `EstadoVehiculoService.mapearCanBus`

Agregar `lectura.getBleTemperaturaC()` como último argumento del constructor de
`CanBusDto`. Sin resolución adicional: lectura directa de la entidad, igual que
`temperaturaRefrigeranteC` (research.md D-02).

## 4. Fuera del modelo

- `rinho-receptor`: sin cambios. La columna, su llenado y sus reglas de "no informado" ya
  existen (feature 008).
- Humedad y batería del sensor BLE (`ble_humedad_pct`, `ble_bateria`): sin cambios, no se
  exponen en esta feature (spec, Assumptions).
- `datos_can` (JSONB): sin cambios. La temperatura BLE nunca vivió ahí.
