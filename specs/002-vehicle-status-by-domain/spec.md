# Feature Specification: Consulta de Estado de Vehículo por Identificador de Dispositivo IoT

**Feature Branch**: `002-vehicle-status-by-domain`

**Created**: 2026-09-09

**Status**: Draft

**Input**: User description: "I need to retrieve via api rest the status of the vehicle from telemetry by vehicle domain or "patente" as it is said in Argentina. This should retrieve a json payload with all information (can bus info, position and device info) from the latest telemetry record of the vehicle. Also I need to publish a port (different than 8080) in the docker service to call that api"

## Clarifications

### Session 2026-09-09

- Q: ¿Cómo se relaciona la patente con el dato que hoy existe en telemetría (`dispositivo_id`)? → A: La patente es un dato maestro que vive en AgroLinkBackend (`Vehicle.iotDeviceId`), no en este servicio.
- Q: Dado que la patente se resuelve en AgroLinkBackend, ¿en qué dirección se invoca la integración: este servicio llama a AgroLinkBackend, o al revés? → A: AgroLinkBackend es el cliente. Resuelve patente→`iotDeviceId` internamente y llama a esta API de ingesta pasando ese identificador de dispositivo (equivalente a `dispositivo_id` en telemetría). Este servicio nunca conoce la patente ni llama a AgroLinkBackend.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consultar el estado actual de un vehículo por identificador de dispositivo (Priority: P1)

Un sistema cliente (en la práctica, AgroLinkBackend, que es quien conoce la
patente del vehículo y la relación patente↔dispositivo IoT) necesita saber el
estado más reciente conocido de un vehículo específico —su posición, el
estado de sus sensores CAN bus y la información de su dispositivo de a
bordo—. AgroLinkBackend ya resolvió la patente ingresada por su propio
usuario al identificador de dispositivo IoT correspondiente antes de
invocar esta consulta; esta feature recibe ese identificador, no la patente.

**Why this priority**: Es la única capacidad de esta feature; sin ella no hay
entrega de valor. Sin esta consulta, saber el estado actual de un vehículo
requiere acceso directo a la base de datos de telemetría.

**Independent Test**: Puede probarse de forma completa invocando la consulta
con el identificador de dispositivo de un vehículo que tiene al menos una
lectura de telemetría registrada, y verificando que la respuesta refleje la
lectura más reciente de ese vehículo.

**Acceptance Scenarios**:

1. **Given** un vehículo con al menos una lectura de telemetría registrada,
   **When** se consulta su estado por identificador de dispositivo, **Then**
   el sistema devuelve un payload con la información de posición, CAN bus y
   dispositivo correspondiente a la lectura más reciente de ese vehículo.
2. **Given** dos lecturas de telemetría para el mismo vehículo con distinto
   momento de evento, **When** se consulta su estado, **Then** el sistema
   devuelve la información de la lectura cuyo momento de evento es el más
   reciente (no la última recibida por el sistema, ver Edge Cases).
3. **Given** un identificador de dispositivo que no corresponde a ningún
   vehículo conocido, **When** se consulta su estado, **Then** el sistema
   indica de forma clara que no fue encontrado, sin devolver un payload de
   estado vacío o con valores en cero.
4. **Given** un identificador de dispositivo válido sin ninguna lectura de
   telemetría registrada aún, **When** se consulta su estado, **Then** el
   sistema indica de forma clara que no hay datos disponibles para ese
   vehículo, sin devolver un payload de estado vacío o con valores en cero.

### Edge Cases

- ¿Qué pasa si llega una lectura de telemetría con timestamp retrasado
  (reenviada tras un corte de conectividad) después de que ya se consultó el
  estado del vehículo? La consulta siguiente debe reflejar la lectura con el
  momento de evento cronológicamente más reciente, no la última en orden de
  llegada (consistente con la tolerancia a fallos de conectividad del
  sistema).
- ¿Qué pasa si la lectura más reciente de un vehículo está incompleta (por
  ejemplo, no tiene posición GPS porque no había señal satelital en ese
  momento)? El sistema debe devolver igualmente esa lectura con los campos
  disponibles, sin ocultarla ni sustituirla por una lectura anterior más
  completa.
- ¿Qué pasa si se consulta con un identificador de dispositivo con formato
  inválido o vacío? El sistema debe rechazar la consulta indicando que el
  parámetro es inválido, sin intentar buscar coincidencias parciales.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE permitir consultar el estado de un vehículo
  identificándolo por su identificador de dispositivo IoT (el mismo valor
  que ya se registra como `dispositivo_id` en telemetría). La resolución de
  la patente del vehículo a este identificador es responsabilidad del
  sistema cliente (AgroLinkBackend) y queda fuera del alcance de esta
  feature.
- **FR-002**: El sistema DEBE devolver, para una consulta exitosa, un único
  payload que represente exclusivamente la lectura de telemetría más reciente
  del vehículo consultado (no un historial ni una agregación de múltiples
  lecturas).
