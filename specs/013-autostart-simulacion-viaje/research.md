# Phase 0 — Research: Arranque automático de la simulación en el horario planificado del viaje

**Feature**: `013-autostart-simulacion-viaje` | **Date**: 2026-10-11

No quedan `[NEEDS CLARIFICATION]` en el Technical Context del plan — las tres rondas de
`/speckit-clarify` ya resolvieron las decisiones de mayor incertidumbre (integración,
timing, alcance de detección). Este documento registra las decisiones de diseño restantes,
de implementación, necesarias para pasar a Phase 1.

## D-01: ¿Dónde vive la lógica de "esperar hasta el horario planificado"?

**Decision**: Un poller `@Scheduled` de baja frecuencia (p. ej. cada 30s) dentro del mismo
proceso `agrolink-ingesta`, que relee una tabla persistida (`ingesta.viaje_programado`) y
dispara los viajes cuyo `estimated_start_date_time <= now()` y `estado = 'PENDIENTE'`.

**Rationale**: Mismo patrón ya usado por el daemon de `simulador-viajes` (relee
`simulador.viaje`/`simulador.camion` cada 60s sin caché en memoria, `src/db/flotaRepository.js`)
— consistente con Principio III (sin broker sin necesidad demostrada) y con el alcance de
tesis/PoC (un solo proceso, sin necesidad de lock distribuido).

**Alternatives considered**:
- Cola de trabajo externa (RabbitMQ/SQS) con delay — rechazada: viola Principio III (no hay
  necesidad demostrada de desacoplar múltiples consumidores ni de reintentos distribuidos a
  esta escala de 5 dispositivos).
- Que AgroLinkBackend programe su propio job y vuelva a llamar en el horario exacto — rechazada
  explícitamente en Clarifications (2026-10-11): "AgroLinkBackend no vuelve a llamar ni recuerda
  nada después del alta".
- `simulador-viajes` (Node.js) con un estado "programado" nuevo en su propio daemon de 60s —
  rechazada: habría requerido modificar el esquema `simulador` y la lógica de
  `obtenerViajesEnCurso`, y la Clarifications (2026-10-11) decidió que la integración pasa
  exclusivamente por `agrolink-ingesta`, no por extender `simulador-viajes`.

## D-02: ¿Dónde persiste la planificación pendiente?

**Decision**: Tabla nueva `ingesta.viaje_programado` (esquema nuevo `ingesta`, separado de
`telemetria` y de `simulador`), vía `deploy/migrations/007_add_viaje_programado.sql`. Acceso
otorgado solo al rol `agrolink_ingesta` (SELECT/INSERT/UPDATE, sin DELETE — se cancela con un
cambio de `estado`, nunca borrando la fila, mismo criterio que otras tablas mutables del
proyecto).

**Rationale**: Principio VII (tolerancia a fallos) exige que un restart de `agrolink-ingesta`
no pierda un viaje programado para dentro de unas horas — descarta guardar esto solo en
memoria. Un esquema nuevo (no `telemetria`) evita cualquier ambigüedad con Principio IV
(inmutabilidad de `lectura_telemetria`): esta tabla es explícitamente mutable, pero vive fuera
del esquema insert-only.

**Alternatives considered**:
- Guardar la planificación en memoria (`Map` en el service) — rechazada: no sobrevive un
  restart, viola Principio VII.
- Reusar el esquema `simulador` (mismo Postgres) — rechazada: Clarifications (2026-10-11)
  decidió explícitamente no otorgarle a `agrolink-ingesta` acceso de escritura al schema
  `simulador`.

## D-03: Contrato HTTP entre AgroLinkBackend y `agrolink-ingesta`

**Decision**: Reusar el puerto ya publicado al host (`vehiculo-estado.http-port`, default
8082) y el prefijo ya permitido por `PuertoAccesoFilter` (`/api/v1/vehiculos/**`) — sin tocar
ese filtro. Nuevo recurso anidado bajo el dispositivo:

- `POST /api/v1/vehiculos/{dispositivoId}/viajes-simulados` (alta)
- `PUT /api/v1/vehiculos/{dispositivoId}/viajes-simulados/{tripCode}` (reprogramación, FR-009)
- `DELETE /api/v1/vehiculos/{dispositivoId}/viajes-simulados/{tripCode}` (cancelación, FR-010)

**Rationale**: AgroLinkBackend es un stack separado (su propio `docker compose`, red distinta)
que ya llega a `agrolink-ingesta` solo por ese puerto publicado — igual que
`IngestaVehiculoEstadoClient` ya hace hoy para `GET /api/v1/vehiculos/{dispositivoId}/estado`.
Anidar el recurso bajo `/vehiculos/{dispositivoId}/` evita tocar `PuertoAccesoFilter` (menor
blast radius que agregar un prefijo nuevo al allowlist).

**Alternatives considered**:
- Nuevo prefijo propio (`/api/v1/viajes-simulados/**`) con su propio allowlist en
  `PuertoAccesoFilter` — rechazada: más cambios de los necesarios para el mismo resultado
  (Principio de simplicidad de la constitución, "complejidad no justificada se rechaza").
- Servir esto por el puerto interno (`server.port`, 8080) — rechazada: no es alcanzable desde
  el stack de AgroLinkBackend (puerto no publicado al host).

