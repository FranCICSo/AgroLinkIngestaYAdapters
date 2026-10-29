# Phase 1 — Data Model: Simulación inmediata sobre la ruta del viaje, con detención

**Feature**: `014-simulacion-ruta-del-viaje` | **Date**: 2026-10-21

Dos migraciones nuevas en `deploy/migrations/` (orden importa: el backfill de `008` lee estados
`DISPARADO` que `009` renombra). Ninguna toca `telemetria.*` (Principio IV).
`deploy/db/03-schema-simulador.sql` se actualiza con las mismas columnas para volúmenes nuevos
(mismo criterio que la migración 005).

---

## 1. `ingesta.viaje_programado` — Registro de viaje simulado (evoluciona 013)

Tabla y entidad conservan su nombre (research.md D-02). Escritura solo desde `agrolink-ingesta`.

| Columna | Tipo | Null | Cambio | Notas |
|---|---|---|---|---|
| `id` | `BIGSERIAL` PK | no | — | |
| `trip_code` | `VARCHAR(64)` UNIQUE | no | **50 → 64** | Contrato §2.1 (1..64). Clave de correlación con AgroLinkBackend. |
| `iot_device_id` | `VARCHAR(20)` | no | — | Uno de la lista cerrada (`DispositivosSimuladosConocidos`, sin cambios, FR-002). |
| `estimated_start_date_time` | `TIMESTAMP` | **sí** | NOT NULL → NULL | Hora **real** de inicio del aviso; solo diagnóstico, nunca programa nada (FR-001). `NULL` en tombstones de detención. |
| `origen_lat` / `origen_lon` / `destino_lat` / `destino_lon` | `NUMERIC(9,6)` | **sí** | NOT NULL → NULL | `NULL` en tombstones. |
| `nombre_ruta` | `VARCHAR(100)` | **sí** | NOT NULL → NULL | Nombre de la ruta del **último intento**: `Viaje {tripCode} #{epochMillis}` (research.md D-06). |
| `estado` | `VARCHAR(12)` | no | **CHECK nuevo** | `ARRANCADO`, `DETENIDO`, `ERROR`, `CANCELADO` (solo legado). |
| `trazado` | `VARCHAR(8)` CHECK IN (`RECIBIDO`,`PROPIO`) | sí | **nueva** | Si el último arranque usó la polyline recibida o el OSRM propio. |
| `velocidades` | `VARCHAR(12)` | sí | **nueva** | Diagnóstico que devuelve el simulador: `RECIBIDAS`, `ACOTADAS`, `DESCARTADAS`, `POR_DEFECTO`, `OSRM`. |
| `motivo_detencion` | `VARCHAR(12)` | sí | **nueva** | `CANCELADO` / `COMPLETADO` del aviso de detención; valor desconocido o ausente → `NULL`. |
| `detenido_en` | `TIMESTAMP` | sí | **nueva** | Momento en que pasó a `DETENIDO`. |
| `ultimo_error` | `TEXT` | sí | — | Detalle del último fallo (arranque o detención). `NULL` tras un arranque exitoso. |
| `creado_en` / `actualizado_en` | `TIMESTAMP` | no | — | Auditoría. |

Índice `viaje_programado_pendiente_idx` se elimina (sin poller). Sin `DELETE` (igual que 013).

### Migración `009_viaje_simulado_inmediato.sql` (esquema)

```sql
ALTER TABLE ingesta.viaje_programado ALTER COLUMN trip_code TYPE VARCHAR(64);
ALTER TABLE ingesta.viaje_programado
  ALTER COLUMN estimated_start_date_time DROP NOT NULL,
  ALTER COLUMN origen_lat DROP NOT NULL,  ALTER COLUMN origen_lon DROP NOT NULL,
  ALTER COLUMN destino_lat DROP NOT NULL, ALTER COLUMN destino_lon DROP NOT NULL,
  ALTER COLUMN nombre_ruta DROP NOT NULL;
ALTER TABLE ingesta.viaje_programado
  ADD COLUMN IF NOT EXISTS trazado VARCHAR(8) CHECK (trazado IN ('RECIBIDO', 'PROPIO')),
  ADD COLUMN IF NOT EXISTS velocidades VARCHAR(12),
  ADD COLUMN IF NOT EXISTS motivo_detencion VARCHAR(12),
  ADD COLUMN IF NOT EXISTS detenido_en TIMESTAMP;

-- FR-017: se reemplaza el CHECK de estados (nombre del constraint resuelto dinámicamente)
-- y se migran los estados del modo programado, dejando constancia.
--   PENDIENTE -> CANCELADO  (ultimo_error = 'Cancelada al desplegar 014: modo programado eliminado')
--   DISPARADO -> ARRANCADO
-- RAISE NOTICE con la cantidad de filas PENDIENTE canceladas.
-- CHECK (estado IN ('ARRANCADO', 'DETENIDO', 'ERROR', 'CANCELADO'))
DROP INDEX IF EXISTS ingesta.viaje_programado_pendiente_idx;
```

