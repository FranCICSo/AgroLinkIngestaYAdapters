# Feature Specification: Arranque automático de la simulación en el horario planificado del viaje

**Feature Branch**: `013-autostart-simulacion-viaje`

**Created**: 2026-10-10

**Status**: Partially superseded by `specs/014-simulacion-ruta-del-viaje` (2026-10-18): the
scheduled mode (wait for `estimatedStartDateTime`, reprogramación, cancelación of pending
schedules) is replaced by an immediate start on notice from AgroLinkBackend plus a stop
operation. FR-001 and FR-006 remain in force via 014.

**Input**: User description: "necesito que cuando se de de alta un viaje de los dispositivos
simulados (dispositivo id con nombre conteniendo la cadena 'demo' o del rango 90000n) se comience
a simular el mismo. Lo mismo que se puede hacer con el curl a simulador-viajes pero en la app
springboot."

## Clarifications

### Session 2026-10-10

- Q: ¿La detección de "dispositivo simulado" se evalúa a partir de qué dato? → A: El
  `iotDeviceId` del vehículo asignado al viaje (no el nombre/patente del vehículo): es simulado
  si ese id contiene la subcadena `demo`, o si es puramente numérico y cae en el rango reservado
  900001-900999 (mismo criterio que ya usa `simulador-viajes`, ver
  `specs/011-generar-ruta-simulada`).

### Session 2026-10-11

- Q: ¿Con qué sistema integra AgroLinkBackend para arrancar la simulación? → A: AgroLinkBackend
  llama únicamente a `agrolink-ingesta` (el Spring Boot de este repo); nunca llama directo a los
  endpoints HTTP de `simulador-viajes` (Node.js). Es `agrolink-ingesta` quien, server-to-server,
  reenvía internamente la solicitud a la API ya existente de `simulador-viajes` (`POST /rutas`
  con bloque `camion`, feature 011/013), reutilizando el trazado de ruta, alta de camión y
  apertura de viaje ya construidos — no se reimplementa esa lógica en Java ni se le otorga a
  `agrolink-ingesta` acceso de escritura al schema `simulador`.
- Q: ¿Cuándo debe arrancar efectivamente la simulación, y quién decide ese momento? → A: La
  simulación debe arrancar en el horario de comienzo planificado del viaje (`estimatedStartDateTime`
  en `TripService`), no en el momento del alta. AgroLinkBackend notifica a `agrolink-ingesta` una
  única vez, al dar de alta el viaje, pasándole la planificación completa (incluido ese horario);
  es `agrolink-ingesta` quien se encarga de saber cuándo corresponde lanzar la simulación y de
  hacerlo en ese instante — AgroLinkBackend no vuelve a llamar ni recuerda nada después del alta.
- Q: ¿La detección de "dispositivo simulado" debe seguir siendo un patrón genérico (contiene
  "demo", o numérico en 900001-900999), o restringirse a los vehículos concretos que siembra
  `LocalDataSeeder.java`? → A: Restringirse a una lista explícita y cerrada de `iotDeviceId`,
  calcada de los que siembra hoy `LocalDataSeeder.java` (`geo-demo-001`, `tel-demo-003`,
  `tra-demo-004`, `900001`, `900002` — vehículos `AGL001`, `AGL003`, `AGL004`, `AGL005`,
  `AGL006` del tenant demo). Un vehículo futuro cuyo `iotDeviceId` matchee el patrón "demo"/rango
  reservado por coincidencia, pero no esté en esa lista, NO dispara el mecanismo — evita activar
  llamadas externas para vehículos reales de producción que no formen parte del set conocido del
  seeder.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Arrancar la simulación sola, en el horario planificado del viaje (Priority: P1)

Un integrante del equipo registra un viaje en la aplicación (AgroLinkBackend) para uno de los
vehículos simulados conocidos del seeder (su `iotDeviceId` es exactamente uno de
`geo-demo-001`/`tel-demo-003`/`tra-demo-004`/`900001`/`900002`). Sin ejecutar ningún comando aparte (hoy haría
falta un curl manual contra `simulador-viajes`), y sin que nadie tenga que acordarse de nada más
tarde, el sistema arranca la simulación de ese dispositivo justo en el horario de comienzo
planificado del viaje — ni antes ni después — y desde ese momento la aplicación ya puede
consultar telemetría fresca para ese vehículo.

