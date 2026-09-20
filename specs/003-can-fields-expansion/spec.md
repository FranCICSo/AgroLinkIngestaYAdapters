# Feature Specification: Exposición estructurada de campos CAN bus

**Feature Branch**: `003-can-fields-expansion`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: "Extraer campos como columnas de la columna datos_can de la tabla lectura_telemetria: 2A Temp. refrigerante y 2C Presión aceite. Además, en la respuesta del controlador de estado, quitar el campo datosCanCrudos de canBus y reemplazarlo por todos los datos como campos: VIN, RPM, Velocidad rueda, Odómetro, Odolitro, Nivel combustible, Temp. refrigerante, Presión aceite." Ampliado en sesión de clarificación (ver Clarifications): persistir y exponer el VIN, columna propia para RPM y para el combustible consumido ("Odolitro", en litros), y mover la tensión de batería del bloque de dispositivo al bloque de CAN bus.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consultar los valores de motor y vehículo como datos de dominio propios (Priority: P1)

Un usuario o sistema consumidor que necesita monitorear la salud mecánica de un vehículo
(identidad del vehículo, régimen del motor, temperatura, presión de aceite, combustible
consumido) hoy debe interpretar manualmente un bloque de datos CAN en bruto para
encontrar estos valores. Con esta funcionalidad, el VIN, las RPM del motor, la
temperatura de refrigerante, la presión de aceite y el combustible consumido quedan
disponibles como datos de dominio propios de cada lectura de telemetría, con su tipo y
unidad ya resueltos.

**Why this priority**: Es el requisito explícito y más concreto del pedido: promover
estos valores de "dato crudo sin interpretar" a "dato de dominio consultable". Sin esto,
ningún otro consumidor puede depender de estos valores de forma confiable.

**Independent Test**: Puede probarse de forma independiente enviando una lectura de
telemetría cuyo bloque CAN incluya los identificadores `1` (VIN), `2` (RPM), `14`
(combustible consumido), `2A` (temperatura de refrigerante) y `2C` (presión de aceite), y
verificando que la lectura almacenada exponga los cinco valores como datos propios (no
como texto a interpretar dentro de un bloque genérico).

**Acceptance Scenarios**:

1. **Given** una lectura de telemetría entrante cuyo bloque CAN incluye el identificador
   `1` con el VIN del vehículo, **When** la lectura se persiste, **Then** el VIN queda
   disponible como un dato propio de la lectura, con el mismo valor reportado por el
   vehículo.
2. **Given** una lectura de telemetría entrante cuyo bloque CAN incluye el identificador
   `2` con un valor de RPM, **When** la lectura se persiste, **Then** las RPM del motor
   quedan disponibles como un dato propio de la lectura, con el mismo valor numérico
   reportado por el vehículo.
3. **Given** una lectura de telemetría entrante cuyo bloque CAN incluye el identificador
   `14` con un valor de combustible consumido, **When** la lectura se persiste, **Then**
   el combustible consumido queda disponible como un dato propio de la lectura, expresado
   en litros.
4. **Given** una lectura de telemetría entrante cuyo bloque CAN incluye el identificador
   `2A` con un valor de temperatura, **When** la lectura se persiste, **Then** la
   temperatura de refrigerante queda disponible como un dato propio de la lectura, con el
   mismo valor numérico reportado por el vehículo.
5. **Given** una lectura de telemetría entrante cuyo bloque CAN incluye el identificador
   `2C` con un valor de presión, **When** la lectura se persiste, **Then** la presión de
   aceite queda disponible como un dato propio de la lectura, con el mismo valor numérico
   reportado por el vehículo.
6. **Given** una lectura de telemetría entrante cuyo bloque CAN NO incluye alguno de los
   identificadores `1`, `2`, `14`, `2A` o `2C` (el vehículo no reportó ese dato en ese
   ciclo), **When** la lectura se persiste, **Then** el dato correspondiente queda
   marcado como "no informado" en lugar de un valor inventado (cero, vacío u otro valor
   que pueda confundirse con una lectura real).

---

### User Story 2 - Ver el estado del vehículo con todos los datos CAN y de vehículo identificados (Priority: P2)

Un usuario que consulta el estado actual de un vehículo (posición, estado del CAN bus,
información del dispositivo) hoy recibe, junto con el odómetro y el nivel de combustible
ya identificados, un bloque de datos crudos sin interpretar que debe decodificar
manualmente para conocer el VIN, las RPM, la velocidad de rueda y el combustible
consumido. Además, la tensión de batería —un dato del vehículo, no del dispositivo de
telemetría en sí— hoy aparece mezclada junto a indicadores propios del equipo IoT
(satélites, estado de interpretación). Con esta funcionalidad, la consulta de estado
devuelve directamente cada uno de los valores de vehículo/CAN como un dato identificado y
con nombre propio, agrupados en el bloque de CAN bus, sin bloques de datos crudos que
decodificar.

