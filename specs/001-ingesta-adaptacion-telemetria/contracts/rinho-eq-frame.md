# Contrato de entrada: trama EQ del Rinho Spider IoT

**Feature**: `001-ingesta-adaptacion-telemetria` | **Date**: 2026-08-15

Contrato del **protocolo de entrada** que consume `rinho-receptor` por UDP. Es un contrato
externo: lo define el fabricante, no AgroLink. Este documento es la referencia normativa
para `protocol/frame.js`, `protocol/eqParser.js` y `protocol/canObd.js`.

**Fuente**: documentación de protocolo del fabricante (`docs.rinho.com.ar`, reporte EQ),
más el envelope y el checksum validados contra hardware real en `../rinho-udp-server`.

> ⚠️ **Estado de verificación**: el layout de abajo está verificado contra el ejemplo
> literal publicado por el fabricante (ver §5), **no contra el dispositivo físico**. Es el
> riesgo R-1 de [research.md](../research.md). Confirmar con captura real antes de dar por
> buena ninguna fila persistida.

---

## 1. Configuración del dispositivo

El equipo se configura con el comando **`GEQ`** para emitir reportes extendidos EQ:

```text
GEQbbc[;@dd..dd]
```

| Parámetro | Significado |
|-----------|-------------|
| `bb` | Número de reporte (`00`–`FF` hex) |
| `c` | Código de buffer (un carácter) |
| `dd..dd` | Campos de datos personalizados (opcional) |

Disponible desde firmware v1.00.00 en las plataformas Spider IoT y Smart IoT.

---

## 2. Envelope

```text
>REQ<sección GPS: 66 chars><;sección CAN>[;#<msgNum>];ID=<deviceId>;*<checksum><
```

| Elemento | Regla |
|----------|-------|
| `>` … `<` | Delimitadores de trama |
| `;#<msgNum>` | **Opcional**. 4 chars hex. `0x0000–0x7FFF` = dato del equipo que espera ACK; `≥ 0x8000` = ACK del equipo a un comando del servidor (fuera de alcance: no hay downlink) |
| `;ID=<deviceId>` | **Obligatorio**. Sin él la trama se rechaza (FR-013) |
| `*<checksum>` | XOR byte a byte de todo el string desde `>` hasta el `*` **inclusive**, en 2 dígitos hex mayúsculas |

Un datagrama UDP puede contener **más de una trama**; el receptor debe iterar todas.

### Checksum (algoritmo validado en producción)

```js
let cs = 0;
for (const ch of frameHastaElAsterisco) cs ^= ch.charCodeAt(0);
const hex = cs.toString(16).toUpperCase().padStart(2, '0');
```

---

## 3. Sección GPS base (66 caracteres de ancho fijo)

Inmediatamente después de `>REQ`. La suma de los anchos de los 19 campos es **66**, y ese
total está verificado contra dos tramas independientes (§5 y §5-bis), ambas cerrando exacto
sin sobrante.

> ⚠️ **Corrección**: revisiones anteriores de este documento decían "49 caracteres". Era un
> error de conteo, no un cambio de protocolo: la tabla de campos siempre estuvo bien, el
> total no. Un parser que reserve 49 desplazaría **todo** desde el odómetro en adelante y
> produciría filas plausibles pero falsas. El ancho correcto es 66; la comprobación barata
> es que el layout cierre sin sobrante, y por eso es un test (T030).

| Offset | Campo | Largo |
|--------|-------|-------|
| 0–1 | `AA` | 2 |
| 2–7 | `BBBBBB` | 6 |
| 8–13 | `CCCCCC` | 6 |
| 14–21 | `DDDDDDDD` | 8 |
| 22–30 | `EEEEEEEEE` | 9 |
| 31–33 | `FFF` | 3 |
| 34–36 | `GGG` | 3 |
| 37–38 | `HH` | 2 |
| 39–40 | `II` | 2 |
| 41–43 | `JJJ` | 3 |
| 44–51 | `KKKKKKKK` | 8 |
| 52 | `L` | 1 |
| 53 | `M` | 1 |
| 54–55 | `NN` | 2 |
| 56–57 | `OO` | 2 |
| 58–61 | `PPPP` | 4 |
| 62 | `Q` | 1 |
| 63 | `R` | 1 |
| 64–65 | `SS` | 2 |

