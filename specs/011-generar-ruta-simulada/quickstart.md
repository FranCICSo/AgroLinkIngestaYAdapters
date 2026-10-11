# Phase 1 — Quickstart & Validación: Generación de Rutas Simuladas desde Origen/Destino

**Feature**: `011-generar-ruta-simulada` | **Date**: 2026-10-07 | **Actualizado**: 2026-10-10
(§ 8: `camion.id` admite ids no puramente numéricos, p. ej. `tra-demo-004`)

Requiere el entorno de la feature [009-simulador-viajes](../009-simulador-viajes/quickstart.md)
ya levantado (TimescaleDB + schema `simulador`), más OSRM corriendo (research.md D-01, D-08).

---

## 1. Levantar OSRM self-hosted

Levantar y operar OSRM es parte del alcance de esta feature (spec.md § Clarifications): un
único comando reproducible, sin pasos manuales de `docker run` aparte.

```bash
make osrm   # desde la raíz del repo — ya incluido en `make simulador`
```

La primera vez descarga el extracto OSM de `OSRM_REGION` (default: `argentina`, vía Geofabrik)
y lo preprocesa (`osrm-extract`/`osrm-partition`/`osrm-customize`) en `deploy/osrm-data/` —
tarda varios minutos y cientos de MB. Corridas siguientes saltean ambos pasos (idempotente) y
sólo levantan el contenedor `osrm-routed`.

**Esperado**: `cd deploy && docker compose exec -T simulador-viajes wget -qO- \
http://osrm:5000/route/v1/driving/-58.4894,-34.6467;-58.3816,-34.6037?overview=false`
responde `"code":"Ok"` (sin `ports:` publicado, sólo se prueba desde dentro de la red de
Docker compose — research.md D-04).

Para una prueba puntual sin levantar el contenedor propio, se puede apuntar temporalmente a
`https://router.project-osrm.org` (ver spec.md § Assumptions — sólo para esto, nunca como
default del proceso de deploy).

## 2. Aplicar la restricción nueva sobre `simulador.ruta`

```bash
docker compose exec -T timescaledb psql -U postgres -d agrolink_telemetria \
  -f /docker-entrypoint-initdb.d/../migrations/005_add_ruta_nombre_unique.sql
```

**Esperado**: `\d simulador.ruta` muestra `ruta_nombre_unique UNIQUE CONSTRAINT, btree (nombre)`.

## 3. Tests unitarios (Principio VIII)

```bash
cd simulador-viajes && npm test
```

**Esperado** (casos nuevos de esta feature, ver `research.md` D-01/D-02/D-06):

| Test | Casos |
|------|-------|
| `routeGenerationService.test.js` | genera y persiste con origen/destino válidos; rechaza por distancia trivial (< 50 m); rechaza cuando OSRM responde `code !== "Ok"` o no responde (timeout) |
| `rutaRepository.test.js` | inserta una ruta nueva; traduce `23505 unique_violation` a `nombre_duplicado` sin dejar fila parcial |

## 4. Generar una ruta vía CLI

```bash
npm run crear-ruta -- \
  --nombre "Ruta demo A" \
  --origenLat -34.6467 --origenLon -58.4894 \
  --destinoLat -34.6037 --destinoLon -58.3816
```

**Esperado**: exit code `0`, imprime el `id` de la fila nueva en `simulador.ruta` — ver
`contracts/crear-ruta-cli.md`.

```bash
docker compose exec -T timescaledb psql -U postgres -d agrolink_telemetria \
  -c "SELECT id, nombre, jsonb_array_length(puntos) FROM simulador.ruta WHERE nombre = 'Ruta demo A';"
```

**Esperado**: una fila con `jsonb_array_length(puntos) > 2` (trazado real sobre calles, no sólo
origen/destino).

## 5. Generar una ruta vía HTTP (dentro de la red de Docker compose)

```bash
docker compose exec simulador-viajes wget -qO- --method=POST \
  --header='Content-Type: application/json' \
  --body-data='{"nombre":"Ruta demo B","origen":{"lat":-34.6467,"lon":-58.4894},"destino":{"lat":-34.6037,"lon":-58.3816}}' \
  http://localhost:PUERTO_HTTP/rutas
```

