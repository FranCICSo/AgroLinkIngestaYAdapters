# Research: Proveedor Samsara por webhook — exceso de velocidad severo

**Feature**: `015-samsara-webhook-exceso-velocidad` | **Date**: 2026-11-04

Cada decisión resuelve una incógnita del Technical Context de [plan.md](./plan.md). Las
referencias a código son al estado de `master` (`b39a77e`) de los tres repos.

---

## D-01 — Formato del webhook: el documentado por Samsara, sin firma

**Decision**: el emisor envía y `agrolink-ingesta` acepta el sobre documentado en
developers.samsara.com/docs/severespeedingstarted y …/severespeedingended (consultado el
2026-11-03): `eventId`, `eventTime`, `eventType`, `orgId`, `webhookId` y `data.data` con
`startTime`, `endTime` (solo Ended), `tripStartTime` y `vehicle` (`id`, `name`, `licensePlate`,
`vehicleVin`, `assetType`, `externalIds`). Sin encabezados de firma. Forma exacta y ejemplos en
[contracts/samsara-webhook-http.md](./contracts/samsara-webhook-http.md).

**Rationale**: la página de cada evento es la fuente primaria del contrato externo. Por la
clarificación de la sesión 2026-11-03 no se valida firma ni credenciales (POC).

**Alternatives considered**: validar `X-Samsara-Signature` con HMAC, descartado por decisión del
usuario. Queda como deuda en el Complexity Tracking. Inventar un formato propio, descartado: el
punto de la demo es adaptar un formato real ajeno.

## D-02 — Dónde se guarda: hypertable nueva `telemetria.evento_samsara`, insert-only

**Decision**: tabla nueva en el schema `telemetria`, hypertable particionada por
`momento_evento`, que es el `eventTime` del sobre, o la hora de recepción si falta. Columnas de
consulta extraídas, más `payload_crudo JSONB`. El rol `agrolink_ingesta` recibe solo
`SELECT, INSERT` sobre esta tabla (nunca `UPDATE`/`DELETE`). Se crea como migración
`deploy/migrations/009_add_evento_samsara.sql`. Detalle en [data-model.md](./data-model.md) §1.

**Rationale**: es dato crudo de telemetría de un proveedor, igual que `lectura_telemetria`. Por
el Principio IV va en `telemetria` con la inmutabilidad garantizada por el motor (grants), no por
convención. Es la primera vez que `agrolink_ingesta` escribe en `telemetria`: el permiso se acota
a esta tabla sola, igual que `rinho_receptor` solo tiene `INSERT` en la suya.

**Alternatives considered**: schema `ingesta`, descartado porque ahí vive estado mutable
(`viaje_programado` con `UPDATE`). Reusar `lectura_telemetria`, descartado: sus columnas son de
posición y CAN y el evento no trae posición (spec, Contexto).

## D-03 — Idempotencia en una hypertable: índice único parcial con la columna de partición

**Decision**: índice único `(event_id, momento_evento) WHERE event_id IS NOT NULL`, más
`INSERT … ON CONFLICT DO NOTHING`. La respuesta distingue `GUARDADO` de `DUPLICADO`.

**Rationale**: TimescaleDB exige que todo índice único incluya la columna de partición. Como
`momento_evento` sale del `eventTime` del sobre, un reintento de Samsara trae el mismo
`eventId` + `eventTime` y choca con el índice. Una notificación sin `eventId` se guarda igual
(FR-002, "casi sin controles"), pero no se deduplica.

**Alternatives considered**: particionar por `momento_recepcion`. Rompe la deduplicación,
porque cada reintento llega en otro momento. Tabla normal sin hypertable: viable, pero se
desvía del criterio de la constitución (TimescaleDB para series temporales).

## D-04 — Posición de consulta para el backend: `id` BIGSERIAL con margen de commit

**Decision**: `GET /api/v1/proveedores/samsara/eventos?despuesDe={id}&limite={n}` devuelve las
filas con `id > despuesDe` y `momento_recepcion <= now() - 2 s`, ordenadas por `id`, con un
máximo de `limite` (default 100, tope 500). El backend guarda el último `id` procesado. Contrato
en [contracts/samsara-eventos-consulta-http.md](./contracts/samsara-eventos-consulta-http.md).

