# Phase 0 — Research: Ingesta y Adaptación de Telemetría

**Feature**: `001-ingesta-adaptacion-telemetria` | **Date**: 2026-08-15

Todos los "NEEDS CLARIFICATION" del Technical Context quedaron resueltos. Las decisiones
marcadas ⚠️ **corrigen supuestos de revisiones anteriores de este plan** y deben leerse
antes de implementar.

**Fuentes primarias usadas** (política del proyecto: verificar contra fuente primaria, no
contra material de marketing):

1. Documentación de protocolo del fabricante: `docs.rinho.com.ar`, página del reporte EQ.
2. Código de referencia probado contra hardware real: `../rinho-udp-server`
   (`protocol.js`, `network.js`, `app.js`, `database.sql`).

---

## D-01 ⚠️ Se elimina Traccar: la decodificación es un componente propio

**Decision**: El stack **no** incluye Traccar. El dispositivo reporta por UDP directamente
a un servicio propio `rinho-receptor` que decodifica la trama, persiste y responde el ACK.

**Rationale**: Decisión explícita del usuario (Clarifications, sesión 2026-08-14). Además
de la directiva, el cambio resuelve tres problemas concretos del diseño anterior:

- **Elimina la incertidumbre del mapeo de campos.** Con Traccar de por medio, odómetro,
  combustible e ignición dependían de qué `attributes` decidiera emitir su decodificador
  para este modelo — riesgo que la revisión anterior tenía abierto (R-1, R-2, R-5) y que no
  se podía cerrar sin el hardware. Leyendo la trama directamente, el mapeo es determinista
  y está documentado por el fabricante.
- **Elimina dos contenedores** (Traccar + su PostgreSQL) y el salto HTTP intermedio, en una
  VM de 2 OCPU compartidas.
- **Hace honesto el ACK.** Con Traccar, la "confirmación" que exigía la User Story 2 era la
  respuesta HTTP a Traccar, no una confirmación al dispositivo: el dispositivo podía dar por
  entregado un dato que nunca llegó a persistirse. Ahora el ACK se emite **después** del
  commit, que es lo que el spec realmente pide.

**Alternatives considered**:
- *Mantener Traccar y solo cambiar el forwarding*: descartado por directiva explícita.
- *Receptor propio que reenvía por HTTP al servicio Java* (en vez de escribir a la base):
  descartado por el usuario en la misma sesión de clarificación; agregaba un salto de red y
  una serialización sin beneficio, ya que el receptor igual debe esperar la confirmación de
  persistencia antes de emitir el ACK.

> **Corrección de rumbo**: la revisión anterior de este plan afirmaba que "el protocolo
> Rinho es TAIP" y fijaba el puerto 5031. Ese diagnóstico venía de la lista de dispositivos
> de Traccar y **ya no aplica**: al decodificar nosotros, lo único que importa es el formato
> nativo que el equipo emite, que es el documentado por el fabricante (D-02). El parecido de
> la trama con TAIP (delimitadores `>`…`<`, campo `;ID=`, checksum XOR) es real pero
> irrelevante para este diseño.

---

## D-02 ⚠️ El dispositivo se configura en modo EQ; el código de referencia NO cubre esa trama

**Decision**: El dispositivo se configura con el comando **`GEQ`** y emite **reportes
extendidos EQ**. El parser debe implementar la trama `>REQ…<`; **no** se implementan `RCQ`
ni `RER`.

**Rationale**: Decisión del usuario (Clarifications, sesión 2026-08-14: "Solo EQ"). EQ es la
única variante que transporta nativamente **nivel de combustible** y **odómetro del ECU**
vía CAN OBD-II, que son requisitos duros de FR-002.

**Hallazgo crítico para la planificación**: `../rinho-udp-server/protocol.js` implementa
`parserCQ` (posición) y `parserER` (evento con CAN **J1939**, vehículo pesado), y su
`canJsonTransform` asume IDs CAN de **4 dígitos** (`2010`, `4201`, `1020`…). El reporte
**EQ usa CAN01 / OBD-II con IDs de 1–2 caracteres hexadecimales** (`1`, `2`, `3`, `B`,
`14`, `15`, `2A`, `2C`). Es decir:

> **La sección CAN de EQ no es compatible con el parser CAN existente, y no hay ningún
> `parserEQ` en el código de referencia.** Esta feature escribe parsing nuevo. Lo que sí se
> reutiliza tal cual es el *envelope* (`frame.js`) y el checksum, que sí están validados
> contra hardware real.

**Alternatives considered**:
- *Configurar el equipo en modo ER (J1939)*: reutilizaría `canJsonTransform`, pero J1939 es
  para vehículo pesado con red CAN propia; EQ/OBD-II es lo que el usuario configuró.
- *Configurar en modo CQ*: descartado, no transporta combustible.

---

## D-03 Formato de la trama EQ (contrato de entrada)

**Decision**: El parser implementa exactamente el layout de abajo. El contrato completo,
con el ejemplo literal de la documentación y su decodificación campo por campo, vive en
[`contracts/rinho-eq-frame.md`](./contracts/rinho-eq-frame.md).

Envelope (idéntico al validado en el código de referencia):

```text
>REQ<sección GPS 66 chars>;<sección CAN>;#<msgNum>;ID=<deviceId>;*<checksum><
```

- `;#<msgNum>` es **opcional** (el ejemplo oficial de la documentación no lo trae).
- El checksum es un XOR byte a byte de todo el string desde `>` hasta el `*` inclusive,
  en dos dígitos hexadecimales mayúsculas.
- Sección CAN: pares `ID=VALOR` separados por **coma**; un campo sin dato del ECU llega
  como `ID=` (identificador, `=`, y nada).

Sección GPS base, **66 caracteres** de ancho fijo (la suma de los 19 anchos):

| Campo | Largo | Contenido | Notas de mapeo |
|-------|-------|-----------|----------------|
| `AA` | 2 | Nº de reporte (hex) | Se guarda como `reporte_id` |
| `BBBBBB` | 6 | Fecha `DDMMYY` | Todo ceros = **sin fix de hora GPS** |
| `CCCCCC` | 6 | Hora `HHMMSS` | idem |
| `DDDDDDDD` | 8 | Latitud, signo + 7 dígitos | ÷ 100000 → grados decimales |
| `EEEEEEEEE` | 9 | Longitud, signo + 8 dígitos | ÷ 100000 → grados decimales |
| `FFF` | 3 | Velocidad | **ya viene en km/h** |
| `GGG` | 3 | Rumbo (grados) | |
| `HH` | 2 | Ignición + entradas (hex) | ignición = bit 7 |
| `II` | 2 | Salidas (hex) | |
| `JJJ` | 3 | Tensión de batería (décimas de V) | ÷ 10 |
| `KKKKKKKK` | 8 | Odómetro (**metros**, hex) | fuente GPS/dispositivo |
| `L` | 1 | Estado de alimentación GPS | |
| `M` | 1 | Modo de fix (2D/3D) | |
| `NN` | 2 | PDOP | |
| `OO` | 2 | Cantidad de satélites | |
| `PPPP` | 4 | Segundos desde la última posición (hex) | `FFFF` = sin posición |
| `Q` | 1 | Estado del módem | |
| `R` | 1 | Estado de registración GSM | |
| `SS` | 2 | Nivel de señal (CSQ) | |

**Rationale**: El layout se tomó de la documentación del fabricante y se **verificó contra
dos tramas independientes**: el ejemplo literal que publica esa página (CAN vacío) y una
trama con CAN poblado aportada por el equipo. En ambas los **66 caracteres cierran exacto
sin sobrante** y el checksum XOR recalculado coincide con el declarado. Ver la verificación
campo a campo en [contracts/rinho-eq-frame.md](./contracts/rinho-eq-frame.md) §5 y §5-bis.