### Máquina de estados

```
(sin fila) --inicio OK--------------------------------------> ARRANCADO
(sin fila) --inicio falla (502/400 trazado/413 del simulador)-> ERROR
(sin fila) --detención-------------------------------------> DETENIDO   (tombstone)
ERROR | CANCELADO --inicio OK------------------------------> ARRANCADO
ERROR | CANCELADO --inicio falla---------------------------> ERROR
ARRANCADO --inicio mismo dispositivo-----------------------> ARRANCADO  (200 SIN_CAMBIOS)
ARRANCADO --detención OK-----------------------------------> DETENIDO
ARRANCADO --detención, simulador falla---------------------> ARRANCADO  (ultimo_error, 502)
ERROR | CANCELADO --detención------------------------------> DETENIDO
DETENIDO --inicio------------------------------------------> DETENIDO   (409 viaje_no_modificable)
DETENIDO --detención---------------------------------------> DETENIDO   (200 SIN_SIMULACION_EN_CURSO)
cualquier estado, otro dispositivo------------------------> sin cambio (409 viaje_de_otro_dispositivo)
```

`DETENIDO` es terminal. Tabla completa de decisión y respuestas: research.md D-03.

---

## 2. `simulador.ruta` — Ruta simulada

| Columna | Tipo | Null | Cambio | Notas |
|---|---|---|---|---|
| `velocidades_kmh` | `JSONB` | sí | **nueva** | `[int, …]`, largo `puntos.length − 1`, cada valor en [25, 80]. `NULL` = ruta sin velocidades por tramo (sembrada, manual, OSRM con paradas) → algoritmo de avance actual. Reglas de origen: research.md D-08. |

`puntos` puede venir ahora de la polyline recibida (decodificada + densificada), no solo de OSRM.
`nombre` sigue UNIQUE.

## 3. `simulador.viaje` — Viaje en curso del simulador

| Columna | Tipo | Null | Cambio | Notas |
|---|---|---|---|---|
| `trip_code` | `VARCHAR(64)` | sí | **nueva** | Correlación con el aviso (research.md D-06). `NULL` para viajes de CLI/manuales y sus vueltas. |
| `fin_en_destino` | `BOOLEAN` | no, default `false` | **nueva** | `true` ⇔ creado por aviso (`POST /rutas` con `tripCode`): al llegar queda estacionado, sin vuelta (FR-014). |
| `avance_tramo_km` | `NUMERIC(10,4)` | no, default `0` | **nueva** | Km recorridos dentro del segmento `indice_actual → indice_actual+1`; solo lo usa el avance por velocidad (research.md D-09). |

Índice nuevo: `viaje_camion_trip_en_curso_idx ON simulador.viaje (camion_id, trip_code) WHERE
estado = 'en_curso'`. Invariante sin cambios: a lo sumo un `en_curso` por camión.

Estados (sin cambio de `CHECK`): `en_curso` cubre "en movimiento" y "esperando en destino"
(índice final + `fin_en_destino`); `finalizado` cubre detenido, reemplazado o completado con
vuelta.

### Migración `008_simulador_ruta_del_viaje.sql`

```sql
ALTER TABLE simulador.ruta  ADD COLUMN IF NOT EXISTS velocidades_kmh JSONB;
ALTER TABLE simulador.viaje
  ADD COLUMN IF NOT EXISTS trip_code       VARCHAR(64),
  ADD COLUMN IF NOT EXISTS fin_en_destino  BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS avance_tramo_km NUMERIC(10,4) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS viaje_camion_trip_en_curso_idx
  ON simulador.viaje (camion_id, trip_code) WHERE estado = 'en_curso';

-- Backfill (research.md D-06): simulaciones disparadas por 013 quedan detenibles.
UPDATE simulador.viaje v
   SET trip_code = vp.trip_code
  FROM simulador.ruta r, ingesta.viaje_programado vp
 WHERE v.ruta_id = r.id
   AND v.estado = 'en_curso' AND v.trip_code IS NULL
   AND vp.estado = 'DISPARADO'
   AND v.camion_id = vp.iot_device_id
   AND r.nombre = 'Viaje ' || vp.trip_code;
```