- **FR-003**: El payload de respuesta DEBE incluir la información de posición
  disponible en la lectura (ubicación, velocidad, rumbo).
- **FR-004**: El payload de respuesta DEBE incluir la información de CAN bus
  disponible en la lectura.
- **FR-005**: El payload de respuesta DEBE incluir la información del
  dispositivo de a bordo disponible en la lectura (identificador de
  dispositivo, estado de sensores propios del equipo, y el momento del evento
  al que corresponde la lectura).
- **FR-006**: "Más reciente" se DEBE determinar por el momento del evento de
  la lectura (cuándo ocurrió realmente, según lo informado por el
  dispositivo), no por el momento en que el sistema la recibió.
- **FR-007**: Si el identificador de dispositivo consultado no corresponde a
  ningún vehículo conocido por el sistema, el sistema DEBE responder
  indicando que no fue encontrado, de forma distinguible de una respuesta
  exitosa.
- **FR-008**: Si el identificador de dispositivo consultado corresponde a un
  vehículo conocido pero sin ninguna lectura de telemetría registrada, el
  sistema DEBE responder indicando que no hay datos disponibles, de forma
  distinguible de una respuesta exitosa y de un identificador no encontrado.
- **FR-009**: El sistema DEBE validar que el identificador de dispositivo
  recibido no esté vacío ni tenga un formato claramente inválido antes de
  intentar la búsqueda, rechazando la consulta en ese caso.
- **FR-010**: Esta consulta DEBE quedar accesible como una interfaz separada,
  invocable de forma independiente de las capacidades de reporte de viaje ya
  existentes en el sistema.
- **FR-011**: Esta consulta DEBE ser alcanzable desde fuera del entorno de
  despliegue del sistema (a diferencia de las consultas de reporte
  existentes, que hoy solo son accesibles dentro de la red interna del
  despliegue), a través de una vía de acceso propia y distinguible de la de
  otros servicios del despliegue.

### Key Entities

- **Vehículo**: En el alcance de esta feature, identificado únicamente por su
  identificador de dispositivo IoT (equivalente a `dispositivo_id` en
  telemetría). Su patente y demás datos maestros (marca, modelo, tenant,
  etc.) viven en AgroLinkBackend y no son conocidos por esta feature.
- **Estado de Vehículo (lectura de telemetría más reciente)**: Instantánea del
  estado de un vehículo en un momento dado. Agrupa tres bloques de
  información: posición (ubicación, velocidad, rumbo), CAN bus (datos del bus
  del vehículo tal como los reporta el dispositivo) y dispositivo (identidad
  del equipo de a bordo y estado de sus propios sensores/indicadores, como
  batería o cantidad de satélites).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un sistema cliente autorizado puede obtener el estado actual de
  un vehículo conocido, dado su identificador de dispositivo, en una sola
  consulta.
- **SC-002**: El estado devuelto corresponde siempre a la lectura de
  telemetría cronológicamente más reciente disponible para ese vehículo, aun
  cuando lecturas retrasadas lleguen fuera de orden.
- **SC-003**: Una consulta por un identificador de dispositivo inexistente o
  sin datos se distingue, sin ambigüedad, de una consulta exitosa, en el
  100% de los casos.
- **SC-004**: La consulta de estado puede invocarse desde fuera del entorno de
  despliegue sin requerir acceso a la base de datos ni a la red interna del
  sistema.

## Assumptions

- Esta feature no resuelve patentes ni conoce datos maestros de vehículos: el
  único parámetro de búsqueda es el identificador de dispositivo IoT, que
  coincide con el `dispositivo_id` ya usado en telemetría. La resolución
  patente→identificador de dispositivo es responsabilidad exclusiva de
  AgroLinkBackend, que la realiza antes de invocar esta consulta.
  (Confirmado con el usuario: `Vehicle.iotDeviceId` en AgroLinkBackend.)
- La integración entre ambos sistemas es unidireccional: AgroLinkBackend es
  el cliente que invoca esta API de ingesta; esta feature nunca llama a
  AgroLinkBackend ni depende de su disponibilidad para responder. (Confirmado
  con el usuario.)
- No existe una entidad "vehículo" separada del dispositivo de telemetría en
  el alcance de esta feature; "identificador de dispositivo no encontrado" y
  "dispositivo desconocido" son el mismo caso.
- El acceso a esta consulta no introduce un esquema de autenticación nuevo
  más allá del que ya use el resto de las interfaces expuestas del sistema.
- Los campos crudos de CAN bus se devuelven tal como los interpreta la capa
  de adaptación existente, sin agregar nueva lógica de decodificación más
  allá de la ya implementada para la ingesta.
- La vía de acceso separada requerida por FR-011 es un requisito de
  despliegue (exponer esta consulta hacia afuera, a diferencia de las
  consultas de reporte existentes) y no implica cambiar la accesibilidad de
  ninguna capacidad ya existente del sistema.
