# Phase 1 — Data Model: Ingesta y Adaptación de Telemetría

**Feature**: `001-ingesta-adaptacion-telemetria` | **Date**: 2026-08-15

Modelo derivado de las Key Entities del [spec](./spec.md) y de las decisiones D-04, D-05,
D-07 y D-08 de [research.md](./research.md).

**Principio rector**: ninguna columna de dominio menciona a Rinho. Todo lo específico del
fabricante vive en `payload_crudo` (la trama tal cual) y `datos_can` (JSONB). Eso es lo que
permite que un segundo tipo de dispositivo escriba en esta misma tabla con solo agregar un
parser y un mapper (Constitución, Principio I).

---

## Entidad: Lectura de Telemetría

Tabla `telemetria.lectura_telemetria` — **hypertable** de TimescaleDB particionada por
`momento_evento`. **Insert-only e inmutable** (Principio IV): ningún camino de código emite
`UPDATE` ni `DELETE`, y los `GRANT` de base lo impiden a nivel de motor.

| Columna | Tipo | Nulo | Origen / Regla |
|---------|------|------|----------------|
| `id` | `BIGSERIAL` | no | Identidad técnica |
| `dispositivo_id` | `VARCHAR(20)` | **no** | Campo `ID=` de la trama. Sin él la trama se rechaza (FR-013) |
| `momento_evento` | `TIMESTAMPTZ` | **no** | Fecha+hora de la trama. Si viene en ceros → hora de recepción y se marca `PARCIAL` (D-08). **Columna de particionamiento** |
| `momento_recepcion` | `TIMESTAMPTZ` | no | `now()` del servidor al recibir el datagrama (Principio VII) |
| `latitud` | `NUMERIC(9,6)` | sí | Campo GPS ÷ 100000. Nulo si no hay fix |
| `longitud` | `NUMERIC(9,6)` | sí | Campo GPS ÷ 100000. Nulo si no hay fix |
| `velocidad_kmh` | `NUMERIC(5,1)` | sí | Campo GPS `FFF`, **ya en km/h — no convertir** (D-03) |
| `rumbo_grados` | `SMALLINT` | sí | Campo GPS `GGG` |
| `odometro_m` | `BIGINT` | sí | **Siempre en metros.** CAN `B` (km) × 1000, o campo GPS (hex, ya en metros) (D-05) |
| `odometro_origen` | `VARCHAR(3)` | sí | `ECU` \| `GPS`. Cuál de las dos fuentes se usó |
| `combustible_pct` | `NUMERIC(5,2)` | sí | CAN `15`. Nulo es **normal**, no anomalía (FR-002/FR-004) |
| `ignicion` | `BOOLEAN` | sí | Bit 7 del campo GPS `HH` |
| `tension_bateria_v` | `NUMERIC(4,1)` | sí | Campo GPS `JJJ` ÷ 10 |
| `satelites` | `SMALLINT` | sí | Campo GPS `OO` |
| `estado_interpretacion` | `VARCHAR(8)` | no | `COMPLETA` \| `PARCIAL` (Principio IX) |
| `campos_faltantes` | `TEXT[]` | sí | Nombres de dominio de lo que no se pudo interpretar |
| `datos_can` | `JSONB` | sí | Todos los pares CAN crudos, incluidos los no promovidos (D-04) |
| `payload_crudo` | `TEXT` | **no** | Trama ASCII exacta como llegó (FR-003) |
| `frame_hash` | `CHAR(64)` | no | SHA-256 de `payload_crudo`. Clave de deduplicación (D-07) |
| `msg_num` | `VARCHAR(4)` | sí | `;#msgNum` si vino. Nulo ⇒ no se pudo emitir ACK (D-06) |
| `reporte_id` | `VARCHAR(2)` | sí | Campo GPS `AA` |

### Índices y restricciones

```sql
-- Deduplicación de reintentos (D-07). Incluye la columna de particionamiento
-- porque TimescaleDB lo exige en todo índice único sobre una hypertable.
CREATE UNIQUE INDEX lectura_dedup_uq
  ON telemetria.lectura_telemetria (dispositivo_id, momento_evento, frame_hash);

-- Consulta principal del reporte de viaje: camión + rango temporal (FR-005).
CREATE INDEX lectura_camion_tiempo_idx
  ON telemetria.lectura_telemetria (dispositivo_id, momento_evento DESC);
```

`estado_interpretacion` y `odometro_origen` se validan con `CHECK` en vez de tipos `ENUM`
de PostgreSQL: agregar un valor a un `ENUM` requiere DDL, y estos dominios crecerán cuando
entre un segundo tipo de dispositivo.

### Reglas de validación (aplicadas en el mapper, antes del insert)