**Esperado**: `201` con el mismo shape de respuesta documentado en
`contracts/rutas-http-api.md`, y una fila equivalente a la del paso 4 en `simulador.ruta`.

## 6. Casos de rechazo (FR-003, FR-008, FR-009)

- Repetir el paso 4 con el mismo `--nombre` → exit code `1`, stderr `ya existe una ruta con ese
  nombre`, y `simulador.ruta` sigue con una sola fila para ese nombre.
- Repetir el paso 4 con `--origenLat`/`--origenLon` iguales a `--destinoLat`/`--destinoLon` →
  exit code `1` antes de llamar a OSRM, sin fila nueva en `simulador.ruta`.

## 7. Arrancar un viaje en la misma llamada (User Story 3, FR-013)

```bash
cd deploy && docker compose exec -T simulador-viajes wget -qO- \
  --header='Content-Type: application/json' \
  --post-data='{
    "nombre": "Ruta demo con camion",
    "origen": { "lat": -34.6467, "lon": -58.4894 },
    "destino": { "lat": -34.6037, "lon": -58.3816 },
    "camion": { "id": "900005", "odometroInicialKm": 0 }
  }' \
  http://localhost:PUERTO_HTTP/rutas
```

**Esperado**: `201` con `"viaje":{"dispositivoId":"900005","viajeId":...,"estado":"en_curso"}`
en el body (ver `contracts/rutas-http-api.md`). Esperar ≤60s y confirmar que ya hay una lectura:

```bash
curl -s http://localhost:$VEHICULO_ESTADO_HTTP_PORT/api/v1/vehiculos/900005/estado
```

**Esperado**: `200` con `dispositivo.momentoEvento` de hace menos de 60s — sin haber ejecutado
ningún `INSERT` manual sobre `simulador.camion`/`simulador.viaje`. Repetir el paso con un
`camion.id` numérico fuera de 900001-900999 (ej. `"12345"`) → `400`, `{"error":"validacion",
...}`, sin fila nueva en `simulador.ruta` (verificable con la consulta del paso 4).

## 8. `camion.id` no numérico, calcando un `iotDeviceId` real de AgroLinkBackend (2026-10-10)

Caso real que motivó esta ampliación: `AgroLinkBackend` siembra vehículos con `iotDeviceId`
como `tra-demo-004` (no numérico, vía `LocalDataSeeder.java` — fuera de este repo, no se
modifica). Para que el daemon de `simulador-viajes` emita telemetría para ese `dispositivoId`
exacto, `camion.id` acepta cualquier id con al menos un carácter no numérico sin exigir el
rango reservado (FR-014 actualizado) — un id así nunca puede confundirse con un IMEI real
(siempre puramente numérico, 15 dígitos).

```bash
cd deploy && docker compose exec -T simulador-viajes wget -qO- \
  --header='Content-Type: application/json' \
  --post-data='{
    "nombre": "Ruta demo tra-demo-004",
    "origen": { "lat": -34.6467, "lon": -58.4894 },
    "destino": { "lat": -34.6037, "lon": -58.3816 },
    "camion": { "id": "tra-demo-004", "odometroInicialKm": 0 }
  }' \
  http://localhost:PUERTO_HTTP/rutas
```

**Esperado**: `201` con `"viaje":{"dispositivoId":"tra-demo-004","viajeId":...,"estado":"en_curso"}`.
Esperar ≤60s y confirmar, igual que en el paso 7:

```bash
curl -s -w '\nHTTP_STATUS:%{http_code}\n' http://localhost:8082/api/v1/vehiculos/tra-demo-004/estado
```

**Esperado**: `HTTP_STATUS:200` con `"dispositivoId":"tra-demo-004"` y `posicion`/`odometroKm`
frescos (confirmado en vivo: `momentoEvento: "2026-10-10T21:11:44Z"`, `odometroKm: 231800.075`).
Requiere que la columna `simulador.camion.id` (y `simulador.viaje.camion_id`) ya esté ensanchada
a `VARCHAR(20)` vía `deploy/migrations/006_widen_camion_id.sql` — en un volumen nuevo, el schema
de `deploy/db/03-schema-simulador.sql` ya la crea así.