Los grants existentes (`GRANT … ON ALL TABLES IN SCHEMA simulador`) cubren columnas nuevas. Los
viajes backfilleados conservan `fin_en_destino = false` (siguen con su vuelta automática hasta
que se los detenga).

---

## 4. Objetos de aplicación

### `agrolink-ingesta`

- **`IniciarViajeRequest`** (reemplaza `ProgramarViajeRequest`): `tripCode`,
  `estimatedStartDateTime` (`LocalDateTime`), `origen`/`destino` (`PuntoDto`), `polyline`
  (`String`, opcional), `velocidadesKmh` (`List<Integer>`, opcional). Campos desconocidos se
  ignoran (default de Spring Boot).
- **`DetenerViajeRequest`**: `motivo` (`String`, opcional; solo `CANCELADO`/`COMPLETADO` se
  persisten).
- **`InicioViajeDto`**: `tripCode`, `dispositivoId`, `estado`, `trazado`, `efecto`
  (`ARRANCADA`|`SIN_CAMBIOS`).
- **`DetencionViajeDto`**: `tripCode`, `dispositivoId`, `estado` (`DETENIDO`), `efecto`
  (`DETENIDA`|`SIN_SIMULACION_EN_CURSO`).
- **`SimulacionResultado`** (evoluciona): `exito`, `motivo` (`TRAZADO_INVALIDO`,
  `PAYLOAD_DEMASIADO_GRANDE`, `NO_DISPONIBLE`), `detalle`, `trazado`, `velocidades`, `efecto`
  (para la detención).
- Se borran: `ReprogramarViajeRequest`, `ViajeSimuladoScheduler`,
  `ViajeProgramadoNoEncontradoException`, `CoordenadasNoDisponiblesException`,
  `ViajeProgramadoDto`.

### `simulador-viajes`

- **Entrada de `generarRuta`** (extiende 011): `+ polyline?`, `+ velocidadesKmh?`, `+ tripCode?`
  (requiere `camion`). Con `polyline`: no se llama a OSRM y `paradas` debe venir vacío.
- **Salida de `generarRuta`**: `+ trazado` (`RECIBIDO`|`PROPIO`), `+ velocidades` (D-08),
  `motivo` nuevo `trazado_invalido` y `payload_demasiado_grande`.
- **Entrada de `avanzar`**: `+ ruta.velocidadesKmh`, `+ avanceTramoKm`; **salida**:
  `+ avanceTramoKm`; con `completado` y `fin_en_destino` el llamador emite estacionado.
- **Módulos nuevos**: `domain/polyline.js` (decodificar precisión 5, `lat,lon`),
  `domain/velocidadesTramo.js` (normalizar/acotar/expandir al densificar, D-08).

## 5. Reglas de validación (resumen)

| Regla | Dónde | Resultado |
|---|---|---|
| `dispositivoId` en lista cerrada | ingesta | `404 dispositivo_no_simulado` |
| `tripCode` 1..64; `estimatedStartDateTime`, `origen`, `destino` presentes; `lat ∈ [-90,90]`, `lon ∈ [-180,180]` finitos | ingesta | `400 validacion` |
| `velocidadesKmh` sin `polyline` | ingesta | `400 validacion` |
| `polyline` > 1 000 000 chars, `velocidadesKmh` > 99 999 | ingesta | `413 payload_demasiado_grande` |
| cuerpo > 4 MiB | simulador | `413 payload_demasiado_grande` |
| polyline no decodificable, < 2 puntos, extremo > 500 m de origen/destino | simulador | `400 trazado_invalido` |
| > 100 000 puntos decodificados | simulador | `413 payload_demasiado_grande` |
| `velocidadesKmh` largo ≠ n − 1 o no numéricas | simulador | se descartan (default 40), `WARN`, sigue |
| valores fuera de [25, 80] | simulador | se acotan, `WARN`, sigue |
| `tripCode` sin `camion`, o `polyline` con `paradas` | simulador | `400 validacion` (solo llamadas internas mal formadas) |
