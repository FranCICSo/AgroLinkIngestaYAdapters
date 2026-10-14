# Feature Specification: Generación de Rutas Simuladas desde Origen/Destino

**Feature Branch**: `011-generar-ruta-simulada`

**Created**: 2026-10-07

**Status**: Draft

> **Actualización (2026-10-10)**: se agregó un bloque `camion` opcional en la misma llamada
> de generación (endpoint y CLI) que da de alta (o reutiliza) un camión simulado y arranca un
> viaje `en_curso` sobre la ruta recién creada, para que el daemon de `simulador-viajes`
> empiece a emitir tramas cada 60s sin un paso manual de SQL aparte. Ver User Story 3, FR-013
> y `contracts/rutas-http-api.md` / `contracts/crear-ruta-cli.md`. Esto reemplaza la
> Assumption original de que la creación del `simulador.viaje` quedaba fuera de alcance (ver
> Assumptions, abajo).
>
> **Actualización (2026-10-10, 2)**: la regla de validación de `camion.id` se amplió para
> además aceptar cualquier id que no sea puramente numérico (p. ej. `tra-demo-004`, calcando un
> `iotDeviceId` ya sembrado en AgroLinkBackend), ya que un id así tampoco puede confundirse con
> un IMEI real (siempre 15 dígitos). La columna `simulador.camion.id` (y `simulador.viaje.camion_id`)
> se ensanchó de `VARCHAR(6)` a `VARCHAR(20)` vía `deploy/migrations/006_widen_camion_id.sql`. Ver
> FR-014 (actualizado) y `src/domain/rangoDispositivoSimulado.js`.

