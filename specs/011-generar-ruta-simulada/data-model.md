# Phase 1 — Data Model: Generación de Rutas Simuladas desde Origen/Destino

**Feature**: `011-generar-ruta-simulada` | **Date**: 2026-10-07 | **Actualizado**: 2026-10-10
(User Story 3: § 4, bloque `camion` opcional; 2026-10-10 (2): § 4, `CamionInput.id` admite ids
no puramente numéricos)

Esta feature no introduce un schema nuevo: escribe en `simulador.ruta`, ya creada por la feature
009-simulador-viajes (`deploy/db/03-schema-simulador.sql`). Agrega una única restricción nueva
sobre esa tabla (research.md D-03) y modela, sólo a nivel de aplicación (no de tabla nueva), los
datos de entrada/salida del servicio de generación.

## 1. `simulador.ruta` (existente, con una restricción nueva)

| Columna | Tipo | Null | Notas |
|---------|------|------|-------|
| `id` | `SERIAL` PK | no | Sin cambios |
| `nombre` | `VARCHAR(100)` **UNIQUE** | no | **Nuevo**: restricción `UNIQUE` (research.md D-03, FR-008) vía `deploy/migrations/005_add_ruta_nombre_unique.sql` |
| `puntos` | `JSONB` | no | Sin cambios de forma — `[{lat, lon}, ...]`; ahora poblado por `routeGenerationService.js` en vez de a mano |
| `paradas` | `JSONB` | no | Sin cambios de forma — `[{indice, duracion_min}, ...]`; `indice` apunta a una posición del array `puntos` generado |

**Migración** (`005_add_ruta_nombre_unique.sql`, idempotente, mismo patrón que 001-004):

```sql
ALTER TABLE simulador.ruta
  ADD CONSTRAINT ruta_nombre_unique UNIQUE (nombre);
```

Para un volumen nuevo, la misma restricción se agrega directo en
`deploy/db/03-schema-simulador.sql` (columna `nombre` pasa a `VARCHAR(100) UNIQUE NOT NULL`).

**Validación de duplicado**: el repositorio (`rutaRepository.js`) intenta el `INSERT` y, si
Postgres devuelve `23505 unique_violation`, lo traduce a un resultado `{ ok: false, motivo:
'nombre_duplicado' }` — no hace un `SELECT` previo (research.md D-03).

## 2. Entrada del servicio de generación (no persistida como tabla — objeto de aplicación)

**`GenerarRutaInput`**

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| `nombre` | `string` | sí | Se valida contra `ruta.nombre` (FR-008) |
| `origen` | `{ lat: number, lon: number }` | sí | |
| `destino` | `{ lat: number, lon: number }` | sí | |
| `paradas` | `{ lat: number, lon: number, duracionMin: number }[]` | no (default `[]`) | Orden = orden de paso sobre la ruta (research.md D-07) |
| `camion` | `CamionInput` (§ 4) | no | User Story 3, FR-013: si se incluye, arranca un viaje sobre la ruta en la misma llamada |

**Validaciones** (FR-009, Edge Cases):
- `nombre` no vacío.
- Distancia Haversine entre `origen` y `destino` ≥ 50 m (research.md D-02); si no, se rechaza
  antes de llamar a OSRM (evita una llamada de red innecesaria para un caso ya inválido).
- Cada parada en `paradas` debe tener `lat`/`lon` numéricos y `duracionMin` > 0.
- Si `camion` está presente, se valida (§ 4, FR-014) **antes** de llamar a OSRM, en el mismo
  paso que las validaciones anteriores — ninguna de las dos hace una llamada de red o una
  escritura si la otra ya rechazó la entrada.

## 3. Salida del servicio de generación (no persistida como tabla — objeto de aplicación)

**`GenerarRutaResultado`**, uno de:

- **Éxito, sin `camion`**: `{ ok: true, ruta: { id, nombre, puntos, paradas } }` — la fila tal
  como quedó en `simulador.ruta` tras el `INSERT` (FR-004, FR-011: ya queda lista para
  asociarse a un `simulador.viaje` sin transformación adicional).
- **Éxito, con `camion`** (User Story 3, FR-013): lo anterior + `viaje: { dispositivoId,
  viajeId, rutaId, estado: 'en_curso' }` (§ 4).
- **Fallo de validación** (distancia trivial, parada inválida, o `camion` inválido — § 4):
  `{ ok: false, motivo: 'validacion', detalle }`.
- **Fallo de trazado** (OSRM no responde / sin ruta — research.md D-06): `{ ok: false, motivo:
  'trazado_no_disponible', detalle }`.
- **Nombre duplicado**: `{ ok: false, motivo: 'nombre_duplicado' }`.

Los wrappers HTTP y CLI (research.md D-05) mapean estos tres `motivo` de fallo a, respectivamente:
un código de salida/mensaje de CLI distinto, y un status HTTP distinto (ver
`contracts/rutas-http-api.md`).

## 4. Bloque `camion` opcional (User Story 3, FR-013/FR-014)

No introduce tablas nuevas: usa `simulador.camion` y `simulador.viaje`, ya creadas por la
feature 009-simulador-viajes, sin cambios de esquema.

**`CamionInput`** (objeto de aplicación, no persistido tal cual):

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| `id` | `string` | sí | Válido si es numérico y está en el rango reservado 900001-900999 (spec 009), **o** si contiene al menos un carácter no numérico (p. ej. `tra-demo-004`, calcando un `iotDeviceId` real de AgroLinkBackend — nunca coincide con un IMEI real, siempre puramente numérico de 15 dígitos; ver `src/domain/rangoDispositivoSimulado.js`). Si es numérico y fuera de rango, `{ ok: false, motivo: 'validacion' }` sin persistir nada, ni la ruta. Columna `simulador.camion.id` / `simulador.viaje.camion_id`: `VARCHAR(20)` (ensanchada vía `deploy/migrations/006_widen_camion_id.sql`) |
| `nombre` | `string` | no | Default: el propio `id`. Solo se usa si el camión no existe todavía — nunca pisa el `nombre` de un camión ya existente |
| `tipoCarga` | `'seca' \| 'refrigerada'` | no | Default `'seca'`. Solo se usa si el camión no existe todavía |
| `odometroInicialKm` | `number` | no | Default `0`. Solo se usa si el camión no existe todavía |
| `setpointTempC` | `number` | no | Solo aplica si `tipoCarga='refrigerada'` y el camión es nuevo |
| `setpointHumedadPct` | `number` | no | Idem `setpointTempC` |

**Flujo** (`iniciarViajeService.js`, orquestando `camionRepository.js` + `viajeRepository.js`):

1. `SELECT` el camión por `id`. Si no existe, `INSERT` con los campos de arriba y `activo=true`.
   Si ya existe, se reutiliza sin modificar ninguno de sus campos.
2. `UPDATE simulador.viaje SET estado='finalizado' WHERE camion_id=id AND estado='en_curso'` —
   cierra cualquier viaje anterior (invariante: a lo sumo uno `en_curso` por camión, ver
   `deploy/db/03-schema-simulador.sql`).
3. Determina el odómetro de arranque: el `odometro_actual_km` del último viaje de ese camión
   (si tenía alguno), o si no `odometro_inicial_km` del camión (existente o recién creado).
4. `INSERT INTO simulador.viaje (..., sentido='ida', indice_actual=0, estado='en_curso')` sobre
   la ruta recién generada.

Ningún paso hace rollback de la ruta ya insertada si este flujo fallara después (mismo criterio
de "no hay rollback manual" que el resto del servicio, research.md D-03) — en la práctica no
falla salvo error de conexión, porque toda la validación de `camion` ya pasó antes de insertar
la ruta (§ 2).
