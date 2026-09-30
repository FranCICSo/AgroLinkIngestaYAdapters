# Feature Specification: Temperatura del sensor BLE en la consulta de estado

**Feature Branch**: `010-estado-temperatura-ble`

**Created**: 2026-09-29

**Status**: Draft

**Input**: User description: "agrega los campos del sensor BLE de temperatura a la respuesta de /estado de un vehículo"

## Contexto

La feature [008](../008-ble-sensor-ingestion/spec.md) dejó al receptor preparado para
recibir e ingestar la temperatura, humedad y batería de un sensor BLE (slot 0) montado en
la carga, pero por decisión explícita (esa spec, FR-012) esos valores quedan solo en la
base: la consulta de estado del vehículo no los expone. Esta funcionalidad cierra esa
brecha para la **temperatura**: un consumidor que hoy consulta el estado de un vehículo
para saber su posición, combustible y datos de motor va a poder ver también la temperatura
de la carga en la misma respuesta, sin consultar la base por separado.

Humedad y batería del sensor quedan fuera de esta funcionalidad (ver Assumptions):
solo se pidió temperatura.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver la temperatura de la carga junto con el resto del estado del vehículo (Priority: P1)

Un consumidor que ya usa la consulta de estado de un vehículo (posición, combustible,
datos de motor) para monitorear una flota necesita saber también si la carga está a una
temperatura segura, sin agregar una consulta aparte a la base de datos ni interpretar
manualmente ningún dato crudo.

**Why this priority**: Es el objetivo completo de esta funcionalidad. Sin esto, un dato ya
ingestado (feature 008) sigue siendo invisible para cualquier consumidor de la API.

**Independent Test**: Con una lectura de telemetría reciente que incluya una temperatura
de sensor BLE, consultar el estado del vehículo y verificar que la respuesta incluye esa
temperatura con el mismo valor que se ingestó.

**Acceptance Scenarios**:

1. **Given** un vehículo cuya lectura de telemetría más reciente incluye una temperatura
   de sensor BLE, **When** se consulta el estado del vehículo, **Then** la respuesta
   incluye esa temperatura, identificada por nombre propio, con el mismo valor reportado
   por el sensor.
2. **Given** un vehículo cuya lectura de telemetría más reciente no incluye una
   temperatura de sensor BLE (el vehículo no tiene sensor, o el equipo no lo reportó en
   esa lectura), **When** se consulta el estado del vehículo, **Then** la respuesta
   muestra la temperatura como "no informada", nunca como cero ni omitida en silencio, y
   el resto de la respuesta se comporta igual que hoy.
3. **Given** una consulta de estado de un vehículo cualquiera, **When** se recibe la
   respuesta, **Then** el resto de los valores ya existentes (posición, datos de motor,
   información del dispositivo) no cambia respecto del comportamiento actual.

---

### Edge Cases

- **Lecturas ya ingestadas antes de esta funcionalidad**: si la lectura más reciente de un
  vehículo no tiene temperatura de sensor BLE asociada (por ejemplo, quedó guardada antes
  de la feature 008, o llegó de un equipo sin sensor), se comporta igual que el caso normal
  de "no informada": no es un error ni una anomalía.
- **Vehículo sin ninguna lectura de telemetría**: se mantiene sin cambios el comportamiento
  actual (respuesta de "vehículo sin telemetría"); esta funcionalidad no lo modifica.
- **Valor de temperatura fuera de rango físico plausible**: se expone tal como fue
  reportado, igual que el resto de los valores de sensores y de CAN bus ya expuestos; esta
  funcionalidad no valida ni corrige rangos.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La consulta de estado de un vehículo DEBE incluir la temperatura reportada
  por el sensor BLE de la lectura de telemetría más reciente de ese vehículo, identificada
  por nombre propio.
- **FR-002**: Cuando la lectura más reciente no tenga una temperatura de sensor BLE
  asociada, la consulta de estado DEBE mostrar ese valor puntual como "no informado", nunca
  como cero ni un valor que pueda confundirse con una lectura real, y sin omitirlo en
  silencio del contrato de la respuesta.
- **FR-003**: Esta funcionalidad NO DEBE modificar ningún otro valor ya expuesto por la
  consulta de estado (posición, datos de motor y CAN bus, información del dispositivo):
  su comportamiento actual se mantiene igual.
- **FR-004**: Esta funcionalidad se limita a exponer la temperatura del sensor BLE. La
  humedad y la batería del sensor (ya ingestadas por la feature 008) quedan fuera de
  alcance.

### Key Entities

- **Estado del vehículo (consulta)**: la respuesta que un consumidor recibe al preguntar
  por la situación actual de un vehículo. Suma la temperatura del sensor BLE de la carga
  a los valores que ya expone (posición, motor/CAN bus, dispositivo).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un consumidor de la consulta de estado puede obtener la temperatura de la
  carga de un vehículo sin realizar ninguna consulta adicional a la base de datos.
- **SC-002**: El 100% de las respuestas de la consulta de estado para vehículos con
  temperatura de sensor BLE en su última lectura exponen ese valor correctamente.
- **SC-003**: Ante un vehículo sin temperatura de sensor BLE reportada, el 100% de las
  respuestas la muestran como "no informada", nunca como cero.
- **SC-004**: El 100% de las respuestas de la consulta de estado mantienen sin cambios los
  valores ya existentes antes de esta funcionalidad (cero regresiones).

## Assumptions

- Se expone únicamente la **temperatura** del sensor BLE (slot 0, feature 008). El pedido
  del usuario nombra explícitamente "el sensor BLE de temperatura"; humedad y batería,
  aunque ya están ingestadas, no se piden acá y se dejan para una funcionalidad posterior
  si se necesitan.
- Es un cambio **aditivo** al contrato de la consulta de estado: se agrega un campo nuevo,
  no se modifica ni se reubica ninguno existente (a diferencia de la reubicación de
  `tensionBateriaV` en la feature 003). No hay ruptura de compatibilidad para consumidores
  actuales.
- La temperatura se toma de la misma lectura de telemetría más reciente que ya usa la
  consulta de estado para el resto de los valores (misma fuente, sin lecturas adicionales).
- "No informada" sigue el mismo criterio ya usado para el resto de los valores opcionales
  de esta consulta (por ejemplo, RPM o temperatura de refrigerante ausentes): un valor
  nulo explícito, nunca cero ni un campo omitido del contrato.
- No se agrega ningún indicador de alerta ni umbral de temperatura segura/insegura: esta
  funcionalidad solo expone el dato, no lo interpreta.