**Rationale**: un `BIGSERIAL` crece por orden de asignación, no de commit. Si dos webhooks
concurrentes asignan 10 y 11 y el 11 hace commit primero, una consulta sin margen podría
devolver 11, avanzar el cursor y saltear el 10 para siempre. El margen de 2 s sobre
`momento_recepcion` (default `now()` = inicio de la transacción) excluye filas cuya transacción
podría seguir abierta. Un insert de una fila tarda milisegundos, así que el margen sobra. El
costo es como mucho 2 s más de latencia, compatible con SC-001 (< 15 s).

**Alternatives considered**: cursor por `momento_recepcion`. Tiene empates y el mismo problema de
commit. Marcar filas como "consumidas" desde el backend, descartado: es un `UPDATE` sobre dato
crudo (Principio IV) y acopla escritura cruzada.

## D-05 — Exposición en `agrolink-ingesta`: prefijo nuevo en `PuertoAccesoFilter`

**Decision**: los dos endpoints viven bajo `/api/v1/proveedores/samsara/`, y
`PuertoAccesoFilter` agrega ese prefijo a los permitidos por el puerto publicado
(`vehiculo-estado.http-port`, 8082). El emisor llama por la red interna (puerto `server.port`).
El backend consulta por la misma base URL que ya usa (`agrolink.telemetry.ingesta.base-url`).

**Rationale**: AgroLinkBackend corre en otra VM y solo alcanza a `agrolink-ingesta` por el puerto
publicado. Un Samsara real también necesitaría alcanzar el webhook por ese puerto. Colgarlo de
`/api/v1/vehiculos/**` evitaría tocar el filtro, pero el recurso no es un vehículo.

**Alternatives considered**: tercer conector Tomcat solo para webhooks, descartado como
sobreingeniería para una POC.

## D-06 — Cómo obtiene el backend los eventos: consulta periódica cada 10 s

**Decision**: un `@Scheduled(fixedDelay)` en AgroLinkBackend
(`agrolink.telemetry.samsara.poll-interval-ms`, default 10000, desactivable con
`…samsara.poll-scheduler.enabled=false`) pide páginas hasta vaciar. Cada evento se procesa en su
propia transacción, que también avanza el cursor. Así un evento con error no frena a los
siguientes y un reinicio no reprocesa. Es el mismo patrón que
`BleTemperatureTelemetrySyncScheduler`. Clarificación 2026-11-04.

**Rationale**: no introduce camino nuevo ingesta→backend ni broker (Principio III). Con
`fixedDelay`, dos corridas nunca se superponen.

**Alternatives considered**: push ingesta→backend (Q1 opción B) y lectura directa de la base
(Q1 opción C), descartadas en la clarificación.

## D-07 — Modelo de velocidad del emisor: base estable + ráfagas Poisson

**Decision**: para cada vehículo con viaje en curso, el emisor avanza un ciclo cada
`SAMSARA_CICLO_MS` (default 5000) y actualiza la velocidad con un proceso de reversión a la
media (Ornstein–Uhlenbeck discreto) hacia un objetivo:

- **Régimen normal**: objetivo 72 km/h, desvío estacionario ~5 km/h, acotado a [0, umbral − 3].
  Queda siempre por debajo del umbral efectivo de 100 km/h, porque 100 está a más de 5σ de 72.
- **Ráfaga de exceso**: en cada ciclo empieza una ráfaga con probabilidad
  `p = 1 − exp(−λ·Δt)`, donde λ = `SAMSARA_EXCESOS_POR_HORA` (default 0,3125/h = 2,5 cada 8 h).
  Durante la ráfaga, el objetivo pasa a `umbral + U(3, 15)` km/h con reversión rápida, por una
  duración `U(20, 170)` s. Al terminar, el objetivo vuelve a 72.

Los excesos salen solo de ráfagas, así que su frecuencia la controla λ y no depende de ajustes
finos del ruido: SC-002 (1–4 cada 8 h) se cumple con λ = 0,3125. Para una demo corta se sube λ
(por ejemplo, `SAMSARA_EXCESOS_POR_HORA=6`, uno cada ~10 min por vehículo). El aleatorio se
inyecta (`rng`), así que los tests son deterministas.

**Rationale**: el usuario pidió que la notificación salga *solo* por cruce de umbral (clarify,
directiva inicial) y que los excesos sean poco frecuentes. Un ruido puro que cruce por azar
haría que la frecuencia dependa de forma muy sensible de σ, y es difícil de calibrar.

**Alternatives considered**: sortear directamente "hay exceso" y su duración (versión previa de
la spec), descartado por la directiva de umbral. Reusar la velocidad del recorrido Rinho,
imposible: estos vehículos no tienen ruta (FR-014).

