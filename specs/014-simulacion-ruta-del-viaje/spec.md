# Feature Specification: Simulación inmediata sobre la ruta del viaje, con detención

**Feature Branch**: `feature/start-simulation-when-trip-starts`

**Created**: 2026-10-18

**Status**: Draft

**Supersedes**: el modo programado de `specs/013-autostart-simulacion-viaje` (espera hasta el
horario planificado, reprogramación y cancelación de planificaciones pendientes). Se mantienen la
lista cerrada de dispositivos simulados (013 FR-001), el reenvío server-to-server a
`simulador-viajes` sin acceso de escritura al schema `simulador` (013 Clarifications) y el
reemplazo de una simulación previa del mismo dispositivo (013 FR-006).

**Counterpart**: el disparo desde AgroLinkBackend al iniciar el viaje
(DESPACHADO→EN_ROUTE) y el cálculo de la ruta que se envía se especifican en
`AgroLinkBackend/specs/026-simulacion-al-iniciar-viaje`.

**Input**: User description: "La simulación deja de programarse por horario estimado y arranca
cuando AgroLinkBackend avisa que el viaje inició, siguiendo exactamente el camino dibujado en el
mapa del viaje (AgroLinkBackend envía el trazado y las velocidades por tramo). Al cancelarse o
completarse el viaje, AgroLinkBackend pide detener la simulación. Reemplaza el modo programado."

## Clarifications

### Session 2026-10-19

- Q: ¿Qué regla de velocidad comparten el mapa y el simulador? → A: Una sola regla: la velocidad
  típica del tramo según el ruteo, acotada al tope legal de 012 FR-002 (60 km/h zona urbana,
  80 km/h ruta/autopista). AgroLinkBackend envía las velocidades ya acotadas; el simulador avanza
  el camión a la velocidad de cada tramo (con la variación verosímil de 012) en lugar de la
  velocidad fija de ~40 km/h introducida en `4302f7e`, y vuelve a aplicar el tope como resguardo.
- Q: ¿Existe hoy una operación para detener una simulación en curso? → A: No. `agrolink-ingesta`
  solo cancela planificaciones `PENDIENTE` y `simulador-viajes` no expone ninguna detención por
  HTTP (solo finaliza internamente el viaje en curso de un camión al arrancar otro). La detención
  de la Historia 3 es funcionalidad nueva en ambos componentes.
- Q: ¿Cómo se clasifica un tramo como urbano (60) o de ruta (80)? → A: No se clasifica: se usa un
  único tope de 80 km/h para todos los tramos, y la velocidad urbana surge de la velocidad típica
  baja que el ruteo ya informa para calles urbanas. El tope urbano estricto de 60 km/h deja de ser
  un criterio verificable para rutas con velocidades de ruteo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Arrancar la simulación en el momento en que se avisa el inicio (Priority: P1)

AgroLinkBackend avisa que un viaje de un dispositivo simulado acaba de iniciar. Sin ninguna
espera ni programación, el camión simulado empieza a recorrer el viaje y la telemetría queda
consultable en el siguiente ciclo de simulación.

**Why this priority**: Es el reemplazo directo del modo programado: el momento de arranque ahora
lo decide la operación real del viaje en AgroLinkBackend, no un horario estimado guardado de
este lado.

**Independent Test**: Enviar un aviso de inicio para uno de los dispositivos simulados conocidos
con origen y destino válidos y verificar que la simulación arranca de inmediato (sin depender de
ningún horario) y que aparece telemetría fresca dentro del siguiente ciclo.

**Acceptance Scenarios**:

1. **Given** un dispositivo de la lista cerrada de simulados, **When** llega un aviso de inicio
   con código de viaje, origen y destino válidos, **Then** la simulación arranca de inmediato y
   el aviso se responde como aceptado.
2. **Given** un dispositivo que no está en la lista cerrada, **When** llega un aviso de inicio,
   **Then** se rechaza como dispositivo no simulado y no se arranca nada.
3. **Given** un aviso de inicio sin origen o destino, **When** llega, **Then** se rechaza por
   coordenadas faltantes y no se arranca nada.
4. **Given** que el dispositivo ya tiene otra simulación en curso de un viaje anterior, **When**
   llega el aviso de inicio de un viaje nuevo, **Then** la simulación anterior se reemplaza por
   la nueva; nunca quedan dos en simultáneo.
5. **Given** un aviso de inicio repetido para el mismo viaje y dispositivo que ya está
   simulándose, **When** llega, **Then** se responde como aceptado sin arrancar una segunda
   simulación ni reiniciar el recorrido.
