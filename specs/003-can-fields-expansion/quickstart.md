# Phase 1 — Quickstart & Validación: Exposición estructurada de campos CAN bus

**Feature**: `003-can-fields-expansion` | **Date**: 2026-09-13 (revisado tras Clarifications)

Guía de validación end-to-end. Requiere el entorno de las features
[001-ingesta-adaptacion-telemetria](../001-ingesta-adaptacion-telemetria/quickstart.md) y
[002-vehicle-status-by-domain](../002-vehicle-status-by-domain/quickstart.md) ya levantado.

---

## 0. Prerrequisitos

| Requisito | Detalle |
|-----------|---------|
| Entorno | Stack de `deploy/compose.yaml` corriendo (`timescaledb`, `rinho-receptor`, `agrolink-ingesta`) |
| Esquema | `telemetria.lectura_telemetria` con las columnas `vin`, `rpm`, `combustible_consumido_l`, `temperatura_refrigerante_c` y `presion_aceite_kpa` (ver §1) |

---

## 1. Aplicar el cambio de esquema

Si el volumen de Postgres es **nuevo**, `deploy/db/01-schema.sql` ya incluye las cinco
columnas — no se necesita ningún paso manual.

Si el volumen ya existía antes de esta feature, aplicar el `ALTER TABLE` manualmente:

```bash
docker compose exec timescaledb psql -U postgres -d agrolink_telemetria -c "
ALTER TABLE telemetria.lectura_telemetria
    ADD COLUMN IF NOT EXISTS vin                        VARCHAR(20),
    ADD COLUMN IF NOT EXISTS rpm                         SMALLINT,
    ADD COLUMN IF NOT EXISTS combustible_consumido_l     NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS temperatura_refrigerante_c  SMALLINT,
    ADD COLUMN IF NOT EXISTS presion_aceite_kpa          SMALLINT;
"
```

Verificar:

```bash
docker compose exec timescaledb psql -U postgres -d agrolink_telemetria \
  -c "\d telemetria.lectura_telemetria" | grep -E "vin|rpm|combustible_consumido_l|temperatura_refrigerante_c|presion_aceite_kpa"
```

**Esperado**: las cinco columnas listadas, nullable.

---

## 2. Tests unitarios (Principio VIII)

No requieren el entorno levantado.

```bash
# Receptor: resolvers de VIN/RPM/combustible consumido/2A/2C
cd rinho-receptor && npm test

# Servicio de lectura: DatosCanCrudoReader + EstadoVehiculoService reestructurado
mvn test  # no se versiona mvnw; requiere Maven instalado localmente
```

**Esperado**: `lecturaMapper.test.js` ya no contiene el test que afirmaba el descarte del
VIN (reemplazado — el VIN ahora se captura). La trama oficial del fabricante con CAN
poblado (`1=1M8GDM9A_KP042788,2=2200,...,2A=90,2C=340`) produce
`lectura.vin === '1M8GDM9A_KP042788'`, `lectura.rpm === 2200`,
`lectura.combustibleConsumidoL === 30000`, `lectura.temperaturaRefrigeranteC === 90`,
`lectura.presionAceiteKpa === 340`, y `lectura.datosCan` solo conserva la clave `"3"`
(velocidad de rueda). Del lado Java, `DatosCanCrudoReaderTest` cubre clave presente,
clave ausente y valor no numérico.

---

## 3. Recibir una trama con todos los valores y consultar el estado

Enviar por UDP la trama de referencia con el bloque CAN completo (ver
[`contracts/rinho-eq-frame.md`](../001-ingesta-adaptacion-telemetria/contracts/rinho-eq-frame.md)
§5-bis):

```bash
FRAME='>REQ00210918170359-2778100-064258570001517F000000000049D13010900001516;1=1M8GDM9A_KP042788,2=2200,3=45,B=66010,14=30000,15=75,2A=90,2C=340;ID=037883;*01<'

printf '%s' "$FRAME" | nc -u -w2 <IP_VM> <PUERTO_UDP>
```

Consultar el estado del vehículo:

