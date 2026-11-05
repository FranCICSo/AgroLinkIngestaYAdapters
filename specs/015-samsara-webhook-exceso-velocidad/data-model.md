# Data Model: Proveedor Samsara por webhook — exceso de velocidad severo

**Feature**: `015-samsara-webhook-exceso-velocidad` | **Date**: 2026-11-04

Cuatro lugares de datos, uno por componente. Las decisiones que los justifican están en
[research.md](./research.md).

---

## 1. `agrolink-ingesta` — `telemetria.evento_samsara` (hypertable, insert-only)

Notificación webhook de Samsara tal como llegó (spec, Key Entities). Migración
`deploy/migrations/009_add_evento_samsara.sql` (D-02).

| Columna | Tipo | Null | Origen |
|---|---|---|---|
| `id` | `BIGSERIAL` | no | Posición de guardado creciente; cursor del backend (D-04). |
| `momento_evento` | `TIMESTAMPTZ` | no | `eventTime` del sobre. Si falta o no se puede interpretar, `momento_recepcion`. Columna de partición. |
| `momento_recepcion` | `TIMESTAMPTZ` | no | `DEFAULT now()`. |
| `event_id` | `TEXT` | sí | `eventId`. |
| `tipo_evento` | `TEXT` | sí | `eventType` tal cual (`SevereSpeedingStarted`, `SevereSpeedingEnded` u otro). |
| `samsara_vehiculo_id` | `TEXT` | sí | `data.data.vehicle.id`. |
| `patente` | `TEXT` | sí | `data.data.vehicle.licensePlate`, sin normalizar. |
| `inicio_exceso` | `TIMESTAMPTZ` | sí | `data.data.startTime`. |
| `fin_exceso` | `TIMESTAMPTZ` | sí | `data.data.endTime`. |
| `inicio_viaje` | `TIMESTAMPTZ` | sí | `data.data.tripStartTime`. |
| `payload_crudo` | `JSONB` | no | Cuerpo completo recibido. |

**Índices y permisos**

- `create_hypertable('telemetria.evento_samsara', 'momento_evento')`.
- `UNIQUE (event_id, momento_evento) WHERE event_id IS NOT NULL` → idempotencia (FR-004, D-03).
- `INDEX (id)` → consulta por cursor (FR-004a).
- `GRANT SELECT, INSERT ON telemetria.evento_samsara TO agrolink_ingesta` + `USAGE, SELECT` sobre
  su secuencia. Sin `UPDATE`/`DELETE` para ningún rol (Principio IV).

**Reglas de extracción**: cada campo de consulta se extrae solo si existe y tiene el tipo
esperado. Una fecha que no es RFC 3339 se deja en `NULL` sin rechazar la notificación (FR-002).
Si el cuerpo no es JSON legible, se rechaza y no se guarda (único rechazo del endpoint).

**Acceso a datos**: `EventoSamsaraRepository` usa `JdbcTemplate` en vez de una entidad JPA,
porque el insert necesita `INSERT … ON CONFLICT (event_id, momento_evento) WHERE event_id IS NOT
NULL DO NOTHING RETURNING id` sobre el índice único parcial. Expone solo `insertar` y
`buscarPosterioresA`, sin métodos de modificación. Validado contra TimescaleDB 2.17.2-pg16
(`EventoSamsaraRepositoryIntegrationTest`).

## 2. `simulador-viajes` — estado del emisor Samsara (en memoria)

`Map<samsaraVehiculoId, EstadoVehiculoSamsara>`. Se pierde si el proceso se reinicia (D-09).

| Campo | Tipo | Descripción |
|---|---|---|
| `vehiculo` | `{ id, patente, nombre, vin }` | Entrada de la lista cerrada `src/samsara/vehiculosSamsara.js`. |
| `tripCode` | string | Viaje en curso que lo habilita (FR-021). |
| `inicioViaje` | ISO-8601 con offset | Hora de inicio del viaje informada por el backend (FR-021c). |
| `velocidadKmh` | number | Velocidad interna (D-07). Nunca se envía. |
| `rafaga` | `{ objetivoKmh, terminaEn } \| null` | Ráfaga de exceso en curso (D-07). |
| `excesoAbierto` | `{ startTime } \| null` | Exceso emitido sin fin todavía (D-08). |

**Transiciones**

```text
(sin entrada) ──aviso inicio──▶ SIMULANDO, sin exceso
SIMULANDO, sin exceso ──velocidad > umbral──▶ envía STARTED ─▶ SIMULANDO, con exceso
SIMULANDO, con exceso ──velocidad ≤ umbral y ≥ 20 s──▶ envía ENDED ─▶ SIMULANDO, sin exceso
SIMULANDO, cualquiera ──aviso detención──▶ (si hay exceso: envía ENDED de inmediato) ─▶ (sin entrada)
SIMULANDO ──aviso inicio de OTRO tripCode──▶ cierra exceso abierto (ENDED) y reinicia con el viaje nuevo
SIMULANDO ──aviso inicio del MISMO tripCode──▶ sin cambios (idempotente)
```

**Configuración** (variables de entorno, validadas al arrancar si el emisor está habilitado):

