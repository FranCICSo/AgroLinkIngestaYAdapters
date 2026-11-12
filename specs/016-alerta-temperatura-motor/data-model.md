# Data Model: Sobretemperatura de motor simulada y alerta de mantenimiento

**Feature**: `016-alerta-temperatura-motor` | **Fecha**: 2026-11-10

## 1. `simulador.viaje`: columnas nuevas (simulador-viajes)

Migración `deploy/migrations/010_add_falla_motor_viaje.sql`, idempotente (`ADD COLUMN IF NOT
EXISTS`). Se replica en `deploy/db/03-schema-simulador.sql` para volúmenes nuevos. No toca
`telemetria.*` (Principio IV).

| Columna | Tipo | Nulo | Descripción |
|---|---|---|---|
| `falla_motor_origen` | `VARCHAR(6)` `CHECK (IN ('azar','manual'))` | sí | `null` = el viaje no tiene falla de motor |
| `falla_motor_indice_disparo` | `INTEGER` | sí | Solo `azar`: índice de avance desde el que se activa |
| `falla_motor_duracion_min` | `INTEGER` `CHECK (> 0)` | sí | Solo `azar`: minutos de reloj que dura una vez activada |
| `falla_motor_activada_en` | `TIMESTAMPTZ` | sí | Momento en que empezó a subir la temperatura |
| `falla_motor_desactivada_en` | `TIMESTAMPTZ` | sí | Momento de desactivación manual o por duración cumplida |

Son independientes de `falla_tipo` / `falla_indice_disparo` (fallas de carga, FR-004).

### Estado derivado (función pura `estadoFallaMotor(viaje, ahora, indice)`)

```text
sin_falla   : origen = null
pendiente   : origen = 'azar' AND activada_en = null AND indice < indice_disparo
activa      : activada_en != null AND desactivada_en = null
              AND (origen = 'manual' OR ahora < activada_en + duracion_min)
terminada   : desactivada_en != null
              OR (origen = 'azar' AND ahora >= activada_en + duracion_min)
```

Transiciones que escribe el ciclo del simulador (`index.js`, por camión):

| De | Condición | Escritura |
|---|---|---|
| `pendiente` | `siguienteIndice >= indice_disparo` | `activada_en = now()` |
| `activa` (azar) | `now() >= activada_en + duracion_min` | `desactivada_en = now()` |

Transiciones que escribe el endpoint HTTP (contracts/simulador-falla-motor-http.md):

| Pedido | Estado previo | Escritura | `efecto` |
|---|---|---|---|
| `POST` | `sin_falla`, `pendiente`, `terminada` | `origen='manual'`, `indice_disparo=null`, `duracion_min=null`, `activada_en=now()`, `desactivada_en=null` | `ACTIVADA` |
| `POST` | `activa` | — | `YA_ACTIVA` |
| `DELETE` | `activa` | `desactivada_en=now()` | `DESACTIVADA` |
| `DELETE` | `pendiente` | `desactivada_en=now()` (cancela el sorteo) | `DESACTIVADA` |
| `DELETE` | `sin_falla`, `terminada` | — | `YA_INACTIVA` |

Fin de viaje: el viaje pasa a `finalizado` y su falla deja de importar. El viaje de vuelta nace con
su propio sorteo (D-03) y **no** copia columnas `falla_motor_*` (FR-008).

### Modo de síntesis de temperatura (por trama)

```text
activa                         → 'sobrecalentamiento'
no activa y anterior > 95 °C   → 'enfriamiento'
otro caso                      → 'normal'
```

La temperatura anterior vive en `estadoPorCamion` (memoria), con clave `camionId`, y guarda el
`viajeId` al que pertenece. Si cambia el `viajeId` (viaje nuevo), se descarta y arranca en la banda
normal (FR-008, "arranca con temperatura normal").

## 2. `alerts`: columnas nuevas (AgroLinkBackend)

Las crea `ddl-auto: update`. Son nullable y no hay migración de datos: las alertas existentes quedan
con `null`.

