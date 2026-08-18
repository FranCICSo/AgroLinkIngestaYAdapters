# Feature Specification: Ingesta y Adaptación de Telemetría

**Feature Branch**: `001-ingesta-adaptacion-telemetria`

**Created**: 2026-08-12

**Status**: Draft

**Input**: User description: "Necesito una nueva feature llamada \"Ingesta y Adaptación de Telemetría\" para el proyecto AgroLink, cuyo servicio principal se llamará AgroLinkIngestaYAdaptacion. Walking skeleton que prueba que la telemetría real de un dispositivo IoT (GPS, odómetro, combustible, ignición) instalado en un camión piloto puede llegar de punta a punta, sin intervención manual, hasta un almacenamiento propio de AgroLink, incluyendo el entorno completo (servidor de telemetría Traccar decodificando el protocolo del dispositivo Rinho Spider IoT, almacenamiento de series temporales, y el servicio de adaptación), y sirve como base para reportes de viaje (distancia, combustible consumido, velocidad promedio y máxima) por camión y rango de fechas."

## Clarifications

### Session 2026-08-14

- Q: ¿Dónde debe vivir el nuevo parser custom del protocolo Rinho respecto del
  servicio de adaptación/persistencia (Spring Boot + TimescaleDB)? → A: Es un
  servicio separado (Node.js) que decodifica la trama y escribe directo en
  TimescaleDB, sin pasar por el endpoint HTTP del servicio de ingesta.
- Q: ¿Qué transporte(s) debe escuchar el nuevo parser para recibir los frames
  del dispositivo? → A: Solo UDP.
- Q: Sin Traccar de por medio, ¿cómo se confirma la recepción exitosa de un
  evento hacia el propio dispositivo? → A: Con un ACK a nivel de protocolo
  Rinho (frame con checksum) que el propio parser envía al dispositivo por
  UDP tras persistir con éxito.
- Q: El porcentaje de combustible solo viaja como dato CAN-bus opcional
  dentro de reportes de evento (ER), no en cada posición (CQ). ¿Cómo se
  trata su ausencia? → A: Best-effort; se persiste la lectura igual,
  marcando combustible como campo faltante normal (FR-004), no como
  anomalía.
- Q: ¿En qué stack se construye el nuevo servicio parser? → A: Node.js,
  evolución "productiva" (config por variables de entorno, logging
  estructurado, sin dependencias de desarrollo) del repo de referencia
  `rinho-udp-server`, como servicio separado del backend Java de
  ingesta/reportes.
- Q: ¿El dispositivo va a enviar solo reportes EQ, o también CQ en paralelo?
  → A: Solo EQ (comando `GEQ` configurado en el Spider IoT); el parser solo
  necesita soportar la trama `REQ` (GPS base + sección CAN OBD-II), no
  `RCQ`/`RER`.
- Q: El reporte EQ trae odómetro en dos lugares (campo GPS base en metros vs.
  campo CAN OBD-II `B` del ECU en km). ¿Cuál es el valor canónico? → A: El
  del ECU (CAN `B`) cuando está presente, con fallback al campo GPS base
  cuando el ECU no lo reporta en esa lectura.

### Session 2026-08-15

- Q: ¿Se agrega en esta feature una entidad "Viaje" persistida, poblada por
  tareas programadas a partir de las lecturas de telemetría? → A: No en esta
  spec; se deja constancia como dirección futura (ver Assumptions) sin
  modelarla ni agregar jobs ahora, para no bloquear ese camino más adelante.