> ⚠️ **Corrección (2026-08-15)**: revisiones anteriores de este documento y del contrato
> decían "49 caracteres". Era un error de conteo propio, no un cambio de protocolo — la
> tabla de campos siempre estuvo correcta; el total, no. Se detectó al sumar los 19 anchos
> programáticamente contra las dos tramas. Un parser escrito sobre el número viejo habría
> desplazado todo desde el odómetro en adelante, produciendo filas plausibles pero falsas:
> exactamente la clase de corrupción silenciosa que el Principio VIII busca atrapar. Por eso
> el "cierra sin sobrante" es una aserción de test (T030), no una nota al pie.

⚠️ **Corrección importante respecto de la revisión anterior**: aquella asumía que la
velocidad llegaba **en nudos** y prescribía multiplicar por 1.852 (era cierto para el
modelo interno de Traccar). Leyendo la trama directamente, **la velocidad ya está en km/h y
no se debe convertir**. Aplicar la conversión vieja inflaría toda velocidad un 85%.

---

## D-04 Campos CAN OBD-II: cuáles se promueven al dominio y cuáles no

**Decision**:

| ID CAN | Significado | Destino |
|--------|-------------|---------|
| `15` | Nivel de combustible (%) | → `combustible_pct` (columna de dominio) |
| `B` | Odómetro total del ECU (**km**) | → `odometro_m` (× 1000), origen `ECU` |
| `14` | Combustible consumido (L) | Solo `datos_can` (crudo) |
| `2` | RPM de motor | Solo `datos_can` |
| `3` | Velocidad de rueda (km/h) | Solo `datos_can` |
| `2A` | Temperatura de refrigerante (°C) | Solo `datos_can` |
| `2C` | Presión de aceite (kPa) | Solo `datos_can` |
| `1` | **VIN** | ⛔ **Descartado explícitamente** |

**Rationale**: Solo se promueven a columnas de dominio los campos que algún requisito usa
hoy (FR-002, FR-005). El resto se conserva íntegro en `datos_can` (JSONB) por FR-003, sin
inventar columnas para datos que ningún reporte consume — coherente con el espíritu de la
User Story 4 (no perder información sin sobre-modelar).

El **VIN se descarta activamente**: es un identificador del vehículo físico, no del
dispositivo, y arrastra al sistema un dato re-identificable que ningún requisito pide. El
Principio V pide minimizar identificadores; descartarlo en el parser es más barato que
tener que purgarlo después.

⚠️ **Unidades**: el odómetro llega en **dos unidades distintas** según la fuente (CAN `B` en
km, GPS base en metros). El modelo normaliza **todo a metros** y registra en
`odometro_origen` de dónde salió el valor. Mezclar unidades sin normalizar produciría una
distancia recorrida 1000× equivocada en SC-006.

---

## D-05 Odómetro: valor canónico ECU con fallback a GPS

**Decision**: `odometro_m` = CAN `B` × 1000 cuando el ECU lo reporta; si no, el campo
`KKKKKKKK` de la sección GPS (ya en metros). La columna `odometro_origen` (`ECU` | `GPS`)
deja registro de cuál se usó en cada fila.

**Rationale**: Decisión del usuario (Clarifications, sesión 2026-08-14). El valor del ECU es
el odómetro real del vehículo; el del dispositivo es una acumulación propia del equipo.

**Riesgo asumido y explicitado**: si dentro de un mismo rango consultado algunas lecturas
tienen origen `ECU` y otras `GPS`, la resta última − primera mezcla dos contadores
independientes y el resultado no significa nada. El spec ya asume que esto "no introduce
saltos significativos para el piloto", pero el diseño **no puede detectarlo en silencio**
(Principio IX): el reporte de viaje **devuelve `odometroOrigenMixto: true`** cuando el rango
combina ambos orígenes. Es una advertencia, no un error: el valor se entrega igual.

**Alternatives considered**:
- *Usar siempre el odómetro GPS*: consistente por construcción y sin el problema de mezcla,
  pero descarta el dato más preciso cuando está disponible. Descartado por el usuario.