| Regla | Acción si falla |
|-------|-----------------|
| `dispositivo_id` presente y no vacío | **Rechazo** de la trama, log con la trama cruda, sin ACK (FR-013) |
| Checksum del envelope válido | **Rechazo** con log (trama corrupta) |
| Latitud ∈ [−90, 90], longitud ∈ [−180, 180] | Campo a `NULL` + `PARCIAL` + registrar en `campos_faltantes` |
| Velocidad ∈ [0, 200] km/h | idem |
| `combustible_pct` ∈ [0, 100] | idem |
| Fecha/hora de la trama no es todo ceros | `momento_evento` = recepción + `PARCIAL` (D-08) |

**El rechazo nunca es silencioso** (Principio IX): las dos únicas causas de rechazo total
—sin `dispositivo_id` y checksum inválido— se loguean en JSON con la trama completa. Todo
lo demás degrada a `PARCIAL` y se persiste (FR-004).

### Ciclo de vida

`recibida → parseada → (COMPLETA | PARCIAL) → persistida → inmutable`

No hay transiciones posteriores. Una corrección futura sería una fila nueva, nunca un
`UPDATE` (Principio IV).

---

## Entidad: Camión

**No se crea tabla en esta feature.** El camión se identifica por `dispositivo_id`, tratado
como token técnico (spec, Assumptions). No se requiere catálogo previo: un dispositivo nuevo
empieza a persistir lecturas sin alta manual.

Cuando exista el catálogo de flota del DER, la relación será
`camion.dispositivo_id ↔ lectura_telemetria.dispositivo_id`, sin migrar datos.

---

## Entidad: Reporte de Viaje

**Entidad calculada, no persistida** (spec, Key Entities). Se deriva a demanda de las
lecturas del rango. Contrato HTTP completo en
[`contracts/agrolink-reportes-api.yaml`](./contracts/agrolink-reportes-api.yaml).

Sea `L` el conjunto de lecturas de `dispositivo_id` con
`momento_evento ∈ [desde, hasta]`, ordenado por `momento_evento`:

| Campo | Cálculo | Notas |
|-------|---------|-------|
| `distanciaM` | `odometro_m` de la última − de la primera lectura **con odómetro no nulo** | Assumption: acumulativo, no se reinicia |
| `combustibleConsumidoPct` | `combustible_pct` de la primera − de la última lectura **con combustible no nulo** | Puntos porcentuales (spec, Assumptions) |
| `tasaConsumoPromedio` | `combustibleConsumidoPct / (distanciaM / 1000)` | Puntos %/km. **`null` si `distanciaM = 0`** (FR-005) |
| `velocidadPromedioKmh` | Media de `velocidad_kmh` no nulos | |
| `velocidadMaximaKmh` | Máximo de `velocidad_kmh` no nulos | |
| `lecturasConsideradas` | `count(L)` | |
| `odometroOrigenMixto` | `true` si `L` combina `ECU` y `GPS` | Advertencia, no error (D-05) |

**Casos borde del cálculo** (todos con test obligatorio):

- `L` vacío → **404** `application/problem+json` (FR-006, D-13).
- Una sola lectura → distancia y combustible consumido `0`; tasa `null`.
- `distanciaM = 0` con lecturas presentes → **200**, `tasaConsumoPromedio: null` y
  `tasaConsumoPromedioNoCalculable: true`.
- Ninguna lectura con `combustible_pct` → `combustibleConsumidoPct: null` y, en
  consecuencia, `tasaConsumoPromedio: null`.
- Combustible consumido negativo (hubo recarga en el rango) → se devuelve **tal cual**, sin
  recortar a cero: el spec declara las recargas fuera de alcance y un valor negativo es la
  señal honesta de que ocurrió una (mejor que enmascararla con un `0`).

---

## Modelo físico (extracto del DDL)

El DDL completo vive en `deploy/db/01-schema.sql` y `deploy/db/02-roles.sql`.

```sql
CREATE SCHEMA IF NOT EXISTS telemetria;
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE telemetria.lectura_telemetria ( /* columnas de la tabla de arriba */ );

SELECT create_hypertable('telemetria.lectura_telemetria', 'momento_evento');

-- Principio IV: inmutabilidad garantizada por el motor, no solo por convención.
GRANT SELECT, INSERT ON telemetria.lectura_telemetria TO rinho_receptor;
GRANT SELECT            ON telemetria.lectura_telemetria TO agrolink_ingesta;
-- Ningún rol de aplicación recibe UPDATE ni DELETE.
```

El servicio Java mapea esta tabla con `@Entity @Immutable` y un repositorio **sin** métodos
de escritura: la inmutabilidad queda expresada en las tres capas (motor, ORM, API).
