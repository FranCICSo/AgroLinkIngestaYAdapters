# Feature Specification: Odómetro en kilómetros en la consulta de estado

**Feature Branch**: `004-odometer-kilometers`

**Created**: 2026-09-15

**Status**: Draft

**Input**: User description: "odometer should be in kilometers"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consultar el odómetro del vehículo en kilómetros (Priority: P1)

Un usuario o sistema consumidor de la consulta de estado del vehículo necesita conocer
el kilometraje recorrido por el vehículo. Hoy ese valor se expone en metros
(`odometroM`), una unidad que no es la habitual para describir el kilometraje de un
vehículo y que obliga a cada consumidor a convertirla por su cuenta. Con esta
funcionalidad, el odómetro se expone directamente en kilómetros, en la unidad en la que
naturalmente se interpreta y comunica el kilometraje de un vehículo.

**Why this priority**: Es el único requisito del pedido y el que determina si la
funcionalidad tiene valor: sin la conversión a kilómetros expuesta al consumidor, la
funcionalidad no existe.

**Independent Test**: Puede probarse de forma independiente consultando el estado de un
vehículo con una lectura de telemetría persistida cuyo odómetro se conoce en metros, y
verificando que el valor de odómetro que devuelve la consulta de estado sea ese mismo
valor expresado en kilómetros.

**Acceptance Scenarios**:

1. **Given** un vehículo con una lectura de telemetría persistida cuyo odómetro
   equivale a 184,3 km, **When** se consulta el estado del vehículo, **Then** el campo
   de odómetro de la respuesta informa 184.3 (kilómetros), no el valor equivalente en
   metros.
2. **Given** un vehículo con una lectura de telemetría persistida cuyo odómetro fue
   determinado a partir del bus CAN del vehículo (origen ECU), **When** se consulta el
   estado del vehículo, **Then** el campo de odómetro se informa en kilómetros y el
   origen del dato (ECU) se sigue informando sin cambios.
3. **Given** un vehículo con una lectura de telemetría persistida cuyo odómetro fue
   determinado a partir de la posición GPS (origen GPS), **When** se consulta el estado
   del vehículo, **Then** el campo de odómetro se informa en kilómetros y el origen del
   dato (GPS) se sigue informando sin cambios.
4. **Given** un vehículo sin ninguna lectura de telemetría con odómetro conocido,
   **When** se consulta el estado del vehículo, **Then** el campo de odómetro se informa
   como dato no disponible, sin inventar un valor en kilómetros.

---

### Edge Cases

- ¿Qué pasa cuando el odómetro almacenado no es un múltiplo exacto de 1000 metros (por
  ejemplo, 184.300 m con parte fraccionaria por debajo del metro)? El valor en
  kilómetros debe conservar la precisión suficiente para no perder información
  significativa respecto del valor original en metros.
- ¿Qué pasa con consumidores existentes que ya interpretan el campo de odómetro como
  metros? Ver Assumptions: se trata como un cambio de contrato explícito, no como un
  campo adicional en paralelo.
- ¿Qué pasa cuando el odómetro almacenado es 0 (vehículo recién dado de alta, sin
  recorrido)? Debe informarse 0 kilómetros, no confundirse con "dato no disponible".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La consulta de estado del vehículo MUST informar el valor del odómetro
  en kilómetros en lugar de metros.
- **FR-002**: La conversión de metros a kilómetros MUST preservar la precisión del
  valor original (sin redondeos que pierdan información significativa respecto del dato
  almacenado en metros).
- **FR-003**: El sistema MUST seguir informando el origen del dato de odómetro (ECU o
  GPS) sin cambios, junto con el valor en kilómetros.
- **FR-004**: Cuando no exista un valor de odómetro conocido para el vehículo, el
  sistema MUST informarlo como dato no disponible, y no como 0 kilómetros ni ningún
  otro valor que pueda confundirse con una lectura real.
- **FR-005**: El almacenamiento interno del odómetro (persistencia de las lecturas de
  telemetría crudas) NO ES ALCANZADO por este cambio: la conversión a kilómetros ocurre
  únicamente en la respuesta expuesta al consumidor de la consulta de estado.

### Key Entities

- **Odómetro del vehículo**: kilometraje acumulado de un vehículo en un momento dado,
  con un valor numérico (ahora en kilómetros) y un origen (ECU o GPS) que indica de qué
  fuente de telemetría se derivó.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un consumidor de la consulta de estado del vehículo obtiene el
  kilometraje del vehículo sin necesidad de realizar ninguna conversión de unidades.
- **SC-002**: El valor de odómetro informado en kilómetros, multiplicado por 1000,
  reproduce el valor en metros que tenía la lectura de telemetría de origen, sin
  pérdida de información significativa.
- **SC-003**: El 100% de las consultas de estado de vehículos con odómetro conocido
  informan el valor en kilómetros; el 100% de las consultas de vehículos sin odómetro
  conocido informan el dato como no disponible.

## Assumptions

- Este cambio reemplaza la unidad del campo de odómetro existente en la consulta de
  estado del vehículo (hoy en metros); no se agrega un campo adicional en paralelo
  expresado en kilómetros. Se trata como un cambio de contrato de esa consulta.
- El almacenamiento interno de la telemetría (lecturas crudas persistidas) sigue en
  metros, tal como está definido hoy; sólo cambia la unidad en la que se presenta el
  odómetro al consumidor de la consulta de estado. Esto es consistente con la capa de
  adaptación existente, que ya traduce datos crudos del proveedor a un modelo propio
  antes de exponerlos.
- El origen del odómetro (ECU o GPS) es información relevante para el consumidor y se
  sigue informando sin cambios; sólo cambia la unidad del valor numérico asociado.
- Ningún otro campo de la consulta de estado (velocidad, combustible, temperatura,
  presión, tensión de batería) es alcanzado por este cambio.