- *Calcular distancia por haversine entre posiciones*: no depende de ningún odómetro, pero
  cambia la semántica que el spec fijó ("a partir del odómetro") y subestima en trayectos
  con reporte esporádico.

---

## D-06 El ACK se emite después del commit, y solo si la trama trae `msgNum`

**Decision**: Orden estricto: parsear → `INSERT` confirmado → recién entonces
`sendAck()`. Si el insert falla, **no se envía ACK** y el dispositivo reintenta por su
cuenta. Si la trama **no trae `;#msgNum`**, no hay ACK que construir: se persiste igual y se
registra en el log que el evento entró sin confirmación posible.

**Rationale**: Es literalmente el escenario 2 de la User Story 2. El código de referencia ya
implementa este orden (`network.sendAck()` se llama dentro del callback de éxito del insert)
y también la guarda `if (msgNum && deviceId)`.

Formato del ACK, tomado de `network.js` de la referencia:

```text
>ACK;#<msgNum>;ID=<deviceId>;*<checksum><
```

El ACK se envía **al `address:port` de origen del datagrama** (`rinfo`), no a una dirección
configurada: el equipo reporta detrás de NAT del operador celular y el puerto de origen
cambia entre sesiones.

---

## D-07 Deduplicación de reintentos

**Decision**: Doble barrera.

1. **En base**: índice único sobre `(dispositivo_id, momento_evento, frame_hash)`, donde
   `frame_hash` es el SHA-256 de la **trama cruda tal como llegó**. El insert usa
   `ON CONFLICT DO NOTHING`; si no insertó fila nueva pero tampoco hubo error, el evento ya
   estaba y **se responde el ACK igual** (el dispositivo necesita la confirmación para dejar
   de reintentar).
2. **En memoria**: caché de `(dispositivo_id, frame_hash)` recientes con TTL corto en el
   receptor, para no ir a la base en la ráfaga de reintentos.

**Rationale**: El edge case del spec exige que un reintento no produzca una lectura
duplicada. A diferencia del escenario anterior con Traccar (donde se temía que el JSON
reordenara claves), acá el dispositivo retransmite **el mismo datagrama**, así que el hash
de la trama cruda es una clave de deduplicación natural y estable.

El índice único **debe** incluir `momento_evento` porque es la columna de particionamiento
de la hypertable (TimescaleDB lo exige).

⚠️ **Limitación conocida y aceptada**: si la trama llega **sin fix de hora GPS** (fecha/hora
en ceros), `momento_evento` se completa con la hora del servidor (ver D-08), que difiere
entre el envío original y su reintento — el índice único **no** los deduplica. Por eso
existe la barrera en memoria, que sí los atrapa porque compara el hash de la trama cruda.
Residual: un reintento que llegue después de expirado el TTL de la caché y sin hora GPS
puede duplicarse. Se acepta para el piloto y se registra en Riesgos (R-3).

**Alternatives considered**:
- *Deduplicar por `(dispositivo_id, msgNum)`*: es semánticamente el campo pensado para esto,
  pero `msgNum` es opcional (la trama del ejemplo oficial no lo trae) y su rango
  `0x0000–0x7FFF` da la vuelta cada ~4–11 días al ritmo de reporte del piloto.
- *Sin deduplicación*: violaría el edge case explícito del spec y sesgaría SC-006.

---

## D-08 Trama sin fix de hora GPS (fecha y hora en ceros)

**Decision**: Cuando `BBBBBB`/`CCCCCC` vienen todos en ceros, `momento_evento` toma la hora
de recepción del servidor, y la fila se marca `estado_interpretacion = PARCIAL` con
`momento_evento` listado en `campos_faltantes`.

**Rationale**: Es un caso real y frecuente, no una anomalía: el ejemplo literal que publica
la propia documentación del fabricante viene con fecha y hora en ceros. El código de
referencia ya trae una guarda explícita para esto (`isZeroDateTime`) con un comentario que
documenta el bug que evita: alimentar `new Date()` con ceros produce **1999-11-30** por
normalización de mes/día en base cero. Una fila con esa fecha rompería el particionamiento
por tiempo y contaminaría cualquier rango consultado.

