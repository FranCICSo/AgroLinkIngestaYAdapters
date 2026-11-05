# Contract: emisor Samsara (o Samsara real) → `agrolink-ingesta` — webhook

**Feature**: `015-samsara-webhook-exceso-velocidad` | **Version**: 1.0.0 | **Date**: 2026-11-04 |
**Dueño**: este repo

`POST /api/v1/proveedores/samsara/webhook`

- Alcanzable por `server.port` (red interna; así llama el emisor) y por el puerto publicado
  `vehiculo-estado.http-port` (prefijo habilitado en `PuertoAccesoFilter`, research D-05).
- **Sin autenticación ni verificación de firma** (POC, spec FR-002). Los encabezados
  `X-Samsara-*` se ignoran.
- `Content-Type: application/json`. Cuerpo máximo 256 KiB; si se excede, `413`.

## Request — forma documentada por Samsara

```jsonc
{
  "eventId": "8f0a6a2e-1b7c-4f0e-9a51-3d2b0c9e1a11",
  "eventTime": "2026-11-04T13:05:12.000Z",
  "eventType": "SevereSpeedingStarted",          // o "SevereSpeedingEnded"
  "orgId": 1001,
  "webhookId": "agrolink-poc",
  "data": {
    "data": {
      "startTime": "2026-11-04T13:05:12.000Z",
      "endTime": "2026-11-04T13:06:40.000Z",       // solo en SevereSpeedingEnded
      "tripStartTime": "2026-11-04T12:40:00.000Z",
      "vehicle": {
        "id": "281474977000101",
        "name": "Camión AGL007",
        "licensePlate": "AGL007",
        "vehicleVin": "8AC906635RE000107",
        "assetType": "vehicle",
        "externalIds": {}
      }
    }
  }
}
```

Fechas en RFC 3339 con offset. El emisor simulado siempre envía UTC (`Z`). Se aceptan y guardan
campos desconocidos y tipos de evento distintos de los dos soportados.

## Responses

| Status | Cuerpo | Cuándo |
|---|---|---|
| `200 OK` | `{ "estado": "GUARDADO", "id": 1234 }` | JSON legible guardado por primera vez, completo o no. |
| `200 OK` | `{ "estado": "DUPLICADO" }` | Mismo `eventId` + `eventTime` ya guardado (research D-03). |
| `400 Bad Request` | `{ "error": "json_invalido", "detalle": "…" }` | Cuerpo vacío o no JSON. No se guarda nada y se registra `WARN`. |
| `413 Payload Too Large` | `{ "error": "payload_demasiado_grande" }` | > 256 KiB. |
| `500` | `{ "error": "error_interno" }` | Falla de base de datos. Samsara reintentaría. |

Se usa `200` (no `201`/`202`) porque Samsara solo distingue 2xx de no-2xx, y un duplicado tiene
que ser 2xx para cortar los reintentos.

## Registro

Cada recepción registra `INFO` con `eventId`, `eventType`, `samsara_vehiculo_id` y el resultado.
Si faltan campos de consulta, `INFO` incluye cuáles (Principio IX).