**Input**: User description: "Afecta a AgroLinkIngestaYAdapters. ¿Para qué?: hoy, para que un
camión simulado recorra algo, alguien tiene que escribir a mano el INSERT INTO simulador.ruta con
el array de puntos lat/lon y las paradas (puntos/paradas jsonb), copiado a ojo. Con origen/destino
geocodificados (issue #71) se puede generar esa ruta automáticamente a partir de los datos reales
de un viaje creado en AgroLink. Cómo: RouteGenerationService (en este repo o invocado vía
script/endpoint): dado un origen y destino (lat/lon), genera el array puntos para simulador.ruta
— por interpolación simple entre ambos extremos, o trazando sobre calles reales con un servicio
de ruteo OSRM (gratis, self-hostable o demo server) si se quiere que el camión 'ande por rutas'.
Reemplaza el INSERT manual por un endpoint HTTP simple del simulador que arma la fila en
simulador.ruta y queda lista para asociarse a un simulador.viaje. Opcional/fase 2: conectar
directo con la creación de un Trip en AgroLinkBackend (si el viaje tiene executionMode simulado),
para que al crear el viaje real se genere automáticamente su ruta simulada sin pasos manuales.
Criterio de aceptación: dado un origen y destino (lat/lon), se puede generar y persistir una fila
en simulador.ruta sin escribir SQL a mano."

## Clarifications

### Session 2026-10-07

- Q: ¿Dónde vive la visualización y el ajuste manual de la ruta sobre un mapa? → A: Fuera de
  alcance de esta feature. El equipo ya tiene stack de mapas (Leaflet + OSM) en el frontend de
  AgroLink para otros fines; esta feature no construye, expone ni depende de ninguna vista previa
  en mapa. El flujo es un único paso: pedir generación con origen/destino/nombre y persistir
  directamente la fila resultante, sin un paso intermedio de revisión visual ni de confirmación
  separado.
- Q: ¿Quién puede llamar al endpoint HTTP de generación/persistencia de rutas? → A: Sólo
  llamadores server-to-server (scripts/CLI internos del equipo, y eventualmente AgroLinkBackend
  en la integración de fase 2); el frontend de AgroLink nunca lo llama directamente.
- Q: ¿Cómo se traza la ruta — siempre sobre calles reales vía OSRM, o con una alternativa de
  interpolación en línea recta cuando OSRM no resuelve un camino? → A: Siempre vía OSRM (un
  servidor gratuito, sea self-hosted o el demo server público). No existe un modo de
  interpolación en línea recta; si OSRM no puede resolver un camino entre origen y destino, la
  generación falla con un error claro en lugar de caer a una ruta en línea recta.
- Q: ¿Levantar y operar el servicio OSRM self-hosted es parte del alcance de esta feature? → A:
  Sí. Al ser un proyecto de tesis/PoC (no un servicio de terceros ya operado por otro equipo),
  esta feature agrega el propio OSRM self-hosted al proceso de deploy del repo (un servicio más
  en `deploy/compose.yaml` + un target reproducible de `Makefile`), en vez de asumirlo como
  infraestructura externa ya resuelta fuera de este alcance.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generar una ruta a partir de origen y destino (Priority: P1)

Un integrante del equipo que necesita armar un nuevo escenario de simulación ingresa las
coordenadas (lat/lon) de origen y destino de un viaje y, sin escribir SQL ni JSON a mano, obtiene
una ruta trazada automáticamente sobre calles reales, lista para guardarse como una fila nueva en
la tabla de rutas del simulador.

**Why this priority**: Es el dolor concreto que origina la feature — hoy este paso se hace
copiando a ojo un INSERT con un array de puntos armado manualmente. Sin generación automática no
hay mejora real sobre el proceso actual.

**Independent Test**: Con el origen y destino de un viaje real ya geocodificado, invocar el
endpoint de generación de ruta con esas coordenadas y un nombre, y verificar que se persiste de
inmediato una fila nueva en la tabla de rutas del simulador con un array de puntos no vacío y
consistente (empieza en el origen, termina en el destino), sin ningún INSERT manual.

**Acceptance Scenarios**:

1. **Given** un par de coordenadas de origen y destino válidas y un nombre para la ruta, **When**
   se invoca el endpoint de generación, **Then** el sistema calcula un recorrido sobre calles
   reales entre ambos puntos y persiste de inmediato una fila nueva en la tabla de rutas del
   simulador con ese recorrido.
2. **Given** una ruta generada, **When** se completa la llamada al endpoint, **Then** queda
   persistida en la tabla de rutas del simulador sin que haya sido necesario escribir SQL o JSON
   a mano, ni pasos adicionales de confirmación.
3. **Given** el servicio OSRM no puede resolver un camino entre origen y destino (p. ej. sin
   cobertura de calles en la zona) o no responde, **When** se invoca el endpoint, **Then** el
   sistema rechaza la generación con un error claro indicando que no se pudo trazar la ruta para
   ese par de puntos, y no persiste ninguna fila.

---

### User Story 2 - Reemplazar el flujo manual por un comando repetible (Priority: P2)

Un integrante del equipo que prefiere trabajar por línea de comandos (sin llamar al endpoint HTTP
directamente) genera y persiste una ruta pasando origen, destino y nombre como parámetros de un
único comando, obteniendo el mismo resultado que si hubiera llamado al endpoint HTTP.

**Why this priority**: Cubre el caso de generación rápida/reproducible (por ejemplo, para
scripts de carga de datos de demo) sin depender del endpoint HTTP, pero es de menor prioridad que
tener el endpoint en sí, que es la forma principal en que esta feature reemplaza el INSERT
manual.

**Independent Test**: Ejecutar el comando con un origen, destino y nombre de ruta, y verificar
que queda persistida una fila nueva en la tabla de rutas del simulador equivalente a la que se
obtendría llamando al endpoint HTTP con los mismos parámetros.

**Acceptance Scenarios**:

1. **Given** coordenadas válidas de origen, destino y un nombre de ruta pasados como parámetros,
   **When** se ejecuta el comando, **Then** se persiste una fila nueva en la tabla de rutas del
   simulador sin ninguna interacción adicional.
2. **Given** un nombre de ruta que ya existe, **When** se ejecuta el comando con ese nombre,
   **Then** el sistema rechaza la operación e informa el conflicto en vez de sobrescribir una
   ruta existente silenciosamente.

---

### User Story 3 - Arrancar el daemon sobre la ruta nueva en la misma llamada (Priority: P2)

Un integrante del equipo genera una ruta y, en la misma llamada (HTTP o CLI), indica el
`dispositivoId` del camión simulado que la debe recorrer. Sin ningún `INSERT` manual adicional
sobre `simulador.camion`/`simulador.viaje`, el daemon del simulador (`src/index.js`) recoge ese
camión en su próximo ciclo (≤60s) y empieza a emitir tramas de telemetría sobre el recorrido
recién generado.

**Why this priority**: Sin esto, una ruta generada por esta feature queda "huérfana" — persistida
pero sin ningún camión asignado — y hace falta el mismo `INSERT` manual a `simulador.viaje` que
el resto de la feature ya había eliminado para la ruta en sí (ver el síntoma real que lo motivó:
una ruta creada vía `POST /rutas` para representar al vehículo `tra-demo-004` de AgroLinkBackend
quedó sin emitir porque nunca se le asoció un viaje).

**Independent Test**: Invocar la generación de ruta con un `camion.id` en el rango reservado
(900001-900999) y, sin ejecutar ningún otro comando, esperar un ciclo (≤60s) y verificar que
aparece una lectura nueva en `telemetria.lectura_telemetria` para ese `dispositivoId`.

**Acceptance Scenarios**:

1. **Given** un `camion.id` que no existe todavía en `simulador.camion`, **When** se genera la
   ruta con ese `camion` en el body/args, **Then** el sistema lo crea, abre un viaje `en_curso`
   sobre la ruta nueva, y dentro de un ciclo (≤60s) aparece una lectura de telemetría para ese
   `dispositivoId`.
2. **Given** un `camion.id` que ya existe y tiene un viaje `en_curso` sobre otra ruta, **When**
   se genera una ruta nueva indicando ese mismo `camion.id`, **Then** el sistema cierra el viaje
   anterior (invariante: un camión tiene a lo sumo un viaje `en_curso` a la vez) y abre uno nuevo
   sobre la ruta recién generada, continuando desde el último odómetro conocido del camión.
3. **Given** un `camion.id` numérico fuera del rango reservado (900001-900999), **When** se
   intenta generar la ruta con ese `camion`, **Then** el sistema rechaza toda la operación (ni la
   ruta ni ningún viaje quedan persistidos) con el mismo error de validación que el resto de la
   feature.
4. **Given** un `camion.id` no puramente numérico que calca un `iotDeviceId` ya sembrado en
   AgroLinkBackend (p. ej. `tra-demo-004`), **When** se genera la ruta con ese `camion`, **Then**
   el sistema lo acepta igual que un id numérico dentro del rango reservado (no puede confundirse
   con un IMEI real, que siempre es puramente numérico de 15 dígitos) y procede igual que en el
   escenario 1.

---

### Edge Cases

- ¿Qué pasa si el origen y el destino son el mismo punto (o están a una distancia trivial)? El
  sistema debe informar que no tiene sentido generar una ruta y no persistir una fila con un solo
  punto o un array vacío.
- ¿Qué pasa si OSRM no responde (caído, sin conectividad, o timeout) en vez de responder que no
  hay cobertura? El sistema debe rechazar la generación con un error claro (sin persistir nada) y
  permitir reintentar, sin dejar el flujo colgado indefinidamente ni caer silenciosamente a un
  trazado en línea recta.
- ¿Qué pasa si el frontend de AgroLink intenta llamar directamente al endpoint de este módulo? El
  sistema no debe quedar expuesto para ese uso; sólo scripts/CLI internos del equipo y
  AgroLinkBackend (en la integración de fase 2) son llamadores válidos.
- ¿Qué pasa si se intenta asociar la ruta generada a un viaje del simulador antes de que la ruta
  haya sido guardada? El sistema debe impedirlo — una ruta debe existir persistida antes de poder
  asociarse a un viaje.
- ¿Qué pasa con las paradas intermedias de un viaje (no sólo origen/destino)? Deben poder pasarse
  como puntos de parada adicionales en la misma llamada de generación, no sólo origen y destino.
- ¿Qué pasa si se genera una ruta sin indicar ningún `camion`? El comportamiento no cambia
  respecto del resto de la feature: la ruta queda persistida sin ningún viaje asociado, para
  asociarse manualmente después (User Story 1/2, sin User Story 3).
- ¿Qué pasa si el `camion.id` indicado corresponde a un camión real/simulado que ya está
  recorriendo otra ruta activamente? Se cierra ese viaje (queda `finalizado`, no se borra) antes
  de abrir el nuevo — nunca quedan dos viajes `en_curso` para el mismo camión.
- ¿Qué pasa si el `camion.id` indicado es numérico pero tiene la longitud de un IMEI real (15
  dígitos)? Se rechaza igual que cualquier id numérico fuera del rango reservado — la longitud no
  lo excluye de la validación, sólo contener un carácter no numérico lo hace.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST permitir generar una ruta a partir de coordenadas de origen y
  destino (latitud/longitud), sin requerir que la persona escriba manualmente el array de puntos
  o un INSERT SQL.
- **FR-002**: El sistema MUST trazar la ruta generada sobre calles reales usando un servicio OSRM
  gratuito (self-hosted o demo server público) en todos los casos; NO existe un modo de
  interpolación en línea recta como alternativa.
- **FR-003**: El sistema MUST rechazar la generación (sin persistir ninguna fila) cuando OSRM no
  pueda resolver un camino entre origen y destino, o no responda, informando el motivo del
  rechazo de forma clara.
- **FR-004**: El sistema MUST persistir, en la misma llamada que genera la ruta, una fila nueva en
  la tabla de rutas del simulador con el array de puntos resultante y un nombre identificatorio —
  sin un paso separado de previsualización ni de confirmación.
- **FR-005**: El sistema MUST exponer un endpoint HTTP que reciba origen, destino y nombre (y
  opcionalmente paradas intermedias) como parámetros y realice la generación y persistencia
  descritas en FR-001 y FR-004.
- **FR-006**: El sistema MUST NOT exponer ese endpoint directamente al frontend de AgroLink; sólo
  deben poder invocarlo llamadores server-to-server (scripts/CLI internos del equipo, y
  AgroLinkBackend si se habilita la integración de fase 2).
- **FR-007**: El sistema MUST permitir generar y persistir una ruta también mediante un comando
  de línea de comandos equivalente al endpoint HTTP, para uso directo del equipo sin pasar por
  HTTP.
- **FR-008**: El sistema MUST rechazar la persistencia de una ruta cuyo nombre ya exista,
  informando el conflicto en vez de sobrescribir la fila existente.
- **FR-009**: El sistema MUST rechazar la generación/persistencia de una ruta cuando origen y
  destino son el mismo punto o están a una distancia que no permite construir un recorrido con al
  menos dos puntos distintos.
- **FR-010**: El sistema MUST permitir pasar puntos de parada intermedios (no sólo origen y
  destino) en la misma llamada de generación.
- **FR-011**: El sistema MUST dejar la ruta persistida en un estado utilizable para asociarse
  directamente a un viaje del simulador existente, sin pasos de transformación adicionales.
- **FR-012**: El sistema MUST proveer el servicio OSRM self-hosted como parte reproducible del
  proceso de deploy del repo (un comando/target, no una serie de pasos manuales ad-hoc
  documentados aparte), de forma que levantar el entorno completo de simulación no dependa de
  infraestructura externa ya operada por otro equipo.
- **FR-013**: El sistema MUST permitir, en la misma llamada de generación (endpoint o comando),
  indicar opcionalmente un `camion.id`; si se indica, el sistema MUST dar de alta el camión si no
  existe (o reutilizarlo si ya existe) y MUST abrir un viaje `en_curso` sobre la ruta recién
  generada, cerrando cualquier viaje `en_curso` previo de ese camión, sin requerir ningún
  `INSERT` manual adicional.
- **FR-014**: El sistema MUST rechazar la generación completa (ruta incluida, sin persistir
  nada) cuando el `camion.id` indicado sea puramente numérico y no esté dentro del rango
  reservado para dispositivos simulados (900001-900999, spec 009), con el mismo tipo de error de
  validación que el resto de la feature (FR-009). Un `camion.id` que contenga al menos un
  carácter no numérico (p. ej. `tra-demo-004`, calcando un `iotDeviceId` ya sembrado en
  AgroLinkBackend) MUST aceptarse sin esta restricción de rango, ya que un id así tampoco puede
  coincidir con un IMEI real (siempre puramente numérico, 15 dígitos) — ver
  `src/domain/rangoDispositivoSimulado.js`.

### Key Entities

- **Ruta simulada**: Representa el recorrido geográfico que seguirá un camión simulado; incluye
  el array ordenado de puntos (lat/lon) que la componen, las paradas intermedias asociadas, y un
  nombre identificatorio único. Es la entidad que hoy se crea a mano vía INSERT y que esta
  feature genera y persiste automáticamente.
- **Origen / Destino**: Coordenadas (lat/lon) que delimitan el recorrido a generar; provienen de
  un viaje real geocodificado o se ingresan directamente para armar un escenario de simulación.
- **Punto de ruta**: Una coordenada (lat/lon) individual dentro del array ordenado que compone
  una ruta, generada automáticamente por el trazado sobre calles reales vía OSRM.
- **Parada**: Un punto de la ruta marcado como lugar donde el camión simulado se detiene durante
  el viaje (entrega, carga, etc.), distinto de un punto de paso regular.
- **Camión simulado** (User Story 3): El `dispositivoId` que recorre la ruta generada — ya sea
  numérico dentro del rango reservado 900001-900999 (spec 009), o cualquier id que contenga un
  carácter no numérico (calcando un `iotDeviceId` real de AgroLinkBackend, p. ej. `tra-demo-004`),
  ya que ninguno de los dos puede coincidir con un IMEI real (siempre puramente numérico, 15
  dígitos). Puede ya existir o darse de alta en la misma llamada; su viaje `en_curso` es lo que
  hace que el daemon del simulador efectivamente emita telemetría para él.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una persona puede generar y persistir una ruta nueva a partir de un origen y un
  destino en menos de 2 minutos, sin escribir ni una línea de SQL o JSON.
- **SC-002**: El 100% de las rutas generadas producen un recorrido trazado sobre calles reales
  que empieza en el origen indicado y termina en el destino indicado.
- **SC-003**: Cuando el trazado automático sobre calles reales no puede resolver un camino para
  un par de puntos, la persona recibe un error claro en la misma llamada (sin ninguna fila
  persistida a medias) en vez de un fallo silencioso o un recorrido aproximado sin trazado real.
- **SC-004**: Cero filas nuevas en la tabla de rutas del simulador se crean mediante INSERT SQL
  manual a partir de la adopción de esta feature.
- **SC-005**: Una persona que clona el repo desde cero puede dejar el servicio de trazado de
  calles corriendo con un único comando reproducible, sin pasos manuales ad-hoc ni depender de
  que otro equipo ya opere esa infraestructura.
- **SC-006**: Al generar una ruta indicando un `camion.id`, dentro de un ciclo (≤60s) aparece
  una lectura nueva en la tabla de telemetría para ese `dispositivoId`, sin ningún `INSERT`
  manual sobre `simulador.camion` o `simulador.viaje`.

## Assumptions

- El trazado se hace siempre contra un servicio OSRM gratuito. Levantar y operar ese servicio
  **es parte del alcance de esta feature** (ver Clarifications): se agrega como un servicio más
  del proceso de deploy existente (`deploy/compose.yaml`, bajo el mismo `profile: ["simulador"]`
  que `simulador-viajes`), provisto por un target reproducible de `Makefile`
  (`make osrm`/incluido en `make simulador`) que descarga y preprocesa un extracto regional de
  OpenStreetMap (Argentina, vía Geofabrik) para la imagen Docker `osrm/osrm-backend`, de forma
  idempotente (saltea la descarga/el preprocesado si ya se hicieron). No hay modo de
  interpolación en línea recta como alternativa cuando OSRM falla: en ese caso la generación se
  rechaza (ver Clarifications y FR-003).
- El servidor demo público (`router.project-osrm.org`) sigue siendo una alternativa manual válida
  sólo para una prueba puntual antes de tener el contenedor propio levantado (está pensado por el
  propio proyecto OSRM sólo para pruebas livianas, con rate limiting y sin garantía de
  disponibilidad) — nunca el default del proceso de deploy.
- Las coordenadas de origen y destino llegan ya geocodificadas (resueltas a lat/lon) desde fuera
  de esta feature (por ejemplo, desde la feature de geocodificación de origen/destino de viajes,
  issue #71); esta feature no geocodifica direcciones en texto libre.
- La visualización en mapa (Leaflet + OSM) ya existe como capacidad del frontend de AgroLink para
  otros fines; esta feature no construye, aloja ni depende de ninguna vista de mapa propia, y no
  ofrece un paso de previsualización/ajuste manual antes de persistir — genera y persiste la ruta
  en una única llamada.
- El endpoint y el comando de esta feature son de uso interno del equipo (scripts/CLI); sólo se
  habilitan para AgroLinkBackend si se implementa la integración de fase 2 (ver más abajo), nunca
  directamente para el frontend de AgroLink.
- La integración automática con la creación de un Trip real en AgroLinkBackend (fase 2 mencionada
  en la descripción) queda fuera del alcance de esta especificación; esta feature cubre la
  generación y persistencia de la ruta simulada vía endpoint/comando.
- Una ruta generada queda disponible para asociarse a un viaje del simulador existente sin
  pasos de transformación adicionales (FR-011); además, desde la actualización de User Story 3
  (FR-013/FR-014), la creación de ese `simulador.viaje` —y, si hace falta, del
  `simulador.camion`— **sí puede hacerse en la misma llamada**, de forma opcional: quien no pase
  `camion` sigue teniendo el comportamiento original (ruta persistida sin viaje asociado).
