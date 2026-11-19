# Feature Specification: Último valor CAN no nulo en la consulta de estado

**Feature Branch**: `feature/estado-ultimo-valor-can-no-nulo`

**Created**: 2026-11-15

**Status**: Implemented

**Alcance cross-repo**: el cambio funcional está en `agrolink-ingesta` (este repo). AgroLinkBackend
se adapta para no tomar como lectura nueva un valor arrastrado (FR-008 y FR-009). Esa parte quedó
registrada como enmienda en sus specs `012-odometer-telemetry-sync` y `016-ble-temperature-alerts`,
y en la spec `016-alerta-temperatura-motor` de este repo. Se despliegan a la par.

**Input**: User description: "Que cuando se busquen datos de la tabla lectura_telemetria para
obtener datos CAN, como por ejemplo el porcentaje de carga de combustible, `/estado` los traiga
desde el último dato no nulo, pero que la posición que viene sea siempre la más actual."

## Contexto

`GET /api/v1/vehiculos/{dispositivoId}/estado` arma toda la respuesta con la lectura más reciente
del dispositivo (feature 002). Muchas tramas del Rinho llegan sin datos CAN: por ejemplo, las de
posición que el equipo manda entre dos reportes completos. Cuando la última trama es una de esas,
`canBus` viene entero en `null`, y el mapa de flota pierde el nivel de combustible, el odómetro y la
temperatura del motor hasta la próxima trama completa, aunque esos datos se conozcan desde hace unos
minutos.

## Clarifications

### Session 2026-11-15

- Q: ¿Qué campos de `canBus` se completan con el último valor no nulo? → A: `combustiblePct`,
  `combustibleConsumidoL`, `odometroKm` (con su `odometroOrigen`), `vin`, `rpm` y
  `temperaturaRefrigeranteC`. `velocidadRuedaKmh`, `presionAceiteKpa`, `tensionBateriaV` y
  `bleTemperaturaC` siguen saliendo solo de la última lectura.
- Q: ¿Hasta cuánto tiempo atrás se busca el último valor? → A: 24 h.
- Q: ¿Cómo se entera el consumidor de que un valor no es de la última lectura? → A: Cada campo
  arrastrado trae su propio momento (`<campo>Momento`), que es el `momento_evento` de la lectura de la
  que salió.
- Q: `rpm` y `temperaturaRefrigeranteC` cambian rápido: con el motor apagado, un valor arrastrado
  puede mostrar un motor en marcha o caliente que ya no lo está. ¿Se arrastran igual? → A: Sí. El
  `*Momento` deja ver su antigüedad, y AgroLinkBackend no usa un valor arrastrado para la alerta de
  sobrecalentamiento (FR-008).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver el último dato CAN conocido aunque la última trama no lo traiga (Priority: P1)

Como usuario del mapa de flota, quiero ver el nivel de combustible, el odómetro y la temperatura del
motor de un camión aunque su última trama haya llegado sin datos CAN, junto con la posición más
reciente.

**Why this priority**: es el pedido. Sin esto, esos datos aparecen y desaparecen según el tipo de
trama.

**Independent Test**: con un dispositivo cuya última lectura no tiene datos CAN y una anterior
(dentro de las 24 h) que sí los tiene, consultar `/estado` y comprobar que `posicion` es la de la
última lectura y que los campos arrastrables traen los valores de la anterior.

**Acceptance Scenarios**:

1. **Given** una última lectura con posición y sin CAN, y una lectura 30 min anterior con combustible
   al 61,5 %, **When** se consulta `/estado`, **Then** `posicion` y `dispositivo.momentoEvento` son
   los de la última lectura, y `canBus.combustiblePct` es 61,5.
2. **Given** que el último VIN informado es de 20 h antes de la última lectura y el último
   combustible es de 30 min antes, **When** se consulta `/estado`, **Then** cada campo sale de su
   propia lectura más reciente con dato, no de una única lectura en común.
3. **Given** que la única lectura con dato CAN es de más de 24 h antes de la última, **When** se
   consulta `/estado`, **Then** esos campos vienen en `null`.

---

### User Story 2 - Saber qué tan viejo es cada dato (Priority: P1)

Como consumidor de `/estado` (el backend o el mapa), quiero saber de qué momento es cada valor
arrastrado, para no tratar un dato de hace horas como actual.

**Why this priority**: sin esto, el arrastre engaña. Un `rpm` de hace 3 h parece un motor en marcha
ahora mismo, y la alerta de sobrecalentamiento del backend se dispararía con datos viejos.

**Independent Test**: en el escenario de la Historia 1, comprobar que
`canBus.combustiblePctMomento` es el `momento_evento` de la lectura de 30 min antes, y que es
distinto de `dispositivo.momentoEvento`.

**Acceptance Scenarios**:

1. **Given** un campo arrastrado, **When** se consulta `/estado`, **Then** su `*Momento` es el
   `momento_evento` de la lectura de la que salió.
2. **Given** un campo que vino en la última lectura, **When** se consulta `/estado`, **Then** su
   `*Momento` es igual a `dispositivo.momentoEvento`.
