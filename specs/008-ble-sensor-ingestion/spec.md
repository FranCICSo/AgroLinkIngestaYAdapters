# Feature Specification: Ingesta de lecturas de sensores BLE

**Feature Branch**: `008-ble-sensor-ingestion`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description: "El receptor rinho-receptor acepta un segmento opcional de sensores BLE en las tramas del Rinho Spider IoT y lo persiste. Contexto completo en docs/handoff/ble-sensores.md. Los datos BLE llegan vía reporte de usuario (SUC + GUn), con un UC que emula EQ y agrega un tercer segmento separado por ';' con pares T0=<temp>,H0=<hum>,B0=<bat> (slot 0..3). Trama: >REQ<evt><gps 64>;<can pares>;T0=23.5,H0=45.0,B0=3012;#0012;ID=...;*CS<. El segmento es opcional: tramas EQ actuales sin él siguen funcionando y las columnas BLE quedan NULL. Valor vacío (T0=) = sin lectura -> NULL. No se inyectan datos dummy (Principio IX: payload_crudo debe respaldar los valores); se prueba con tramas fixture. Cambios: splitBody en udpServer separa GPS/CAN/BLE; nuevo src/protocol/bleSection.js; campos nuevos en lecturaMapper y lecturaRepository; migración deploy/migrations/003 con columnas nullable (y 01-schema.sql); buildFrame con opción ble; corregir specs/001-.../contracts/rinho-eq-frame.md §1 (';@dd..dd' de GEQ es el destino, no campos personalizados). Unidades de batt (% vs mV) y formato exacto a verificar con hardware; no hay sensor físico todavía."

## Contexto

El equipo Rinho Spider IoT puede leer sensores inalámbricos BLE (temperatura, humedad y
batería del propio sensor) montados en la caja o cámara de frío del vehículo. El equipo
guarda solo la última lectura de cada sensor (hasta 4 sensores, "slots" 0 a 3) y **no la
envía por sí solo**: ningún reporte estándar la incluye. Para que llegue al servidor hay
que configurar en el equipo un **reporte de usuario** que emula el reporte EQ actual y le
agrega, al final del bloque de datos, un segmento con las lecturas BLE
(`docs/handoff/ble-sensores.md`).

Hoy no hay sensor físico. El objetivo es dejar la ingesta **preparada** para que, el día
que el equipo se configure y el sensor se instale, las lecturas se persistan sin cambios
adicionales de software, sin inventar ningún dato mientras tanto.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar la temperatura y humedad de la carga junto con cada lectura del vehículo (Priority: P1)

Un operador que transporta carga sensible (refrigerada) necesita saber qué temperatura y
humedad tenía la carga en cada momento del viaje, asociada a la misma posición y hora que
ya se registran para el vehículo. Cuando el equipo de a bordo informa lecturas de sus
sensores BLE, cada lectura de telemetría guarda la temperatura, la humedad y el nivel de
batería del sensor como datos propios, con el dato crudo original conservado como
respaldo.

**Why this priority**: Es el objetivo de la funcionalidad. Sin esto, las lecturas de los
sensores se reciben pero se pierden, o directamente la trama se rechaza.

**Independent Test**: Enviar al receptor una trama de prueba (construida con la
herramienta de generación de tramas) que incluya el segmento BLE con temperatura, humedad y
batería para el sensor 0, y verificar que la lectura persistida expone esos tres valores
como datos propios y que el dato crudo almacenado es idéntico a la trama recibida.

**Acceptance Scenarios**:

1. **Given** una trama válida que incluye el segmento BLE con temperatura `23.5`, humedad
   `45.0` y batería `3012` para el sensor 0, **When** el receptor la procesa, **Then** la
   lectura persistida expone temperatura 23.5, humedad 45.0 y batería 3012 para ese
   sensor, junto con la posición, hora y datos CAN de la misma trama.
2. **Given** una trama válida con segmento BLE donde algún valor llega vacío (el equipo no
   tiene lectura de ese sensor), **When** el receptor la procesa, **Then** ese valor queda
   como "no informado" (nunca cero), la lectura se marca como parcial con ese campo
   listado entre los faltantes, y el resto de los valores se persiste normalmente.
3. **Given** una trama válida con segmento BLE, **When** el receptor la persiste, **Then**
   envía el ACK al equipo exactamente igual que con una trama sin segmento BLE.

