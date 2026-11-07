# Contract: AgroLinkBackend → `agrolink-ingesta` — consulta de eventos Samsara

**Feature**: `015-samsara-webhook-exceso-velocidad` | **Version**: 1.0.0 | **Date**: 2026-11-04 |
**Dueño**: este repo (receptor). El llamador es AgroLinkBackend.

`GET /api/v1/proveedores/samsara/eventos?despuesDe={id}&limite={n}`

- Mismo puerto publicado y base URL que ya usa el backend (`agrolink.telemetry.ingesta.base-url`).
  Sin autenticación, igual que `/api/v1/vehiculos/**` (Complexity Tracking del plan).
- `despuesDe`: entero ≥ 0, obligatorio. `limite`: 1..500, default 100.

## Semántica

Devuelve las filas de `telemetria.evento_samsara` con `id > despuesDe` **y**
`momento_recepcion <= now() − 2 s` (margen de commit, research D-04), ordenadas por `id`
ascendente, con un máximo de `limite`. El llamador repite con `despuesDe = ultimaPosicion` hasta
que `hayMas = false`.

## Response `200 OK`

```jsonc
{
  "eventos": [
    {
      "posicion": 1234,                              // = id
      "eventId": "8f0a6a2e-…",
      "tipoEvento": "SevereSpeedingStarted",
      "momentoEvento": "2026-11-04T13:05:12Z",
      "momentoRecepcion": "2026-11-04T13:05:12.481Z",
      "samsaraVehiculoId": "281474977000101",
      "patente": "AGL007",
      "inicioExceso": "2026-11-04T13:05:12Z",
      "finExceso": null,
      "inicioViaje": "2026-11-04T12:40:00Z",
      "payloadCrudo": { /* cuerpo original */ }
    }
  ],
  "ultimaPosicion": 1234,                            // = despuesDe si no hay eventos
  "hayMas": false
}
```

Los campos ausentes en la fila van como `null`. Las fechas van en ISO-8601 UTC (`Instant`).

## Errores

| Status | Cuerpo | Cuándo |
|---|---|---|
| `400` | `{ "error": "validacion", "detalle": "…" }` | `despuesDe` ausente o negativo, `limite` fuera de rango. |
| `500` | `{ "error": "error_interno" }` | Falla de base. |

## Lado del llamador (AgroLinkBackend)

- `SamsaraEventosSyncScheduler` con `fixedDelay` de `agrolink.telemetry.samsara.poll-interval-ms`
  (default 10000) y desactivable con `agrolink.telemetry.samsara.poll-scheduler.enabled=false`.
- Timeouts de 3 s de conexión y 5 s de lectura. Una falla de red o una respuesta no-2xx se
  registra como `WARN` y se reintenta en el próximo ciclo, desde el mismo cursor. Sin pérdida de
  eventos (spec, edge case de ingesta caída).
- Cada evento se procesa y avanza el cursor en una transacción propia (research D-06). Un evento
  rechazado también avanza el cursor, con su `WARN`.
- Si el proveedor `SAMSARA` no está `ACTIVE` en el registro de proveedores, el ciclo no consulta
  nada y lo registra en `DEBUG`.
