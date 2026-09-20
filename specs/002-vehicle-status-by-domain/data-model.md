# Phase 1 — Data Model: Consulta de Estado de Vehículo por Identificador de Dispositivo IoT

**Feature**: `002-vehicle-status-by-domain` | **Date**: 2026-09-09

No se agrega ninguna tabla ni columna nueva. Esta feature es una **proyección de lectura**
adicional sobre `telemetria.lectura_telemetria` (definida en
[001-ingesta-adaptacion-telemetria/data-model.md](../001-ingesta-adaptacion-telemetria/data-model.md)),
más la ampliación de mapeo JPA descrita en [research.md](./research.md) D-02.

---

## Entidad: Lectura de Telemetría (ampliada)

Mismas filas, misma tabla, mismo régimen insert-only/inmutable (Principio IV) que la feature
001. Se agregan al mapeo JPA de `LecturaTelemetria` las columnas que ya existían en el
schema pero no tenían consumidor:

| Columna | Tipo dominio | Bloque de respuesta | Regla |
|---------|-------------|----------------------|-------|
| `latitud` | `Double` | Posición | Nulo si no había fix GPS |
| `longitud` | `Double` | Posición | Nulo si no había fix GPS |
| `rumbo_grados` | `Integer` | Posición | Nulo si no había fix GPS |
| `ignicion` | `Boolean` | Dispositivo | Bit propio del equipo, no del CAN |
| `tension_bateria_v` | `Double` | Dispositivo | Indicador de salud del equipo |
| `satelites` | `Short`/`Integer` | Dispositivo | Indicador de calidad de fix GPS |
| `momento_recepcion` | `Instant` | Dispositivo | Cuándo llegó al servidor (distinto de `momento_evento`, FR-006) |
| `estado_interpretacion` | `EstadoInterpretacion` | Dispositivo | `COMPLETA` \| `PARCIAL` — ya existe como enum de dominio (feature 001) |
| `campos_faltantes` | `List<String>` | Dispositivo | Lista de campos de dominio que esa lectura no pudo interpretar |
| `datos_can` | `JSON` crudo | CAN bus | Se devuelve tal cual lo persistió el receptor, sin reinterpretar (ver Assumptions de la spec) |

Las columnas ya mapeadas por la feature 001 (`dispositivo_id`, `momento_evento`,
`velocidad_kmh`, `odometro_m`, `odometro_origen`, `combustible_pct`) se reutilizan sin
cambios: `velocidad_kmh` y `rumbo_grados`/`latitud`/`longitud` van al bloque Posición;
`odometro_m`, `odometro_origen` y `combustible_pct` van al bloque CAN bus (mismo criterio
que hoy usa el reporte de viaje, que los trata como datos de motor/ECU).

`payload_crudo` y `frame_hash` **no** se mapean: siguen sin consumidor (D-02).

### Nueva consulta

```sql
-- Ya cubierta por el índice lectura_camion_tiempo_idx de la feature 001
-- (dispositivo_id, momento_evento DESC): no se agrega ningún índice nuevo.
SELECT *
FROM telemetria.lectura_telemetria
WHERE dispositivo_id = :dispositivoId
ORDER BY momento_evento DESC
LIMIT 1;
```

El índice `lectura_camion_tiempo_idx` (feature 001) ya cubre exactamente este acceso —
`dispositivo_id` igualdad + `momento_evento DESC` + `LIMIT 1` — sin necesidad de un índice
adicional.

---

## Entidad derivada: Estado de Vehículo

No se persiste — se calcula a demanda a partir de una única fila (a diferencia del reporte
de viaje, que agrega muchas). Estructura de salida (ver contrato completo en
`contracts/agrolink-vehiculo-estado-api.yaml`):

```text
EstadoVehiculo
├── posicion
│   ├── latitud            (nullable)
│   ├── longitud           (nullable)
│   ├── velocidadKmh       (nullable)
│   └── rumboGrados        (nullable)
├── canBus
│   ├── odometroM          (nullable)
│   ├── odometroOrigen     (nullable, ECU | GPS)
│   ├── combustiblePct     (nullable)
│   └── datosCanCrudos     (nullable, objeto JSON de datos_can)
└── dispositivo
    ├── dispositivoId      (siempre presente — es la clave de búsqueda)
    ├── momentoEvento      (siempre presente)
    ├── momentoRecepcion   (siempre presente)
    ├── ignicion           (nullable)
    ├── tensionBateriaV    (nullable)
    ├── satelites          (nullable)
    ├── estadoInterpretacion (siempre presente: COMPLETA | PARCIAL)
    └── camposFaltantes    (lista, puede ser vacía)
```

Todo el objeto proviene de **una sola fila** — la de `momento_evento` más reciente para ese
`dispositivo_id` (FR-002, FR-006). Ningún campo se agrega ni se calcula a partir de otras
filas.

### Reglas de validación (aplicadas antes de buscar)

| Regla | Acción si falla | Requisito |
|-------|------------------|-----------|
| Identificador de dispositivo no vacío / no solo espacios | `400` | FR-009 |
| Existe al menos una lectura para ese identificador | si no, `404` | FR-007, FR-008 (spec Assumptions: mismo caso, ver research D-03) |

### Ciclo de vida

`lectura persistida (feature 001) → consultada bajo demanda → serializada → descartada`
(no hay estado propio de esta entidad derivada entre una consulta y otra).