| # | Campo | Largo | Contenido | Transformación al dominio |
|---|-------|-------|-----------|---------------------------|
| 1 | `AA` | 2 | Nº de reporte (hex) | → `reporte_id` |
| 2 | `BBBBBB` | 6 | Fecha `DDMMYY` | ver §3.1 |
| 3 | `CCCCCC` | 6 | Hora `HHMMSS` (UTC) | ver §3.1 |
| 4 | `DDDDDDDD` | 8 | Latitud: signo + 7 dígitos | ÷ 100000 → grados |
| 5 | `EEEEEEEEE` | 9 | Longitud: signo + 8 dígitos | ÷ 100000 → grados |
| 6 | `FFF` | 3 | Velocidad | **ya en km/h — NO convertir** |
| 7 | `GGG` | 3 | Rumbo (grados) | → `rumbo_grados` |
| 8 | `HH` | 2 | Ignición + entradas (hex) | `ignicion = (hex & 0x80) !== 0` |
| 9 | `II` | 2 | Salidas (hex) | solo `datos_can`/descartado |
| 10 | `JJJ` | 3 | Tensión de batería (décimas V) | ÷ 10 |
| 11 | `KKKKKKKK` | 8 | Odómetro (**metros**, hex) | fallback de `odometro_m` |
| 12 | `L` | 1 | Alimentación GPS | |
| 13 | `M` | 1 | Modo de fix (2D/3D) | |
| 14 | `NN` | 2 | PDOP | |
| 15 | `OO` | 2 | Satélites | → `satelites` |
| 16 | `PPPP` | 4 | Segundos desde última posición (hex) | `FFFF` = sin posición |
| 17 | `Q` | 1 | Alimentación del módem | |
| 18 | `R` | 1 | Registración GSM | |
| 19 | `SS` | 2 | Nivel de señal (CSQ) | |

> ⚠️ **Trampa histórica**: una revisión anterior de este plan asumía velocidad **en nudos**
> y prescribía `× 1.852`. Eso era cierto para el modelo interno de Traccar, **no para la
> trama**. Aplicar esa conversión acá infla toda velocidad un 85% y rompe SC-006 en
> silencio.

### 3.1 Fecha y hora en ceros = sin fix de hora GPS

Cuando fecha y hora vienen **todas en ceros**, el equipo aún no tiene hora GPS.

**Obligatorio**: detectarlo antes de construir la fecha. Alimentar un constructor de fecha
con ceros produce **1999-11-30** por normalización de mes/día en base cero — una fila con esa
fecha rompe el particionamiento temporal de la hypertable y contamina cualquier rango
consultado.

Comportamiento requerido (D-08): `momento_evento` = hora de recepción,
`estado_interpretacion = PARCIAL`, y `"momento_evento"` en `campos_faltantes`.

---

## 4. Sección CAN OBD-II

Va después de la sección GPS, separada por `;`. Formato: pares `ID=VALOR` separados por
**coma**.

```text
1=,2=1250,3=48,B=17316,14=,15=62,2A=88,2C=
```

| Regla | Detalle |
|-------|---------|
| Separador entre pares | `,` (coma) |
| Separador ID/valor | `=` |
| Campo **sin dato del ECU** | `ID=` — identificador, `=`, y nada. **Es lo normal, no un error** |
| Formato del ID | Hexadecimal, **1–2 caracteres** |

| ID | Significado | Unidad | Destino (D-04) |
|----|-------------|--------|----------------|
| `1` | VIN | — | ⛔ **descartado** (Principio V) |
| `2` | RPM de motor | rpm | `datos_can` |
| `3` | Velocidad de rueda | km/h | `datos_can` |
| `B` | **Odómetro total del ECU** | **km** | → `odometro_m` **× 1000**, origen `ECU` |
| `14` | Combustible consumido | L | `datos_can` |
| `15` | **Nivel de combustible** | **%** | → `combustible_pct` |
| `2A` | Temperatura de refrigerante | °C | `datos_can` |
| `2C` | Presión de aceite | kPa | `datos_can` |

> ⚠️ **Incompatibilidad con el código de referencia**: `canJsonTransform` de
> `../rinho-udp-server` parsea la variante **ER / J1939** (vehículo pesado), cuyos IDs son de
> **4 dígitos** (`2010`, `4201`, `1020`…). **No sirve para EQ.** La sección CAN de EQ
> necesita parser nuevo. El envelope y el checksum sí se reutilizan.

