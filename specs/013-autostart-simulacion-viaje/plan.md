# Implementation Plan: Arranque automático de la simulación en el horario planificado del viaje

**Branch**: `013-autostart-simulacion-viaje` | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-autostart-simulacion-viaje/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Hoy, para que un dispositivo simulado (uno de los 5 `iotDeviceId` que siembra
`LocalDataSeeder.java` en AgroLinkBackend) empiece a emitir telemetría, alguien tiene que
ejecutar a mano un curl contra `simulador-viajes`. Esta feature automatiza ese paso: cuando
AgroLinkBackend da de alta un viaje para uno de esos 5 dispositivos, notifica una única vez a
`agrolink-ingesta` (este repo) con la planificación completa del viaje (incluido su horario de
comienzo); `agrolink-ingesta` persiste esa planificación y, exactamente en el horario planificado
(ni antes ni después), llama internamente a la API ya existente de `simulador-viajes`
(`POST /rutas` con bloque `camion`, feature 011) para arrancar la simulación. AgroLinkBackend
nunca llama directo a `simulador-viajes`, y el alta del viaje nunca se bloquea ni falla por una
falla de este mecanismo secundario.

Enfoque técnico: una tabla nueva y mutable (`ingesta.viaje_programado`, fuera del esquema
insert-only `telemetria`) que registra cada viaje programado y su estado; un poller
`@Scheduled` de baja frecuencia dentro del mismo proceso `agrolink-ingesta` (sin introducir un
broker de mensajería, Principio III) que dispara los viajes cuyo horario ya llegó; y un cliente
HTTP nuevo, modelado sobre `IngestaVehiculoEstadoClient` ya existente, que llama a
`simulador-viajes` server-to-server.

## Technical Context

**Language/Version**: Java 21, Spring Boot 3.3.4 (mismo stack que el resto de `agrolink-ingesta`
— Principio II; sin nueva dependencia de build: `spring-boot-starter-web` ya trae `RestClient` y
el soporte de `@Scheduled`, `spring-boot-starter-data-jpa` + `postgresql` ya están en `pom.xml`).

**Primary Dependencies**: Spring Web (`RestClient`), Spring Data JPA, Spring `@Scheduled`
(`@EnableScheduling`, nuevo en `IngestaApplication`), driver `postgresql`. En AgroLinkBackend
(repo separado): un cliente HTTP nuevo con el mismo patrón que `IngestaVehiculoEstadoClient`
(`RestClient` + `@Value` base-url/timeouts, nunca `RestTemplate`/`WebClient`/Feign).

**Storage**: PostgreSQL/TimescaleDB ya existente (`deploy/db/01-schema.sql` +
`deploy/migrations/`). Tabla mutable nueva `ingesta.viaje_programado` en un esquema nuevo
(`ingesta`), separado de `telemetria` (insert-only, Principio IV) y de `simulador` (sin acceso
de escritura para `agrolink-ingesta`, Clarifications 2026-10-11).

**Testing**: JUnit 5 + Spring Boot Test (mismo patrón que `EstadoVehiculoService`/
`ReporteViajeService`): tests unitarios de la lista cerrada de dispositivos (FR-001), del
service de scheduling (horario futuro/pasado/inmediato, reprogramación, cancelación), y un test
de integración liviano del controller nuevo con un `SimuladorViajesClient` mockeado.

**Target Platform**: Linux, contenedor Docker dentro de `deploy/compose.yaml` (mismo stack ya
desplegado). `agrolink-ingesta` y `simulador-viajes` comparten la misma red de Docker compose de
este repo; AgroLinkBackend es un stack separado que ya le habla a `agrolink-ingesta` por su
puerto publicado al host (`vehiculo-estado.http-port`, default 8082).

**Project Type**: web-service existente que se extiende (no es un proyecto nuevo) — cambios en
dos repos: este repo (`agrolink-ingesta`, dueño de la lógica de scheduling) y AgroLinkBackend
(repo separado, dueño del hook de alta/reprogramación/cancelación de `Trip`).

**Performance Goals**: Sin requisitos de throughput — a lo sumo unos pocos viajes simulados
simultáneos (alcance de tesis/demo, no producción). El poller corre con un intervalo bajo (p.
ej. cada 30s) sobre una tabla con, como mucho, decenas de filas.

**Constraints**: FR-004 (el alta del viaje en AgroLinkBackend nunca se bloquea ni falla por este
mecanismo — la llamada a `agrolink-ingesta` debe ser de timeout corto y tolerante a fallos,
mismo patrón que `IngestaVehiculoEstadoClient`); la planificación debe sobrevivir un restart de
`agrolink-ingesta` (Principio VII) — de ahí la tabla persistida en vez de estado en memoria.