**Why this priority**: Depende de que existan los datos de dominio (Historia 1) para
poder exponerlos; es la capa de presentación sobre esos datos. Tiene valor propio porque
es lo que un consumidor de la consulta de estado efectivamente ve y usa.

**Independent Test**: Puede probarse de forma independiente consultando el estado de un
vehículo con lecturas de telemetría recientes y verificando que la respuesta incluya, en
el bloque de CAN bus, cada uno de los nueve valores soportados identificados por nombre
(VIN, RPM, velocidad de rueda, odómetro, combustible consumido, nivel de combustible,
temperatura de refrigerante, presión de aceite y tensión de batería), que ya no incluya
ningún bloque de datos crudos sin interpretar, y que la tensión de batería ya no aparezca
en el bloque de información del dispositivo.

**Acceptance Scenarios**:

1. **Given** un vehículo con una lectura de telemetría reciente que incluye todos los
   valores soportados, **When** se consulta el estado del vehículo, **Then** el bloque de
   CAN bus de la respuesta incluye, cada uno como un dato identificado y con nombre
   propio: VIN, RPM, velocidad de rueda, odómetro, combustible consumido, nivel de
   combustible, temperatura de refrigerante, presión de aceite y tensión de batería.
2. **Given** cualquier consulta de estado de un vehículo, **When** se recibe la
   respuesta, **Then** dicha respuesta ya no contiene ningún campo de datos CAN crudos
   sin interpretar (el bloque genérico de datos sin identificar se elimina), y el bloque
   de información del dispositivo ya no incluye la tensión de batería (movida al bloque
   de CAN bus).
3. **Given** un vehículo cuya última lectura de telemetría no reportó alguno de los
   valores soportados, **When** se consulta el estado del vehículo, **Then** ese valor
   puntual se muestra como "no informado" y el resto de los valores disponibles se
   muestran con normalidad.

---

### Edge Cases

- ¿Qué ocurre cuando un vehículo nunca reportó telemetría con datos CAN (lectura
  inexistente)? El comportamiento actual de "sin datos" para la consulta de estado se
  mantiene sin cambios; ninguno de los nuevos valores identificados debe romper ese
  comportamiento.
- ¿Qué ocurre si el vehículo reporta un valor CAN fuera del rango físico esperable (por
  ejemplo, una presión de aceite negativa, una temperatura de refrigerante extremadamente
  alta, o RPM/combustible consumido con un valor irreal)? El valor se expone tal como fue
  reportado; esta funcionalidad no valida ni corrige valores fuera de rango, solo los
  identifica y expone con nombre propio.
- ¿Qué ocurre con lecturas de telemetría ya existentes (persistidas antes de esta
  funcionalidad) que no tienen los nuevos valores identificados disponibles? Deben seguir
  siendo consultables; los valores nuevos que no puedan derivarse de datos ya persistidos
  se muestran como "no informado".
- **Cambio de contrato aceptado**: cualquier consumidor de la consulta de estado que hoy
  lea la tensión de batería desde el bloque de información del dispositivo deja de
  encontrarla ahí — pasa al bloque de CAN bus. Es un cambio de ruptura intencional
  (Clarifications, sesión 2026-09-13), no un defecto: se documenta en el contrato de la
  API para que los consumidores lo adapten.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE identificar, a partir de los datos CAN reportados por el
  vehículo, el VIN (identificador `1`) como un dato propio de cada lectura de
  telemetría.
- **FR-002**: El sistema DEBE identificar, a partir de los datos CAN reportados por el
  vehículo, las RPM del motor (identificador `2`) como un dato propio de cada lectura de
  telemetría.
- **FR-003**: El sistema DEBE identificar, a partir de los datos CAN reportados por el
  vehículo, el combustible consumido (identificador `14`, "Odolitro") como un dato propio
  de cada lectura de telemetría, expresado en litros.
- **FR-004**: El sistema DEBE identificar, a partir de los datos CAN reportados por el
  vehículo, la temperatura de refrigerante (identificador `2A`) como un dato propio de
  cada lectura de telemetría.
- **FR-005**: El sistema DEBE identificar, a partir de los datos CAN reportados por el
  vehículo, la presión de aceite (identificador `2C`) como un dato propio de cada lectura
  de telemetría.
- **FR-006**: El sistema DEBE seguir conservando el dato crudo original de los datos CAN
  tal como fue recibido, sin que la promoción de valores a datos de dominio implique
  perder o alterar el dato original de la lectura.
