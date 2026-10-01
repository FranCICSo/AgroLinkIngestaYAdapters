# Guía: puesta en marcha de un sensor BLE en el Rinho Spider IoT

Cómo configurar el equipo para que envíe las lecturas de un sensor BLE (temperatura,
humedad, batería) y cómo verificar, con una trama real, que llegan en el formato que
acepta `rinho-receptor`.

| | |
|---|---|
| Feature | [`specs/008-ble-sensor-ingestion/`](../../specs/008-ble-sensor-ingestion/spec.md) |
| Contrato de la trama | [`contracts/rinho-ble-segment.md`](../../specs/008-ble-sensor-ingestion/contracts/rinho-ble-segment.md) |
| Análisis de origen | [`docs/handoff/ble-sensores.md`](../handoff/ble-sensores.md) |
| Fuente del fabricante | `docs.rinho.com.ar/configuraciones/sensor-condition-ble` (config probada por Rinho) |

> ⚠️ **Nada de esta guía se verificó todavía con un sensor físico.** Los comandos salen
> de la documentación del fabricante, que en otras páginas se contradice
> (ver §7, H-8). El receptor ya acepta el formato de §5. Si la trama real difiere, seguir
> §8: no se "corrige" el parser a ojo.

---

## 1. Qué hace falta

- Un sensor BLE compatible con el Rinho (tipo "Sensor info", ver §2) y su **dirección MAC**
  (12 caracteres hex, sin `:`). Suele venir en una etiqueta o se lee con una app de escaneo
  BLE en el celular.
- Acceso de configuración al equipo (el canal que se use hoy para mandarle comandos `>...<`).
  El sistema AgroLink **no** envía comandos al equipo: no hay canal de bajada.
- El receptor desplegado con la feature 008 (columnas `ble_*` en la base, migración `003`).
- Acceso a los logs de `rinho-receptor` y a la base (`psql`) para §6.

## 2. Emparejar el sensor (slot 0)

```text
>SBS00E,<MAC>,10,120,0<
```

Ejemplo del fabricante: `>SBS00E,D44A85BF3DD5,10,120,0<`.

| Parte | Significado (según la página del fabricante) |
|-------|----------------------------------------------|
| `SBS00` | Configuración del sensor BLE en el slot `00`. El receptor **solo persiste el slot 0** |
| `E` | Habilitado |
| `D44A85BF3DD5` | MAC del sensor, 12 hex, sin `:` |
| `10` | Tipo 10 = "Sensor info" |
| `120` | Timeout, en segundos |
| `0` | **No documentado** en la página. Dejarlo en `0` como en el ejemplo |

`SBS` solo hace que el equipo guarde la última lectura del sensor. **No envía nada**: para
que la lectura llegue al servidor hacen falta §3 y §4.

## 3. Plantilla del reporte de usuario

La config probada del fabricante usa un reporte `HQ` con etiquetas `temp:`/`hum:`/`bat:`.
El receptor **no** acepta ese formato: espera un reporte que emula EQ, con el segmento BLE
como tercer segmento. Usar esta plantilla:

```text
>SUC00 $REQ| #| QEQ,5| $\3BT0=| QBS00.temp,0| $\2CH0=| QBS00.hum,0| $\2CB0=| QBS00.batt,0<
```

| Token | Qué produce |
|-------|-------------|
| `$REQ` | El literal `REQ`: la trama empieza igual que un EQ |
| `#` | Número de evento (debería ocupar el lugar de `AA` en la sección GPS, H-1) |
| `QEQ,5` | Contenido del reporte EQ: GPS y sección CAN (H-1, H-2, H-3) |
| `$\3BT0=` | `;T0=`: abre el segmento BLE (`\3B` = `;`) |
| `QBS00.temp,0` | Temperatura del slot 0 |
| `$\2CH0=` | `,H0=` (`\2C` = `,`) |
| `QBS00.hum,0` | Humedad del slot 0 |
| `$\2CB0=` | `,B0=` |
| `QBS00.batt,0` | Batería del slot 0 |

Reglas de `SUC`: los tokens se separan con `|`; un token con **espacio inicial** se
concatena sin coma; `$texto` es un literal; `#` es el número de evento. Límite: **239
bytes** de trama y **20 tokens EVAL**. Con VIN completo y un sensor la trama ronda los
~190 bytes (H-7): no agregar más slots sin medir.

## 4. Regla de envío

`SUC` solo define el texto. Una regla `SRL` decide cuándo se genera (`GU..`) y a dónde se
manda. Las dos primeras reglas de la config del fabricante:

```text
>SRL00E;TRG=TD00+;CND=IGN;ACC={GU000H;@LOG}<
>SRL01E;TRG=TD01+;CND=IGN!;ACC={GU001H;@LOG}<
```

Según la página, `SRL00` es periódica cada 30 s con ignición encendida y `SRL01` cada 30
min con ignición apagada. Los timers `TD00`/`TD01` se definen en otra parte de esa config.
Copiarlos de la misma página: esta guía no los reproduce.

