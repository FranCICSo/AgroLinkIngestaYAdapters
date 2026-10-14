# Contract: Hook de `TripService` en AgroLinkBackend → `agrolink-ingesta`

**Feature**: `013-autostart-simulacion-viaje` | **Date**: 2026-10-11

Este contrato describe el lado llamador (AgroLinkBackend, repo separado), no código de este
repo — documentado aquí porque la spec (Clarifications 2026-10-11) decidió explícitamente la
integración cruzada. Implementación de referencia relevada en
`src/main/java/org/example/agrolink/trip/TripService.java`.

## Cuándo se llama

| Punto de `TripService` | Acción sobre `ingesta.viaje_programado` | FR |
|---|---|---|
| `createTrip(...)`, inmediatamente después de `tripRepository.save(trip)` (línea ~181) | `POST .../viajes-simulados` si `trip.getVehicle().getIotDeviceId()` está en la lista cerrada | FR-002/FR-008 |
| `updateTrip(...)`, si el `Trip` sigue en estado `CREATED`/`DESPACHADO` y `estimatedStartDateTime` cambió | `PUT .../viajes-simulados/{tripCode}` | FR-009 |
| `applyStateTransition(trip, TripState.CANCELLED)` / `deleteTrip(...)` | `DELETE .../viajes-simulados/{tripCode}` | FR-010 |

`createOutsourcedTrip` (viajes `TERCERIZADA`) **no** dispara este hook — alcance limitado a
flota propia (spec, Assumptions).

## Qué dato dispara la llamada

`SimulacionViajeClient` (nuevo, mismo patrón que `IngestaVehiculoEstadoClient`) chequea
`trip.getVehicle().getIotDeviceId()` contra la lista cerrada (FR-001, idéntica a la que valida
`agrolink-ingesta` del lado servidor — research.md D-04):

```
geo-demo-001, tel-demo-003, tra-demo-004, 900001, 900002
```

Si el `iotDeviceId` no está en esa lista, `SimulacionViajeClient` ni siquiera hace la llamada
HTTP (FR-003/SC-002) — cero overhead de red para los viajes de dispositivos reales.

## Garantías

- La llamada nunca bloquea ni hace fallar la transacción de `TripService` (FR-004): se ejecuta
  después de que `tripRepository.save(trip)` ya confirmó, con un cliente de timeout corto que
  traduce cualquier falla a un resultado tipado, nunca una excepción propagada.
- Un fallo de esta llamada se loggea (FR-005) y no se reintenta automáticamente — el equipo
  puede recrear la planificación a mano si corresponde (mismo criterio que el resto del
  mecanismo, research.md D-06).
- El `tripCode` del `Trip` (ya único por `normalizeOrGenerateTripCode`) es la clave que
  correlaciona ambos lados — no se genera un id nuevo para esto.

## Payload (ver `viajes-simulados-http-api.md` para el contrato completo)

```jsonc
// POST /api/v1/vehiculos/{iotDeviceId}/viajes-simulados
{
  "tripCode": "<Trip.tripCode>",
  "estimatedStartDateTime": "<Trip.estimatedStartDateTime, ISO-8601 local>",
  "origen": { "lat": "<geocodificado de Trip.direccionOrigen/legacy origin>", "lon": "..." },
  "destino": { "lat": "<geocodificado de Trip.direccionDestino/legacy destination>", "lon": "..." }
}
```

**Nota de implementación** (fuera del alcance de este repo, a resolver en AgroLinkBackend): al
momento de este plan, `Trip` almacena `direccionOrigen`/`localidadOrigen`/`provinciaOrigen` (y
el equivalente de destino) como texto estructurado, no como `lat`/`lon` ya geocodificados — a
diferencia de lo asumido en `specs/011-generar-ruta-simulada` para rutas creadas directamente
en `simulador-viajes`. Si AgroLinkBackend no tiene todavía coordenadas geocodificadas para el
`Trip`, FR-007 exige igualmente usar el recorrido ya asociado al viaje: el edge case "sin
origen/destino geocodificados disponibles" (spec, Edge Cases) se resuelve tratándolo como una
falla de arranque más (User Story 2) — `SimulacionViajeClient` no debe inventar un
geocodificador nuevo para esto.