6. **Given** un aviso de inicio con un código de viaje ya asociado a otro dispositivo, **When**
   llega, **Then** se rechaza sin modificar la simulación del otro dispositivo.
7. **Given** que el servicio simulador no está disponible, **When** llega el aviso de inicio,
   **Then** el fallo queda registrado con el código de viaje y el dispositivo, y la respuesta lo
   informa como error sin reintentos automáticos.

---

### User Story 2 - El camión recorre exactamente el trazado recibido (Priority: P1)

Cuando el aviso de inicio trae el trazado de la ruta y las velocidades por tramo, el camión
simulado recorre ese trazado, de forma que sus posiciones coinciden con el camino que
AgroLinkBackend dibuja en el mapa del viaje.

**Why this priority**: Hoy el simulador vuelve a trazar la ruta con su propio servidor de ruteo y
puede elegir un camino distinto al del mapa. Usar el trazado recibido elimina esa diferencia.

**Independent Test**: Enviar un aviso de inicio con un trazado conocido y verificar que la ruta
simulada generada sigue ese trazado (todos sus puntos sobre el trazado recibido) y que no se
consultó el servidor de ruteo propio.

**Acceptance Scenarios**:

1. **Given** un aviso de inicio con trazado y velocidades válidos, **When** se arranca la
   simulación, **Then** la ruta simulada se construye a partir de ese trazado, sin consultar el
   servidor de ruteo propio, y conserva el realismo de velocidad por tramo de la feature 012.
2. **Given** un aviso de inicio con trazado pero sin velocidades, **When** se arranca, **Then**
   se usa el trazado recibido con velocidades por defecto dentro de los límites verosímiles de la
   feature 012.
3. **Given** un aviso de inicio sin trazado, **When** se arranca, **Then** la ruta se traza con el
   servidor de ruteo propio, igual que hasta hoy, y se registra que la simulación podría no
   coincidir con el mapa.
4. **Given** un trazado que no se puede interpretar, que tiene menos de dos puntos, o cuyos
   extremos están lejos del origen o el destino informados, **When** llega, **Then** el aviso se
   rechaza por trazado inválido y no se arranca nada.

---

### User Story 3 - Detener la simulación cuando el viaje termina o se cancela (Priority: P2)

AgroLinkBackend avisa que un viaje que estaba simulándose se completó o se canceló. El camión
simulado deja de recorrer ese viaje.

**Why this priority**: Evita que un viaje cancelado a mitad de camino siga mostrando movimiento.
Menos urgente que el arranque porque solo afecta al cierre.

**Independent Test**: Arrancar una simulación, enviar un aviso de detención para ese viaje y
verificar que deja de avanzar y de emitir telemetría de ese viaje dentro del siguiente ciclo.

**Acceptance Scenarios**:

1. **Given** una simulación en curso para un viaje, **When** llega el aviso de detención de ese
   viaje y dispositivo, **Then** la simulación se detiene y el aviso se responde como aceptado.
2. **Given** que no hay simulación en curso para ese viaje (ya se detuvo, nunca arrancó o falló
   al arrancar), **When** llega el aviso de detención, **Then** se responde como aceptado sin
   efecto (idempotente).
3. **Given** que el dispositivo ya está simulando un viaje más nuevo, **When** llega una
   detención de un viaje anterior de ese dispositivo, **Then** la simulación del viaje más nuevo
   no se toca.
4. **Given** un aviso de detención con un código de viaje asociado a otro dispositivo, **When**
   llega, **Then** no se detiene la simulación del otro dispositivo.

---

### User Story 4 - El camión espera en destino hasta que el viaje se cierra (Priority: P2)

Cuando el camión simulado de un viaje avisado por AgroLinkBackend llega a destino, se queda
detenido allí, sin generar un viaje de vuelta automático, y sigue reportando su estado
(incluida la temperatura de la carga refrigerada) hasta recibir la detención.

**Why this priority**: En AgroLinkBackend el viaje sigue abierto mientras espera la descarga; un
viaje de vuelta automático mostraría el camión alejándose de un viaje que aún no terminó, y
cortar la telemetría dejaría sin evidencia de frío la etapa de espera.

**Independent Test**: Arrancar una simulación con un trazado corto, dejar que llegue a destino y
verificar que no se genera un viaje de vuelta y que siguen llegando lecturas con el camión
detenido en el destino hasta enviar la detención.

**Acceptance Scenarios**:

1. **Given** un viaje simulado avisado por AgroLinkBackend, **When** el camión llega a destino,
   **Then** queda detenido en el destino, sin viaje de vuelta automático, emitiendo lecturas con
   velocidad cero.
2. **Given** ese camión detenido en destino, **When** llega la detención del viaje, **Then** deja
   de emitir lecturas de ese viaje.
3. **Given** una ruta creada manualmente (por línea de comandos o pedido directo sin aviso de
   AgroLinkBackend), **When** el camión llega al final, **Then** conserva el comportamiento
   actual de viaje de vuelta automático.

---

### Edge Cases

- **Planificaciones pendientes del modo anterior**: las que hubieran quedado sin disparar al
  desplegar esta versión no se disparan más; se marcan como canceladas, con registro.
- **Detención antes que inicio**: los avisos pueden llegar en distinto orden; una detención para
  un viaje sin simulación se acepta sin efecto, y un inicio posterior para ese mismo viaje ya
  detenido se rechaza como no modificable para no revivir un viaje cerrado.
- **Trazado muy largo**: viajes de larga distancia producen trazados con miles de puntos; deben
  aceptarse sin rechazo por tamaño dentro de un límite razonable documentado en el plan.
- **Reinicio del servicio simulador con un camión esperando en destino**: al retomar, el camión
  sigue detenido en el destino (el estado de espera persiste igual que el progreso del viaje).
- **Viaje que nunca recibe detención**: el camión queda esperando en destino indefinidamente; se
  acepta para el alcance de demo y se documenta como limitación.

## Requirements *(mandatory)*

### Functional Requirements

**Inicio**

- **FR-001**: El sistema MUST arrancar la simulación inmediatamente al recibir un aviso de inicio
  válido, sin programarla para un horario futuro, independientemente de la hora de inicio que
  traiga el aviso.
- **FR-002**: El sistema MUST seguir aceptando avisos solo para los dispositivos de la lista
  cerrada de 013 y rechazar los demás como dispositivo no simulado.
- **FR-003**: El sistema MUST rechazar un aviso de inicio sin origen o destino completos.
- **FR-004**: El sistema MUST tratar como aceptado, sin efecto, un aviso de inicio repetido para
  un viaje y dispositivo que ya está simulándose.
- **FR-005**: El sistema MUST rechazar un aviso de inicio para un viaje ya detenido o asociado a
  otro dispositivo, sin modificar ninguna simulación existente.
- **FR-006**: El sistema MUST reemplazar la simulación en curso de un dispositivo cuando llega el
  inicio de un viaje distinto para ese dispositivo.

**Trazado**

- **FR-007**: Cuando el aviso de inicio incluye un trazado válido, el sistema MUST construir la
  ruta simulada a partir de ese trazado y MUST NOT consultar el servidor de ruteo propio.
- **FR-008**: Cuando el aviso incluye velocidades por tramo coherentes con el trazado, el sistema
  MUST avanzar el camión a la velocidad de cada tramo, con la variación verosímil de 012 y
  acotada a un único tope de 80 km/h (sin clasificar urbano/ruta), y MUST usar las mismas
  velocidades para densificar el trazado; si faltan o no corresponden al trazado, MUST usar
  velocidades por defecto dentro del mismo tope.
- **FR-008a**: La misma regla de avance por velocidad de tramo MUST aplicarse a las rutas que el
  simulador traza con su propio ruteo (FR-009), usando la velocidad típica que ese ruteo informa,
  acotada al mismo tope. Las rutas sin velocidades por tramo (sembradas o manuales)
  conservan la velocidad por defecto actual.
- **FR-009**: Cuando el aviso no incluye trazado, el sistema MUST trazar la ruta con el servidor
  de ruteo propio como hasta hoy y registrar que la simulación puede no coincidir con el mapa.
- **FR-010**: El sistema MUST rechazar como trazado inválido uno que no se pueda interpretar,
  tenga menos de dos puntos o cuyos extremos estén a más de 500 metros del origen o el destino
  informados.

**Detención y fin de recorrido**

- **FR-011**: El sistema MUST ofrecer una operación de detención (nueva: hoy no existe en
  `agrolink-ingesta` ni en `simulador-viajes`) por dispositivo y código de viaje que detenga la
  simulación en curso de ese viaje, reenviada server-to-server de `agrolink-ingesta` a
  `simulador-viajes` sin acceso de escritura al schema `simulador`.
- **FR-012**: La detención MUST ser idempotente: si no hay simulación en curso para ese viaje,
  MUST responder como aceptada sin efecto.