```bash
curl -s "http://localhost:${VEHICULO_ESTADO_HTTP_PORT}/api/v1/vehiculos/037883/estado" | jq '.canBus, .dispositivo'
```

**Esperado** (contrato completo en
[`contracts/agrolink-vehiculo-estado-api.yaml`](./contracts/agrolink-vehiculo-estado-api.yaml)):

```json
{
  "vin": "1M8GDM9A_KP042788",
  "rpm": 2200,
  "velocidadRuedaKmh": 45,
  "odometroM": 66010000,
  "odometroOrigen": "ECU",
  "combustibleConsumidoL": 30000.0,
  "combustiblePct": 75.0,
  "temperaturaRefrigeranteC": 90,
  "presionAceiteKpa": 340,
  "tensionBateriaV": 0.0
}
```

seguido de `dispositivo` (que ya **no** debe incluir `tensionBateriaV`):

```json
{
  "dispositivoId": "037883",
  "momentoEvento": "2018-09-21T17:03:59Z",
  "...": "...",
  "satelites": 9,
  "estadoInterpretacion": "COMPLETA",
  "camposFaltantes": []
}
```

- El campo `datosCanCrudos` **no debe existir** en `canBus` (FR-007).
- El campo `tensionBateriaV` **no debe existir** en `dispositivo` — solo en `canBus`
  (FR-009).

Confirmar en base que los cinco identificadores promovidos ya no se duplican dentro de
`datos_can` para esta fila (solo debe quedar `"3"`):

```bash
docker compose exec timescaledb psql -U postgres -d agrolink_telemetria -c "
SELECT vin, rpm, combustible_consumido_l, temperatura_refrigerante_c, presion_aceite_kpa, datos_can
FROM telemetria.lectura_telemetria
WHERE dispositivo_id = '037883'
ORDER BY momento_evento DESC LIMIT 1;
"
```

**Esperado**: las cinco columnas pobladas con los valores de la trama, y `datos_can` con
una única clave (`"3": "45"`).

### ✅ Criterio US1 / US2 (feature 003) / SC-001, SC-003, SC-005

---

## 4. Casos a ejercitar explícitamente

| Caso | Cómo provocarlo | Respuesta esperada |
|------|------------------|---------------------|
| Sensor no reportado (FR-010) | Trama con `1=,2=,14=,2A=,2C=` (vacíos) | Los cinco campos correspondientes en `canBus` en `null`, nunca `0` ni cadena vacía |
| Ningún dato CAN reportado | Trama oficial del fabricante sin fix GPS ni CAN (ver [feature 001 §3](../001-ingesta-adaptacion-telemetria/quickstart.md)) | Los nueve campos de `canBus` en `null`; el resto de la respuesta se comporta igual que en la feature 002 |
| Lectura histórica previa a esta feature | Consultar un `dispositivoId` cuya última lectura sea anterior al `ALTER TABLE` de §1 | Los cinco campos nuevos en `null` (columna `NULL` por definición); el resto responde con normalidad |
| Respuesta ya no trae bloque crudo | Cualquier consulta de estado | La clave `datosCanCrudos` no aparece en `canBus` |
| Tensión de batería reubicada | Cualquier consulta de estado | `dispositivo` no tiene la clave `tensionBateriaV`; `canBus` sí |

```bash
curl -s "http://localhost:${VEHICULO_ESTADO_HTTP_PORT}/api/v1/vehiculos/037883/estado" \
  | jq '.canBus | has("datosCanCrudos"), (.dispositivo | has("tensionBateriaV"))'
# esperado: false
false
```

### ✅ Criterio SC-002, SC-004, SC-005

---

## Resumen de trazabilidad

| Escenario | User Story | Criterios |
|-----------|-----------|-----------|
| §1 Cambio de esquema | — (research.md D-01) | Prerrequisito de US1 |
| §2 Tests unitarios | — | Principio VIII |
| §3 Trama completa → estado con 9 campos nombrados en canBus | US1, US2 | FR-001 a FR-008, SC-001, SC-003, SC-005 |
| §4 Casos límite (no informado, histórico, sin campo crudo, tensión reubicada) | US1, US2 | FR-009, FR-010, SC-002, SC-004, SC-005 |