## D-04: ¿Quién evalúa la lista cerrada de dispositivos simulados (FR-001)?

**Decision**: Doble chequeo, mismo criterio en ambos lados (defense in depth, sin
desincronización porque ambos listan los mismos 5 valores literales):
1. **AgroLinkBackend** (`SimulacionViajeClient`, nuevo): antes de llamar a `agrolink-ingesta`,
   chequea si `vehicle.getIotDeviceId()` está en la lista cerrada — si no, ni siquiera hace la
   llamada HTTP (cero overhead de red para los viajes de dispositivos reales, FR-003/SC-002).
2. **`agrolink-ingesta`** (`DispositivosSimuladosConocidos`, nuevo): vuelve a validar el mismo
   criterio al recibir la solicitud — si alguna vez llega una por error (bug en
   AgroLinkBackend, llamada manual de prueba), responde `404`/`422` sin persistir nada, en vez
   de confiar ciegamente en el llamador.

**Rationale**: FR-001 dice "el sistema" sin especificar cuál; dado que ambos componentes son
Java/Spring Boot y la lista es un literal de 5 strings (no un endpoint de configuración), el
costo de duplicarla una vez es mínimo comparado con el riesgo de que `agrolink-ingesta` procese
una solicitud para un dispositivo real por una llamada indebida.

**Alternatives considered**:
- Que solo AgroLinkBackend valide, y `agrolink-ingesta` confíe ciegamente — rechazada: viola
  Principio IX (trazabilidad) si alguna vez llega una solicitud indebida; más barato
  rechazarla con una validación local que debuggear un dispositivo real contaminado por una
  simulación fantasma.
- Exponer la lista como configuración centralizada (ej. un endpoint de catálogo) — rechazada:
  complejidad no justificada para 5 valores literales que ya están documentados en la spec y en
  `LocalDataSeeder.java`.

## D-05: Reemplazo de simulación previa del mismo dispositivo (FR-006)

**Decision**: No se necesita lógica nueva en `agrolink-ingesta` para esto — ya lo resuelve
`simulador-viajes` (`iniciarViajeService.js`, feature 011): cada vez que llega un
`POST /rutas` con `camion.id`, cierra cualquier viaje `en_curso` previo de ese camión antes de
abrir el nuevo. `ingesta.viaje_programado` identifica cada fila por `tripCode` (no por
dispositivo), así que dos viajes futuros para el mismo dispositivo simplemente son dos filas
`PENDIENTE` independientes; cuando cada una dispara, `simulador-viajes` aplica el reemplazo.

**Rationale**: Evita duplicar una invariante que `simulador-viajes` ya garantiza; menos
superficie de código nueva.

## D-06: Reintentos ante una falla de `simulador-viajes` al disparar (FR-004/FR-005)

**Decision**: Un solo intento en el horario planificado. Si falla (servicio caído, rechazo,
timeout), la fila pasa a `estado = 'ERROR'` con el detalle en una columna `ultimo_error`, se
loggea, y el poller deja de reintentarla automáticamente — queda disponible para que el equipo
la dispare a mano (mismo flujo manual que existe hoy) una vez resuelto el problema.

**Rationale**: El spec (FR-005/SC-004, User Story 2) solo exige que la falla sea diagnosticable
y no bloquee el alta del viaje — no exige reintentos automáticos. Un reintento infinito o con
backoff agrega complejidad (política de reintentos, riesgo de duplicar el arranque si el
primer intento sí llegó a destino pero la respuesta se perdió) no pedida por la spec
(constitución: "complejidad no justificada... se rechaza").

**Alternatives considered**:
- Reintento automático con backoff exponencial y tope de intentos — rechazada: no está en el
  alcance pedido (spec explícitamente menciona "arrancarla manualmente después").

## D-07: Cliente HTTP `agrolink-ingesta` → `simulador-viajes`

**Decision**: Nueva clase `SimuladorViajesClient`, modelada 1:1 sobre
`IngestaVehiculoEstadoClient` ya existente: `@Component`, `RestClient` (no `RestTemplate`/
`WebClient`/Feign), `@Value`-inyectado `agrolink.simulador-viajes.base-url` +
connect/read-timeout, captura `RestClientException` y la traduce a un resultado tipado
(éxito/fallo) en vez de propagar la excepción — igual patrón que el cliente existente.

**Rationale**: Consistencia de código dentro del mismo repo; el patrón ya está probado y
revisado.

## D-08: Cliente HTTP AgroLinkBackend → `agrolink-ingesta`

**Decision**: Nueva clase `SimulacionViajeClient` en AgroLinkBackend, mismo patrón que su
`IngestaVehiculoEstadoClient` ya existente (`RestClient`, `@Value` base-url ya configurado como
`agrolink.telemetry.ingesta.base-url` — se reusa esa misma base URL, ya apunta al puerto 8082).
Se llama desde `TripService.createTrip` (tras `tripRepository.save`, línea ~181),
`TripService.updateTrip` (si cambia `estimatedStartDateTime` de un viaje aún no arrancado) y
desde el camino que lleva a `TripState.CANCELLED` (`applyStateTransition`/`deleteTrip`).

**Rationale**: Reutiliza toda la infraestructura de configuración y el patrón de cliente ya
existentes en ese repo; no agrega una base-url nueva.