3. **Given** un campo sin ningún valor en la ventana, **When** se consulta `/estado`, **Then** el
   campo y su `*Momento` vienen en `null`.

---

### Edge Cases

- **Vehículo que dejó de reportar hace días**: la ventana se cuenta desde su última lectura, no desde
  ahora. Sigue mostrando los valores de su último día de actividad, y los `*Momento` muestran su
  antigüedad.
- **Lecturas atrasadas** (Principio VII): una trama vieja que llega tarde se ordena por
  `momento_evento`, así que no pisa un valor más reciente.
- **Odómetro y su origen**: `odometroOrigen` se toma de la misma lectura que `odometroKm`. Nunca se
  combina el valor de una lectura con el origen de otra.
- **Dos lecturas con el mismo `momento_evento`**: es improbable, porque el receptor deduplica por
  dispositivo, momento y hash de la trama. Si pasara, el valor puede salir de cualquiera de las dos.
- **Ingesta y backend desplegados en momentos distintos**: un backend sin la adaptación (FR-008 y
  FR-009) tomaría los valores arrastrados como nuevos. Un backend adaptado que consulte una ingesta
  sin los `*Momento` se comporta como antes. Por eso conviene desplegar el backend antes o junto con
  la ingesta.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `posicion`, `dispositivo` y los campos de `canBus` no arrastrables
  (`velocidadRuedaKmh`, `presionAceiteKpa`, `tensionBateriaV` y `bleTemperaturaC`) MUST seguir
  saliendo de la lectura con `momento_evento` más reciente del dispositivo, igual que antes.
- **FR-002**: `combustiblePct`, `combustibleConsumidoL`, `odometroKm`, `vin`, `rpm` y
  `temperaturaRefrigeranteC` MUST tomar, cada uno por separado, el último valor no nulo entre las
  lecturas del dispositivo con `momento_evento` en las 24 h previas a la lectura más reciente,
  incluida esa misma lectura.
- **FR-003**: `odometroOrigen` MUST salir de la misma lectura que `odometroKm`.
- **FR-004**: Cada campo de FR-002 MUST traer en `canBus` su momento (`combustiblePctMomento`,
  `combustibleConsumidoLMomento`, `odometroMomento`, `vinMomento`, `rpmMomento` y
  `temperaturaRefrigeranteCMomento`), que es el `momento_evento` de la lectura de la que salió el
  valor.
- **FR-005**: Si ninguna lectura de la ventana trae un campo de FR-002, ese campo y su momento MUST
  venir en `null`. Nunca se informan como 0 (se mantiene FR-010 de la feature 003).
- **FR-006**: El cambio de contrato MUST ser aditivo: ningún campo existente cambia de nombre, tipo
  ni bloque.
- **FR-007**: La consulta de estado MUST seguir siendo de solo lectura (Principio IV) y no requerir
  migraciones de base.
- **FR-008** *(AgroLinkBackend)*: La alerta `ENGINE_OVERHEAT` MUST evaluarse solo con una
  `temperaturaRefrigeranteC` cuyo momento sea el de la última lectura. Un valor arrastrado se muestra
  en el mapa, pero no abre, no mantiene ni reabre la alerta.
- **FR-009** *(AgroLinkBackend)*: Un `odometroKm` arrastrado MUST tratarse como "sin odómetro en
  este ciclo". No se registra como lectura de telemetría nueva.

### Key Entities

- **Valor CAN arrastrado**: valor de un campo de FR-002 que sale de una lectura anterior a la última,
  junto con el momento de esa lectura.
- **Ventana de arrastre**: intervalo de 24 h que termina en el `momento_evento` de la última lectura
  del dispositivo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Para un vehículo que reportó datos CAN en las últimas 24 h de actividad, `/estado` no
  devuelve `combustiblePct` en `null` por el solo hecho de que la última trama haya llegado sin CAN.
- **SC-002**: La posición devuelta es siempre la de la lectura más reciente: el cambio no la retrasa
  respecto del comportamiento anterior.
- **SC-003**: En el 100 % de las respuestas, cada campo arrastrable no nulo trae su `*Momento`, y un
  campo nulo trae su `*Momento` también nulo.
- **SC-004**: Con la adaptación del backend desplegada, un valor arrastrado nunca abre ni reabre una
  alerta `ENGINE_OVERHEAT` ni agrega una lectura al historial de odómetro.

## Assumptions

- **Ventana fija**: 24 h, como constante en el servicio (`EstadoVehiculoService.VENTANA_ULTIMO_VALOR_CAN`).
  No se pidió que sea configurable.
- **Sin cambios en el mapa**: el backend ya guarda en `normalized_telemetry` lo que recibe, así que
  el mapa muestra los valores arrastrados sin cambios. Mostrar en el mapa la antigüedad de cada
  dato necesitaría una migración en el backend y queda fuera de alcance.
- **Fuera de alcance**: arrastrar `velocidadRuedaKmh`, `presionAceiteKpa`, `tensionBateriaV` y
  `bleTemperaturaC`, y hacer la ventana configurable.
