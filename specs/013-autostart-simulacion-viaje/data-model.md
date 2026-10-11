# Phase 1 — Data Model: Arranque automático de la simulación en el horario planificado del viaje

**Feature**: `013-autostart-simulacion-viaje` | **Date**: 2026-10-11

## 1. `ingesta.viaje_programado` (tabla nueva)

Esquema nuevo (`ingesta`), separado de `telemetria` (insert-only, Principio IV) y de
`simulador` (sin acceso de escritura para `agrolink-ingesta`, ver research.md D-02).

| Columna | Tipo | Null | Notas |
|---|---|---|---|
| `id` | `BIGSERIAL` PK | no | |
| `trip_code` | `VARCHAR(50)` UNIQUE | no | Clave natural del viaje en AgroLinkBackend (`Trip.tripCode`); identifica la fila para reprogramar/cancelar (FR-009/FR-010). |
| `iot_device_id` | `VARCHAR(20)` | no | Debe coincidir con uno de los 5 valores de la lista cerrada (FR-001) — validado en el service, no con un `CHECK` (mismo criterio que `simulador.camion`: loggear el motivo en vez de que una edición falle silenciosamente al insertar). |
| `estimated_start_date_time` | `TIMESTAMP` | no | Horario de comienzo planificado del viaje (`Trip.estimatedStartDateTime`) — instante en que el poller debe disparar (FR-002). |
| `origen_lat` / `origen_lon` | `NUMERIC(9,6)` | no | Coordenadas de origen del viaje (FR-007) — reenviadas tal cual a `simulador-viajes` como `origen`. |
| `destino_lat` / `destino_lon` | `NUMERIC(9,6)` | no | Idem para destino. |
| `nombre_ruta` | `VARCHAR(100)` | no | Nombre único a persistir en `simulador.ruta` (contrato `rutas-http-api.md`, feature 011) — derivado de `trip_code` (p. ej. `"Viaje {tripCode}"`) para evitar colisiones con nombres de ruta de otro origen. |
| `estado` | `VARCHAR(12)` CHECK IN (`'PENDIENTE'`, `'DISPARADO'`, `'CANCELADO'`, `'ERROR'`) | no | Ver máquina de estados, § 2. |
| `ultimo_error` | `TEXT` | sí | Detalle de la última falla al disparar (FR-005) — solo tiene sentido con `estado = 'ERROR'`. |
| `creado_en` | `TIMESTAMP` | no | Auditoría. |
| `actualizado_en` | `TIMESTAMP` | no | Se actualiza en cada transición de estado y en cada reprogramación. |

```sql
CREATE SCHEMA IF NOT EXISTS ingesta;

CREATE TABLE ingesta.viaje_programado (
    id                          BIGSERIAL       PRIMARY KEY,
    trip_code                   VARCHAR(50)     UNIQUE NOT NULL,
    iot_device_id               VARCHAR(20)     NOT NULL,
    estimated_start_date_time   TIMESTAMP       NOT NULL,
    origen_lat                  NUMERIC(9,6)    NOT NULL,
    origen_lon                  NUMERIC(9,6)    NOT NULL,
    destino_lat                 NUMERIC(9,6)    NOT NULL,
    destino_lon                 NUMERIC(9,6)    NOT NULL,
    nombre_ruta                 VARCHAR(100)    NOT NULL,
    estado                      VARCHAR(12)     NOT NULL CHECK (estado IN ('PENDIENTE', 'DISPARADO', 'CANCELADO', 'ERROR')),
    ultimo_error                TEXT,
    creado_en                   TIMESTAMP       NOT NULL DEFAULT now(),
    actualizado_en               TIMESTAMP       NOT NULL DEFAULT now()
);

CREATE INDEX viaje_programado_pendiente_idx
  ON ingesta.viaje_programado (estimated_start_date_time)
  WHERE estado = 'PENDIENTE';
```

Grants (migración `007_add_viaje_programado.sql`):

```sql
GRANT USAGE ON SCHEMA ingesta TO agrolink_ingesta;
GRANT SELECT, INSERT, UPDATE ON ingesta.viaje_programado TO agrolink_ingesta;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ingesta TO agrolink_ingesta;
```

Sin `DELETE`: cancelar es un cambio de `estado` a `'CANCELADO'` (FR-010), nunca un borrado de
fila — mismo criterio de auditabilidad que el resto del proyecto.

## 2. Máquina de estados de `estado`

```
PENDIENTE --(horario llega, llamada a simulador-viajes OK)--> DISPARADO
PENDIENTE --(horario llega, llamada a simulador-viajes falla)--> ERROR
PENDIENTE --(reprogramación, FR-009)--> PENDIENTE (se actualiza estimated_start_date_time)
PENDIENTE --(cancelación, FR-010)--> CANCELADO
```

`DISPARADO`, `CANCELADO` y `ERROR` son terminales para esta feature: una reprogramación o
cancelación que llega para una fila que ya no está en `PENDIENTE` se rechaza (`409 Conflict`,
ver `contracts/viajes-simulados-http-api.md`) — fuera de alcance reabrir un viaje ya disparado
(Assumptions de la spec).

## 3. Entrada del service (`ViajeProgramadoService`, objeto de aplicación)

**`ProgramarViajeInput`** (alta, `POST`):

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `tripCode` | `string` | sí | Clave natural; si ya existe una fila `PENDIENTE` con el mismo `tripCode`, se trata como una actualización (idempotencia ante un reintento de red de AgroLinkBackend). |
| `iotDeviceId` | `string` | sí (path) | Validado contra la lista cerrada (FR-001) — si no matchea, `404`. |
| `estimatedStartDateTime` | `ISO-8601 datetime` | sí | Si ya pasó o es inmediato, el poller lo dispara en su próximo ciclo sin esperar (FR-002a) — no hay un camino de "disparo síncrono" separado, para no duplicar la lógica de llamado a `simulador-viajes`. |
| `origen` / `destino` | `{lat, lon}` | sí | Reenviados tal cual a `simulador-viajes`. |

**`ReprogramarViajeInput`** (`PUT`): sólo `estimatedStartDateTime` — el resto de los campos del
viaje programado no cambian con una reprogramación (FR-009).

## 4. Salida del service

- **Alta/reprogramación exitosa**: `{ tripCode, estado: 'PENDIENTE', estimatedStartDateTime }`.
- **Cancelación exitosa**: `{ tripCode, estado: 'CANCELADO' }`.
- **`iotDeviceId` no está en la lista cerrada**: fallo de validación, `404` (ver contrato HTTP).
- **Operación sobre una fila que ya no está `PENDIENTE`**: fallo de conflicto, `409`.
- **Disparo del poller, éxito**: fila pasa a `estado = 'DISPARADO'`.
- **Disparo del poller, falla**: fila pasa a `estado = 'ERROR'` con `ultimoError` poblado;
  loggeado (FR-005).