## D-08 — Detección de cruces: histéresis temporal de 20 s

**Decision**: `detectorExceso` es una función pura sobre `(estado, velocidad, ahora)`. Si no hay
exceso abierto y `velocidad > umbral`, se emite `STARTED` con `startTime = ahora`. Si hay exceso
abierto, `velocidad <= umbral` y `ahora − startTime >= 20 s`, se emite `ENDED` con
`endTime = ahora`. En cualquier otro caso no se emite nada. El fin forzado por fin de viaje
(FR-021b) ignora la mínima de 20 s.

**Rationale**: implementa FR-016 y el edge case de oscilación sin un segundo umbral. Con el
modelo de D-07 la ráfaga dura ≥ 20 s, así que la histéresis casi nunca actúa. Es un resguardo.

## D-09 — Ubicación del emisor y forma de recibir el aviso de viaje

**Decision**: módulo `simulador-viajes/src/samsara/`, sin tocar la simulación Rinho. El servidor
HTTP existente (`src/http/rutaHttpServer.js`, que se levanta con `PUERTO_HTTP`) agrega dos rutas:
`POST /samsara/viajes` y `POST /samsara/viajes/{tripCode}/detencion`. El estado vive en memoria
(`Map` por id de vehículo). El envío usa `fetch` nativo de Node 22, sin dependencias nuevas, con
timeout de 3 s. Contrato en
[contracts/simulacion-samsara-avisos.md](./contracts/simulacion-samsara-avisos.md) §3.
Clarificación 2026-11-03 (Q3 → A).

**Rationale**: reutiliza proceso, despliegue y red interna. Que el estado esté en memoria sigue
la precedencia de `estadoPorCamion` en `src/index.js`, alcance aceptado para la PoC. Si el
proceso se reinicia, los viajes en curso se pierden hasta el próximo aviso de inicio. Queda en
Assumptions de la spec ("el emisor se detiene").

**Alternatives considered**: persistir en el schema `simulador`. Agrega migración y
repositorios para un estado efímero sin beneficio en la demo.

## D-10 — Ruteo del aviso de viaje en `agrolink-ingesta`: despacho por lista Samsara

**Decision**: `ViajeProgramadoController` mantiene sus rutas y, antes de delegar en
`ViajeProgramadoService`, consulta `VehiculosSamsaraSimulados.esSamsara(dispositivoId)`. Si es
Samsara, delega en un `AvisoViajeSamsaraService` nuevo, que reenvía a `simulador-viajes`
(`SimuladorSamsaraClient`) sin persistir nada y sin exigir `origen`/`destino`. Se agrega el
mapeo `POST …/viajes-simulados/{tripCode}/detencion`, que hoy no existe en este repo porque la
feature 014 está planificada pero no implementada. Para Samsara reenvía la detención. Para
cualquier otro dispositivo responde `404 dispositivo_no_simulado`, que es lo que AgroLinkBackend
ya recibe hoy y solo registra. La feature 014 reemplazará la rama no-Samsara al implementarse.

**Rationale**: FR-021a pide el mismo camino que Rinho. Despachar en el controlador mantiene
intacta la lógica de 013/014 y deja explícito el punto de convergencia.

**Alternatives considered**: rutas Samsara separadas en ingesta
(`/api/v1/proveedores/samsara/viajes`). Obligaría al backend a elegir la URL según el proveedor
en vez de reusar el cliente existente.

## D-11 — Aviso de viaje desde el backend: sin ruta para Samsara

**Decision**: `SimulatedDeviceRegistry` suma una segunda lista cerrada (`SAMSARA_DEVICE_IDS`) y
el método `isSamsaraSimulated`. `TripService.publishSimulatedTripNotificationIfApplicable`
publica el evento si el dispositivo está en cualquiera de las dos listas. El listener, para
Samsara, **no** resuelve la ruta (`TripRouteService.resolveForSimulation` devolvería vacío sin
geocodificación y cortaría el aviso) y envía un inicio con solo `tripCode` y
`estimatedStartDateTime`. Esto requiere que el contrato v2 de AgroLinkBackend/026 acepte
`origen`/`destino` ausentes **solo** para dispositivos Samsara: delta v2.1, en
[contracts/simulacion-samsara-avisos.md](./contracts/simulacion-samsara-avisos.md) §1.

**Rationale**: los vehículos Samsara no tienen recorrido simulado. Pedirles una ruta solo
agrega puntos de falla.