**Why this priority**: Es el dolor concreto que origina la feature — hoy, cada vez que se da de
alta un viaje para un dispositivo simulado, alguien tiene que acordarse de ejecutar a mano un
curl contra el servicio simulador, y además hacerlo justo en el horario correcto, para que
efectivamente empiece a "andar" cuando el viaje realmente debería estar en curso. Si ese paso se
olvida, o se ejecuta en el momento equivocado, el viaje queda dado de alta pero con telemetría
ausente o con un recorrido que no corresponde a su horario real.

**Independent Test**: Dar de alta un viaje nuevo para uno de los vehículos simulados conocidos del
seeder (`iotDeviceId` exactamente uno de la lista cerrada), con un horario de comienzo planificado
determinado, y sin ejecutar ningún otro comando: verificar que no aparece telemetría nueva antes
de ese horario, y que sí aparece de forma consultable a partir de ese horario.

**Acceptance Scenarios**:

1. **Given** un viaje nuevo para un vehículo cuyo `iotDeviceId` coincide exactamente con uno de la
   lista cerrada de dispositivos simulados del seeder, con un horario de comienzo planificado en
   el futuro, **When** el viaje queda dado de alta, **Then** el sistema NO arranca la simulación todavía, pero queda
   programado para arrancarla automáticamente en ese horario, sin que la persona que lo dio de
   alta ejecute ningún paso manual adicional ni en ese momento ni más tarde.
2. **Given** ese mismo viaje programado, **When** llega el horario de comienzo planificado,
   **Then** el sistema arranca automáticamente la simulación de ese dispositivo sobre el
   recorrido del viaje, sin intervención humana.
3. **Given** un viaje nuevo para un dispositivo simulado cuyo horario de comienzo planificado ya
   pasó al momento del alta (o es inmediato), **When** el viaje queda dado de alta, **Then** el
   sistema arranca la simulación de inmediato, sin esperar.
4. **Given** un viaje recién arrancado (ya alcanzado su horario planificado), **When** se consulta
   el estado/telemetría de ese vehículo, **Then** la consulta devuelve datos frescos (no un error
   de "sin telemetría"), sin que nadie haya ejecutado un comando aparte.
5. **Given** un viaje nuevo para un vehículo cuyo `iotDeviceId` no está en la lista cerrada de
   dispositivos simulados del seeder (dispositivo real, o uno que sólo coincide con el patrón
   "demo"/rango reservado por casualidad), **When** el viaje queda dado de alta, **Then** el
   sistema NO intenta arrancar ni programar ninguna simulación para ese dispositivo — el
   comportamiento no cambia.

---

### User Story 2 - El alta del viaje no se ve afectada si la simulación no puede arrancar (Priority: P2)

Un integrante del equipo da de alta un viaje para un dispositivo simulado en un momento en que el
servicio de simulación no está disponible (apagado, sin red, o rechaza la solicitud). El alta del
viaje en la aplicación se completa igual, y la persona se entera de forma clara de que la
simulación no pudo arrancar, para poder resolverlo aparte sin haber perdido el viaje ya
registrado.

**Why this priority**: Sin esta garantía, un problema transitorio del servicio de simulación
(que es un componente secundario respecto del registro del viaje en sí) podría bloquear o hacer
fallar una operación de negocio principal — dar de alta un viaje — que no debería depender de la
disponibilidad de ese componente.

**Independent Test**: Con el servicio de simulación caído o inalcanzable, dar de alta un viaje
para un dispositivo simulado y verificar que el viaje queda registrado igual, y que en algún
lugar accesible (logs) queda constancia de que el arranque de la simulación falló.

**Acceptance Scenarios**:

1. **Given** el servicio de simulación no responde o rechaza la solicitud, **When** se da de alta
   un viaje para un dispositivo simulado, **Then** el viaje queda registrado igual que si el
   servicio hubiera respondido correctamente.
2. **Given** ese mismo escenario de falla, **When** ocurre, **Then** el sistema deja constancia
   del fallo (por ejemplo en los logs de la aplicación) con suficiente detalle para que el equipo
   pueda diagnosticarlo o arrancar la simulación manualmente después.

---

### Edge Cases

- ¿Qué pasa si el viaje se da de alta para un vehículo cuyo `iotDeviceId` es simulado pero ese
  mismo dispositivo ya tiene otra simulación en curso (de un viaje anterior)? El sistema debe
  reemplazar la simulación anterior por la nueva (un dispositivo simulado no puede estar
  "recorriendo" dos viajes a la vez), sin dejar ambas corriendo en simultáneo.
