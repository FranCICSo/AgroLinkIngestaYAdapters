# Feature Specification: Almacenar el odómetro en kilómetros

**Feature Branch**: `005-odometer-storage-km`

**Created**: 2026-09-15

**Status**: Draft

**Input**: User description: "change also column odometro_m to odometro_km in table lectura_telemetria. Use double as type and check if rinho-parser should be changed also. It is because SpiderIoT has odometer value in km, not m https://docs.rinho.com.ar/comandos/configuracion-y-consulta-de-estados/canbus/comandos-canxx"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El odómetro se guarda y se calcula en kilómetros de punta a punta (Priority: P1)

Hoy el sistema guarda internamente el odómetro en metros (`lectura_telemetria.odometro_m`)
y lo convierte a kilómetros recién en la respuesta de la consulta de estado (feature
004). Esa conversión es una traducción de ida y vuelta: el equipo de a bordo (Rinho
Spider IoT) ya reporta su odómetro de ECU directamente en kilómetros por el bus CAN
(identificador `B`), y hoy la capa de ingesta lo multiplica por 1000 para forzarlo a
metros, solo para que la consulta de estado lo vuelva a dividir por 1000 más adelante.
Con esta funcionalidad, el odómetro se persiste directamente en kilómetros, evitando esa
doble conversión y dejando que el resto del sistema (reportes de viaje incluidos)
trabaje sobre esa misma unidad de forma consistente.

**Why this priority**: Es el único cambio pedido y el que determina si la funcionalidad
tiene sentido: sin persistir en kilómetros, no hay beneficio real sobre lo que ya entrega
la feature 004 (que solo convertía en la respuesta, no en el almacenamiento).

**Independent Test**: Puede probarse de forma independiente enviando una lectura de
telemetría con odómetro de ECU conocido (CAN id `B`, en kilómetros) y verificando que el
valor persistido y el expuesto por la consulta de estado coincidan exactamente, sin que
ocurra ninguna multiplicación ni división de por medio salvo cuando el origen es GPS
(que sigue reportando en metros de forma nativa).

**Acceptance Scenarios**:

1. **Given** una lectura de telemetría entrante cuyo bus CAN informa el odómetro de ECU
   (identificador `B`) en kilómetros, **When** la lectura se persiste, **Then** el valor
   guardado es ese mismo valor en kilómetros, sin conversión adicional, y el origen
   queda marcado como ECU.
2. **Given** una lectura de telemetría entrante sin odómetro de ECU pero con posición GPS
   que incluye su propio contador de distancia (nativamente en metros), **When** la
   lectura se persiste, **Then** el valor guardado es ese contador convertido a
   kilómetros, y el origen queda marcado como GPS.
3. **Given** un vehículo con lecturas ya persistidas antes de este cambio, **When** se
   despliega esta funcionalidad, **Then** el valor histórico de cada lectura sigue
   representando la misma distancia real que representaba antes (no se pierde ni se
   duplica magnitud alguna al re-expresarlo en kilómetros).
4. **Given** un vehículo con un odómetro conocido, **When** se consulta su estado más
   reciente o su reporte de viaje, **Then** ambos reflejan la distancia en kilómetros de
   forma consistente entre sí y sin decimales espurios de una conversión que ya no
   ocurre en ese punto.

### Edge Cases

- ¿Qué pasa con una lectura cuyo odómetro de ECU llega con parte fraccionaria de
  kilómetro (por ejemplo, un valor no entero)? Debe conservarse esa fracción, no
  truncarse.
- ¿Qué pasa con el reporte de viaje que hoy informa la distancia recorrida asumiendo
  metros? Debe seguir siendo correcto y coherente con la nueva unidad de
  almacenamiento (ver Assumptions).
- ¿Qué pasa con una lectura sin ningún dato de odómetro (ni ECU ni GPS)? Sigue
  quedando sin valor conocido, igual que hoy — este cambio no altera esa semántica.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST persistir el odómetro de cada lectura de telemetría en
  kilómetros en lugar de metros.
- **FR-002**: Cuando el odómetro provenga del ECU del vehículo (que ya lo reporta en
  kilómetros), el sistema MUST persistir ese valor sin convertirlo a otra unidad
  primero.
- **FR-003**: Cuando el odómetro provenga del GPS del equipo (que lo reporta
  nativamente en metros), el sistema MUST convertirlo a kilómetros antes de
  persistirlo, preservando su precisión.