| Campo (Java) | Columna | Tipo | Uso |
|---|---|---|---|
| `maintenanceKind` | `maintenance_kind` | `VARCHAR` (enum `MaintenanceAlertKind`) | `ENGINE_OVERHEAT`; `null` = work item o RTO |
| `engineVehiclePlate` | `engine_vehicle_plate` | `VARCHAR` | Patente al abrirse (evita resolver el vehículo al serializar) |
| `enginePeakTempC` | `engine_peak_temp_c` | `DOUBLE PRECISION` | Máximo del episodio |
| `engineLastTempC` | `engine_last_temp_c` | `DOUBLE PRECISION` | Última lectura evaluada |
| `engineLastReadingAt` | `engine_last_reading_at` | `TIMESTAMP` | `momentoEvento` de la última lectura evaluada (filtro de re-lecturas, D-10) |

Valores que se fijan al crear una alerta `ENGINE_OVERHEAT`:

| Campo | Valor |
|---|---|
| `type` | `MAINTENANCE` |
| `assetType` / `assetId` | `TRUCK` / `vehicle.id` |
| `maintenanceWorkItemId` | `null` |
| `trip` | Viaje `EN_ROUTE` o `ALERTA_CRITICA` del vehículo, si lo hay (mismo `findActiveTrip`) |
| `tenant` | `vehicle.tenant` |
| `triggerDateTime` | `momentoEvento` de la lectura que la abrió |
| `causeClassification` | `UNCLASSIFIED` |
| `description` | Ver abajo |

Descripción (se regenera al escalar):

```text
WARNING : "Riesgo de detención por alta temperatura de motor (107 °C) — Camión AB123CD · Viaje VJ-0042"
CRITICAL: "Detención inminente por temperatura de motor (112 °C) — Camión AB123CD · Viaje VJ-0042"
sin viaje: se omite " · Viaje ..."
```

Repositorio, consulta nueva:

```text
findFirstByTenant_IdAndTypeAndMaintenanceKindAndAssetTypeAndAssetIdAndStatusIn(
    tenantId, MAINTENANCE, ENGINE_OVERHEAT, TRUCK, vehicleId, [ACTIVE, ACKNOWLEDGED])
```

Invariante: como máximo una alerta `ENGINE_OVERHEAT` abierta por vehículo. La garantiza la
evaluación secuencial del poll (research.md D-10). No se agrega un índice único parcial, porque
`ddl-auto` no lo gestiona.

## 3. Máquina de estados de la alerta

```text
             t >= warning (y < critical)          t >= critical
 (ninguna) ─────────────────────────────▶ WARNING ─────────────▶ CRITICAL
     │                                       │                       │
     │ t >= critical                         │ t < warning − margin  │ t < warning − margin
     └──────────────────────▶ CRITICAL       ▼                       ▼
                                          RESOLVED               RESOLVED
```

- La severidad nunca baja (CRITICAL → WARNING no existe, FR-014).
- `status` puede pasar a `ACKNOWLEDGED` a mano en cualquier momento. Para esta máquina,
  `ACKNOWLEDGED` cuenta igual que `ACTIVE`: escala, actualiza el pico y se resuelve sola.
- Resolución automática: `status = RESOLVED`, `resolveDateTime = momentoEvento` de la lectura
  normalizada, `causeClassification` sin cambios (`UNCLASSIFIED`). Una resolución manual por
  `PUT /alerts/{id}/resolve` cierra el episodio igual. Si la temperatura sigue alta, la lectura
  siguiente abre una alerta nueva. Es el comportamiento esperado: el usuario cerró algo que seguía
  pasando.
- Lecturas ignoradas: `t == null`, `t` fuera de `[valid-min-c, valid-max-c]` (con log `WARN`) y
  `momentoEvento <= engineLastReadingAt` con alerta abierta.

## 4. Respuesta de alerta (`AlertDto.AlertResponse`)

Campos nuevos, con `null` para cualquier otra alerta (retrocompatible):

| Campo | Tipo | Descripción |
|---|---|---|
| `maintenanceKind` | `"ENGINE_OVERHEAT" \| null` | Subtipo de alerta de mantenimiento |
| `engine` | `EngineOverheatInfo \| null` | Ver abajo |

`EngineOverheatInfo`:

| Campo | Tipo |
|---|---|
| `vehiclePlate` | `string` |
| `peakTemperatureC` | `number` |
| `lastTemperatureC` | `number` |
| `lastReadingAt` | `string` (ISO local, igual que `triggerDateTime`) |

Los umbrales no viajan en la respuesta: son configuración del backend y la severidad ya dice en
qué zona está la alerta (decidido al implementar: `fromEntity` es estático y no tiene acceso a la
configuración).

## 5. Configuración

- Simulador: research.md D-06.
- Backend: research.md D-12.