Marcarla `PARCIAL` en vez de aceptarla en silencio es lo que exige el Principio IX: quien
lea la fila sabe que ese timestamp es de recepción, no del evento.

---

## D-09 El servicio persiste en una TimescaleDB propia, en la VM, con schema `telemetria`

**Decision**: El stack despliega su **propia** TimescaleDB en la VM Oracle. Las lecturas
viven en el schema `telemetria`, tabla `lectura_telemetria`. **No** se escribe sobre la base
de AgroLinkBackend.

**Rationale**: Mantiene el criterio de aceptación central — `docker compose up` levanta todo
sin depender de nada externo. Además se verificó que `../AgroLinkBackend/compose.yaml` **no
define ninguna TimescaleDB**: es un stack Supabase local (`supabase/postgres:15.6.1.138`,
servicio `supabase-db`) que hoy no es alcanzable desde la VM Oracle. Planificar contra esa
base habría introducido una dependencia de red inexistente.

**Alternatives considered**:
- *Escribir en la Postgres de Supabase de AgroLinkBackend*: requeriría habilitar la extensión
  `timescaledb` allí, exponer esa base o montar un túnel, y gestionar credenciales cruzadas.
  Rompe la autonomía del despliegue. Descartado por decisión explícita del usuario.
- *Extender la tabla `normalized_telemetry` existente del backend*: ver D-10.

**Nota de compatibilidad futura**: el DDL se escribe autocontenido en su propio schema
(mismo patrón que `rinho-udp-server` usa con su schema `rinho_udp`). Migrar más adelante a la
base del backend requiere solo cambiar la URL de conexión, sin reescribir el DDL.

---

## D-10 No se reutiliza `normalized_telemetry` de AgroLinkBackend

**Decision**: Se define una entidad propia `LecturaTelemetria`. La tabla
`public.normalized_telemetry` de AgroLinkBackend queda intacta.

**Rationale**: AgroLinkBackend ya tiene una capa de adaptación análoga (`TelemetryAdapter`
con `SamsaraTelemetryAdapter` y `GeotabTelemetryAdapter`, entidad `NormalizedTelemetry`).
Sin embargo, `NormalizedTelemetry` **carece de los campos que este spec exige**: no tiene
odómetro, ni porcentaje de combustible, ni estado de ignición, ni payload crudo, ni estado
de interpretación (FR-002, FR-003, FR-004). Reutilizarla obligaría a alterar el DDL de una
tabla cuya dueña es otra aplicación.

**Alternatives considered**:
- *Extender `normalized_telemetry`*: pondría dos aplicaciones distintas como dueñas del mismo
  DDL; un `ddl-auto` mal configurado en cualquiera corrompe la tabla de la otra.
- *Aportar el adaptador dentro de AgroLinkBackend*: máxima reutilización, pero contradice la
  instrucción de construir AgroLinkIngestaYAdaptacion como aplicación propia.

**Nota de convergencia futura**: el usuario mencionó querer "adaptar el formato a un estándar
relativo a nuestro DER" si aparece otro tipo de dispositivo. El modelo de esta feature ya es
ese estándar candidato: es vendor-neutral (ninguna columna de dominio menciona a Rinho) y
todo lo específico del fabricante queda confinado a `payload_crudo` y `datos_can`. Un
segundo fabricante agrega un parser y un mapper nuevos contra la **misma** tabla.

---

## D-11 Imágenes ARM64: usar `timescale/timescaledb`, NUNCA `timescaledb-ha`

**Decision**: Fijar en el compose imágenes verificadas multi-arch:

| Pieza | Imagen | ARM64 |
|-------|--------|-------|
| Telemetría AgroLink | `timescale/timescaledb:2.17.2-pg16` | ✅ multi-arch |
| Receptor UDP | `node:22-alpine` | ✅ multi-arch oficial |
| Servicio de reportes (runtime) | `eclipse-temurin:21-jre-alpine` | ✅ multi-arch |