- Q: ¿Se agrega detección de desvío de ruta/geocerca ("camión que se aleja
  del destino")? → A: Fuera de alcance de esta feature.
- Q: ¿Se agrega una tasa de consumo promedio de combustible al reporte de
  viaje, además del combustible consumido total? → A: Sí, se agrega.
- Q: ¿Se agrega ingesta de transacciones de carga de combustible
  (surtidor/proveedor)? → A: Fuera de alcance de esta feature.
- Q: ¿El indicador de origen mixto del odómetro (presente en el modelo de datos y en
  el contrato de la API) tiene respaldo en el spec? → A: No lo tenía; se agrega a
  FR-005 y a los atributos de la entidad Reporte de Viaje. La distancia con odómetro
  de orígenes mezclados se entrega con advertencia explícita, nunca en silencio
  (Principio IX). Hallazgo F2 de `/speckit-analyze`.
- Q: ¿SC-002 ("el 100% de las lecturas recibidas... se persisten") contradice a FR-013
  (rechazar tramas sin identificador válido)? → A: Sí; SC-002 se acota a las lecturas
  con identificador de camión válido y checksum correcto. El rechazo registrado de
  tramas inválidas es comportamiento requerido, no incumplimiento. Hallazgo F3 de
  `/speckit-analyze`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Entorno de ingesta persistente y reproducible (Priority: P1)

Como equipo de proyecto, necesitamos contar con un entorno de ingesta de telemetría
corriendo de forma persistente y reproducible, para poder demostrarle a la cátedra y a
usuarios piloto que el dato real de un camión llega al sistema sin pasos manuales.

**Why this priority**: Sin un entorno desplegable y estable, ninguna otra historia de
esta feature puede demostrarse. Es el prerrequisito de todo lo demás y el primer hito
verificable del "walking skeleton".

**Independent Test**: Se puede levantar el entorno completo (servicio receptor/parser
Rinho, almacenamiento de series temporales, servicio de adaptación y reportes) desde
cero siguiendo solo la documentación del proyecto, sin pasos manuales no documentados,
y verificar que los tres componentes quedan operativos y comunicados entre sí.

**Acceptance Scenarios**:

1. **Given** un entorno limpio sin componentes previos instalados, **When** se sigue el
   procedimiento de despliegue documentado, **Then** el servicio receptor/parser Rinho
   (UDP), el almacenamiento de series temporales y el servicio de adaptación y reportes
   quedan operativos y comunicados, sin haber requerido pasos manuales fuera de lo
   documentado.
2. **Given** el entorno ya desplegado, **When** se reinicia cualquiera de los tres
   componentes, **Then** el entorno vuelve a quedar operativo sin pérdida de
   configuración ni de datos ya persistidos.

---

### User Story 2 - Recepción confiable de eventos de posición (Priority: P1)

Como dispositivo Rinho Spider IoT, quiero enviar cada trama de posición por UDP
directamente al servicio receptor/parser de AgroLink y recibir un ACK a nivel de
protocolo, para saber que el dato no se perdió en el camino.

**Why this priority**: Es el punto de entrada de todo el flujo de datos. Sin una
recepción confiable con confirmación, no hay garantía de que ningún dato posterior
(persistencia, reportes) sea correcto o completo.

**Independent Test**: Se puede enviar una trama de posición simulada por UDP al puerto
del servicio receptor/parser y verificar que responde con el ACK de protocolo Rinho
correspondiente, independientemente de si el resto del flujo de reportes ya está
completo.

**Acceptance Scenarios**:

1. **Given** el servicio receptor/parser Rinho está operativo, **When** el dispositivo
   envía una trama de posición por UDP, **Then** el servicio la decodifica, la
   persiste en TimescaleDB y responde al dispositivo con el ACK de protocolo Rinho
   (frame con checksum) por UDP.
2. **Given** el servicio receptor/parser Rinho no logra persistir el evento (p. ej.
   TimescaleDB no disponible), **When** el dispositivo envía una trama, **Then** el
   servicio no envía el ACK de protocolo, de forma que el dispositivo detecta la falta
   de confirmación y reintenta según su propia lógica, sin que el evento se dé por
   recibido falsamente.

---

### User Story 3 - Registro auditable de cada lectura de telemetría (Priority: P1)

Como Analista de Tráfico, quiero que cada lectura de telemetría recibida quede
registrada con: identificador del camión, fecha y hora de la lectura, latitud,
longitud, velocidad, odómetro, porcentaje de combustible, y estado de ignición, para
poder auditar después el recorrido completo de cualquier viaje.

**Why this priority**: Es el valor central de negocio de la feature: sin un registro
completo y auditable por campo, no existe base para ningún reporte posterior.

**Independent Test**: Se puede enviar una lectura completa por UDP al servicio
receptor/parser Rinho y consultar directamente el almacenamiento para verificar que los
ocho campos quedaron persistidos correctamente y son consultables.

**Acceptance Scenarios**:

1. **Given** una lectura de telemetría completa (todos los campos presentes),
   **When** es recibida por el servicio, **Then** queda persistida con identificador
   de camión, fecha/hora, latitud, longitud, velocidad, odómetro, porcentaje de
   combustible y estado de ignición, todos consultables posteriormente.
2. **Given** múltiples lecturas ya persistidas para un mismo camión, **When** se
   consultan por identificador de camión, **Then** se puede reconstruir la secuencia
   completa y ordenada cronológicamente de esas lecturas.

---

### User Story 4 - Conservación del payload crudo (Priority: P2)

Como sistema, quiero conservar el payload crudo recibido junto con los campos ya
interpretados, para no perder información si en el futuro se descubre un campo
adicional útil que hoy no se está mapeando.

**Why this priority**: Es una salvaguarda de valor futuro, no bloqueante para demostrar
el flujo end-to-end, pero necesaria para no tener que re-solicitar datos ya recibidos
si el mapeo de campos cambia más adelante.

**Independent Test**: Se puede enviar una lectura por UDP al servicio receptor/parser
Rinho y verificar que, además de los campos interpretados, el payload original recibido
queda almacenado íntegro y asociado a esa misma lectura.

**Acceptance Scenarios**:

1. **Given** una lectura de telemetría es recibida, **When** se persiste, **Then**
   el payload crudo original queda guardado junto con (y asociado a) los campos ya
   interpretados de esa lectura.

---

### User Story 5 - Reporte de viaje por camión y rango de fechas (Priority: P2)

Como Jefe de Tráfico, quiero poder pedir un reporte de un viaje dado un camión y un
rango de fechas/horas, y obtener: distancia recorrida (a partir del odómetro),
combustible consumido, tasa promedio de consumo de combustible, velocidad promedio y
velocidad máxima, para evaluar el costo y comportamiento de ese trayecto sin depender
de planillas manuales.

**Why this priority**: Es el resultado de negocio que demuestra que la telemetría cruda
se transforma en información útil, cumpliendo el objetivo central del proyecto. Depende
de que las historias 1 a 3 ya estén resueltas.

**Independent Test**: Con un conjunto de lecturas ya persistidas para un camión en un
rango conocido, se puede solicitar el reporte de viaje para ese camión y rango, y
verificar que los cinco valores (distancia, combustible consumido, tasa promedio de
consumo, velocidad promedio, velocidad máxima) son correctos respecto a los datos de
entrada.

**Acceptance Scenarios**:

1. **Given** un camión con lecturas registradas dentro de un rango de fechas/horas
   dado, **When** se solicita el reporte de viaje para ese camión y rango, **Then** se
   obtiene distancia recorrida, combustible consumido, tasa promedio de consumo de
   combustible, velocidad promedio y velocidad máxima, calculados a partir de esas
   lecturas.
2. **Given** un camión sin ninguna lectura registrada en el rango de fechas/horas
   pedido, **When** se solicita el reporte de viaje, **Then** el sistema informa
   explícitamente que no hay datos disponibles para ese camión en ese rango, en vez de
   devolver un reporte vacío o ambiguo.

---

### User Story 6 - Validación end-to-end con dispositivo real (Priority: P1)

Como equipo de desarrollo, quiero un criterio de aceptación de "validación end to end":
que al prender el dispositivo real instalado en el camión piloto y hacerlo reportar, se
pueda confirmar —sin intervención manual— que la lectura recorrió todo el camino
(dispositivo → decodificación/parser Rinho → almacenamiento en TimescaleDB) y quedó
correctamente interpretada.

**Why this priority**: Es la prueba definitiva del objetivo del proyecto: telemetría de
hardware real, no simulada, llegando de punta a punta. Sin esta validación, la feature
no cumple su propósito de "walking skeleton" demostrable.

**Independent Test**: Se enciende el dispositivo real instalado en el camión piloto, se
espera a que reporte al menos un evento, y se verifica en el almacenamiento de AgroLink
—sin ninguna intervención manual intermedia— que la lectura llegó completa y
correctamente interpretada.

**Acceptance Scenarios**:

1. **Given** el dispositivo Rinho Spider IoT instalado en el camión piloto está
   encendido y con cobertura celular, **When** reporta un evento de posición por UDP,
   **Then** ese evento queda persistido en el almacenamiento de AgroLink con sus
   campos correctamente interpretados, sin que ninguna persona haya intervenido
   manualmente en el trayecto del dato.

---

### Edge Cases

- Un evento llega con campos de telemetría incompletos o nulos (ej. sin fix de GPS, sin
  dato de combustible): el sistema persiste igual lo que sí vino, sin descartar el
  evento completo (ver FR-004).
- Un evento llega con timestamp retrasado respecto a lecturas ya almacenadas de ese
  mismo camión (por reconexión luego de pérdida de cobertura celular): el sistema lo
  acepta sin sobrescribir ni inconsistenciar lecturas más recientes ya persistidas.
- Se reciben eventos simultáneos de distintos camiones: cada lectura queda asociada
  únicamente a su camión de origen, sin mezclarse con las de otros camiones.
- Se solicita un reporte de viaje para un camión sin lecturas en el rango pedido: el
  sistema lo informa explícitamente (ver User Story 5, escenario 2).
- El dispositivo reintenta el envío de una trama por UDP porque no recibió el ACK de
  protocolo a tiempo: el reintento no debe producir una lectura duplicada interpretada
  como dos eventos de negocio distintos que distorsionen el reporte de viaje.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST exponer un receptor UDP que reciba las tramas ASCII del
  reporte extendido EQ (`REQ`) del protocolo propio de Rinho Spider IoT directamente
  desde el dispositivo (GPS base + sección CAN OBD-II), las decodifique y responda al
  dispositivo con un ACK a nivel de protocolo (frame con checksum) solo cuando el evento
  fue persistido exitosamente.
- **FR-002**: El sistema MUST persistir cada lectura recibida con, al menos: identificador
  del camión, fecha y hora del evento, latitud, longitud, velocidad, odómetro,
  porcentaje de combustible y estado de ignición. El porcentaje de combustible (campo CAN
  OBD-II `15`) y el odómetro del ECU (campo CAN OBD-II `B`, en km) viajan como datos
  CAN-bus opcionales dentro de la trama EQ y no siempre están presentes; el odómetro usa
  como valor canónico el del ECU (`B`) cuando está presente, con fallback al campo
  odómetro de la sección GPS base (hex, metros) cuando el ECU no lo reporta en esa
  lectura; la ausencia de combustible se trata como campo faltante normal (ver FR-004),
  no como una anomalía.
- **FR-003**: El sistema MUST conservar el payload crudo original (la trama ASCII cruda
  recibida por UDP) de cada lectura junto con (asociado a) los campos ya interpretados de
  esa misma lectura.
- **FR-004**: El sistema MUST persistir una lectura aun cuando lleguen campos
  incompletos o nulos —incluyendo el caso frecuente de ausencia de combustible o de
  odómetro del ECU por no venir ese dato CAN OBD-II en la trama EQ—, guardando los campos
  presentes (aplicando el fallback de odómetro de FR-002 cuando corresponda) y dejando
  evidencia (registro o campo de estado) de cuáles campos faltaron o no pudieron
  interpretarse, sin descartar el evento completo.
- **FR-005**: El sistema MUST permitir solicitar un reporte de viaje dado un
  identificador de camión y un rango de fechas/horas, devolviendo: distancia recorrida
  (a partir del odómetro), combustible consumido, tasa promedio de consumo de
  combustible (combustible consumido dividido por la distancia recorrida), velocidad
  promedio y velocidad máxima. Cuando la distancia recorrida es cero, la tasa promedio
  de consumo se informa explícitamente como no calculable (no se devuelve una división
  por cero ni un valor engañoso). Cuando la distancia se calcula combinando lecturas
  cuyo odómetro proviene de orígenes distintos (el del ECU en unas y el de la sección
  GPS base en otras, según el fallback de FR-002), el reporte MUST señalar
  explícitamente ese origen mixto, porque restar dos contadores independientes puede
  arrojar una distancia no confiable. El valor se entrega igual, acompañado de la
  advertencia, en vez de omitirse o devolverse como si fuera confiable (Principio IX:
  nada se descarta ni se degrada en silencio).
- **FR-006**: El sistema MUST informar explícitamente cuando no existen lecturas para
  un camión en el rango de fechas/horas solicitado, en vez de devolver un reporte
  vacío o ambiguo.
- **FR-007**: El sistema MUST soportar la recepción concurrente de eventos de múltiples
  camiones sin mezclar datos entre ellos.
- **FR-008**: El entorno completo (servicio receptor/parser Rinho decodificando el
  protocolo del dispositivo instalado en el camión piloto por UDP, almacenamiento de
  series temporales y servicio de adaptación y reportes) MUST poder desplegarse de forma
  reproducible, sin configuración manual ad-hoc no documentada.
- **FR-009**: El sistema MUST permitir verificar, sin intervención manual, que una
  lectura generada por el dispositivo real del camión piloto recorrió todo el camino
  (dispositivo → decodificación/parser Rinho → almacenamiento en TimescaleDB) y quedó
  correctamente interpretada.
- **FR-010**: El sistema MUST NOT almacenar nombres, DNI/CUIL u otros identificadores
  personales de choferes en las lecturas de telemetría ni en el reporte de viaje; toda
  referencia a un camión usa un identificador interno.
- **FR-011**: El sistema MUST tratar toda lectura de telemetría ya persistida como de
  solo lectura: ninguna interfaz de usuario ni proceso automático puede editarla ni
  borrarla manualmente.
- **FR-012**: El sistema MUST aceptar lecturas que lleguen con timestamp retrasado
  (posteriores a una desconexión del dispositivo) sin sobrescribir ni generar
  inconsistencias sobre lecturas más recientes ya almacenadas del mismo camión.
- **FR-013**: El sistema MUST rechazar o descartar de forma explícita y registrada
  (nunca silenciosa) un evento que no incluya un identificador de camión válido, ya que
  sin ese dato no puede asociarse a ningún reporte.

### Key Entities *(include if feature involves data)*

- **Lectura de Telemetría**: Un evento de posición/estado reportado por el dispositivo
  de un camión en un instante dado. Atributos: identificador del camión, fecha/hora del
  evento, fecha/hora de recepción, latitud, longitud, velocidad, odómetro (del ECU vía
  CAN OBD-II cuando está presente, o de la sección GPS base como fallback), porcentaje
  de combustible (CAN OBD-II, opcional), estado de ignición, payload crudo original (la
  trama ASCII cruda del reporte EQ recibida por UDP), y estado de interpretación
  (completa o parcial, con detalle de campos faltantes si aplica; el combustible o el
  odómetro del ECU ausentes por no venir ese dato CAN OBD-II en la trama son el caso más
  frecuente de interpretación parcial). Es inmutable una vez persistida.
- **Camión**: Entidad mínima que representa el vehículo monitoreado, identificado por
  un identificador interno/token (no un dato personal). En esta feature no tiene
  atributos de negocio adicionales (esos se modelan en historias futuras).
- **Reporte de Viaje**: Resultado calculado a demanda a partir de las lecturas de un
  camión dentro de un rango de fechas/horas. Atributos: identificador del camión, rango
  de fechas/horas solicitado, distancia recorrida, combustible consumido, tasa promedio
  de consumo de combustible (combustible consumido / distancia recorrida, o no
  calculable si la distancia es cero), velocidad promedio, velocidad máxima, cantidad
  de lecturas consideradas, e **indicador de origen mixto del odómetro** (verdadero
  cuando el rango combina lecturas con odómetro del ECU y de la sección GPS base, lo
  que vuelve la distancia potencialmente no confiable — ver FR-005). No se persiste
  como entidad propia: se deriva de las lecturas existentes en el momento de la
  consulta.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una lectura generada por el dispositivo real instalado en el camión
  piloto queda disponible, correctamente interpretada, en el almacenamiento de AgroLink
  dentro de los 2 minutos posteriores a ser reportada por el dispositivo, sin ninguna
  intervención manual.
- **SC-002**: El 100% de las lecturas recibidas **con identificador de camión válido y
  checksum correcto** que tengan campos incompletos o nulos se persisten con los campos
  presentes (ninguna lectura se descarta por completo por tener datos parciales). Las
  tramas sin identificador válido o con checksum inválido quedan fuera de este criterio:
  su rechazo explícito y registrado es el comportamiento requerido por FR-013, no una
  pérdida de datos.
- **SC-003**: El 100% de las solicitudes de reporte de viaje para un camión sin
  lecturas en el rango pedido devuelven un mensaje explícito de "sin datos", nunca un
  reporte vacío sin explicación.
- **SC-004**: El sistema procesa correctamente eventos concurrentes de al menos 5
  camiones simultáneos sin que ninguna lectura quede asociada al camión equivocado.
- **SC-005**: Una persona del equipo que no participó del despliegue original puede
  levantar el entorno completo (servicio receptor/parser Rinho, almacenamiento, servicio
  de adaptación y reportes) siguiendo únicamente la documentación del proyecto, en menos
  de 30 minutos, sin asistencia ad-hoc de quien lo desplegó originalmente.
- **SC-006**: Dado un conjunto conocido de lecturas de un camión en un rango de
  fechas/horas, el reporte de viaje calculado coincide exactamente con los valores
  esperados de distancia, combustible consumido, tasa promedio de consumo de
  combustible, velocidad promedio y velocidad máxima derivados manualmente de esas
  mismas lecturas.

## Out of Scope

- No se implementa ningún broker de mensajería (MQTT/Kafka u otro): la ingesta es un
  receptor UDP directo desde el dispositivo, sin intermediarios.
- No se modelan las entidades completas de negocio de AgroLink (Cliente, Chofer, Viaje
  formal con estados, facturación); solo el registro de lecturas de telemetría y el
  reporte derivado de ellas por rango de tiempo.
- No se implementa autenticación ni cifrado avanzado en la recepción UDP en esta fase
  (el protocolo Rinho no lo soporta; el servicio receptor/parser y el resto de los
  servicios conviven en la misma red privada durante el piloto).
- No se resuelve ninguna interfaz visual propia de AgroLink en esta etapa (no hay UI de
  terceros ni propia); el acceso a los datos es vía el reporte de viaje (User Story 5) o
  consultas directas al almacenamiento de series temporales.
- No se implementa el canal de comandos descendentes (downlink) hacia el dispositivo
  Rinho Spider IoT; esta feature solo cubre la ruta de subida (uplink) de telemetría y
  su ACK de protocolo.
- No se calculan costos operativos (OPEX) ni otras métricas de negocio derivadas más
  allá de las cinco definidas en el reporte de viaje de esta feature.
- No se implementa detección de desvío de ruta ni geocercas (alertar cuando un camión
  se aleja de un destino esperado); el dominio de esta feature no tiene concepto de
  "destino" asignado a un camión o viaje.
- No se ingieren transacciones de carga de combustible (surtidor/proveedor externo);
  "combustible consumido" se calcula únicamente a partir del porcentaje de tanque
  reportado por el dispositivo, sin reconciliar con recargas reales.

## Assumptions

- El identificador de camión usado en telemetría y reportes es el identificador interno
  del dispositivo (tal como lo reporta el propio dispositivo en el campo `ID` de la
  trama del protocolo Rinho), tratado como token técnico y no como dato personal; no se
  requiere un catálogo previo de camiones dados de alta manualmente para que la ingesta
  funcione.
- "Combustible consumido" en el reporte de viaje se expresa como la diferencia entre el
  porcentaje de combustible de la primera y la última lectura del rango (en puntos
  porcentuales), dado que en esta feature no se dispone de la capacidad del tanque en
  litros; el cálculo de costo en unidades monetarias u otras unidades queda para
  historias de negocio futuras (cálculo de OPEX).
- La "tasa promedio de consumo de combustible" se expresa como puntos porcentuales de
  combustible consumidos por unidad de distancia recorrida (mismas unidades del
  odómetro, p. ej. puntos %/km), calculada como combustible consumido dividido por
  distancia recorrida del mismo rango; no contempla recargas de combustible durante el
  rango (ver Out of Scope), por lo que un reabastecimiento dentro del rango distorsiona
  el valor.
- La distancia recorrida se calcula como la diferencia entre el odómetro (valor
  canónico según FR-002: ECU vía CAN OBD-II con fallback a GPS base) de la última y la
  primera lectura del rango solicitado, asumiendo que es acumulativo y no se reinicia;
  se asume además que mezclar lecturas con odómetro de distinto origen (ECU vs. GPS)
  dentro de un mismo rango no introduce saltos significativos para el piloto.
- La confirmación de recepción exitosa hacia el dispositivo es un ACK a nivel de
  protocolo Rinho (frame con checksum) enviado por UDP directamente por el servicio
  receptor/parser tras persistir con éxito (el dispositivo define su propia política de
  reintento si no lo recibe); no hay servidor de telemetría intermedio ni mecanismo de
  confirmación adicional.
- Los datos de telemetría del piloto se retienen indefinidamente durante la duración
  del proyecto (no se define una política de purga en esta feature).
- No existe todavía un catálogo formal de "viajes" con inicio/fin de negocio; el
  "reporte de viaje" de esta feature es, en rigor, un reporte de actividad del camión
  para el rango de fechas/horas que el usuario elija consultar.
- A futuro se prevé materializar viajes como entidad propia del dominio (con inicio/fin
  de negocio), poblada por procesos batch a partir de estas mismas lecturas de
  telemetría; esta feature no lo implementa, pero el modelo de Lectura de Telemetría
  (inmutable, insert-only, con fecha/hora de evento propia) se elige deliberadamente
  para no bloquear ese camino futuro.