---

### User Story 2 - Las tramas actuales, sin sensores, siguen funcionando sin cambios (Priority: P1)

Los vehículos que hoy reportan sin sensores BLE (todos, en este momento) deben seguir
ingresando igual que antes: mismos valores, mismo estado de interpretación, mismo ACK.

**Why this priority**: Es la condición de no regresión. Romper la ingesta actual para
preparar una capacidad que todavía no tiene hardware es inaceptable.

**Independent Test**: Reprocesar las tramas de referencia existentes (fixtures de las
features 001 y 003) y verificar que producen exactamente las mismas lecturas que antes, con
los datos BLE como "no informado" y sin que esa ausencia cambie el estado de
interpretación de la lectura.

**Acceptance Scenarios**:

1. **Given** una trama EQ sin segmento BLE, **When** el receptor la procesa, **Then** la
   lectura persistida es idéntica a la que producía antes de esta funcionalidad, con los
   datos BLE como "no informado".
2. **Given** una trama EQ sin segmento BLE y con todos los demás datos completos, **When**
   el receptor la procesa, **Then** la lectura se marca como interpretada completa (la
   ausencia del segmento BLE no la degrada a parcial).

---

### User Story 3 - Configurar el equipo con una referencia de protocolo correcta (Priority: P2)

Quien configure el equipo el día que llegue el sensor necesita una referencia documental
que diga exactamente qué comandos enviar al equipo y qué trama debe esperar el receptor,
y que marque explícitamente lo que todavía no se verificó con hardware.

**Why this priority**: Sin esto, la preparación del receptor no sirve: el equipo emitiría
un formato distinto al esperado. Pero no bloquea el valor de la Historia 1 en pruebas.

**Independent Test**: Revisar el contrato de protocolo y la guía de puesta en marcha
(`docs/guias/configuracion-sensor-ble.md`) y verificar que (a) describen el formato del
segmento BLE y la configuración del equipo que lo produce, (b) el contrato corrige la
descripción errónea del parámetro opcional de `GEQ`, y (c) la guía permite, sin otra
fuente, configurar un sensor comprado, capturar una trama real y verificarla contra la
esperada.

**Acceptance Scenarios**:

1. **Given** el contrato de protocolo de la trama EQ, **When** se lo consulta, **Then**
   describe el parámetro opcional `;@dd..dd` de `GEQ` como el destino del reporte (por
   ejemplo GPRS, LOG, SMS), no como "campos de datos personalizados".
2. **Given** el contrato de protocolo, **When** se lo consulta, **Then** incluye la
   configuración del equipo que produce el segmento BLE, la trama esperada y la lista de
   supuestos pendientes de verificación con hardware.
3. **Given** un sensor BLE recién comprado y la guía de puesta en marcha, **When** se
   siguen sus pasos, **Then** se puede configurar el equipo, capturar una trama real y
   determinar si coincide con el formato que acepta el receptor.

---

### Edge Cases

- **Colisión de identificadores entre CAN y BLE**: la sección CAN usa identificadores
  hexadecimales de 1–2 caracteres, por lo que `B0` o `B` son identificadores CAN válidos.
  El segmento BLE NO puede reconocerse por el nombre de sus claves: se reconoce por su
  **posición** (tercer segmento del bloque de datos, después de GPS y CAN).
- **Sensor sin lectura**: `T0=` (clave presente, valor vacío) → "no informado", igual que
  un identificador CAN sin dato del ECU.
- **Valor no numérico** (p. ej. `T0=abc`): el valor queda "no informado", se deja
  evidencia en el estado de interpretación de la lectura y la lectura se persiste igual
  (Principio IX); nunca se rechaza la trama completa por esto.
- **Valor numérico fuera de rango físico plausible** (p. ej. temperatura de 900 °C): se
  persiste tal como fue reportado, sin corregirlo, igual que los valores CAN (feature
  003). Esta funcionalidad no valida rangos de sensores.
- **Claves desconocidas o de slots distintos de 0** en el segmento BLE (p. ej. `X0=1`,
  `T1=20`, `T7=1`): se ignoran sin rechazar la trama; el dato sigue respaldado en el payload crudo.
- **Segmento BLE vacío** (dos `;` seguidos o segmento sin pares): equivale a "sin
  lecturas BLE".