**Rationale**: La imagen **`timescale/timescaledb` (la clásica) sí publica manifests
multi-arch con ARM64**, mientras que la variante recomendada para HA,
**`timescale/timescaledb-ha`, NO tiene soporte multi-arch** — es x86_64 only y fallaría en
Ampere A1. Es una trampa fácil de pisar porque la propia documentación de Timescale empuja
hacia `-ha`.

**Verificación obligatoria antes de fijar tags** (los tags concretos deben confirmarse al
implementar):

```bash
docker manifest inspect timescale/timescaledb:2.17.2-pg16 \
  | grep -A2 '"platform"' | grep -E 'architecture|os'
```

---

## D-12 Healthchecks sin dependencias extra

**Decision**: Ambos servicios exponen `GET /health` devolviendo `200 {"status":"UP"}`:
el de reportes con un `@RestController` trivial (sin Actuator), el receptor con el módulo
`node:http` incorporado, en un puerto **no publicado** al host. El compose los usa como
healthcheck con `start_period` generoso (120 s para la JVM).

**Rationale**: La directiva del usuario es mantener las dependencias al mínimo. Actuator
agrega una dependencia de runtime completa para un endpoint trivial. En el receptor, además,
el healthcheck es la **única** forma de que Docker sepa que el proceso está vivo: un socket
UDP no tiene noción de conexión, así que sin este endpoint un receptor colgado se vería
"corriendo" indefinidamente.

---

## D-13 Semántica de "sin datos" en el reporte de viaje

**Decision**: `GET /api/v1/reportes/viaje` devuelve **404 Not Found** con cuerpo
`application/problem+json` cuando no hay lecturas del camión en el rango. Cuando sí hay
lecturas pero la **distancia recorrida es cero**, devuelve **200** con
`tasaConsumoPromedio: null` y `tasaConsumoPromedioNoCalculable: true`.

**Rationale**: FR-006 exige informar explícitamente en vez de devolver un reporte vacío o
ambiguo; un 200 con todos los agregados en `0` es indistinguible de un camión detenido todo
el rango. Y FR-005 exige que la tasa de consumo con distancia cero se informe como no
calculable en vez de devolver una división por cero — son dos situaciones distintas y el
contrato las distingue: 404 = no hay datos; 200 con `null` = hay datos, pero esa métrica en
particular no tiene sentido para este rango.

---

## D-14 `DEVICE_HORA_UTC_OFFSET_HOURS`: parche de despliegue para equipos con hora local

**Contexto**: el equipo piloto real (`860693084873877`), verificado el 2026-08-17, reportó
el campo `hora` de la trama EQ en **hora local de Argentina (UTC-3)** en vez de UTC. Se
detectó comparando `momento_evento` decodificado contra `momento_recepcion` real: coincidían
con un desfase constante de 3 horas, exactamente el offset de `America/Argentina/Buenos_Aires`.
Causa raíz: se corrigió manualmente el reloj del equipo (no tenía fix de hora GPS) usando
hora local, no UTC.

**Decision**: se agrega `DEVICE_HORA_UTC_OFFSET_HOURS` (default `0`) como variable de
entorno del receptor (`rinho-receptor/src/config.js`), sumada a la hora decodificada antes
de construir `momento_evento` (`lecturaMapper.js`, `resolveMomentoEvento`). Con el equipo en
su estado actual, `deploy/.env` la fija en `3`.

**Rationale**: el contrato del fabricante (§3 de `contracts/rinho-eq-frame.md`) documenta
ese campo como UTC, verificado contra dos tramas de referencia oficiales — no es un error de
nuestra parte, es un equipo concreto mal configurado. Hardcodear el offset habría corregido
este piloto pero roto silenciosamente cualquier otro equipo (presente o futuro) correctamente
configurado en UTC. El default `0` mantiene el comportamiento documentado; el ajuste queda
explícito por variable de entorno, con su propia advertencia en `.env.example`.