- **FR-013**: La detención MUST afectar solo la simulación del viaje indicado; MUST NOT detener
  la simulación de un viaje más nuevo del mismo dispositivo ni la de otro dispositivo.
- **FR-014**: Para viajes arrancados por aviso de inicio, al llegar a destino el camión MUST
  quedar detenido en el destino emitiendo lecturas con velocidad cero, sin viaje de vuelta
  automático, hasta recibir la detención.
- **FR-015**: Las rutas creadas sin aviso de inicio (línea de comandos o pedido directo) MUST
  conservar el viaje de vuelta automático actual.

**Reemplazo del modo programado**

- **FR-016**: El sistema MUST dejar de ofrecer la reprogramación y la cancelación de
  planificaciones pendientes, y MUST dejar de disparar simulaciones por horario.
- **FR-017**: Al desplegarse esta versión, las planificaciones pendientes del modo anterior MUST
  marcarse como canceladas y registrarse, sin dispararse.

**Garantías heredadas**

- **FR-018**: Toda falla de arranque o detención MUST registrarse con el código de viaje y el
  dispositivo, sin reintentos automáticos.
- **FR-019**: El sistema MUST conservar un registro por viaje de cada inicio y detención
  recibidos y su resultado (arrancado, detenido, error con detalle) para diagnóstico.

### Key Entities

- **Aviso de inicio**: código de viaje, dispositivo, hora real de inicio, origen, destino y,
  opcionalmente, trazado y velocidades por tramo.
- **Aviso de detención**: código de viaje y dispositivo.
- **Registro de viaje simulado** (evoluciona la planificación de 013): un registro por código de
  viaje con su dispositivo, coordenadas, si usó trazado recibido o propio, estado (arrancado,
  detenido, error) y detalle del último resultado.
- **Ruta simulada**: trazado densificado que recorre el camión; ahora puede originarse en el
  trazado recibido.
- **Viaje en curso del simulador**: progreso del camión sobre la ruta; gana el estado de espera
  en destino para viajes arrancados por aviso.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los avisos de inicio válidos producen telemetría consultable dentro de
  los 2 minutos.
- **SC-002**: Cuando el aviso trae trazado, el 100% de las posiciones simuladas quedan a menos de
  30 metros de ese trazado.
- **SC-003**: Cero simulaciones se disparan por horario después del despliegue.
- **SC-004**: El 100% de las detenciones de un viaje en curso dejan de producir movimiento de ese
  viaje dentro de los 2 minutos; el 100% de las detenciones repetidas o tardías se aceptan sin
  error.
- **SC-005**: Cero viajes arrancados por aviso generan un viaje de vuelta automático.
- **SC-006**: En un viaje arrancado con trazado y velocidades, el tiempo hasta llegar a destino
  difiere en menos del 10% de la duración planificada que informa AgroLinkBackend, y ninguna
  trama supera 80 km/h.

## Assumptions

- AgroLinkBackend envía el aviso de inicio una sola vez por viaje, en la transición a "en ruta",
  y el aviso de detención al cancelar o completar un viaje iniciado (spec 026 de ese repo).
- El trazado llega en el formato de polilínea codificada estándar que ya usa el mapa, con una
  velocidad por tramo en km/h; el formato exacto se fija en el contrato del plan.
- Los endpoints siguen bajo el prefijo `/api/v1/vehiculos/{dispositivoId}/**` ya permitido por el
  filtro de acceso, y `simulador-viajes` sigue sin publicarse fuera de la red interna.
- La identificación de "qué viaje en curso del simulador corresponde a un código de viaje" se
  apoya en la ruta generada para ese código (hoy nombrada a partir del código); el mecanismo
  exacto se define en el plan.
- La espera indefinida en destino sin detención es aceptable para el uso de demo.
- El tope de 80 km/h es la misma regla en ambos repositorios; si cambia, debe cambiar en los dos
  a la vez.
- Para rutas con velocidades de ruteo, esta feature relaja 012 FR-002/SC-002: el tope urbano de
  60 km/h deja de aplicarse como tope estricto y queda cubierto por las velocidades típicas bajas
  que el ruteo asigna a calles urbanas. Las rutas sembradas sin velocidades conservan el tope de
  60 km/h de 012.
- Volver a avanzar por velocidad de tramo deshace la velocidad fija de ~40 km/h de `4302f7e`
  para las rutas con velocidades; conviene confirmarlo con quien hizo ese cambio.