- **Reintento del equipo** de una trama con segmento BLE: se deduplica igual que cualquier
  otra trama (mismo dato crudo → misma lectura, un solo registro).
- **Lecturas históricas** persistidas antes de esta funcionalidad: siguen consultables,
  con los datos BLE como "no informado".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El receptor DEBE aceptar tramas cuyo bloque de datos incluya, después de la
  sección CAN, un segmento opcional de lecturas BLE con pares `clave=valor` separados por
  coma, donde la clave es una letra de magnitud (`T` temperatura, `H` humedad, `B` batería
  del sensor) seguida del número de sensor (`0`–`3`).
- **FR-002**: El receptor DEBE identificar el segmento BLE por su posición en la trama
  (tercer segmento del bloque de datos), nunca por el nombre de sus claves, para no
  confundirlo con la sección CAN.
- **FR-003**: Las tramas sin segmento BLE DEBEN procesarse exactamente igual que antes de
  esta funcionalidad: mismos valores persistidos, mismo estado de interpretación, mismo
  ACK.
- **FR-004**: Cada lectura de telemetría DEBE poder registrar, como datos propios,
  temperatura (°C), humedad relativa (%) y batería del sensor **del sensor 0 (slot 0)**.
  Las claves de los slots 1–3 se toleran pero no se persisten como datos propios (quedan
  respaldadas en el payload crudo). La batería del sensor se persiste como el número tal
  cual llega, sin conversión ni unidad en su nombre, con un tipo numérico que admita
  tanto un porcentaje como milivoltios; su unidad se documenta como pendiente en la guía
  de puesta en marcha (FR-013).
- **FR-005**: Un valor BLE vacío en la trama DEBE persistirse como "no informado", nunca
  como cero ni otro valor que pueda confundirse con una lectura real. Si el segmento BLE
  está presente, un valor vacío o una clave del sensor 0 ausente también deja evidencia
  en el estado de interpretación (lectura parcial, con el campo listado entre los
  faltantes), igual que un identificador CAN sin dato. Un `0` válido se persiste como
  cero, nunca como "no informado".
- **FR-006**: Un valor BLE presente pero no numérico DEBE persistirse como "no informado"
  y dejar evidencia en el estado de interpretación de la lectura (lectura parcial, con el
  campo listado entre los faltantes), sin rechazar la trama.
- **FR-007**: La ausencia completa del segmento BLE NO DEBE marcar la lectura como parcial
  ni listar los campos BLE como faltantes: es el caso normal de un vehículo sin sensores.
- **FR-008**: El dato crudo de la trama DEBE seguir conservándose byte a byte, incluido el
  segmento BLE, y todo valor BLE persistido DEBE poder reconstruirse a partir de él
  (Principio IX). El sistema NO DEBE generar ni inyectar lecturas BLE que no provengan de
  una trama recibida.
- **FR-009**: La base de datos de producción DEBE poder recibir los nuevos datos mediante
  una migración versionada, idempotente y no destructiva, que no modifique ninguna lectura
  ya persistida (Principio IV); las instalaciones nuevas DEBEN obtener el mismo esquema.
- **FR-010**: La herramienta de generación de tramas de prueba DEBE poder producir tramas
  con segmento BLE, con checksum válido, para probar la funcionalidad sin hardware.
- **FR-011**: El contrato de protocolo DEBE corregir la descripción del parámetro opcional
  de `GEQ` (es el destino del reporte, no campos personalizados) y documentar el formato
  del segmento BLE, la configuración del equipo que lo produce y los supuestos pendientes
  de verificación con hardware.
- **FR-013**: La funcionalidad DEBE entregar una guía de puesta en marcha del sensor BLE,
  versionada en el repositorio (`docs/guias/configuracion-sensor-ble.md`), que cubra:
  emparejamiento del sensor con el equipo, comandos de configuración del reporte de
  usuario, trama esperada por el receptor, cómo capturar una trama real y compararla con
  la esperada, y la lista de supuestos a verificar con hardware. La guía se actualiza en
  la misma entrega que cualquier cambio del formato aceptado por el receptor.
- **FR-012**: Esta funcionalidad se limita a la ingesta y persistencia. La consulta de
  estado del vehículo NO cambia; la exposición de los datos BLE queda para una
  funcionalidad posterior.

### Key Entities