**Scale/Scope**: Alcance de tesis/PoC — un solo proceso `agrolink-ingesta` (sin necesidad de
lock distribuido para el poller, Principio III), 5 dispositivos simulados conocidos (lista
cerrada, Clarifications 2026-10-11).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Evaluación |
|---|---|
| I. Arquitectura Desacoplada por Capas de Adaptación | ✅ PASS — esta feature no toca la capa de adaptación de telemetría (Rinho→dominio); vive en un paquete nuevo (`viajeprogramado`), separado de `estado`/`telemetry`. |
| II. Stack Tecnológico del Backend | ✅ PASS — Java/Spring Boot/PostgreSQL, sin desviación. |
| III. Mensajería Solo por Necesidad Demostrada | ✅ PASS — se eligió deliberadamente un poller `@Scheduled` en vez de un broker (no hay necesidad demostrada de desacoplar consumidores ni de reintentos distribuidos a esta escala). |
| IV. Inmutabilidad de los Datos Crudos de Telemetría | ✅ PASS — la tabla nueva (`ingesta.viaje_programado`) es mutable por diseño, pero vive fuera del esquema `telemetria`; ninguna lectura de `lectura_telemetria` se edita ni borra. |
| V. Minimización de Datos Personales Identificables | ✅ PASS — la tabla nueva solo guarda `tripCode`, `iotDeviceId`, horario y coordenadas; cero nombres/DNI. |
| VI. Seguridad como Línea Base | ✅ PASS — la llamada `agrolink-ingesta` → `simulador-viajes` queda dentro de la red interna de Docker compose (sin publicar puerto, igual que hoy); la llamada AgroLinkBackend → `agrolink-ingesta` reutiliza el puerto ya publicado y ya restringido por `PuertoAccesoFilter`. No aplica la excepción de TLS (Principio VI es sobre el tramo dispositivo→receptor, no esto). |
| VII. Tolerancia a Fallos de Conectividad | ✅ PASS — la planificación se persiste (no vive solo en memoria) para sobrevivir un restart; FR-004/FR-005 ya exigen que una falla del simulador no bloquee el alta del viaje y quede loggeada. |
| VIII. Testing Mínimo Esperado | ✅ PASS (aplicado por analogía) — no es una capa de parseo de datos externos, pero se exige igual cobertura de los 3 casos críticos: lista cerrada (match/no-match), horario (futuro/pasado/inmediato) y fallo del simulador (log sin bloquear). |
| IX. Trazabilidad y No Reproceso Silencioso | ✅ PASS — FR-005 exige dejar constancia de cada falla; ningún intento de arranque se descarta sin loggear. |

Sin violaciones — no se requiere Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/013-autostart-simulacion-viaje/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── viajes-simulados-http-api.md     # agrolink-ingesta expone: AgroLinkBackend -> agrolink-ingesta
│   └── agrolink-backend-trip-hook.md    # AgroLinkBackend consume: TripService -> agrolink-ingesta
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Feature cross-repo: la lógica de scheduling/disparo vive en **este repo**
(`AgroLinkIngestaAdaptacion`, servicio `agrolink-ingesta`); el hook de alta/reprogramación/
cancelación de `Trip` vive en **AgroLinkBackend** (repo separado, ya explorado en la sesión de
clarificación).

```text
# Este repo — agrolink-ingesta (Option 1: single Spring Boot project, ya existente)
src/main/java/ar/utn/agrolink/ingesta/
├── estado/                          # ya existente, sin cambios
├── report/                          # ya existente, sin cambios
├── telemetry/                       # ya existente, sin cambios (Principio IV intacto)
└── viajeprogramado/                 # NUEVO paquete de esta feature
    ├── DispositivosSimuladosConocidos.java   # lista cerrada (FR-001), ver Clarifications
    ├── ViajeProgramado.java                  # entidad JPA (tabla ingesta.viaje_programado)
    ├── ViajeProgramadoRepository.java        # JpaRepository (mutable, fuera de telemetria)
    ├── ViajeProgramadoService.java           # alta/reprogramación/cancelación (FR-002/008/009/010)
    ├── ViajeProgramadoController.java        # POST/PUT/DELETE bajo /api/v1/vehiculos/{dispositivoId}/...
    ├── SimuladorViajesClient.java            # cliente HTTP (RestClient), modelado sobre IngestaVehiculoEstadoClient
    └── ViajeSimuladoScheduler.java           # @Scheduled poller que dispara viajes vencidos

src/test/java/ar/utn/agrolink/ingesta/viajeprogramado/
├── DispositivosSimuladosConocidosTest.java
├── ViajeProgramadoServiceTest.java
├── SimuladorViajesClientTest.java
└── ViajeProgramadoControllerIT.java

deploy/migrations/007_add_viaje_programado.sql    # schema `ingesta` + tabla + grants a agrolink_ingesta
src/main/resources/application.yaml               # + agrolink.simulador-viajes.base-url/timeouts, scheduler.pool-interval

# AgroLinkBackend (repo separado, fuera de este working tree — referencia para implementación)
src/main/java/org/example/agrolink/trip/
├── TripService.java                 # hook en createTrip (post-save), updateTrip, applyStateTransition(CANCELLED), deleteTrip
└── simulacion/                      # NUEVO paquete en ese repo
    └── SimulacionViajeClient.java    # cliente HTTP (RestClient), modelado sobre IngestaVehiculoEstadoClient,
                                      # decide si el iotDeviceId del vehicle está en la lista cerrada antes de llamar
```

**Structure Decision**: Se extiende el único servicio Spring Boot existente de este repo
(`agrolink-ingesta`) con un paquete nuevo y autocontenido (`viajeprogramado`), sin tocar los
paquetes `estado`/`telemetry` ya existentes (Principio I). No se introduce un segundo servicio
ni un broker: el poller vive en el mismo proceso. El lado de AgroLinkBackend reutiliza el patrón
de cliente HTTP ya establecido por `IngestaVehiculoEstadoClient` en ese mismo repo.

## Complexity Tracking

> Sin violaciones de la constitución — tabla omitida (Constitution Check: todo PASS).