**Alternativa descartada**: cambiar el `timezone` de sesión/servidor de PostgreSQL. No
resuelve el problema — `momento_evento` es un `TIMESTAMPTZ`, guarda un instante absoluto;
cambiar el timezone de visualización no corrige el instante mal calculado, solo cambia cómo
se muestra un dato que sigue siendo incorrecto.

**Camino recomendado a futuro**: reconfigurar el reloj del equipo piloto en UTC (no local) y
volver `DEVICE_HORA_UTC_OFFSET_HOURS` a `0`. El parche por variable de entorno es intencional
para no bloquear la validación end-to-end mientras tanto, no un reemplazo permanente de
arreglar la configuración del equipo.

---

## Riesgos abiertos (no bloquean el diseño, sí la validación end-to-end)

| # | Riesgo | Mitigación |
|---|--------|-----------|
| R-1 | ⬇️ **Reducido (2026-08-15)**. El layout ya no depende de un solo ejemplo: cierra exacto en 66 chars, con checksum coincidente, en **dos tramas independientes** (§5 y §5-bis del contrato), una de ellas con CAN poblado. Queda abierto solo respecto del **firmware específico del equipo instalado**. | Se mantiene T056: capturar tramas del dispositivo real y compararlas campo a campo antes de dar por buena ninguna fila. El `payload_crudo` persistido permite reprocesar el histórico si el layout resultara distinto. |
| R-2 | ✅ **CERRADO (2026-08-15)**. La trama de §5-bis trae `15=75` (combustible, %) y `B=66010` (odómetro ECU, km) poblados: el ECU **sí** publica ambos por CAN OBD-II. SC-006 es verificable en sus cinco métricas y no hay que replantear su alcance con la cátedra. | Sin acción. El diseño previo (FR-004 + fallback D-05) se mantiene: sigue siendo correcto tratar el campo ausente como caso normal, porque el ejemplo del fabricante muestra que también ocurre. |
| R-7 | **El bit de ignición no es consistente con el resto de la trama.** En §5-bis `HH = 7F` (bit 7 = 0 → ignición apagada) convive con 2200 rpm y 90 °C de refrigerante; y la velocidad GPS es 0 con velocidad de rueda 45 km/h. O el bit de ignición no es el 7, o está invertido, o ambas tramas de referencia son sintéticas. | Verificar contra el equipo real en T056, con el motor encendido y apagado, registrando `HH` en cada estado. `ignicion` **no** debe usarse para ninguna decisión de negocio hasta confirmarlo. No bloquea la ingesta: el campo se persiste tal como se lee y `payload_crudo` permite recalcularlo. |
| R-3 | Reintento duplicado no deduplicado cuando la trama llega sin fix de hora GPS y fuera del TTL de la caché en memoria (ver D-07). | Acotado: requiere simultáneamente sin-fix-GPS y reintento tardío. Mitigable subiendo el TTL. Se monitorea contando filas con `campos_faltantes` conteniendo `momento_evento`. |
| R-4 | ✅ **CERRADO (2026-08-17)**. Confirmado contra el equipo real (`860693084873877`, modo `REQ`): emite `;#msgNum` en tramas consecutivas (`#01CF`, `#01D0`, `#01D1`, ...) y el receptor respondió el ACK sin errores en cada una (T059). | Sin acción. |
| R-5 | Puerto UDP del receptor abierto en la Security List de la VCN, sin autenticación (Principio VI). | El puerto de reportes y el de la base **no** se publican. Trama sin `ID` válido o con checksum inválido se descarta con registro (FR-013). Filtrado por rango de IP del operador celular antes de operar flota real. |
| R-6 | `datos_can` en JSONB puede crecer sin control si el ECU publica muchos campos. | Volumen de piloto: despreciable. Si escalara, TimescaleDB ofrece compresión por chunk sobre la hypertable sin cambiar el modelo. |
