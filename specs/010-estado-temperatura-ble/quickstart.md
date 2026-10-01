# Phase 1 — Quickstart & Validación: Temperatura del sensor BLE en la consulta de estado

**Feature**: `010-estado-temperatura-ble` | **Date**: 2026-09-29

Requiere el stack de la feature 001 levantado y la migración `003_add_ble_sensor_fields.sql`
(feature 008) ya aplicada — sin ella la columna `ble_temperatura_c` no existe.

---

## 1. Tests unitarios (Principio VIII)

```bash
mvn test  # no se versiona mvnw; requiere Maven instalado localmente
```

**Esperado**: `EstadoVehiculoServiceTest` cubre los dos casos de `bleTemperaturaC`
(research.md D-05): lectura con el valor presente → `canBus.bleTemperaturaC` con ese
mismo valor; lectura con la columna en `null` → `canBus.bleTemperaturaC` en `null`, sin
que el resto de la respuesta cambie.

## 2. Con temperatura de sensor BLE presente

Enviar por UDP una trama con segmento BLE (ver
[`008-ble-sensor-ingestion/quickstart.md` §3](../008-ble-sensor-ingestion/quickstart.md)):

```bash
cd rinho-receptor
FRAME=$(node test/tools/buildFrame.js --device-id 2326 \
  --can "1=,2=,3=,B=,14=,15=,2A=,2C=" --ble "T0=4.2,H0=80,B0=3012")
printf '%s' "$FRAME" | nc -u -w1 <IP_VM> <PUERTO_UDP>
```

Consultar el estado:

```bash
curl -s "http://localhost:${VEHICULO_ESTADO_HTTP_PORT}/api/v1/vehiculos/2326/estado" | jq '.canBus.bleTemperaturaC'
```

**Esperado**: `4.2` (contrato completo en
[`contracts/agrolink-vehiculo-estado-api.yaml`](./contracts/agrolink-vehiculo-estado-api.yaml)).
El resto de `canBus` y de `dispositivo` responde igual que antes de esta feature.

## 3. Sin temperatura de sensor BLE (caso normal hoy)

Enviar la trama oficial del fabricante, sin segmento BLE (ver
[feature 001 §5](../001-ingesta-adaptacion-telemetria/contracts/rinho-eq-frame.md)), y
repetir la consulta.

**Esperado**: `canBus.bleTemperaturaC` es `null` — nunca `0` ni el campo ausente del JSON
(FR-002, SC-003). `dispositivo.estadoInterpretacion` no se ve afectado por esta ausencia
(comportamiento ya establecido en la feature 008: la falta del segmento BLE no degrada la
lectura a `PARCIAL`).

## 4. Regresión (SC-004)

```bash
curl -s "http://localhost:${VEHICULO_ESTADO_HTTP_PORT}/api/v1/vehiculos/2326/estado" | jq '.canBus'
```

**Esperado**: los nueve campos ya existentes de `canBus` (§2/§3 más arriba) tienen
exactamente los mismos valores que producían antes de esta feature; `bleTemperaturaC` es
el único campo nuevo.

## 5. Lectura histórica (previa a la feature 008)

Consultar el estado de un `dispositivoId` cuya última lectura sea anterior a la migración
`003` (columna `ble_temperatura_c` inexistente en esa fila, o `NULL` por defecto).

**Esperado**: `canBus.bleTemperaturaC` es `null`; el resto de la respuesta no cambia.