- **FR-007**: La consulta de estado del vehículo DEBE dejar de incluir el bloque de datos
  CAN crudos sin interpretar en su respuesta.
- **FR-008**: La consulta de estado del vehículo DEBE incluir, en el bloque de CAN bus,
  cada uno de los siguientes valores como un dato identificado y con nombre propio: VIN,
  RPM, velocidad de rueda, odómetro (ya existente), combustible consumido, nivel de
  combustible (ya existente), temperatura de refrigerante, presión de aceite, y tensión de
  batería.
- **FR-009**: La consulta de estado del vehículo DEBE dejar de incluir la tensión de
  batería en el bloque de información del dispositivo — pasa a ser exclusivamente parte
  del bloque de CAN bus (FR-008).
- **FR-010**: Cuando alguno de los valores del FR-008 no haya sido reportado por el
  vehículo en la lectura utilizada para responder la consulta de estado, el sistema DEBE
  mostrar ese valor puntual como "no informado" en lugar de omitirlo silenciosamente o
  inventar un valor.
- **FR-011**: El sistema DEBE mantener sin cambios el comportamiento actual de la consulta
  de estado para los valores que ya se exponían como datos de dominio antes de esta
  funcionalidad y que esta funcionalidad no reubica ni redefine (odómetro y su origen,
  nivel de combustible, posición, y el resto de la información del dispositivo salvo la
  tensión de batería — ver FR-009).

### Key Entities

- **Lectura de telemetría**: Un registro periódico de datos reportados por un vehículo en
  un momento dado. Incluye posición, datos del dispositivo y ahora, además del odómetro y
  el nivel de combustible ya existentes, el VIN, las RPM, el combustible consumido, la
  temperatura de refrigerante y la presión de aceite como datos propios identificados,
  sin dejar de conservar el dato CAN crudo original completo.
- **Estado del vehículo (consulta)**: La respuesta que un consumidor recibe al preguntar
  por la situación actual de un vehículo. Pasa de incluir un bloque genérico de datos CAN
  sin interpretar a incluir cada valor de vehículo/CAN soportado (incluida la tensión de
  batería, reubicada desde el bloque de dispositivo) como un dato identificado y con
  nombre propio dentro del bloque de CAN bus.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un consumidor de la consulta de estado puede obtener el VIN, las RPM, el
  combustible consumido, la temperatura de refrigerante y la presión de aceite de un
  vehículo sin necesidad de interpretar ningún bloque de datos en bruto.
- **SC-002**: El 100% de las respuestas de la consulta de estado dejan de incluir un
  bloque de datos CAN crudos sin interpretar.
- **SC-003**: Para una lectura de telemetría que reporta los nueve valores soportados, la
  consulta de estado devuelve los nueve valores correctamente identificados en el bloque
  de CAN bus, con el mismo valor reportado por el vehículo, en el 100% de los casos
  verificados.
- **SC-004**: Ante un valor no reportado por el vehículo en la última lectura, el
  consumidor de la consulta de estado puede distinguir sin ambigüedad "el vehículo no
  reportó este dato" de "el valor es cero", en el 100% de los casos.
- **SC-005**: El 100% de las respuestas de la consulta de estado dejan de incluir la
  tensión de batería en el bloque de información del dispositivo.

## Assumptions

- El VIN se persiste y se expone tal como lo reporta el vehículo (Clarifications, sesión
  2026-09-13): la cita previa a "Principio V" en la documentación del protocolo era una
  interpretación excesivamente amplia de esa regla (que protege datos personales de
  choferes, no identificadores de vehículo) y se corrige como parte de esta
  funcionalidad, sin requerir una enmienda formal a la Constitución.
- El combustible consumido (identificador `14`, "Odolitro") se expone en litros
  (Clarifications, sesión 2026-09-13) — ya no se trata como una unidad sin confirmar.
- La velocidad de rueda (identificador CAN `3`) es un dato distinto de la velocidad ya
  existente en el bloque de posición (`velocidadKmh`, de origen GPS); ambas conviven sin
  que una reemplace a la otra (Clarifications, sesión 2026-09-13).
- Los valores ya promovidos a dato de dominio antes de esta funcionalidad (odómetro y su
  origen, nivel de combustible) no cambian su fuente ni su forma de cálculo; solo se
  agregan los nuevos valores identificados junto a ellos.
- Las lecturas de telemetría persistidas antes de esta funcionalidad permanecen
  consultables; los nuevos valores identificados que no puedan derivarse de una lectura
  antigua se muestran como "no informado" para esa lectura puntual.
- Mover la tensión de batería del bloque de dispositivo al bloque de CAN bus es un cambio
  de ruptura aceptado deliberadamente (Clarifications, sesión 2026-09-13): no se duplica
  en ambos bloques.

