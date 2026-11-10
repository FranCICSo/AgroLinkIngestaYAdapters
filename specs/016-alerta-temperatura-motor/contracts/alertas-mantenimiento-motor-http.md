# Contract: AgroLinkBackend → frontend AgroLink — alerta de sobretemperatura de motor

**Feature**: `016-alerta-temperatura-motor` | **Version**: 1.0.0 | **Date**: 2026-11-10 |
**Dueño**: AgroLinkBackend

Extiende la API de alertas existente (`/api/v1/alerts`), con la misma autenticación y el mismo
alcance por tenant (`TenantAccessGuard`). No agrega endpoints. Todos los cambios son aditivos.

## 1. `AlertResponse`: campos nuevos

```jsonc
{
  "id": 912, "type": "MAINTENANCE", "severity": "WARNING", "status": "ACTIVE",
  "triggerDateTime": "2026-11-10T14:11:03", "resolveDateTime": null,
  "description": "Riesgo de detención por alta temperatura de motor (107 °C) — Camión AB123CD · Viaje VJ-0042",
  "tripId": 42, "tripCode": "VJ-0042",
  "assetType": "TRUCK", "assetId": 7, "maintenanceWorkItemId": null,
  // … campos existentes sin cambios …
  "maintenanceKind": "ENGINE_OVERHEAT",   // null en el resto de las alertas
  "engine": {                              // null en el resto de las alertas
    "vehiclePlate": "AB123CD",
    "peakTemperatureC": 107,
    "lastTemperatureC": 107,
    "lastReadingAt": "2026-11-10T14:11:03"
  }
}
```

- `severity`: `WARNING` = riesgo de detención; `CRITICAL` = detención inminente.
- `tripId`/`tripCode`: `null` si el camión no tenía viaje en curso al abrirse la alerta.
- Fechas locales, igual que el resto de `AlertResponse`.

## 2. `GET /api/v1/alerts/maintenance/active`

Sin cambios de forma: ya devuelve las `MAINTENANCE` en `ACTIVE` del tenant, así que ahora también
incluye las `ENGINE_OVERHEAT`. `GET /api/v1/alerts/active` y `GET /api/v1/alerts/trip/{tripId}`
también las incluyen.

## 3. SSE: evento `maintenance-alert`

Por el stream existente `GET /api/v1/alerts/stream`, con el mismo nombre de evento y
`AlertResponse` como cuerpo. Para `ENGINE_OVERHEAT` se emite:

| Momento | `status` | `severity` |
|---|---|---|
| Apertura | `ACTIVE` | `WARNING` o `CRITICAL` |
| Escalado | `ACTIVE` / `ACKNOWLEDGED` | `CRITICAL` |
| Resolución automática | `RESOLVED` | sin cambios |
| Reconocimiento / resolución manual | según la acción | sin cambios (comportamiento existente) |

No se emite en cada actualización del pico (research.md D-11).

**Cambio de alcance (todas las alertas de mantenimiento)**: el evento `maintenance-alert` ahora
llega **solo a los clientes del tenant** del activo. Antes llegaba a todos los tenants. Las
alertas sin tenant (RTO de acoplados) se siguen emitiendo a todos, como hoy.

## 4. Push

`AlertPushNotifier`: si `maintenanceKind == ENGINE_OVERHEAT`, el título es "Riesgo de detención
por temperatura de motor" (`WARNING`) o "Detención inminente: temperatura de motor" (`CRITICAL`).
El cuerpo es la `description`, como en el resto de las alertas: ya incluye temperatura, patente y
viaje. Se envía en la apertura y en el escalado, no en la resolución automática.

## 5. Reconocer y resolver

`POST /api/v1/alerts/{id}/acknowledge` y `PUT /api/v1/alerts/{id}/resolve` funcionan igual que
para el resto de las alertas. Una alerta reconocida sigue su ciclo: escala, actualiza el pico y se
resuelve sola (data-model.md §3).
