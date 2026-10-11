# Phase 1 — Quickstart & Validación: Arranque automático de la simulación en el horario planificado del viaje

**Feature**: `013-autostart-simulacion-viaje` | **Date**: 2026-10-11

Requiere el entorno de `simulador-viajes` levantado (`make simulador`, perfil `simulador` de
`deploy/compose.yaml`) y la migración `007_add_viaje_programado.sql` aplicada sobre
`agrolink-ingesta`'s base de datos.

## 1. Aplicar la migración nueva

```bash
cd deploy && docker compose exec -T timescaledb psql -U postgres -d agrolink_telemetria \
  -f /docker-entrypoint-initdb.d/../migrations/007_add_viaje_programado.sql
```

**Esperado**: `\dn` lista el esquema `ingesta`; `\d ingesta.viaje_programado` muestra la tabla
con sus columnas y el índice parcial sobre `estado = 'PENDIENTE'`.

## 2. Tests unitarios (Principio VIII)

```bash
mvn -q test -Dtest='*ViajeProgramado*,*SimuladorViajesClient*'
```

**Esperado**: cubre, como mínimo:
- `DispositivosSimuladosConocidosTest`: cada uno de los 5 ids de la lista cerrada matchea;
  un id que sólo se parece al patrón ("demo"/900001-900999) pero no está en la lista, no
  matchea (FR-001).
- `ViajeProgramadoServiceTest`: alta con horario futuro (queda `PENDIENTE`, no dispara);
  alta con horario ya pasado/inmediato (dispara sin esperar, FR-002a); reprogramación de una
  fila `PENDIENTE` (FR-009); cancelación de una fila `PENDIENTE` (FR-010); reprogramación/
  cancelación de una fila ya `DISPARADO` (`409`, fuera de alcance).
- `SimuladorViajesClientTest`: éxito llamando a `POST /rutas` con bloque `camion`; fallo de
  red/4xx/5xx traducido a resultado tipado sin excepción propagada (FR-004).

## 3. Probar el alta de una planificación (simulando la llamada de AgroLinkBackend)

```bash
curl -s -w '\nHTTP_STATUS:%{http_code}\n' -X POST \
  http://localhost:8082/api/v1/vehiculos/900005/viajes-simulados \
  -H 'Content-Type: application/json' \
  -d '{
    "tripCode": "QUICKSTART-001",
    "estimatedStartDateTime": "2026-10-12T08:00:00",
    "origen": { "lat": -34.6467, "lon": -58.4894 },
    "destino": { "lat": -34.6037, "lon": -58.3816 }
  }'
```

Nota: usar `900005` acá (no en la lista cerrada final) es intencional para el paso 3b — ver
abajo el caso con un id de la lista real.

**Esperado (3a, id fuera de la lista cerrada)**: `HTTP_STATUS:404`,
`{"error":"dispositivo_no_simulado",...}` — confirma FR-001/FR-003 (sólo los 5 ids del seeder
disparan el mecanismo).

**3b, con un id de la lista cerrada** (p. ej. `900001`, sembrado como `AGL005` en
`LocalDataSeeder.java`):

```bash
curl -s -w '\nHTTP_STATUS:%{http_code}\n' -X POST \
  http://localhost:8082/api/v1/vehiculos/900001/viajes-simulados \
  -H 'Content-Type: application/json' \
  -d '{
    "tripCode": "QUICKSTART-002",
    "estimatedStartDateTime": "2026-10-12T08:00:00",
    "origen": { "lat": -34.6467, "lon": -58.4894 },
    "destino": { "lat": -34.6037, "lon": -58.3816 }
  }'
```

**Esperado**: `HTTP_STATUS:202`, `{"tripCode":"QUICKSTART-002","estado":"PENDIENTE",...}`.

```bash
docker compose exec -T timescaledb psql -U postgres -d agrolink_telemetria \
  -c "SELECT trip_code, iot_device_id, estado, estimated_start_date_time FROM ingesta.viaje_programado WHERE trip_code = 'QUICKSTART-002';"
```

**Esperado**: una fila con `estado = 'PENDIENTE'`.

## 4. Confirmar que NO dispara antes del horario

Con `estimated_start_date_time` todavía en el futuro, esperar menos de un ciclo del poller y
verificar que la fila sigue `PENDIENTE` y que no hay telemetría nueva para `900001`:

```bash
curl -s http://localhost:8082/api/v1/vehiculos/900001/estado | grep -o '"momentoEvento":"[^"]*"'
```

**Esperado**: ningún timestamp posterior al momento del alta (SC-005).

## 5. Confirmar el disparo en el horario planificado

Repetir el paso 3b con un `estimatedStartDateTime` ya pasado (o esperar hasta que llegue el
horario del paso 3b) y, tras un ciclo del poller (≤intervalo configurado):

```bash
docker compose exec -T timescaledb psql -U postgres -d agrolink_telemetria \
  -c "SELECT trip_code, estado FROM ingesta.viaje_programado WHERE trip_code = 'QUICKSTART-002';"
```

**Esperado**: `estado = 'DISPARADO'`.

```bash
curl -s -w '\nHTTP_STATUS:%{http_code}\n' http://localhost:8082/api/v1/vehiculos/900001/estado
```

**Esperado**: `HTTP_STATUS:200` con `dispositivo.momentoEvento` de hace menos de un ciclo del
daemon de `simulador-viajes` (SC-001).

## 6. Reprogramar y cancelar (FR-009/FR-010)

```bash
curl -s -w '\nHTTP_STATUS:%{http_code}\n' -X PUT \
  http://localhost:8082/api/v1/vehiculos/900001/viajes-simulados/QUICKSTART-003 \
  -H 'Content-Type: application/json' \
  -d '{"estimatedStartDateTime": "2026-10-13T09:00:00"}'
```

**Esperado**: `404` si `QUICKSTART-003` no existe todavía (crear primero vía paso 3b);
`200` con el nuevo horario si existe y sigue `PENDIENTE`.

```bash
curl -s -w '\nHTTP_STATUS:%{http_code}\n' -X DELETE \
  http://localhost:8082/api/v1/vehiculos/900001/viajes-simulados/QUICKSTART-003
```

**Esperado**: `204`, y la fila en la base pasa a `estado = 'CANCELADO'` (no se borra).

## 7. Simular una falla del servicio de simulación (User Story 2)

```bash
cd deploy && docker compose stop simulador-viajes
```

Repetir el paso 3b con un horario inmediato (`estimatedStartDateTime` en el pasado) y, tras un
ciclo del poller:

```bash
docker logs agrolink-ingesta --since 2m | grep -i "viaje_programado\|simulador-viajes"
```

**Esperado**: una línea de log con el error de conexión (FR-005); la fila queda en
`estado = 'ERROR'` con `ultimo_error` poblado; `curl` contra `POST /api/v1/trips` en
AgroLinkBackend (no mostrado acá — repo separado) sigue devolviendo `201` normalmente (FR-004,
SC-003).

```bash
cd deploy && docker compose start simulador-viajes
```
