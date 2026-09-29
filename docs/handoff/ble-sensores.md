# Handoff: incorporación de datos de sensores BLE (Rinho Spider IoT)

> **Estado**: implementado en [`specs/008-ble-sensor-ingestion/`](../../specs/008-ble-sensor-ingestion/spec.md);
> guía operativa en [`docs/guias/configuracion-sensor-ble.md`](../guias/configuracion-sensor-ble.md).
> Este documento queda como registro del análisis original.

Contexto traído de una sesión de análisis previa (2026-09-26). No hay sensor físico todavía:
el objetivo es dejar el receptor **preparado** para recibir datos BLE, sin inventar datos.

## Cómo llegan los datos BLE al servidor (según docs.rinho.com.ar)

- `SBS` solo guarda la última lectura en el equipo (slots `BS00`–`BS03`). **Nada se envía solo.**
- Ningún reporte estándar de `G` (incluido `GEQ`) lleva BLE. Hay que usar **reporte de usuario**:
  `SUC` (plantilla) + `GUn` (lo genera y lo envía) + reglas `SRL` (cuándo).
- Fuente más confiable: la config probada `docs.rinho.com.ar/configuraciones/sensor-condition-ble`:

  ```text
  >SBS00E,D44A85BF3DD5,10,120,0<
  >SUC00 $RHQ| #| QHQ,5|$temp:| QBS00.temp,0|$hum:| QBS00.hum,0|$bat:| QBS00.batt,0<
  >SRL00E;TRG=TD00+;CND=IGN;ACC={GU000H;@LOG}<
  ```
  Salida: `RHQ00<pos HQ>,temp:23.5,hum:45.0,bat:3012`

- En `SUC`: los campos se unen con coma salvo que lleven espacio inicial; `$texto` es literal;
  `#` es el nº de evento; `\3B` = `;`, `\2C` = `,`. Límite: 239 bytes, 20 tokens EVAL.

## Diseño propuesto

UC que emula EQ + un segmento BLE extra:

```text
>SUC00 $REQ| #| QEQ,5| $\3BT0=| QBS00.temp,0| $\2CH0=| QBS00.hum,0| $\2CB0=| QBS00.batt,0<
```
Trama esperada:
```text
>REQ<evt><gps 64>;1=,2=,...,2C=;T0=23.5,H0=45.0,B0=3012;#0012;ID=...;*CS<
```

- El segmento BLE es **opcional**: sin él (tramas EQ reales de hoy) las columnas quedan `NULL`.
- Valor vacío (`T0=`) = sin lectura → `NULL` (misma regla que CAN `ID=`).
- **No** inyectar datos dummy en el parser (rompe Principio IX: `payload_crudo` dejaría de
  respaldar los valores). Probar con tramas fixture en tests.

## Cambios en rinho-receptor

1. `src/net/udpServer.js` `splitBody`: hoy toma todo lo que sigue al primer `;` como CAN; con un
   tercer segmento `parseCanSection` recibiría `1=...;T0=...`. Separar GPS / CAN / BLE.
2. Nuevo `src/protocol/bleSection.js` + campos en `lecturaMapper`.
3. Migración `003` con columnas nullable (p. ej. `temperatura_c`, `humedad_pct`,
   `bateria_sensor_mv`). Si se prevén varios sensores por vehículo (hasta 4), mejor tabla hija
   por (lectura, slot). Ojo: existe `deploy/migrations/002_add_can_fields.sql` sin trackear.
4. `test/tools/buildFrame.js`: opción `ble` para generar tramas con el segmento.
5. Corregir `specs/001-.../contracts/rinho-eq-frame.md` §1: `;@dd..dd` de `GEQ` es el
   **destino** (GPRS, LOG, SMx…), no "campos de datos personalizados".

## A verificar con hardware (no confiar en la doc)

- La guía `guias/sensores-ble` se contradice: envía el UC con `GCQ04H` (eso genera un CQ
  estándar; lo correcto es `GU4..`) y usa una sintaxis `$;PA=temp:2:` que no aparece en la
  config probada.
- Unidades: `batt` figura como % en la guía y como mV (3012) en la config. `SUV` usa temp ×10.
- Con `>QU0<`: que `QEQ,5` devuelva GPS+CAN sin `;ID=`/checksum propios, y que el total no
  pase de 239 bytes (~190 con VIN completo y 1 sensor).
- Que los reportes `GU` por TAIP UDP lleven `#msgNum` (para el ACK).

## Siguiente paso sugerido

`/speckit-specify` para la feature "receptor acepta segmento BLE opcional + migración".