⚠️ **El ejemplo manda el reporte a `@LOG`**, uno de los destinos posibles (junto a GPRS y
SMx, contrato EQ §1). Por el nombre parece ser el registro interno del equipo, no el envío
al servidor, pero la página no lo aclara. Para que llegue al receptor, el destino tiene
que ser el mismo canal GPRS/UDP que ya usa el EQ. A verificar: el nombre exacto de ese
destino, y si se puede combinar con `@LOG`. Tampoco está
documentado qué significan los dígitos de `GU000H`/`GU001H` (plantilla, evento, buffer):
probar primero con una sola regla.

## 5. Trama esperada por el receptor

```text
>REQ<sección GPS 66>;<sección CAN>;T0=23.5,H0=45.0,B0=3012;#0012;ID=<deviceId>;*<CS><
```

- La sección GPS tiene exactamente **66 caracteres** después de `REQ` (contrato EQ §3).
- La sección CAN es la misma del EQ (`1=,2=,...,2C=`); puede venir con valores vacíos.
- El segmento BLE es el **tercero**. El receptor lo identifica por posición, no por las
  claves (`B0` también es un ID CAN).
- `T0=` vacío es "sin lectura": se guarda `NULL`, nunca 0.
- Unidades esperadas: `T0` °C, `H0` % y `B0` mV según la config del fabricante (otra guía
  del fabricante dice %). El receptor guarda `B0` crudo en `ble_bateria`, sin conversión.

Para generar una trama igual sin hardware:

```bash
cd rinho-receptor
node test/tools/buildFrame.js --device-id 2326 --msg-num 0012 \
  --can "1=,2=,3=,B=,14=,15=,2A=,2C=" --ble "T0=23.5,H0=45.0,B0=3012"
```

## 6. Capturar una trama real y compararla

1. **Consultar el reporte en el equipo**: `>QU0<` devuelve el texto que genera el reporte
   de usuario, sin esperar a la regla. Compararlo carácter a carácter con §5.
2. **Ver qué recibió el receptor** en sus logs:
   - `Trama rechazada: fallo de parseo`: la sección GPS no mide 66 (H-1).
   - `Trama rechazada: checksum invalido` o `sin ID de dispositivo valido` → H-3.
   - `Trama con segmentos inesperados en el body` → hay más de 3 segmentos. El formato
     difiere de §5.
   - `Lectura persistida sin msgNum` → falta `#msgNum`, sin ACK (H-4).
3. **Ver qué se guardó**:

   ```sql
   SELECT momento_evento, ble_temperatura_c, ble_humedad_pct, ble_bateria,
          estado_interpretacion, campos_faltantes, datos_can, payload_crudo
   FROM telemetria.lectura_telemetria
   WHERE dispositivo_id = '<deviceId>'
   ORDER BY momento_recepcion DESC LIMIT 5;
   ```

   Correcto: `ble_*` con los valores del sensor, `datos_can` sin claves `T0`/`H0`/`B0`, y
   ningún `ble*` en `campos_faltantes`.

## 7. Checklist de verificación con hardware

Marcar cada punto con la trama real. El detalle está en el contrato, §5.

| # | Verificar | Cómo se ve si falla | Qué hacer |
|---|-----------|---------------------|-----------|
| H-1 | `#` + `QEQ,5` dan exactamente la sección GPS de 66 | log "fallo de parseo" | Ajustar la plantilla (§3) antes que el parser |
| H-2 | `QEQ,5` incluye la sección CAN | `T0`/`H0`/`B0` en `datos_can`, `ble_*` en `NULL` | Ídem |
| H-3 | `QEQ,5` no agrega su propio `;ID=`/checksum | trama rechazada por checksum o `ID` | Ídem |
| H-4 | El reporte `GU` por UDP lleva `#msgNum` | lecturas sin ACK, el equipo reintenta | Revisar la regla/destino (§4) |
| H-5 | Unidad de `batt`: mV (config, `3012`) o % | valores ~3000 o ~0–100 | Solo documentar. `ble_bateria` es crudo |
| H-6 | `temp` en °C con decimales, no ×10 | temperaturas 10× mayores | Nueva feature (conversión) |
| H-7 | La trama entra en 239 bytes | el equipo rechaza el `SUC` o trunca | Acortar la plantilla |
| H-8 | La guía `guias/sensores-ble` del fabricante está mal (`GCQ04H`, sintaxis `$;PA=`), y la config probada es la correcta | sin tramas con segmento BLE | Usar solo la config probada |
| — | Destino de la regla: envío por GPRS, no solo `@LOG` | nada llega al receptor | §4 |

## 8. Si el formato real difiere

1. Guardar la trama real (`payload_crudo`) como fixture.
2. Abrir una feature nueva (`/speckit-specify`) con esa trama como evidencia: no ajustar el
   parser sin contrato.
3. En la misma entrega, actualizar juntos: `rinho-receptor/src/protocol/bleSection.js` y/o
   `bodySections.js`, el contrato `rinho-ble-segment.md`, esta guía (FR-013) y la
   memoria/notas del proyecto con lo aprendido.

Las lecturas ya guardadas no se corrigen (Principio IV): `payload_crudo` permite
reinterpretarlas en una tabla o vista nueva si hiciera falta.
