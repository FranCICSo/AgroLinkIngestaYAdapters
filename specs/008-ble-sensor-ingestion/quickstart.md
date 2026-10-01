# Phase 1 — Quickstart & Validación: Ingesta de lecturas de sensores BLE

**Feature**: `008-ble-sensor-ingestion` | **Date**: 2026-09-27

Guía de validación de punta a punta sin hardware BLE. Requiere el entorno de la feature
[001](../001-ingesta-adaptacion-telemetria/quickstart.md) (stack de `deploy/compose.yaml`).
La validación con un sensor real está en `docs/guias/configuracion-sensor-ble.md` (FR-013).

---

## 1. Tests unitarios (Principio VIII)

```bash
cd rinho-receptor && npm test
```

**Esperado**, además de que todos los tests previos sigan pasando sin cambios (SC-002):

| Test | Casos |
|------|-------|
| `bleSection.test.js` | pares completos; `T0=` vacío; segmento vacío; clave sin `=` |
| `lecturaMapper.test.js` | BLE completo → tres valores y `COMPLETA`; sin segmento → `NULL` y **sin** `PARCIAL` por BLE; `T0=` → `PARCIAL` con `bleTemperaturaC`; `T0=abc`, `T0=0x1A`, `T0=1e3` → `NULL` + faltante; `T0=0` → `0` (SC-003); `T0=900` → 900; claves `T1`/`X0` ignoradas |
| `frame.test.js` | `REQ<gps>;;T0=1;ID=..` conserva el CAN vacío intermedio; la trama de referencia del fabricante sigue igual |
| `udpServer.test.js` (`handleFrame`) | trama con BLE → `persist` recibe los tres valores y el ACK sale al origen; sin BLE → ACK igual; `persist` falla → sin ACK |
| `lecturaRepository.integration.test.js` | solo con base disponible (se salta si no): las columnas `ble_*` vuelven con los valores insertados, sin corrimiento de placeholders |
| `bodySections.test.js` (`splitBody`) | 1, 2, 3 y 4 segmentos (el 4º se ignora con warn); CAN vacío con BLE presente |

## 2. Esquema

Volumen nuevo: `deploy/db/01-schema.sql` ya trae las columnas. Volumen existente: el
pipeline aplica `deploy/migrations/003_add_ble_sensor_fields.sql`; a mano:

```bash
deploy/scripts/apply-migrations.sh deploy/compose.yaml deploy/migrations POSTGRES_DB
docker compose -f deploy/compose.yaml exec timescaledb \
  psql -U postgres -d agrolink_telemetria -c "\d telemetria.lectura_telemetria" | grep ble_
```

**Esperado**: `ble_temperatura_c`, `ble_humedad_pct` y `ble_bateria`, las tres `numeric`
y nullable. Una segunda ejecución del script no hace nada (idempotente).

## 3. Trama con segmento BLE, de punta a punta

```bash
cd rinho-receptor
FRAME=$(node test/tools/buildFrame.js --device-id 2326 --msg-num 0012 \
  --can "1=,2=,3=,B=,14=,15=,2A=,2C=" --ble "T0=23.5,H0=45.0,B0=3012")
printf '%s' "$FRAME" | nc -u -w1 <host> <puerto>
```

**Esperado**:
- El receptor devuelve ACK por `#0012`, igual que con un EQ.
- Consulta:

  ```sql
  SELECT ble_temperatura_c, ble_humedad_pct, ble_bateria, estado_interpretacion,
         campos_faltantes, datos_can, payload_crudo
  FROM telemetria.lectura_telemetria
  WHERE dispositivo_id = '2326' ORDER BY momento_recepcion DESC LIMIT 1;
  ```

  → `23.5 | 45.0 | 3012`. `datos_can` sin claves `T0`/`H0`/`B0`, y `payload_crudo`
  idéntico a `$FRAME` (SC-001, SC-004).

## 4. Regresión: trama EQ sin segmento BLE

Reenviar la trama real de referencia (`rinho-eq-frame.md` §5-bis).

**Esperado**: los mismos valores que antes de la feature, las tres columnas `ble_*` en
`NULL`, `estado_interpretacion = COMPLETA` y ningún `ble*` en `campos_faltantes`
(FR-003, FR-007).

## 5. Valor inválido: evidencia, no descarte

Repetir §3 con `--ble "T0=abc,H0=45.0,B0="`.

**Esperado**: la lectura se persiste con ACK, `ble_temperatura_c` y `ble_bateria` en
`NULL`, `ble_humedad_pct = 45.0`, `PARCIAL`, y `campos_faltantes` con `bleTemperaturaC` y
`bleBateria` (FR-006, SC-005).
