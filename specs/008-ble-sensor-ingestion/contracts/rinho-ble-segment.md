# Contrato de entrada: segmento BLE en el reporte de usuario del Rinho Spider IoT

**Feature**: `008-ble-sensor-ingestion` | **Date**: 2026-09-27

Amplía [`rinho-eq-frame.md`](../../001-ingesta-adaptacion-telemetria/contracts/rinho-eq-frame.md):
el envelope, el checksum, la sección GPS y la sección CAN no cambian. Es la referencia
normativa de `protocol/bleSection.js` y de `splitBody` en `net/udpServer.js`.

> ⚠️ **Estado de verificación**: se diseñó a partir de la documentación del fabricante
> (`docs.rinho.com.ar`, config `sensor-condition-ble`) y **no se verificó con un sensor
> físico**. Ver §5.

---

## 1. De dónde sale

Ningún reporte estándar (`G..`, incluido `GEQ`) lleva datos BLE. `SBS` solo guarda la
última lectura de cada sensor en el equipo (slots `BS00`–`BS03`). Para que lleguen al
servidor hay que definir un **reporte de usuario**:

| Comando | Rol |
|---------|-----|
| `SBS00E,<MAC>,...` | Empareja el sensor BLE en el slot 0 |
| `SUC00 <plantilla>` | Define el texto del reporte de usuario 00 |
| `SRL..` con acción `GU000H` | Regla que decide **cuándo** se genera y envía |

Plantilla que emula EQ y agrega el segmento BLE:

```text
>SUC00 $REQ| #| QEQ,5| $\3BT0=| QBS00.temp,0| $\2CH0=| QBS00.hum,0| $\2CB0=| QBS00.batt,0<
```

Reglas de `SUC`: los tokens con espacio inicial se concatenan sin coma; `$texto` es un
literal; `#` es el número de evento; `\3B` es `;` y `\2C` es `,`. Límite: 239 bytes y 20
tokens EVAL. La configuración paso a paso está en `docs/guias/configuracion-sensor-ble.md`.

## 2. Envelope resultante

```text
>REQ<sección GPS 66><;sección CAN><;segmento BLE>[;#<msgNum>];ID=<deviceId>;*<checksum><
```

Ejemplo:

```text
>REQ<gps 66>;1=,2=,3=,B=,14=,15=,2A=,2C=;T0=23.5,H0=45.0,B0=3012;#0012;ID=2326;*CS<
```

## 3. Identificación de segmentos: por posición

Después de quitar `#msgNum` e `ID=`, el body se separa por `;`:

| Posición | Segmento | Si falta |
|----------|----------|----------|
| 0 | GPS (66 caracteres después de `REQ`) | trama rechazada (fallo de parseo, con log) |
| 1 | CAN | CAN vacío |
| 2 | BLE | sin segmento BLE (caso normal de un EQ estándar) |
| ≥ 3 | inesperado | se ignora y se registra `log.warn` con la trama cruda |

Los segmentos vacíos intermedios **conservan su posición**: `REQ<gps>;;T0=1` tiene CAN
vacío y BLE `T0=1`.

> ⚠️ El segmento BLE **no se puede** reconocer por sus claves: `B` y `B0` también son IDs
> CAN válidos (hex de 1–2 caracteres).

## 4. Formato del segmento BLE

Pares `CLAVE=VALOR` separados por `,`. La clave es una letra de magnitud más el número
de slot:

| Clave | Magnitud | Unidad | Destino |
|-------|----------|--------|---------|
| `T0` | Temperatura | °C | `ble_temperatura_c` |
| `H0` | Humedad relativa | % | `ble_humedad_pct` |
| `B0` | Batería del sensor | **sin confirmar** (% o mV) | `ble_bateria` (valor crudo) |
| `T1`–`T3`, `H1`–`H3`, `B1`–`B3` | slots 1–3 | — | se ignoran (solo `payload_crudo`) |
| otra | — | — | se ignora |

| Regla | Detalle |
|-------|---------|
| Valor vacío (`T0=`) | sin lectura: `NULL` + `campos_faltantes` |
| Valor válido | `^-?\d+(\.\d+)?$` |
| Valor no válido | `NULL` + `campos_faltantes`; la trama se persiste igual |
| Fuera de rango físico | se persiste tal cual |

## 5. Supuestos pendientes de verificación con hardware

| # | Supuesto | Cómo se ve si es falso |
|---|----------|------------------------|
| H-1 | `#` + `QEQ,5` producen exactamente la sección GPS de 66 caracteres | fallo de parseo "largo distinto de 66" en el log |
| H-2 | `QEQ,5` incluye la sección CAN | los pares BLE aparecen en `datos_can` y las columnas `ble_*` quedan en `NULL` |
| H-3 | `QEQ,5` no agrega su propio `;ID=` ni checksum | trama rechazada por checksum o por `ID` |
| H-4 | El reporte `GU` por UDP lleva `#msgNum` | lecturas persistidas sin ACK (log "sin msgNum") |
| H-5 | `batt` en mV (config probada: `3012`) o en % (guía) | solo documentación: `ble_bateria` es crudo |
| H-6 | `QBS00.temp,0` manda °C con decimales, no ×10 | temperaturas 10× mayores a lo esperable |
| H-7 | La trama entra en 239 bytes con VIN completo y 1 sensor (~190) | el equipo trunca o rechaza el `SUC` |
| H-8 | La guía `guias/sensores-ble` del fabricante está mal (`GCQ04H`, sintaxis `$;PA=`); la config probada es la correcta | ninguna trama con segmento BLE |