> ⚠️ **Unidades del odómetro**: CAN `B` en **km**, campo GPS `KKKKKKKK` en **metros**. El
> dominio guarda **siempre metros**. No normalizar produce una distancia 1000× equivocada.

---

## 5. Ejemplo oficial verificado

Trama publicada por el fabricante:

```text
>REQ00000000000000-2780656-064296830000117F00000010836F1130112FFFF1117;1=,2=,3=,B=,14=,15=,2A=,2C=;ID=2326;*01<
```

Decodificación campo a campo (los 66 caracteres cierran exactamente; checksum `01` verificado):

| Campo | Valor crudo | Interpretación |
|-------|-------------|----------------|
| `AA` | `00` | Reporte 00 |
| Fecha | `000000` | **Sin fix de hora GPS** → aplica §3.1 |
| Hora | `000000` | idem |
| Latitud | `-2780656` | **−27.80656°** |
| Longitud | `-06429683` | **−64.29683°** (nordeste argentino ✓) |
| Velocidad | `000` | 0 km/h |
| Rumbo | `011` | 11° |
| Ign+entradas | `7F` | `0x7F & 0x80 = 0` → **ignición apagada** |
| Salidas | `00` | — |
| Batería | `000` | 0.0 V (trama de banco) |
| Odómetro | `010836F1` | `0x010836F1` = **17 315 569 m** ≈ 17 316 km |
| GPS power | `1` | encendido |
| Fix | `3` | **3D** |
| PDOP | `01` | 1 |
| Satélites | `12` | 12 |
| Edad posición | `FFFF` | sin posición |
| Módem | `1` | encendido |
| GSM | `1` | registrado |
| Señal | `17` | CSQ 17 |
| CAN | `1=,2=,…,2C=` | **todos vacíos**: el ECU no publicó nada |
| `ID` | `2326` | `dispositivo_id` |
| Checksum | `01` | |

**Dos observaciones que este ejemplo obliga a asumir:**

1. **El caso "todos los campos CAN vacíos" es el ejemplo canónico del fabricante.** Refuerza
   R-2: no hay garantía de que el ECU del camión piloto publique combustible ni odómetro. El
   diseño debe tratarlo como normal (FR-004), no como fallo.
2. **Esta trama no trae `;#msgNum`.** Confirma que el segmento es opcional y que, sin él, no
   hay ACK posible (D-06). Es también señal de que el ejemplo es sintético (declara fix 3D
   con 12 satélites pero hora en ceros y batería en 0.0 V), lo que sostiene R-1: verificar
   contra el equipo real.

**Este ejemplo debe existir como fixture de test** (`test/eqParser.test.js`), junto con la
trama de §5-bis (datos CAN poblados) y una trama de checksum inválido: son los tres casos
que exige el Principio VIII.

---

## 5-bis. Trama con sección CAN poblada

Segunda trama de referencia, aportada por el equipo. **Es la que resuelve el riesgo R-2**:
demuestra que el ECU sí publica combustible y odómetro por CAN OBD-II.

```text
>REQ00210918170359-2778100-064258570001517F000000000049D13010900001516;1=1M8GDM9A_KP042788,2=2200,3=45,B=66010,14=30000,15=75,2A=90,2C=340;ID=037883;*01<
```

Verificado: 66 chars de sección GPS cerrando exacto, checksum `01` recalculado y coincidente.

| # | Campo | Raw | Interpretación |
|---|-------|-----|----------------|
| 1 | Nro reporte | `00` | 0 |
| 2 | Fecha | `210918` | 21/09/2018 |
| 3 | Hora | `170359` | 17:03:59 UTC |
| 4 | Latitud | `-2778100` | **−27.78100°** (ver ⚠️ abajo) |
| 5 | Longitud | `-06425857` | **−64.25857°** (ver ⚠️ abajo) |
| 6 | Velocidad | `000` | 0 km/h |
| 7 | Rumbo | `151` | 151° (SE) |
| 8 | IGN+IN | `7F` | bit 7 = 0 → **ignición apagada** (ver ⚠️ abajo) |
| 9 | XP salidas | `00` | ninguna activa |
| 10 | Tensión | `000` | 0.0 V |
| 11 | Odómetro GPS | `0000049D` | `0x49D` = **1 181 m** |
| 12 | GPS power | `1` | encendido |
| 13 | Fix | `3` | 3D |
| 14 | PDOP | `01` | 1 |
| 15 | Satélites | `09` | 9 |
| 16 | Edad posición | `0000` | 0 s (posición fresca) |
| 17 | Módem | `1` | encendido |
| 18 | GSM | `5` | registrado en roaming |
| 19 | CSQ | `16` | 16 |

