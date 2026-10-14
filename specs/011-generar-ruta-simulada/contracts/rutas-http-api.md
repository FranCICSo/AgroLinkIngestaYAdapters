# Contract: `POST /rutas` (simulador-viajes)

**Feature**: `011-generar-ruta-simulada` | **Date**: 2026-10-07 | **Actualizado**: 2026-10-10
(User Story 3, FR-013/FR-014: bloque `camion` opcional; 2026-10-10 (2): `camion.id` admite ids
no puramente numéricos, p. ej. `tra-demo-004`)

Endpoint HTTP interno del proceso `simulador-viajes` (FR-005). **No publicado al host** en
`deploy/compose.yaml` (research.md D-04): alcanzable sólo dentro de la red de Docker compose, nunca
desde el frontend de AgroLink directamente (FR-006).

## Request

```
POST /rutas
Content-Type: application/json
```

```jsonc
{
  "nombre": "Mercado Central → depósito X",
  "origen": { "lat": -34.6467, "lon": -58.4894 },
  "destino": { "lat": -34.6037, "lon": -58.3816 },
  "paradas": [
    { "lat": -34.620, "lon": -58.430, "duracionMin": 15 }
  ],
  "camion": {
    "id": "900005",
    "nombre": "Camion 5",
    "tipoCarga": "seca",
    "odometroInicialKm": 0,
    "setpointTempC": 2.5,
    "setpointHumedadPct": 87
  }
}
```

`paradas` es opcional (default `[]`) — ver `data-model.md` § 2 para las reglas de validación de
cada campo.

`camion` es opcional (User Story 3, FR-013). Si se incluye:
- `id` es el único campo obligatorio dentro de `camion`. Es válido si:
  - es numérico y está en el rango reservado 900001-900999 (spec 009-simulador-viajes), o
  - contiene al menos un carácter no numérico — por ejemplo `tra-demo-004`, calcando un
    `iotDeviceId` ya sembrado en AgroLinkBackend (FR-014, 2026-10-10). Un id así tampoco puede
    confundirse con un IMEI real (siempre puramente numérico, 15 dígitos), así que no necesita
    estar en el rango reservado.
  - Si no cumple ninguna de las dos condiciones (numérico fuera de rango), la llamada completa se
    rechaza (ver abajo). Columna `simulador.camion.id` / `simulador.viaje.camion_id`: `VARCHAR(20)`.
- Si el camión no existe en `simulador.camion`, se crea con los demás campos (`nombre` default
  `id`, `tipoCarga` default `'seca'`, `odometroInicialKm` default `0`; `setpointTempC`/
  `setpointHumedadPct` opcionales, solo tienen efecto si `tipoCarga='refrigerada'`).
- Si el camión ya existe, se reutiliza tal cual está (no se pisan sus campos) — solo se cierra
  su viaje `en_curso` anterior (si tenía uno) y se abre el nuevo sobre esta ruta, continuando
  desde su último odómetro conocido.

## Responses

| Status | Cuándo | Body |
|--------|--------|------|
| `201 Created` | Ruta generada y persistida (FR-004), sin `camion` en el body | `{ "id": 7, "nombre": "...", "puntos": [...], "paradas": [...] }` |
| `201 Created` | Ruta generada y persistida, **con** `camion` en el body (FR-013) | igual que arriba + `"viaje": { "dispositivoId": "900005", "viajeId": 42, "rutaId": 7, "estado": "en_curso" }` |
| `400 Bad Request` | Validación de entrada falla (FR-009: distancia trivial, campos faltantes/inválidos; o FR-014: `camion.id` numérico fuera del rango reservado, o `camion.tipoCarga` inválido) | `{ "error": "validacion", "detalle": "..." }` |
| `409 Conflict` | `nombre` ya existe (FR-008) | `{ "error": "nombre_duplicado" }` |
| `422 Unprocessable Entity` | OSRM no pudo resolver un camino o no respondió (FR-003) | `{ "error": "trazado_no_disponible", "detalle": "..." }` |

Ningún camino de error persiste una fila parcial (FR-004, Edge Cases) — incluida la validación
de `camion` (FR-014): si `camion.id` es inválido, ni la ruta ni ningún viaje quedan persistidos.

## Ejemplos (curl, desde dentro de la red de Docker compose)

Sin camión (comportamiento original, User Story 1):

```bash
curl -X POST http://simulador-viajes:PUERTO_HTTP/rutas \
  -H 'Content-Type: application/json' \
  -d '{
    "nombre": "Ruta demo A",
    "origen": { "lat": -34.6467, "lon": -58.4894 },
    "destino": { "lat": -34.6037, "lon": -58.3816 }
  }'
```

Con camión, para que el daemon empiece a emitir en el próximo ciclo (User Story 3):

```bash
curl -X POST http://simulador-viajes:PUERTO_HTTP/rutas \
  -H 'Content-Type: application/json' \
  -d '{
    "nombre": "Ruta demo A",
    "origen": { "lat": -34.6467, "lon": -58.4894 },
    "destino": { "lat": -34.6037, "lon": -58.3816 },
    "camion": { "id": "900005", "odometroInicialKm": 0 }
  }'
```

Con un `camion.id` no numérico, calcando un `iotDeviceId` real de AgroLinkBackend (FR-014,
2026-10-10):

```bash
curl -X POST http://simulador-viajes:PUERTO_HTTP/rutas \
  -H 'Content-Type: application/json' \
  -d '{
    "nombre": "Ruta demo A",
    "origen": { "lat": -34.6467, "lon": -58.4894 },
    "destino": { "lat": -34.6037, "lon": -58.3816 },
    "camion": { "id": "tra-demo-004", "odometroInicialKm": 0 }
  }'
```
