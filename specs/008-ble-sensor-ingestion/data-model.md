# Phase 1 — Data Model: Ingesta de lecturas de sensores BLE

**Feature**: `008-ble-sensor-ingestion` | **Date**: 2026-09-27

Solo cambia una entidad existente: `telemetria.lectura_telemetria` (feature 001). No hay
entidades nuevas, relaciones nuevas ni cambios de ciclo de vida: la tabla sigue siendo
insert-only (Principio IV).

---

## 1. `telemetria.lectura_telemetria` — columnas nuevas

| Columna | Tipo | Null | Origen en la trama | Campo del mapper | Nombre en `campos_faltantes` |
|---------|------|------|--------------------|------------------|------------------------------|
| `ble_temperatura_c` | `NUMERIC` | sí | segmento BLE, clave `T0` | `bleTemperaturaC` | `bleTemperaturaC` |
| `ble_humedad_pct` | `NUMERIC` | sí | segmento BLE, clave `H0` | `bleHumedadPct` | `bleHumedadPct` |
| `ble_bateria` | `NUMERIC` | sí | segmento BLE, clave `B0` | `bleBateria` | `bleBateria` |

- Sin precisión, escala, `DEFAULT` ni `CHECK`: ver research.md D-05 (sin desborde, así que
  no hay reintento infinito, y sin redondeo).
- Unidades: `ble_temperatura_c` en °C y `ble_humedad_pct` en % relativa, según el handoff.
  `ble_bateria` va **sin unidad**: puede ser % o mV y queda pendiente de verificar con
  hardware (spec, Clarifications).
- Ubicación en `01-schema.sql`: después de `presion_aceite_kpa` (bloque de datos de
  vehículo/sensores), antes de `ignicion`.
- Filas existentes: las tres columnas quedan en `NULL`, sin backfill (Principio IV).

## 2. Reglas de validación (mapper)

Aplican a cada una de las tres claves del slot 0 (`T0`, `H0`, `B0`):

| Entrada | Columna | `campos_faltantes` | Efecto en `estado_interpretacion` |
|---------|---------|--------------------|-----------------------------------|
| Trama sin segmento BLE (o segmento vacío) | `NULL` | — | ninguno |
| Segmento presente, clave ausente | `NULL` | agrega el nombre | → `PARCIAL` |
| `T0=` (valor vacío) | `NULL` | agrega el nombre | → `PARCIAL` |
| Valor que no cumple `^-?\d+(\.\d+)?$` | `NULL` | agrega el nombre | → `PARCIAL` |
| Valor numérico válido (cualquier magnitud) | `Number(valor)` | — | ninguno |

- Las claves de los slots 1–3 (`T1`…`B3`) y las desconocidas se ignoran: solo quedan en
  `payload_crudo`.
- Las claves BLE nunca se escriben en `datos_can`: ese JSON sigue siendo exclusivo de la
  sección CAN.
- La deduplicación no cambia: `frame_hash` se calcula sobre la trama completa, BLE incluido.

## 3. Objeto `lectura` del receptor (entre mapper y repositorio)

Se suman tres propiedades al objeto que devuelve `mapFrameToLectura`, en el mismo orden
en que el repositorio las inserta:

```text
... presionAceiteKpa, bleTemperaturaC, bleHumedadPct, bleBateria, ignicion, ...
```

`mapFrameToLectura` recibe además `ble` (el `Map` de `parseBleSection`, o `null` si la
trama no trajo el segmento). Distinguir `null` de un mapa vacío no es necesario: los dos
significan "sin segmento" (tabla §2, primera fila).

## 4. Fuera del modelo

- Entidad JPA `LecturaTelemetria` (Java): no se modifica (spec FR-012). Con
  `ddl-auto: none` y mapeo por columnas explícitas, que la tabla tenga columnas extra no
  afecta al servicio de lectura.
- Seed de demo (`deploy/seed/`): no se modifica. No se generan lecturas BLE sintéticas
  (FR-008).