Sección CAN:

| ID | Raw | Interpretación | Destino |
|----|-----|----------------|---------|
| `1` | `1M8GDM9A_KP042788` | VIN | ⛔ **descartado** (Principio V) |
| `2` | `2200` | 2200 rpm | `datos_can` |
| `3` | `45` | 45 km/h de rueda | `datos_can` |
| `B` | `66010` | **66 010 km** | → `odometro_m` = 66 010 000, origen `ECU` |
| `14` | `30000` | combustible consumido (unidad dudosa) | `datos_can` |
| `15` | `75` | **75 % de tanque** | → `combustible_pct` |
| `2A` | `90` | 90 °C refrigerante | `datos_can` |
| `2C` | `340` | 340 kPa presión de aceite | `datos_can` |

### ⚠️ Discrepancias detectadas — leer antes de implementar

**(a) Coordenadas: la tabla de interpretación que acompañaba a esta trama está equivocada.**
Proponía leer `-2778100` como grados + minutos decimales (`27°781.000'` → −40.016667°) y
`-06425857` como `64°258.570'` → −68.309500°. Es imposible: un valor de minutos vive en
`[0, 60)`, y 781 y 258.57 no lo son. Además esa lectura ubicaría al camión en Neuquén/Río
Negro, a ~1000 km del punto que da la división por 100000. Con `÷ 100000` ambas tramas
—la del fabricante y ésta— caen a **4.7 km una de otra en Santiago del Estero**, que es
coherente con un mismo equipo/zona de prueba. **Se mantiene `÷ 100000`.**

**(b) Tres contradicciones internas de la trama.** No cambian el parseo, pero impiden usarla
como prueba de coherencia semántica:

1. **Ignición vs. RPM**: `HH = 7F` tiene el bit 7 en 0 → ignición apagada, pero el CAN
   reporta 2200 rpm y 90 °C. Un motor a 2200 rpm con la ignición apagada no existe. O el bit
   de ignición no es el 7, o está invertido, o la trama es sintética. **Sin resolver — es el
   riesgo R-7.**
2. **Velocidad GPS 0 vs. velocidad de rueda 45 km/h.**
3. **Odómetro GPS 1 181 m vs. odómetro ECU 66 010 km** (factor ~55 000). Confirma que el
   fallback de D-05 nunca debe mezclarse dentro de un mismo rango sin advertirlo: restar un
   contador contra el otro daría una distancia disparatada. Es exactamente lo que
   `odometroOrigenMixto` existe para señalar.

**(c) El VIN no es numérico**: `1M8GDM9A_KP042788` es alfanumérico con guion bajo. El parser
de la sección CAN **no debe** convertir valores a número al leerlos: los trata como strings
opacos y recién el mapper decide tipo por ID. Convertir a número daría `NaN` y podría
enmascarar el descarte del VIN que exige el Principio V.

**(d) `14=30000`** como litros consumidos es implausible para un camión; probablemente esté
en decilitros, mililitros o sea un contador acumulado. Como va a `datos_can` sin promoverse
a columna de dominio, no bloquea nada, pero **no debe usarse para ningún cálculo** hasta
confirmar la unidad.

---

## 6. ACK (respuesta del receptor al dispositivo)

```text
>ACK;#<msgNum>;ID=<deviceId>;*<checksum><
```

| Regla | Detalle |
|-------|---------|
| **Cuándo** | Solo **después** de que el `INSERT` está confirmado en base (US2, escenario 2) |
| Insert deduplicado | Si `ON CONFLICT DO NOTHING` no insertó porque ya existía: **igual se responde ACK** (el equipo necesita la confirmación para dejar de reintentar) |
| Fallo de persistencia | **No se responde nada.** El silencio es la señal para que el equipo reintente |
| Sin `msgNum` | No hay ACK que construir. Se persiste igual y se registra en el log |
| Destino | Al `address:port` **de origen del datagrama**, nunca a una dirección configurada: el equipo está detrás del NAT del operador celular y su puerto de origen cambia entre sesiones |
