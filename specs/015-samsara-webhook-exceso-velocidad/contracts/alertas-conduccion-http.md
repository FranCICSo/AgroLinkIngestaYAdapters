# Contract: AgroLinkBackend → frontend AgroLink — alertas de conducción

**Feature**: `015-samsara-webhook-exceso-velocidad` | **Version**: 1.0.0 | **Date**: 2026-11-04 |
**Dueño**: AgroLinkBackend

Extiende la API de alertas existente (`/api/v1/alerts`). Usa la misma autenticación y el mismo
alcance por tenant (`TenantAccessGuard`) que el resto de los endpoints de alertas.

## 1. `AlertResponse` — campo nuevo

```jsonc
{
  "id": 501, "type": "SPEEDING", "severity": "WARNING", "status": "ACTIVE",
  "triggerDateTime": "2026-11-04T10:05:12", "resolveDateTime": null,
  "description": "Exceso de velocidad severo según Samsara — AGL007",
  "tripId": 88, "tripCode": "VIAJE-AB12CD34",
  // … campos existentes sin cambios …
  "speeding": {                                 // null para cualquier otro tipo
    "vehiclePlate": "AGL007",
    "provider": "SAMSARA",
    "startTime": "2026-11-04T10:05:12",
    "endTime": null,
    "durationSeconds": null,
    "inProgress": true
  }
}
```

Las fechas son locales (`TripSchedulePolicy.ZONE`), igual que el resto de `AlertResponse`. La
`description` aclara que la severidad la determinó el proveedor (spec FR-025).

## 2. `GET /api/v1/alerts/driving`

Devuelve todas las alertas `SPEEDING` del tenant en cualquier estado, de la más reciente a la más
antigua, con un máximo de 200. El frontend filtra por estado, igual que en las otras pestañas.

## 3. SSE — evento `driving-alert`

Por el stream existente `GET /api/v1/alerts/stream`, con un nuevo nombre de evento,
`driving-alert`, y `AlertResponse` como cuerpo. Se emite al abrir y al cerrar un episodio, y en
cada reconocimiento o resolución manual de una alerta `SPEEDING`. Solo llega a los clientes del
tenant del vehículo.

## 4. Push

`AlertPushNotifier` agrega el caso `SPEEDING`, con el título "Exceso de velocidad severo" y el
cuerpo "{patente} · según Samsara · desde {HH:mm}". Solo se envía al abrir el episodio, no al
cerrarlo (FR-026).

## 5. Reconocer y resolver

Se usan los endpoints existentes `POST /api/v1/alerts/{id}/acknowledge` y
`PUT /api/v1/alerts/{id}/resolve` sin cambios. Si un operador resuelve a mano una alerta cuyo
episodio sigue abierto, el episodio no cambia, y su fin posterior no reabre la alerta.
