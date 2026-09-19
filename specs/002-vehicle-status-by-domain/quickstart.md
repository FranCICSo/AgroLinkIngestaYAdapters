# Phase 1 — Quickstart & Validación: Consulta de Estado de Vehículo por Identificador de Dispositivo IoT

**Feature**: `002-vehicle-status-by-domain` | **Date**: 2026-09-09

Guía de validación end-to-end. Requiere el entorno de la feature
[001-ingesta-adaptacion-telemetria](../001-ingesta-adaptacion-telemetria/quickstart.md) ya
levantado (`docker compose up -d` desde `deploy/`), con al menos una lectura de telemetría
persistida para un `dispositivoId` conocido.

---

## 0. Prerrequisitos

| Requisito | Detalle |
|-----------|---------|
| Entorno | Stack de `deploy/compose.yaml` corriendo (`timescaledb`, `rinho-receptor`, `agrolink-ingesta`) |
| Datos | Al menos una fila en `telemetria.lectura_telemetria` para un `dispositivo_id` de prueba (ver §3 de la [guía de la feature 001](../001-ingesta-adaptacion-telemetria/quickstart.md) para simular una trama) |
| Variable de entorno nueva | `VEHICULO_ESTADO_HTTP_PORT` definida en `deploy/.env` (ver `.env.example`) |

---

## 1. Verificar la separación de puertos (research.md D-01)

```bash
docker compose ps
```

**Esperado**: `agrolink-ingesta` publica **un solo puerto** al host —
`VEHICULO_ESTADO_HTTP_PORT` — y sigue **sin** publicar `REPORTES_HTTP_PORT`. El reporte de
viaje (`/api/v1/reportes/viaje`) sigue siendo alcanzable solo desde dentro de la red del
compose, exactamente como en la feature 001.

Confirmar que el puerto nuevo **no** sirve el reporte de viaje (debe fallar):

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "http://localhost:${VEHICULO_ESTADO_HTTP_PORT}/api/v1/reportes/viaje?camionId=2326&desde=2026-08-15T00:00:00-03:00&hasta=2026-08-15T23:59:59-03:00"
# esperado: 404 (research.md D-01 — el filtro por puerto rechaza cualquier ruta que no sea
# /api/v1/vehiculos/** cuando la petición entra por VEHICULO_ESTADO_HTTP_PORT)
```

Confirmar que el puerto original, desde dentro de la red del compose, sigue sirviendo el
reporte sin cambios (no debe romper nada de la feature 001):

```bash
docker compose exec agrolink-ingesta \
  wget -qO- "http://localhost:${REPORTES_HTTP_PORT}/api/v1/reportes/viaje?camionId=2326&desde=2026-08-15T00:00:00-03:00&hasta=2026-08-15T23:59:59-03:00"
```

### ✅ Criterio SC-004 (accesibilidad externa) sin regresión sobre la feature 001

---

## 2. Consultar el estado de un vehículo conocido (User Story 1)

```bash
curl -s "http://localhost:${VEHICULO_ESTADO_HTTP_PORT}/api/v1/vehiculos/2326/estado" | jq
```

**Esperado**: `200`, con los tres bloques del contrato
([`contracts/agrolink-vehiculo-estado-api.yaml`](./contracts/agrolink-vehiculo-estado-api.yaml)):
`posicion`, `canBus`, `dispositivo`. Contrastar `dispositivo.momentoEvento` contra la
`momento_evento` más reciente de esa fila en base (FR-002, FR-006):

```bash
docker compose exec timescaledb psql -U postgres -d agrolink_telemetria -c \
  "SELECT momento_evento FROM telemetria.lectura_telemetria WHERE dispositivo_id = '2326' ORDER BY momento_evento DESC LIMIT 1;"
```

Ambos valores deben coincidir exactamente.

### ✅ Criterio US1 / SC-001 / SC-002

---

## 3. Casos a ejercitar explícitamente

| Caso | Cómo provocarlo | Respuesta esperada |
|------|------------------|---------------------|
| Identificador inexistente (FR-007/FR-008) | `dispositivoId` que nunca reportó telemetría | **404** `application/problem+json` — nunca `200` con campos en cero/null que parezca una lectura real |
| Identificador vacío (FR-009) | `GET /api/v1/vehiculos//estado` o un valor de solo espacios | **400** |
| Lectura más reciente sin fix GPS | Enviar la trama oficial del fabricante (sin fix, ver [feature 001 §3](../001-ingesta-adaptacion-telemetria/quickstart.md)) y consultar ese `dispositivoId` | **200** con `posicion.*` en `null` pero `dispositivo.estadoInterpretacion: "PARCIAL"` — la lectura se devuelve igual, no se oculta (spec, Edge Cases) |
| Orden fuera de secuencia (FR-006) | Enviar dos tramas del mismo dispositivo con `momento_evento` distinto, la más vieja **después** | La consulta sigue devolviendo la de `momento_evento` cronológicamente mayor, no la última recibida |

```bash
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:${VEHICULO_ESTADO_HTTP_PORT}/api/v1/vehiculos/NO-EXISTE-999/estado"
# esperado: 404

curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:${VEHICULO_ESTADO_HTTP_PORT}/api/v1/vehiculos/%20/estado"
# esperado: 400
```

### ✅ Criterio SC-003

---

## 4. Test unitario

No requiere el entorno levantado:

```bash
mvn test  # no se versiona mvnw; requiere Maven instalado localmente
```

Cobertura mínima esperada del servicio (`EstadoVehiculoServiceTest`): identificador con
lectura completa, identificador con lectura parcial (sin fix GPS), identificador sin
ninguna lectura (excepción → 404).

---

## Resumen de trazabilidad

| Escenario | User Story | Criterios |
|-----------|-----------|-----------|
| §1 Separación de puertos | — (FR-011) | SC-004, sin regresión sobre feature 001 |
| §2 Estado de vehículo conocido | US1 | FR-001 a FR-006, SC-001, SC-002 |
| §3 Casos límite | US1 (escenarios 3-4) | FR-007, FR-008, FR-009, SC-003 |
| §4 Test unitario | — | Principio VIII |