| Variable | Default | Regla |
|---|---|---|
| `SAMSARA_EMISOR_HABILITADO` | `false` | `true` para activarlo (FR-020). |
| `SAMSARA_WEBHOOK_URL` | compose: `http://agrolink-ingesta:${REPORTES_HTTP_PORT}/api/v1/proveedores/samsara/webhook` | URL interna (puerto `server.port` de ingesta). Obligatoria si el emisor está habilitado. |
| `SAMSARA_LIMITE_KMH` | `80` | > 0 (FR-015a). |
| `SAMSARA_MARGEN_KMH` | `20` | > 0. |
| `SAMSARA_CICLO_MS` | `5000` | Entero ≥ 1000. |
| `SAMSARA_EXCESOS_POR_HORA` | `0.3125` | Número ≥ 0 (λ de D-07). |
| `SAMSARA_ORG_ID` / `SAMSARA_WEBHOOK_ID` | `"1001"` / `"agrolink-poc"` | Solo para completar el sobre. |

Una configuración inválida hace que `loadConfig` falle con un mensaje claro (edge case de la
spec) y el proceso no arranca.

## 3. AgroLinkBackend — dominio de eventos de conducción

### 3.1 `DrivingEvent` (record, no persistido)

Salida de `SamsaraSpeedingEventAdapter` (Principio I): `kind` (`SPEEDING_STARTED` |
`SPEEDING_ENDED`), `provider` (`SAMSARA`), `providerEventId`, `providerVehicleId`, `plate`,
`startTime`, `endTime` (solo `ENDED`), `providerTripStartTime`, `sourcePosition` (id de ingesta).
Las horas se convierten de RFC 3339 a `LocalDateTime` en `TripSchedulePolicy.ZONE`, igual que el
resto del backend.

**Validación del adaptador** (Principio VIII: completo / faltante / inválido). Un tipo de evento
no soportado da `Optional.empty()` sin error. Si falta `startTime` o vehículo (ni id ni patente),
o `endTime < startTime`, se rechaza con motivo.

### 3.2 `SpeedingEpisode` (tabla `speeding_episodes`)

| Campo | Tipo | Regla |
|---|---|---|
| `id` | PK | |
| `tenant` | FK `tenants` | Del vehículo. |
| `vehicle` | FK `vehicles` | No nulo. |
| `trip` | FK `trips` | Nulo si no había viaje activo al abrir. |
| `provider` | string | `SAMSARA`. |
| `startTime` | `LocalDateTime` | No nulo. |
| `endTime` | `LocalDateTime` | Nulo mientras está abierto. |
| `startEventId` / `endEventId` | string | Únicos (nullable). |
| `status` | `OPEN` \| `CLOSED` | |
| `alert` | FK `alerts` | Alerta vinculada. |

Restricción única `(vehicle_id, start_time)`. Duración calculada como `endTime − startTime`, no
persistida.

**Reglas de aplicación** (`SpeedingEpisodeService.apply(DrivingEvent)`, una transacción por
evento, junto con el avance del cursor):

1. Si el `providerEventId` ya figura como `startEventId` o `endEventId`, no tiene efecto (FR-007).
2. Vehículo: primero por `iotDeviceId == providerVehicleId`. Si no hay, por patente normalizada.
   Si ambos encuentran vehículos distintos, prevalece el id y se registra la inconsistencia. Sin
   vehículo, o con proveedor ≠ `SAMSARA`, se registra `WARN` con el motivo, sin efecto
   (FR-006/FR-010).
3. `STARTED`: si no existe episodio `(vehículo, startTime)`, se crea `OPEN`, se asocia el viaje
   activo (`EN_ROUTE`, `WAITING_DISCHARGE` o `ALERTA_CRITICA`) y se abre la alerta. Si existe
   `CLOSED`, solo se completa `startEventId` y no se reabre (US3-2).
4. `ENDED`: si existe `OPEN`, pasa a `CLOSED` con `endTime` y se resuelve la alerta. Si no existe,
   se crea ya `CLOSED` (con su alerta creada y resuelta en la misma transacción) para que quede
   rastro.
5. Un `STARTED` con otro `startTime` para un vehículo con episodio abierto crea un episodio nuevo
   y el anterior queda abierto (edge case).

### 3.3 `ProviderEventCursor` (tabla `provider_event_cursors`)

`providerCode` (PK, `SAMSARA`), `lastPosition` (long, default 0) y `updatedAt`. Posición de
consulta de la spec. Persiste entre reinicios.

### 3.4 Cambios en entidades existentes

- `Alert.AlertType`: + `SPEEDING`. `Alert`: + `speedingEpisode` (FK nullable). `alerts_type_check`
  se ajusta al arrancar (D-14).
- `AlertDto.AlertResponse`: + `speeding` (nullable) =
  `{ vehiclePlate, provider, startTime, endTime, durationSeconds, inProgress }`.
- `SimulatedDeviceRegistry`: + lista `SAMSARA_DEVICE_IDS` y `isSamsaraSimulated` (D-11/D-12).
- `LocalDataSeeder`: proveedor `SAMSARA` → `ACTIVE` (FR-011). Además, vehículos `AGL007`/`AGL008`
  del tenant demo con proveedor `SAMSARA` e `iotDeviceId` `281474977000101`/`…102`, con chofer
  disponible para poder crear viajes.

## 4. Frontend AgroLink

- `AlertType` += `'SPEEDING'`. `ThermalAlert` += `speeding?: SpeedingInfo | null`, con
  `SpeedingInfo = { vehiclePlate: string; provider: string; startTime: string; endTime: string | null; durationSeconds: number | null; inProgress: boolean }`.
- `useDrivingAlerts`: lista inicial de `GET /api/v1/alerts/driving` y actualización con el evento
  SSE `driving-alert`, reemplazando por `id`.
- Página de alertas: pestaña "Conducción", tarjeta KPI "Conducción" con las activas, y `allAlerts`
  que incluye las de conducción (FR-023/FR-024). Las tarjetas térmica y de mantenimiento no
  cambian de cálculo.