- ¿Qué pasa si el viaje no tiene origen/destino geocodificados disponibles al momento del alta?
  El sistema no debe poder arrancar una simulación sin un recorrido que trazar; debe tratarse
  igual que cualquier otra falla de arranque de la simulación (User Story 2), sin bloquear el
  alta del viaje.
- ¿Qué pasa si el mismo viaje se intenta dar de alta dos veces (duplicado) para el mismo
  dispositivo simulado? No debe arrancar dos simulaciones independientes para el mismo
  dispositivo; debe comportarse igual que el caso de reemplazo descrito arriba.
- ¿Qué pasa con un viaje para un vehículo cuyo `iotDeviceId` contiene "demo" o cae en el rango
  900001-900999, pero no es exactamente ninguno de los cinco `iotDeviceId` sembrados por
  `LocalDataSeeder.java`? El sistema NO lo trata como simulado — la lista cerrada (FR-001) es la
  única fuente de verdad; parecerse al patrón no alcanza.
- ¿Qué pasa si, mientras un viaje está programado (aún no llegó su horario de arranque), el
  horario de comienzo planificado se modifica (reprogramación del viaje)? El sistema debe
  arrancar la simulación en el nuevo horario, no en el original — nunca debe quedar arrancando
  en un horario que ya fue reemplazado.
- ¿Qué pasa si un viaje programado se cancela antes de llegar su horario de arranque? El sistema
  no debe arrancar la simulación para un viaje cancelado.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST detectar, en el momento en que se da de alta un viaje, si el
  `iotDeviceId` del vehículo asignado coincide exactamente con uno de la lista cerrada de
  dispositivos simulados conocidos del seeder (`geo-demo-001`, `tel-demo-003`, `tra-demo-004`,
  `900001`, `900002`) — no un patrón genérico; un `iotDeviceId` que sólo se parezca (contenga
  "demo" o caiga en 900001-900999) sin estar en esta lista NO cuenta como simulado para esta
  feature.
- **FR-002**: El sistema MUST, cuando el dispositivo del viaje recién dado de alta es simulado,
  arrancar automáticamente la simulación de telemetría para ese dispositivo sobre el recorrido
  del viaje exactamente en el horario de comienzo planificado del viaje (`estimatedStartDateTime`)
  — nunca antes —, sin requerir que la persona que dio de alta el viaje ejecute ningún comando o
  llamada manual adicional, ni en ese momento ni más tarde para que el arranque efectivamente
  ocurra.
- **FR-002a**: El sistema MUST, cuando el horario de comienzo planificado ya pasó (o es
  inmediato) al momento del alta del viaje, arrancar la simulación de inmediato en vez de
  esperar.
- **FR-003**: El sistema MUST NOT intentar arrancar ni programar ninguna simulación para un
  viaje cuyo dispositivo asignado no sea simulado (dispositivo real).
- **FR-004**: El sistema MUST completar el alta del viaje exitosamente incluso si el intento de
  arrancar la simulación falla (servicio no disponible, rechazo, timeout, u otro error) — el
  arranque de la simulación es una operación secundaria respecto del alta del viaje en sí.
- **FR-005**: El sistema MUST dejar constancia (visible para el equipo, p. ej. en logs) cuando el
  arranque automático de la simulación falla, con suficiente detalle para diagnosticar la causa
  o arrancarla manualmente después.
- **FR-006**: El sistema MUST, si el dispositivo simulado del viaje recién dado de alta ya tenía
  otra simulación en curso (de un viaje anterior), reemplazarla por la nueva — nunca deben quedar
  dos simulaciones corriendo en simultáneo para el mismo dispositivo.
- **FR-007**: El sistema MUST usar, para arrancar la simulación, el recorrido (origen y destino
  geocodificados) ya asociado al viaje dado de alta — no debe requerir que la persona ingrese
  coordenadas por separado.
- **FR-008**: El sistema MUST recibir, en el momento del alta del viaje, toda la planificación
  necesaria (incluido el horario de comienzo planificado) en una única notificación — sin que
  AgroLinkBackend tenga que volver a llamar, recordar, ni reprogramar nada después del alta. El
  componente notificado (`agrolink-ingesta`) es responsable de saber cuándo corresponde arrancar
  la simulación y de hacerlo en ese instante.
- **FR-009**: El sistema MUST, si el horario de comienzo planificado de un viaje programado (aún
  no arrancado) se modifica, arrancar la simulación en el nuevo horario en vez del original.
- **FR-010**: El sistema MUST NOT arrancar la simulación de un viaje programado que fue
  cancelado antes de llegar su horario de arranque.

### Key Entities

