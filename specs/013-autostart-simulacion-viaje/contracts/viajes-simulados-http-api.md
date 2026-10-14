# Contract: `/api/v1/vehiculos/{dispositivoId}/viajes-simulados` (agrolink-ingesta)

**Feature**: `013-autostart-simulacion-viaje` | **Date**: 2026-10-11

Expuesto por `agrolink-ingesta`, por el puerto ya publicado al host
(`vehiculo-estado.http-port`, default 8082) — mismo puerto y mismo prefijo
(`/api/v1/vehiculos/**`) ya permitido por `PuertoAccesoFilter`, sin cambios a ese filtro
(research.md D-03). Llamador esperado: AgroLinkBackend (`SimulacionViajeClient`), nunca el
frontend de AgroLink.

## `POST /api/v1/vehiculos/{dispositivoId}/viajes-simulados`

Alta de la planificación (FR-002/FR-008). Llamada una única vez al dar de alta el viaje.

### Request

```
POST /api/v1/vehiculos/900001/viajes-simulados
Content-Type: application/json
```

```jsonc
{
  "tripCode": "VIAJE-AB12CD34",
  "estimatedStartDateTime": "2026-10-12T08:00:00",
  "origen": { "lat": -34.6467, "lon": -58.4894 },
  "destino": { "lat": -34.6037, "lon": -58.3816 }
}
```

### Responses

| Status | Cuándo | Body |
|---|---|---|
| `202 Accepted` | `{dispositivoId}` está en la lista cerrada (FR-001) y la fila quedó `PENDIENTE` | `{ "tripCode": "VIAJE-AB12CD34", "estado": "PENDIENTE", "estimatedStartDateTime": "2026-10-12T08:00:00" }` |
| `404 Not Found` | `{dispositivoId}` NO está en la lista cerrada de dispositivos simulados (FR-001/FR-003) | `{ "error": "dispositivo_no_simulado", "dispositivoId": "..." }` |
| `409 Conflict` | Ya existe una fila con ese `tripCode` en un estado terminal (`DISPARADO`/`CANCELADO`/`ERROR`) | `{ "error": "viaje_no_modificable", "estadoActual": "..." }` |
| `400 Bad Request` | Campos faltantes o inválidos (coordenadas, fecha) | `{ "error": "validacion", "detalle": "..." }` |

Un `POST` repetido con el mismo `tripCode` mientras la fila sigue `PENDIENTE` actualiza la fila
existente (idempotente ante un reintento de red de AgroLinkBackend) en vez de crear una
duplicada.

## `PUT /api/v1/vehiculos/{dispositivoId}/viajes-simulados/{tripCode}`

Reprogramación (FR-009) — sólo mientras la fila sigue `PENDIENTE`.

### Request

```jsonc
{ "estimatedStartDateTime": "2026-10-12T10:30:00" }
```

### Responses

| Status | Cuándo | Body |
|---|---|---|
| `200 OK` | Reprogramado | `{ "tripCode": "...", "estado": "PENDIENTE", "estimatedStartDateTime": "2026-10-12T10:30:00" }` |
| `404 Not Found` | No existe una fila con ese `tripCode` | `{ "error": "viaje_programado_no_encontrado" }` |
| `409 Conflict` | La fila ya no está `PENDIENTE` (ya se disparó, se canceló, o quedó en error) | `{ "error": "viaje_no_modificable", "estadoActual": "..." }` |

## `DELETE /api/v1/vehiculos/{dispositivoId}/viajes-simulados/{tripCode}`

Cancelación (FR-010) — sólo mientras la fila sigue `PENDIENTE`.

### Responses

| Status | Cuándo | Body |
|---|---|---|
| `204 No Content` | Cancelado (`estado` pasa a `CANCELADO`) | — |
| `404 Not Found` | No existe una fila con ese `tripCode` | `{ "error": "viaje_programado_no_encontrado" }` |
| `409 Conflict` | La fila ya no está `PENDIENTE` | `{ "error": "viaje_no_modificable", "estadoActual": "..." }` |

## Garantías para el llamador (AgroLinkBackend)

- Ninguna de estas tres llamadas debe bloquear ni hacer fallar el alta/actualización/
  cancelación del `Trip` en AgroLinkBackend (FR-004): el cliente (`SimulacionViajeClient`)
  usa un timeout corto y traduce cualquier error (red, `4xx`, `5xx`) a un resultado tipado sin
  propagar la excepción — mismo patrón que `IngestaVehiculoEstadoClient`.
- Un `404`/`409`/`400` de este contrato no es una falla del alta del `Trip` en sí — es
  información de que la planificación de la simulación no se pudo crear/actualizar, y
  corresponde loggearlo (FR-005), no reintentarlo automáticamente desde AgroLinkBackend (ver
  research.md D-06, mismo criterio de "sin reintentos automáticos").