## D-12 — Identidad de vehículos Samsara: `iotDeviceId` = id de Samsara

**Decision**: tres listas cerradas con los mismos ids (backend `SimulatedDeviceRegistry`, ingesta
`VehiculosSamsaraSimulados` y emisor `vehiculosSamsara.js`), disjuntas de la lista Rinho. Hay un
test por repo que verifica la disjunción con la lista Rinho local. Ids:
`281474977000101` y `281474977000102` (patentes `AGL007`/`AGL008`). Clarificación Q4 → A.

**Rationale**: los ids de Samsara son numéricos largos. Ninguno se parece a los de Rinho
(`900001`…, `*-demo-*`). Las listas se mantienen a mano por la misma razón documentada en
`SimulatedDeviceRegistry` (research 019 D6): que no diverjan en silencio por configuración.

## D-13 — Episodios, alertas y orden de llegada en el backend

**Decision**: entidad `SpeedingEpisode` (tabla `speeding_episodes`) con índice único
`(vehicle_id, start_time)` y columnas únicas `start_event_id` y `end_event_id`. Reglas en
[data-model.md](./data-model.md) §3. La alerta usa el tipo nuevo `Alert.AlertType.SPEEDING`,
severidad `WARNING`, vinculada al episodio por `speeding_episode_id`. Se cierra en `RESOLVED`
automáticamente al llegar el fin, con `resolveDateTime = endTime` y causa `UNCLASSIFIED`.

**Rationale**: la unicidad por `(vehicle_id, start_time)` empareja inicio y fin en cualquier
orden (Principio VII). Las columnas de event id hacen que un mismo evento no genere efectos dos
veces (FR-007). El episodio es un dato derivado, no telemetría cruda: actualizarlo al cerrarse
no viola el Principio IV, porque la notificación cruda queda intacta en ingesta.

## D-14 — Restricción CHECK del enum de alertas

**Decision**: agregar un `AlertTypeCheckSchemaFix` (`ApplicationRunner`,
`@Order(HIGHEST_PRECEDENCE)`), con el mismo patrón que `TripCargaColumnsSchemaFix`. Si existe
`alerts_type_check` y no admite `SPEEDING`, la recrea con todos los valores del enum. Es
idempotente.

**Rationale**: con `EnumType.STRING`, Hibernate 6+ genera un `CHECK (type IN (...))` al crear la
tabla, y `ddl-auto=update` nunca lo modifica. Una base creada antes de esta feature rechazaría el
insert de una alerta `SPEEDING`. Hay que confirmar el nombre real de la restricción contra la
base local durante la implementación. Si no existe, el fix no hace nada.

## D-15 — Reemplazo del `SamsaraTelemetryAdapter` actual

**Decision**: se elimina `telemetry/adapter/SamsaraTelemetryAdapter.java`, que parsea un formato
inventado (`deviceId`, `vehiclePlate`, `gps.speedKmh`) hacia `NormalizedTelemetry`. Se reemplaza
por `telemetry/samsara/SamsaraSpeedingEventAdapter`, que traduce el evento de ingesta a
`DrivingEvent`. `POST /api/v1/telemetry/ingest/SAMSARA` pasa a responder "Unsupported telemetry
provider", lo que es correcto: Samsara ya no entra por ese camino.

**Rationale**: el evento real no trae posición, así que no cabe en `NormalizedTelemetry`, con
latitud y longitud `NOT NULL`. Mantener dos adaptadores Samsara con formatos distintos
confundiría. Nada productivo depende del actual: el proveedor está `UNDER_REVIEW`.

## D-16 — Frontend: sección "Conducción" reutilizando la tabla existente

**Decision**: el tipo `AlertType` suma `'SPEEDING'`, y la respuesta de alerta suma un objeto
opcional `speeding` (patente, proveedor, inicio, fin, duración, en curso). Se agregan un hook
`useDrivingAlerts`, con carga inicial desde `GET /api/v1/alerts/driving` y SSE con el evento
`driving-alert`, una tercera pestaña y una tarjeta KPI en `src/app/admin/alertas/page.tsx`, y
`ThermalAlertTable` acepta `category='SPEEDING'` con sus columnas propias. `AlertPushNotifier`
agrega título y cuerpo para `SPEEDING` (FR-026).

**Rationale**: FR-023 pide los mismos filtros y acciones. Reutilizar la tabla los da sin
duplicar. El evento SSE propio evita que el hook térmico mezcle alertas de conducción.