- **FR-004**: El sistema MUST seguir registrando el origen del odómetro (ECU o GPS)
  sin cambios de semántica, independientemente de la unidad de almacenamiento.
- **FR-005**: Los valores de odómetro persistidos antes de este cambio MUST
  reinterpretarse a kilómetros de forma que seguir representando la misma distancia
  real (no un valor 1000 veces mayor ni menor).
- **FR-006**: Todo cálculo o respuesta del sistema que hoy deriva del odómetro (consulta
  de estado del vehículo, reporte de viaje) MUST seguir siendo correcto y coherente
  entre sí una vez que la unidad de almacenamiento cambia a kilómetros.
- **FR-007**: El sistema MUST seguir tratando un odómetro desconocido como "sin dato"
  (no como `0`), sea cual sea la unidad de almacenamiento.

### Key Entities

- **Odómetro del vehículo**: kilometraje acumulado de un vehículo al momento de una
  lectura de telemetría, con un valor numérico (ahora en kilómetros, antes en metros) y
  un origen (ECU o GPS) que indica de qué fuente de telemetría se derivó.
- **Reporte de viaje**: cálculo derivado que hoy incluye la distancia recorrida entre
  dos lecturas, obtenida restando el odómetro de la última menos el de la primera
  dentro de un rango; su magnitud pasa a expresarse en la misma unidad que el
  almacenamiento (kilómetros).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El valor de odómetro reportado por el ECU de un vehículo se persiste y se
  expone sin ninguna conversión de unidades de por medio (se elimina la doble
  conversión km→m→km existente).
- **SC-002**: El valor de odómetro de cualquier lectura, expresado en kilómetros después
  de este cambio, representa exactamente la misma distancia real que representaba en
  metros antes del cambio (conversión de unidades sin pérdida de magnitud, en datos
  nuevos y ya existentes).
- **SC-003**: La distancia recorrida calculada por el reporte de viaje es idéntica
  (salvo la unidad en la que se expresa) antes y después de este cambio, para el mismo
  conjunto de lecturas.

## Assumptions

- El "rinho-parser" al que se refiere el pedido es la capa de ingesta que traduce la
  trama del equipo Rinho Spider IoT al modelo de dominio (`rinho-receptor`, función
  `resolveOdometro` en `lecturaMapper.js`, y el parseo de la sección GPS en
  `eqParser.js`). Se revisó contra la documentación del fabricante citada en el pedido
  (docs.rinho.com.ar, comandos CANxx): confirma que el CAN id `B` (odómetro de ECU) es
  kilómetros, dato que este proyecto ya tenía identificado y aplicado (ver
  `specs/001-ingesta-adaptacion-telemetria/research.md`, decisión D-05) — hoy ese valor
  en km se multiplica por 1000 para guardarlo como metros; con este cambio, se guarda
  directamente en kilómetros, sin esa multiplicación. El campo de odómetro de la
  sección GPS, en cambio, sigue siendo nativamente metros según el mismo contrato del
  fabricante, y sigue necesitando su propia conversión (ahora a kilómetros en vez de
  quedarse en metros).
- Este cambio reemplaza la columna de almacenamiento existente (renombrar y cambiar de
  tipo, no agregar una columna en paralelo), siguiendo el mismo criterio de "una sola
  unidad por campo, sin mezclar" ya aplicado en la feature 004 para el campo expuesto
  por la consulta de estado.
- El reporte de viaje (`ReporteViajeService`, feature 001) queda alcanzado por este
  cambio en la medida necesaria para que su cálculo de distancia siga siendo correcto y
  quede expresado de forma coherente con la nueva unidad de almacenamiento — incluyendo
  renombrar cualquier campo de su contrato que hoy declare explícitamente "metros" en su
  nombre, si ese campo pasa a expresarse en kilómetros. No se rediseña ningún otro
  aspecto de ese reporte.
- La consulta de estado del vehículo (feature 004), que hoy convierte metros a
  kilómetros al responder, deja de necesitar esa conversión una vez que el
  almacenamiento ya está en kilómetros: sigue exponiendo el mismo campo y unidad que
  hoy (`canBus.odometroKm`), simplemente sin el paso de conversión intermedio.
- Los datos ya persistidos antes de este cambio se reinterpretan (se re-expresan en la
  nueva unidad), no se recalculan a partir de la trama original: no se vuelve a
  contactar al equipo de campo ni se reprocesa el payload crudo para este cambio.