## Clarifications

### Session 2026-09-13

- Q: ¿La "velocidad de rueda" pedida es el mismo dato que la `velocidadKmh` ya existente
  (de origen GPS), o son datos distintos que deben convivir? → A: Son datos distintos —
  `velocidadKmh` viene del GPS y la velocidad de rueda viene del CAN bus; ambas se
  exponen por separado, ninguna reemplaza a la otra.
- Q: ¿Persistir y exponer el VIN requiere una enmienda formal a la Constitución
  (Principio V), o la cita previa de "Principio V" para descartar el VIN era una
  interpretación demasiado amplia (esa regla protege datos personales de choferes, no
  identificadores de vehículo) que puede corregirse sin enmienda? → A: Es una
  interpretación demasiado amplia; se corrige la documentación y se persiste/expone el
  VIN sin enmendar la Constitución.
- Q: ¿La tensión de batería debe moverse del bloque de información del dispositivo al
  bloque de CAN bus (cambio de ruptura), o duplicarse en ambos bloques (aditivo)? → A: Se
  mueve — deja de estar en el bloque de dispositivo y pasa a estar solo en el bloque de
  CAN bus.

### Preguntas resueltas por el pedido de ampliación del usuario (sin interacción adicional)

Estas decisiones fueron indicadas directamente por el usuario al pedir la ampliación de
esta funcionalidad (no requirieron una pregunta de clarificación adicional, ver sesión de
arriba para las que sí la requirieron):

- El VIN se persiste y se expone (ver también la pregunta de Constitución arriba).
- RPM (identificador `2`) obtiene un dato propio persistido, no solo lectura a demanda.
- El combustible consumido (identificador `14`, "Odolitro") obtiene un dato propio
  persistido, expresado en litros (unidad ya confirmada por el usuario).
- La velocidad de rueda (identificador `3`) sigue sin dato propio persistido —se
  identifica por nombre a partir del dato CAN crudo ya almacenado, sin agregar
  almacenamiento dedicado, igual que se decidió originalmente para todos los valores no
  pedidos explícitamente como columna.
- El odómetro y el nivel de combustible (ya existentes) no se tocan.

### Historial: preguntas iniciales de la especificación (superadas por la sesión de arriba)

Las siguientes tres preguntas se plantearon al escribir la primera versión de esta
especificación, con una respuesta por defecto documentada explícitamente como asumida.
Se conservan como registro histórico de esa decisión inicial; sus respuestas efectivas
quedaron reemplazadas por la sesión de clarificación del 2026-09-13 (arriba) y por el
pedido de ampliación del usuario.

#### Pregunta histórica 1: Alcance del VIN

**Decisión final**: Reemplazada — ver sesión 2026-09-13. El VIN se persiste y se expone.

<details>
<summary>Contexto original (superado)</summary>

El pedido original incluye "VIN" como uno de los campos a exponer en la consulta de
estado. La documentación del protocolo existente establecía (incorrectamente, según se
confirmó en la sesión 2026-09-13) que el VIN se descartaba por "Principio V". La
respuesta por defecto asumida en la primera versión de este documento fue excluir el VIN
del alcance; esa decisión fue revertida por el usuario.

</details>

#### Pregunta histórica 2: Alcance de persistencia de los demás valores CAN

**Decisión final**: Parcialmente reemplazada. RPM y combustible consumido (`14`) pasan a
tener dato propio persistido (pedido de ampliación del usuario). Velocidad de rueda (`3`)
mantiene la respuesta original: se identifica a demanda desde el dato CAN crudo, sin
columna propia.

<details>
<summary>Contexto original (parcialmente superado)</summary>

El pedido original pedía explícitamente "extraer como columnas" solo la temperatura de
refrigerante (`2A`) y la presión de aceite (`2C`). La respuesta por defecto asumida fue
que RPM, velocidad de rueda y combustible consumido no tendrían dato propio persistido,
identificándose solo a demanda en la consulta de estado. El usuario amplió el pedido para
que RPM y combustible consumido también tengan dato propio persistido; la velocidad de
rueda queda como estaba.

</details>

#### Pregunta histórica 3: Unidad del combustible consumido ("Odolitro")

**Decisión final**: Reemplazada — el usuario confirmó que la unidad es litros.

<details>
<summary>Contexto original (superado)</summary>

La documentación del protocolo existente marcaba la unidad real del combustible
consumido (identificador `14`) como no confirmada. La respuesta por defecto asumida fue
exponer el valor tal cual, sin conversión ni etiqueta de unidad confirmada. El usuario
confirmó directamente que la unidad es litros.

</details>
