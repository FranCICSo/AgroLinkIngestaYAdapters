# Feature Specification: Proveedor Samsara por webhook — eventos de exceso de velocidad severo

**Feature Branch**: `015-samsara-webhook-exceso-velocidad`

**Created**: 2026-11-03

**Status**: Draft

**Alcance cross-repo**: esta especificación cubre las cuatro partes de la feature:

- **Emisor de webhooks simulado** (`simulador-viajes`, este repo): genera las notificaciones Samsara solo cuando un
  vehículo cruza el umbral de exceso de velocidad.
- **`agrolink-ingesta`** (este repo): recibe las notificaciones en un endpoint propio y las guarda en
  una tabla de series temporales.
- **AgroLinkBackend**: obtiene los eventos guardados, los adapta y genera las alertas.
- **Frontend AgroLink**: muestra las alertas resultantes (FR-022 a FR-026).

Si se prefiere, las partes de AgroLinkBackend y de AgroLink pueden separarse en sus propios
`specs/` en la fase de plan, manteniendo estos requisitos.

**Input**: User description: "I need to add a new telemetry provider for Samsara webhook only for
the case of severespeedingstarted and ended
(https://developers.samsara.com/docs/severespeedingended,
https://developers.samsara.com/docs/severespeedingstarted). But I need to simulate randomized
webhook notifications for some vehicles with this telemetry provider (not at the same time as
rinho simulations). Occurrences of these notifications should be low. Drivers are not driving fast
always. Please, also think about what to modify in backend for this case."

## Clarifications

### Session 2026-11-03

- Q: ¿Cuándo se generan los episodios simulados? → A: Solo mientras el vehículo Samsara simulado
  tiene un viaje en curso en AgroLink. AgroLinkBackend avisa al simulador cuando ese viaje inicia y
  cuando termina o se cancela, igual que ya hace con los dispositivos Rinho simulados.
- Q: ¿Qué significa "no al mismo tiempo que las simulaciones de Rinho"? → A: Que son vehículos
  distintos: ningún vehículo recibe ambas simulaciones, pero las dos pueden correr en simultáneo.
- Q: ¿Dónde ve el operador los episodios? → A: Solo como alerta, en el listado de alertas y en
  tiempo real. No hay vista de historial de episodios en esta feature.
- Q: ¿Se puede modificar el frontend? → A: Sí, se puede adaptar la pantalla de alertas para
  mostrar bien las alertas de conducción (FR-023 a FR-026).
- Q: ¿Quién recibe el webhook, cómo se valida y cuándo se emite? → A: Lo recibe `agrolink-ingesta`
  en un endpoint propio, sin validar credenciales ni firma (POC). El contenido se guarda casi sin
  controles en una tabla de series temporales. El emisor simulado vive en este repo (ver más abajo
  dónde) y envía una notificación solo cuando un vehículo cruza el umbral
  de exceso de velocidad.

### Session 2026-11-04

- Q: ¿Cómo obtiene AgroLinkBackend los eventos Samsara guardados por `agrolink-ingesta`? → A:
  Consultando periódicamente a `agrolink-ingesta` (cada 10 s por defecto, configurable) por los
  eventos posteriores al último que procesó, con el mismo patrón que ya usa para la temperatura BLE.
- Q: ¿Cuál es el umbral de exceso de velocidad severo del emisor? → A: Límite de velocidad más un
  margen, ambos configurables: por defecto 80 km/h de límite y 20 km/h de margen (umbral efectivo
  100 km/h), iguales para todos los vehículos Samsara simulados.
- Q: ¿Dónde vive el emisor Samsara simulado? → A: Dentro de `simulador-viajes`, como un emisor
  separado de la simulación Rinho, con su propia lista de vehículos y su propio interruptor de
  activación. Reutiliza el aviso de viajes que ya llega desde `agrolink-ingesta` y el despliegue
  existente.
- Q: ¿Cómo se identifica un vehículo Samsara entre sistemas? → A: Su identificador de dispositivo
  IoT en AgroLink es su id de vehículo en Samsara. Con él viaja el aviso de viaje y se empareja el
  webhook, con la patente como respaldo. Esos ids nunca figuran en la lista de dispositivos Rinho
  simulados.

## Contexto

El objetivo es demostrar, para la entrega de la POC, que AgroLink opera con **más de un proveedor
de telemetría** y no solo con Rinho. Samsara se integra únicamente por **webhook** (Samsara empuja
la notificación cuando ocurre el evento) y únicamente para dos tipos de evento, según la
documentación pública de Samsara (consultada el 2026-11-03):

- **SevereSpeedingStarted**: comienzo de un exceso de velocidad severo. Datos: hora de inicio del
  exceso, hora de inicio del viaje y el vehículo (id de Samsara, nombre, patente, VIN, tipo de
  activo, ids externos).
- **SevereSpeedingEnded**: fin del exceso. Mismos datos más la hora de fin.

Ambos llegan dentro de un sobre común con identificador único del evento, hora del evento, tipo de
evento, id de organización e id de la suscripción del webhook.

**Hecho relevante para el diseño**: estas notificaciones **no traen posición ni velocidad**. No son
lecturas de telemetría (como las tramas de Rinho), sino **eventos de conducción** con inicio y fin.
Por eso no pueden guardarse como una lectura de posición más: se modelan como un tipo de dato
propio (ver Key Entities).

**Cómo se simula**: en un Samsara real, el proveedor mide la velocidad del vehículo y decide cuándo
empieza y termina el exceso. Como no hay Samsara, el emisor simulado cumple ese papel: lleva una
velocidad interna para cada vehículo Samsara con viaje en curso y emite el inicio cuando esa
velocidad supera el umbral y el fin cuando vuelve a quedar por debajo. La velocidad interna nunca
se envía, porque Samsara tampoco la envía en estos eventos.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El operador ve los excesos de velocidad severos reportados por Samsara (Priority: P1)

Un vehículo de la flota que usa Samsara como proveedor entra en exceso de velocidad severo. Samsara
notifica el inicio a AgroLink y, minutos después, el fin. El operador de tráfico ve en AgroLink una
alerta de exceso de velocidad severo para ese vehículo mientras dura el episodio. Cuando el episodio
termina, la alerta indica cuándo terminó y cuánto duró.

**Why this priority**: Es el valor que se demuestra: un segundo proveedor, con un formato totalmente
distinto al de Rinho, que entra por la capa de adaptación y aparece en el producto como cualquier
otro dato.

**Independent Test**: Enviar a mano al endpoint de `agrolink-ingesta` una notificación de inicio y
otra de fin con el formato de Samsara, para un vehículo registrado con proveedor Samsara. Verificar
que quedan guardadas y que en AgroLink aparece la alerta, primero abierta y después cerrada, con la
duración correcta.

**Acceptance Scenarios**:

1. **Given** un vehículo registrado en AgroLink con proveedor Samsara, **When** `agrolink-ingesta`
   recibe una notificación SevereSpeedingStarted para ese vehículo, **Then** la notificación queda
   guardada y el operador ve una alerta activa de exceso de velocidad severo para ese vehículo, con
   la hora de inicio informada por Samsara.
2. **Given** un episodio abierto para ese vehículo, **When** llega la notificación
   SevereSpeedingEnded con la misma hora de inicio, **Then** el episodio queda cerrado con su hora de
   fin y su duración, y la alerta deja de figurar como activa.
3. **Given** el vehículo tiene un viaje en curso, **When** se registra el episodio, **Then** el
   episodio y su alerta quedan asociados a ese viaje. Si no hay viaje en curso, se registran
   asociados solo al vehículo.

---

### User Story 2 - Simulación de excesos de velocidad por umbral (Priority: P1)

Como no hay cuenta ni hardware real de Samsara, el emisor simulado representa a un conjunto chico y
fijo de vehículos Samsara, **solo mientras el vehículo tiene un viaje en curso** en AgroLink. Para
cada uno lleva una velocidad interna que varía de forma aleatoria y verosímil. La mayor parte del
tiempo queda por debajo del umbral, porque los conductores no van rápido siempre. El emisor envía el
inicio de un exceso solo cuando la velocidad cruza el umbral hacia arriba, y el fin cuando vuelve a
cruzarlo hacia abajo. Si no hay cruce, no envía nada.

**Why this priority**: Sin esto la Historia 1 no se puede mostrar en la demo. Tiene la misma
prioridad porque las dos juntas forman el mínimo demostrable.

**Independent Test**: Iniciar un viaje para un vehículo Samsara simulado, dejarlo en curso durante
un período fijo y contar las notificaciones enviadas. Cada notificación tiene que corresponder a un
cruce del umbral, cada inicio tiene que tener su fin, no tiene que haber notificaciones fuera del
viaje y ninguna tiene que dirigirse a un vehículo simulado por Rinho.

**Acceptance Scenarios**:

1. **Given** un viaje en curso para un vehículo Samsara simulado y la configuración por defecto,
   **When** el viaje lleva 8 horas en curso, **Then** ese vehículo tuvo, en promedio, entre 1 y 4
   excesos, y en ningún momento tuvo dos excesos superpuestos.
2. **Given** la velocidad interna de un vehículo está por debajo del umbral, **When** sigue por
   debajo, **Then** el emisor no envía ninguna notificación para ese vehículo.
3. **Given** la velocidad interna está por debajo del umbral, **When** lo supera, **Then** el emisor
   envía un SevereSpeedingStarted con la hora del cruce como hora de inicio del exceso.
4. **Given** un exceso en curso, **When** la velocidad interna vuelve a quedar por debajo del umbral,
   **Then** el emisor envía el SevereSpeedingEnded con la hora del cruce como hora de fin y las
   mismas horas de inicio de exceso y de viaje que envió en el inicio.
5. **Given** un vehículo Samsara simulado sin viaje en curso, **When** pasa cualquier período de
   tiempo, **Then** el emisor no envía ninguna notificación para ese vehículo.
6. **Given** un vehículo Samsara simulado, **When** su viaje pasa a estar en curso, **Then** el emisor
   recibe el aviso y empieza a simular la velocidad de ese vehículo, usando la hora de inicio del
   viaje como hora de inicio de viaje en las notificaciones.
7. **Given** un exceso en curso, **When** el viaje se completa o se cancela, **Then** el emisor envía
   de inmediato el fin de ese exceso y deja de simular el vehículo.
8. **Given** un vehículo simulado por Rinho, aunque tenga un viaje en curso, **When** corre la
   simulación Samsara, **Then** ese vehículo nunca recibe notificaciones Samsara, y las dos
   simulaciones pueden estar activas al mismo tiempo sobre sus propios vehículos.
9. **Given** `agrolink-ingesta` no responde o rechaza una notificación, **When** el emisor intenta
   enviarla, **Then** deja registro del fallo y sigue con los demás vehículos sin detenerse.

---

### User Story 3 - Tolerancia a reintentos, desorden y eventos no soportados (Priority: P2)

Un proveedor de webhooks real reintenta entregas y no garantiza el orden de llegada. AgroLink tiene
que tolerar notificaciones duplicadas, un fin que llega antes que su inicio y tipos de evento de
Samsara que AgroLink no maneja, sin generar alertas inconsistentes y sin descartar nada sin dejar
rastro.

**Why this priority**: El emisor de la Historia 2 no produce estos casos en el flujo normal, así que
no bloquean la demo. Sí los exige la constitución (Principios VII y IX) y mostrarían una integración
frágil si un evaluador los prueba.

**Independent Test**: Enviar al endpoint de `agrolink-ingesta` la misma notificación dos veces, un
fin sin inicio previo y una notificación de un tipo distinto a los dos soportados, y verificar el
resultado de cada uno.

**Acceptance Scenarios**:

1. **Given** una notificación ya recibida, **When** llega de nuevo con el mismo identificador de
   evento, **Then** se acepta sin crear un segundo episodio ni una segunda alerta.
2. **Given** no hay episodio abierto para el vehículo, **When** llega un SevereSpeedingEnded,
   **Then** se registra un episodio ya cerrado con su inicio y fin (los datos están en la propia
   notificación de fin), y si después llega el inicio correspondiente no se reabre.
3. **Given** cualquier notificación de Samsara de un tipo distinto a SevereSpeedingStarted o
   SevereSpeedingEnded, **When** llega, **Then** se acepta y se guarda, pero no genera episodio ni
   alerta.
4. **Given** una notificación cuya patente no corresponde a ningún vehículo registrado en AgroLink,
   **When** AgroLinkBackend la procesa, **Then** no se crea ningún episodio y queda evidencia del
   rechazo con la patente recibida.

---

### Edge Cases

- La notificación trae un id de vehículo que no coincide con ningún vehículo, pero sí su patente,
  con otro formato (minúsculas, espacios, guiones): AgroLinkBackend lo empareja por patente con la
  normalización existente y deja registro de que el id no coincidió.
- El id de vehículo y la patente de la notificación apuntan a dos vehículos distintos de AgroLink:
  prevalece el id, y queda registro de la inconsistencia.
- El vehículo de la patente está registrado con un proveedor distinto de Samsara: AgroLinkBackend no
  genera alerta y deja evidencia, para no mezclar proveedores en un mismo vehículo.
- Lo que llega a `agrolink-ingesta` no es un JSON legible: se rechaza y queda registro. Cualquier
  JSON legible se guarda, aunque le falten datos. Los datos faltantes o incoherentes (sin hora de
  inicio, sin vehículo, fin anterior al inicio) se detectan después, al generar la alerta, y quedan
  como evidencia del rechazo.
- `agrolink-ingesta` no responde durante una o varias consultas periódicas de AgroLinkBackend: las
  alertas se demoran, pero no se pierde ningún evento. La siguiente consulta exitosa retoma desde
  el último evento procesado. Cada consulta fallida queda registrada.
- La notificación llega horas después del evento, por ejemplo tras una caída del emisor o de
  `agrolink-ingesta`: se registra con las horas del evento, no con la hora de llegada.
- Un nuevo SevereSpeedingStarted llega para un vehículo que ya tiene un episodio abierto con otra
  hora de inicio: se registra como un episodio nuevo y el anterior queda abierto hasta que llegue
  su fin.
- Se configura un margen de 0 o negativo, o un límite no positivo: el emisor no arranca con esa
  configuración y deja registro del error, en vez de emitir excesos sin sentido.
- La velocidad interna oscila justo alrededor del umbral: el emisor no debe generar una ráfaga de
  inicios y fines de pocos segundos. Un exceso dura al menos 20 segundos antes de poder terminar.
- El emisor se detiene en medio de un exceso: al reanudarse no reenvía inicios viejos. Un episodio
  que quedó sin fin queda abierto en AgroLink. Ver Assumptions.
- El aviso de inicio o fin de viaje no llega al emisor porque está caído o no responde: el viaje
  sigue su curso normal en AgroLink sin reintentos, y ese viaje simplemente no tiene excesos
  simulados, o no se cortan al terminar. Queda registro del fallo, igual que con Rinho.
- Llega un aviso de inicio de viaje para un vehículo que el emisor ya tiene con un viaje en curso: el
  nuevo viaje reemplaza al anterior y se cierra cualquier exceso abierto del anterior.
- Llega un aviso de inicio de viaje para un vehículo que no está en la lista de vehículos Samsara
  simulados: se ignora y queda registro.

## Requirements *(mandatory)*

### Functional Requirements

**Recepción y almacenamiento (`agrolink-ingesta`)**

- **FR-001**: `agrolink-ingesta` DEBE exponer un endpoint que reciba notificaciones webhook de
  Samsara con el formato de sobre y de datos documentado por Samsara.
- **FR-002**: El endpoint DEBE aceptar cualquier contenido JSON legible y responder con éxito, sin
  validar credenciales, firma ni la completitud del contenido. Esto es una decisión explícita de la
  POC: es un desvío del Principio VI que el plan debe documentar en su Complexity Tracking. Solo se
  rechaza lo que no es JSON legible, y queda registro.
- **FR-003**: Cada notificación recibida DEBE guardarse en una tabla de series temporales de la base
  de telemetría de `agrolink-ingesta`, con el contenido completo tal como llegó, la hora de
  recepción y, cuando estén presentes, los datos que permiten consultarla: identificador del
  evento, tipo de evento, patente, id del vehículo en Samsara, hora de inicio del exceso y hora de
  fin. Las notificaciones guardadas no se editan ni se borran (Principio IV).
- **FR-004**: Una notificación cuyo identificador de evento ya fue guardado DEBE aceptarse sin
  guardarse dos veces (idempotencia ante reintentos).

**Adaptación y alertas (AgroLinkBackend)**

- **FR-004a**: `agrolink-ingesta` DEBE permitir consultar las notificaciones guardadas posteriores a
  una posición dada, en el orden en que se guardaron, para que AgroLinkBackend pueda retomar desde
  el último evento que procesó sin saltear ni repetir eventos.
- **FR-005**: AgroLinkBackend DEBE obtener las notificaciones guardadas por `agrolink-ingesta`
  **consultándolo periódicamente** (cada 10 segundos por defecto, configurable sin cambiar código)
  por las posteriores a la última que procesó, y DEBE traducir cada una, a través de la capa de adaptación de proveedores (Principio I), a un evento de
  conducción del dominio propio de AgroLink: tipo (inicio o fin de exceso de velocidad severo),
  proveedor, patente, id del vehículo en el proveedor, hora de inicio del exceso, hora de fin (solo
  en el fin), hora de inicio del viaje según el proveedor e identificador del evento del proveedor.
  El formato de Samsara no llega a la lógica de alertas ni de viajes.
- **FR-006**: AgroLinkBackend DEBE identificar el vehículo por el id de vehículo que informa Samsara,
  comparándolo con el identificador de dispositivo IoT del vehículo en AgroLink. Si no hay
  coincidencia, DEBE usar como respaldo la patente informada, con la normalización de patente
  existente. Solo DEBE generar alerta si el vehículo está registrado con proveedor Samsara.
- **FR-006a**: Un vehículo con proveedor Samsara DEBE tener como identificador de dispositivo IoT su
  id de vehículo en Samsara. Así cumple la regla vigente de que proveedor y dispositivo se cargan
  juntos, y el aviso de viaje (FR-021a) viaja con ese identificador por el mismo camino que usa
  Rinho.
- **FR-007**: AgroLinkBackend DEBE agrupar inicio y fin en un **episodio de exceso de velocidad
  severo** por vehículo, emparejándolos por vehículo y hora de inicio del exceso, con independencia
  del orden de llegada (Principio VII). Cada evento de conducción genera efectos una sola vez,
  aunque se obtenga más de una vez.
- **FR-008**: Al abrirse un episodio, el sistema DEBE generar una alerta de exceso de velocidad
  severo para el vehículo (y para su viaje, si tiene uno en curso), visible para el operador del
  tenant dueño del vehículo por los mismos medios que las alertas existentes, incluida la
  notificación en tiempo real.
- **FR-009**: Al cerrarse un episodio, la alerta DEBE reflejar la hora de fin y la duración, y dejar
  de figurar como activa.
- **FR-010**: Las notificaciones de tipos no soportados no generan episodio ni alerta. Las que no se
  pueden convertir en alerta (vehículo desconocido, vehículo de otro proveedor, datos obligatorios
  faltantes o incoherentes) DEBEN dejar evidencia del motivo y de los datos identificatorios
  recibidos (Principio IX).
- **FR-011**: El proveedor Samsara DEBE quedar activo en el registro de proveedores de
  AgroLinkBackend en los entornos donde se ejecuta la demo. El resto de los proveedores no cambia.
- **FR-012**: Los eventos de conducción DEBEN registrarse sin datos personales del conductor
  (Principio V). La notificación de Samsara no los trae, y si una versión futura los trajera, no se
  almacenan.

**Emisor de webhooks simulado (`simulador-viajes`)**

- **FR-013**: El emisor simulado DEBE vivir dentro de `simulador-viajes`, separado de la simulación
  Rinho (sin compartir su lista de vehículos ni su envío de tramas), y DEBE enviar al endpoint de FR-001 notificaciones SevereSpeedingStarted y
  SevereSpeedingEnded con el formato documentado por Samsara, sin firma.
- **FR-014**: El emisor DEBE operar sobre una lista cerrada y explícita de vehículos Samsara
  simulados, identificados por su id de vehículo en Samsara, **disjunta** de los dispositivos
  simulados por Rinho. Ningún identificador puede figurar en las dos listas, ni en
  `simulador-viajes` ni en las copias de AgroLinkBackend y `agrolink-ingesta`, para que un vehículo
  Samsara nunca dispare una simulación de ruta Rinho.
- **FR-015**: Para cada vehículo Samsara con viaje en curso, el emisor DEBE llevar una velocidad
  interna que varía de forma aleatoria y verosímil, y que la mayor parte del tiempo está por debajo
  del umbral de exceso de velocidad severo. La velocidad interna no se envía.
- **FR-015a**: El umbral de exceso de velocidad severo DEBE definirse como **límite de velocidad más
  margen**, ambos configurables sin cambiar código, por defecto 80 km/h de límite y 20 km/h de
  margen (umbral efectivo de 100 km/h). Es el mismo para todos los vehículos Samsara simulados. El
  límite por defecto coincide con el tope de velocidad que usa la simulación de Rinho.
- **FR-016**: El emisor DEBE enviar un SevereSpeedingStarted **solo** cuando la velocidad interna
  cruza el umbral hacia arriba, y el SevereSpeedingEnded correspondiente cuando vuelve a cruzarlo
  hacia abajo, con las horas de los cruces como horas de inicio y de fin. Si no hay cruce, no se
  envía nada. Un exceso dura al menos 20 segundos antes de poder terminar, para evitar ráfagas
  cuando la velocidad oscila alrededor del umbral.
- **FR-017**: Con la configuración por defecto, el comportamiento de la velocidad interna DEBE
  producir en promedio entre 1 y 4 excesos por vehículo cada 8 horas de viaje en curso, cada uno de
  entre 20 segundos y 3 minutos. El umbral y los parámetros que gobiernan la frecuencia DEBEN poder
  ajustarse por configuración sin cambiar código. Por ejemplo, más excesos para una demo corta.
- **FR-018**: Cada exceso simulado DEBE ser coherente: un inicio seguido de exactamente un fin para
  el mismo vehículo, con las mismas horas de inicio de exceso y de viaje, y sin excesos superpuestos
  en un mismo vehículo.
- **FR-019**: Los datos de vehículo de cada notificación (patente, nombre, VIN, id del proveedor)
  DEBEN coincidir con los de los vehículos Samsara registrados en AgroLinkBackend, para que la
  notificación se pueda emparejar.
- **FR-020**: El emisor DEBE poder activarse y desactivarse con independencia de la simulación Rinho,
  y DEBE registrar cada envío y su resultado (aceptado, rechazado, sin respuesta). Un fallo de envío
  no detiene el emisor.
- **FR-021**: El emisor DEBE simular un vehículo **solo mientras ese vehículo tiene un viaje en
  curso** en AgroLink. Fuera de un viaje en curso no se envía ninguna notificación para el vehículo.
- **FR-021a**: Cuando un viaje de un vehículo Samsara simulado pasa a estar en curso,
  AgroLinkBackend DEBE avisarlo al emisor con el identificador de dispositivo del vehículo (su id en
  Samsara) y la hora de inicio del viaje. Cuando el
  viaje se completa o se cancela, DEBE avisar su fin. Es el mismo camino server-to-server que hoy
  existe para los dispositivos Rinho simulados (AgroLinkBackend → `agrolink-ingesta` →
  `simulador-viajes`), extendido a vehículos Samsara: `simulador-viajes` dirige el aviso al emisor
  Samsara o a la simulación Rinho según a qué lista pertenezca el vehículo. Un fallo del aviso se registra y no afecta al viaje,
  sin reintentos.
- **FR-021b**: Al recibir el aviso de fin de viaje, el emisor DEBE enviar de inmediato el fin de
  cualquier exceso abierto de ese vehículo y dejar de simularlo.
- **FR-021c**: La hora de inicio de viaje en las notificaciones simuladas DEBE ser la hora de inicio
  del viaje informada por AgroLinkBackend.

**Presentación (frontend AgroLink)**

- **FR-022**: Los episodios se muestran **solo como alerta**, en la pantalla de alertas y en la
  notificación en tiempo real existentes. El operador DEBE poder distinguir en la alerta que el
  origen es el proveedor Samsara, y DEBE ver la patente, la hora de inicio y, una vez cerrada, la
  hora de fin y la duración del episodio. No se agrega una vista de historial de episodios.
- **FR-023**: Hoy la pantalla de alertas (AgroLink frontend) solo agrupa alertas de cadena de frío y
  de mantenimiento, así que una alerta de otro tipo no aparece en ninguna sección. La pantalla DEBE
  incorporar una sección de **alertas de conducción** para los excesos de velocidad severos, con
  los mismos filtros por estado (activas, reconocidas, resueltas, todas), la misma búsqueda y las
  mismas acciones de reconocer y resolver que las secciones existentes.
- **FR-024**: Los indicadores de resumen de la pantalla de alertas DEBEN incluir la cantidad de
  alertas de conducción activas. Los indicadores existentes de cadena de frío y mantenimiento no
  cambian de valor.
- **FR-025**: Cada alerta de conducción DEBE mostrar patente, proveedor de origen, viaje asociado
  (si lo hay), hora de inicio, y hora de fin y duración una vez cerrada. Mientras el episodio está
  abierto, DEBE indicar que sigue en curso. El texto DEBE aclarar que la severidad la determinó el
  proveedor, porque la notificación no informa la velocidad ni el margen sobre el límite.
- **FR-026**: La notificación en tiempo real de una alerta de conducción DEBE poder distinguirse a
  simple vista de una alerta térmica: título y texto propios de exceso de velocidad, con la
  patente.

### Key Entities

- **Notificación webhook de Samsara**: la notificación tal como llegó a `agrolink-ingesta`, guardada
  en la tabla de series temporales: contenido completo, hora de recepción y los datos de consulta
  extraídos (identificador de evento, tipo, patente, id del vehículo en Samsara, horas de inicio y
  fin del exceso). Inmutable. El identificador de evento es único (FR-004). Tiene una posición de
  guardado creciente que AgroLinkBackend usa para retomar (FR-004a).
- **Posición de consulta**: en AgroLinkBackend, la última notificación de Samsara ya procesada. Se
  conserva entre reinicios para no repetir ni saltear eventos.
- **Evento de conducción**: hecho del dominio de AgroLink derivado de una notificación: tipo de
  evento (inicio o fin de exceso de velocidad severo), proveedor, vehículo, horas del evento.
  Independiente del formato de Samsara, de modo que otro proveedor pueda generar el mismo evento.
- **Episodio de exceso de velocidad severo**: agrupa el inicio y el fin de un exceso para un
  vehículo. Tiene vehículo, viaje asociado (opcional), hora de inicio, hora de fin (opcional
  mientras está abierto), duración y estado (abierto o cerrado).
- **Alerta de exceso de velocidad severo**: alerta del sistema de alertas existente, vinculada al
  episodio, al vehículo y al viaje si lo hay.
- **Vehículo Samsara simulado**: entrada de la lista cerrada del emisor: id de vehículo en Samsara
  (igual al identificador de dispositivo IoT del vehículo en AgroLink), patente, nombre y VIN,
  iguales a los del vehículo registrado en AgroLinkBackend. Mientras tiene un
  viaje en curso, el emisor guarda su hora de inicio de viaje, su velocidad interna y, si lo hay, su
  exceso abierto. AgroLinkBackend mantiene su propia copia de la lista para decidir a qué vehículos
  les avisa el inicio y el fin de viaje, igual que con los dispositivos Rinho simulados.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En una demo, con el intervalo de consulta por defecto, un exceso simulado aparece como
  alerta activa en AgroLink en menos de 15 segundos desde que el emisor envía el inicio, y figura
  cerrado en menos de 15 segundos desde que envía el fin.
- **SC-002**: Con 8 horas de viaje en curso y la configuración por defecto, el promedio de excesos
  por vehículo Samsara queda entre 1 y 4, y el 100 % de los excesos iniciados tiene su fin.
- **SC-003**: El 0 % de las notificaciones Samsara simuladas se dirige a vehículos simulados por
  Rinho, y el 0 % se envía para un vehículo sin viaje en curso, salvo el fin inmediato de un exceso
  al terminar el viaje (FR-021b).
- **SC-004**: El 100 % de las notificaciones enviadas por el emisor corresponde a un cruce del
  umbral: ninguna se envía mientras la velocidad interna se mantiene del mismo lado del umbral.
- **SC-005**: Reenviar 10 veces la misma notificación produce exactamente un registro guardado, un
  episodio y una alerta.
- **SC-006**: La telemetría de Rinho (posiciones, temperatura, alertas térmicas) se comporta igual
  que antes de la feature: ninguna prueba existente de ese flujo cambia de resultado.
- **SC-007**: Un operador encuentra una alerta de exceso de velocidad de una patente dada desde la
  pantalla de alertas en menos de 3 interacciones (entrar a la sección y buscar).
- **SC-008**: El 100 % de las notificaciones que no generan alerta (tipo no soportado, vehículo
  desconocido, datos incompletos) queda guardado y con evidencia consultable del motivo.

## Assumptions

- Se usa la documentación pública de Samsara como fuente del formato. No hay cuenta ni sandbox de
  Samsara, así que la integración se valida solo contra el emisor simulado.
- El endpoint de `agrolink-ingesta` no valida credenciales ni firma porque es una POC. Queda
  expuesto solo donde ya se exponen los endpoints de `agrolink-ingesta`. Validar la firma de
  Samsara queda fuera de alcance.
- AgroLinkBackend ya cuenta con un proveedor Samsara registrado (hoy en revisión, no activo), un
  punto de ingesta por proveedor y un adaptador de Samsara con un formato que no corresponde al real.
  La feature reemplaza ese formato por el documentado, porque nada en producción depende de él (el
  proveedor no está activo).
- Los vehículos Samsara simulados son pocos (2 o 3) y se registran en AgroLinkBackend con proveedor
  Samsara, su id de Samsara como identificador de dispositivo, y patente, VIN y nombre fijos,
  iguales a los de la lista del emisor.
- La frecuencia por defecto (1–4 excesos cada 8 h de viaje por vehículo) y la duración (20 s –
  3 min) son valores verosímiles. Como los viajes de una demo suelen durar minutos, para una
  presentación se espera ajustar la configuración para que haya más excesos.
- El aviso de inicio y fin de viaje al emisor se dispara en los mismos momentos que el aviso
  existente para Rinho: el viaje pasa a estar en curso, y se completa o se cancela.
- Un episodio que quedó abierto porque nunca llegó su fin (por ejemplo, el emisor se detuvo) queda
  abierto: no hay cierre automático por tiempo en esta feature. El operador puede resolver la alerta
  a mano como cualquier otra.
- Samsara no aporta posición ni velocidad en estos eventos: la alerta no muestra ubicación ni
  velocidad alcanzada, y estos vehículos no aparecen en el mapa de flota por estos eventos.
- Fuera de alcance: otros tipos de evento de Samsara, la integración por consulta periódica o por
  streaming, el alta del webhook en una cuenta real de Samsara y el puntaje de conducción del
  conductor.