- **Viaje**: Registro de negocio que representa el transporte de una carga entre un origen y un
  destino, con un vehículo (y su dispositivo IoT) asignado. Dar de alta un viaje es el evento que
  dispara esta feature.
- **Dispositivo simulado**: Uno de los cinco `iotDeviceId` exactos sembrados hoy por
  `LocalDataSeeder.java` (`geo-demo-001`, `tel-demo-003`, `tra-demo-004`, `900001`, `900002`,
  correspondientes a los vehículos `AGL001`/`AGL003`/`AGL004`/`AGL005`/`AGL006` del tenant demo)
  — una lista cerrada, no un patrón; ningún otro `iotDeviceId` cuenta como simulado para esta
  feature aunque se le parezca.
- **Simulación de telemetría**: El proceso, externo al alta del viaje, que efectivamente empieza
  a producir lecturas de telemetría periódicas para un dispositivo simulado sobre un recorrido
  determinado — hoy arrancado a mano vía un comando dirigido al servicio simulador.
- **Viaje programado**: Un viaje de un dispositivo simulado cuyo horario de comienzo planificado
  todavía no llegó; `agrolink-ingesta` ya recibió su planificación completa y es responsable de
  arrancar la simulación exactamente en ese horario, sin ninguna acción adicional de
  AgroLinkBackend.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los viajes dados de alta para un dispositivo simulado quedan con
  telemetría consultable dentro de un minuto de alcanzado su horario de comienzo planificado (o
  del alta, si ese horario ya pasó o es inmediato), sin que la persona que lo dio de alta haya
  ejecutado ningún comando manual en ese momento ni después.
- **SC-002**: Cero viajes para dispositivos reales disparan un intento de arranque de simulación.
- **SC-003**: El 100% de las altas de viaje para dispositivos simulados se completan
  exitosamente aunque el servicio de simulación esté caído en ese momento — ninguna falla de ese
  servicio provoca la pérdida de un viaje ya ingresado por la persona.
- **SC-004**: Cada falla de arranque automático de simulación queda identificable por el equipo
  (vía logs) sin necesidad de reproducir el escenario para diagnosticarla.
- **SC-005**: Cero viajes para dispositivos simulados producen telemetría antes de su horario de
  comienzo planificado.

## Assumptions

- El viaje, al momento de darse de alta, ya cuenta con origen y destino geocodificados
  (coordenadas lat/lon) — esta feature reutiliza ese dato existente, no lo genera ni lo valida.
- El patrón "contiene demo, o numérico en 900001-900999" usado por `simulador-viajes` (ver
  `specs/011-generar-ruta-simulada`, `src/domain/rangoDispositivoSimulado.js`) sigue vigente
  *dentro* de `simulador-viajes` (quién puede recibir un `camion.id` al generar una ruta) — pero
  esta feature, para decidir si *dispara* el mecanismo desde un alta de viaje, usa una lista
  cerrada más estricta (ver Clarifications, 2026-10-11): sólo los cinco `iotDeviceId` exactos que
  siembra `LocalDataSeeder.java` hoy. Si el equipo agrega vehículos simulados nuevos al seeder más
  adelante, esta lista deberá actualizarse junto con el seeder — no se mantiene sola.
- El servicio de simulación (`simulador-viajes`) ya expone, de la feature 011, una forma de
  arrancar una simulación en la misma llamada que genera un recorrido — esta feature consume esa
  capacidad ya existente, no construye un mecanismo de simulación nuevo.
- AgroLinkBackend integra exclusivamente con `agrolink-ingesta` (el Spring Boot de este repo);
  nunca llama directo a los endpoints HTTP de `simulador-viajes` (Node.js). Es `agrolink-ingesta`
  quien, server-to-server, reenvía la solicitud a `simulador-viajes` (Clarifications,
  2026-10-11) — para AgroLinkBackend, todo el flujo queda encapsulado detrás de una única llamada
  a `agrolink-ingesta`.
- Esta feature cubre el alta de un viaje y su ventana de espera hasta el horario de arranque
  (incluida una reprogramación o cancelación del viaje mientras todavía está en esa ventana, ver
  FR-009/FR-010). Qué pasa con la simulación una vez que ya arrancó — si el viaje se reprograma,
  cancela o finaliza después de ese punto — queda fuera del alcance de esta especificación.
- El alcance de "viaje" para esta feature son los viajes de flota propia (vehículo propio
  asignado directamente); los viajes tercerizados (vehículo de un transportista externo) quedan
  fuera de alcance, salvo que el equipo decida extenderlo más adelante.