- **Lectura de telemetría**: registro de lo que reportó un vehículo en un momento dado.
  Suma tres datos propios opcionales, uno por campo recibido del sensor 0: temperatura,
  humedad y batería del sensor (sin tabla aparte). Sigue conservando el dato crudo
  completo.
- **Sensor BLE (slot)**: posición 0–3 en la memoria del equipo que corresponde a un
  sensor inalámbrico emparejado. La identidad física del sensor (dirección MAC) la conoce
  el equipo por configuración; no viaja en la trama.
- **Segmento BLE de la trama**: tercer segmento del bloque de datos del reporte de
  usuario que emula EQ; formato `T<n>=<temp>,H<n>=<hum>,B<n>=<bat>`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las tramas de prueba con segmento BLE completo se persisten con
  temperatura, humedad y batería idénticas a las de la trama enviada.
- **SC-002**: El 100% de las tramas de referencia existentes (sin segmento BLE) producen
  las mismas lecturas que antes de esta funcionalidad (cero regresiones).
- **SC-003**: En el 100% de los casos, un consumidor puede distinguir "el sensor no
  informó" de "el sensor informó cero".
- **SC-004**: Ninguna lectura persistida contiene un valor BLE que no esté presente en su
  dato crudo (verificable reconstruyendo cada valor desde el payload).
- **SC-005**: Una trama con segmento BLE mal formado nunca se descarta en silencio: el
  100% de esos casos queda persistido con evidencia en el estado de interpretación.

## Assumptions

- El formato de trama es el diseño del handoff (`docs/handoff/ble-sensores.md`): un reporte
  de usuario que emula EQ más un segmento BLE. **No está verificado con hardware**; si el
  equipo real emite otro formato, se ajusta el parser en una funcionalidad posterior.
- Unidades asumidas: temperatura en °C con decimales, humedad relativa en %. La **unidad
  de la batería del sensor no está confirmada** (la documentación del fabricante la da
  como % en un lugar y como mV en otro): se persiste el valor tal como llega, sin
  conversión, y se documenta como pendiente de verificación.
- La trama con segmento BLE siempre trae sección CAN antes (el reporte de usuario la
  incluye aunque venga con todos sus valores vacíos), por lo que el segmento BLE siempre
  es el tercero.
- La trama del reporte de usuario lleva número de mensaje para el ACK igual que el reporte
  EQ; si no lo trae, aplica el comportamiento ya existente para tramas sin número de
  mensaje.
- El límite de largo del reporte de usuario del equipo (239 bytes) es una restricción de
  configuración del equipo, no del receptor.
- La configuración del equipo (comandos `SBS`, `SUC`, `SRL`) se documenta pero no se
  envía desde el sistema: no hay canal de comandos hacia el equipo (fuera de alcance).
- Queda fuera de alcance: persistir los slots 1–3, exponer los datos en la consulta de
  estado del vehículo, alertas por temperatura fuera de rango, reportes de cadena de
  frío y cualquier interfaz de usuario.

## Clarifications

### Session 2026-09-27

- Q: ¿Cuántos sensores BLE por lectura se persisten? → A: Solo el slot 0, como datos
  propios de la lectura (tres valores opcionales). Hoy hay un único sensor previsto y el
  reporte de usuario del equipo (239 bytes) apenas admite uno junto con GPS y CAN
  completos; ampliar a más slots será otra funcionalidad con su propia migración.
- Q: ¿Se exponen los datos BLE en la consulta de estado del vehículo en esta
  funcionalidad? → A: No. Solo ingesta y persistencia; la exposición queda para una
  funcionalidad posterior, cuando haya datos reales.
- Q: ¿Cómo se almacenan los datos BLE? → A: Columnas dedicadas y opcionales en la tabla de
  lecturas de telemetría, solo para los campos que se reciben (temperatura, humedad y
  batería del sensor 0); sin tabla aparte.
- Q: ¿Dónde vive la guía de puesta en marcha del sensor BLE? → A: En el repositorio, en
  `docs/guias/configuracion-sensor-ble.md`, como entregable de esta funcionalidad (FR-013).
- Q: ¿Cómo se almacena la batería del sensor, cuya unidad (% o mV) no está confirmada? →
  A: Valor crudo, sin conversión, en un dato con nombre sin unidad y tipo numérico que
  admita ambos; la unidad queda documentada como pendiente hasta verificar con hardware.
