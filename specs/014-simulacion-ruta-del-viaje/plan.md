# Implementation Plan: Simulación inmediata sobre la ruta del viaje, con detención

**Branch**: `feature/start-simulation-when-trip-starts` (feature dir `014-simulacion-ruta-del-viaje`) | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-simulacion-ruta-del-viaje/spec.md`

**Contrato externo**: [contracts/ingesta-simulacion-http.md](./contracts/ingesta-simulacion-http.md) — copia
sin cambios de `AgroLinkBackend/specs/026-simulacion-al-iniciar-viaje/contracts/ingesta-simulacion-http.md`
v2.0.0 (fuente única de verdad, dueño AgroLinkBackend).

## Summary

Se reemplaza el modo programado de 013 (poller que disparaba `PENDIENTE → DISPARADO` en el
horario estimado, con reprogramación y cancelación) por un modo inmediato dirigido por
AgroLinkBackend:

- **`agrolink-ingesta`**: `POST …/viajes-simulados` arranca de inmediato llamando a
  `simulador-viajes` en el mismo request, es idempotente ante un inicio repetido, rechaza
  inicios de viajes ya detenidos o de otro dispositivo, y reenvía `polyline` + `velocidadesKmh`
  opcionales. Nuevo `POST …/viajes-simulados/{tripCode}/detencion` idempotente, reenviado
  server-to-server. Se eliminan el poller, la reprogramación y la cancelación; la migración
  `009` cancela con registro las filas `PENDIENTE` que queden (FR-017) y evoluciona el registro
  por viaje (FR-019).
- **`simulador-viajes`**: `POST /rutas` acepta `polyline` (salta OSRM, valida y densifica),
  `velocidadesKmh` y `tripCode`; las velocidades por tramo se persisten con la ruta y `avanzar`
  recorre cada tramo a su velocidad (tope único 80) con posición interpolada y remanente
  persistido, para que el tiempo de viaje coincida con el planificado. Nuevo
  `POST /viajes/detener` acotado por `(camión, tripCode)`. Los viajes avisados esperan en el
  destino emitiendo con velocidad 0 hasta la detención; CLI/manuales conservan la vuelta
  automática.

Decisiones: [research.md](./research.md) D-01…D-13.

## Technical Context

**Language/Version**: Java 21 + Spring Boot 3.3.4 (`agrolink-ingesta`); Node.js ≥ 22, ESM
(`simulador-viajes`, componente existente de la feature 009).

**Primary Dependencies**: Spring Web (`RestClient`), Spring Data JPA, `postgresql`; en Node
solo `pg` + `node:http`/`fetch` nativos. Sin dependencias nuevas: el decodificador de polyline
es ~30 líneas propias (`domain/polyline.js`), no una librería.

**Storage**: PostgreSQL/TimescaleDB existente. Cambios en `ingesta.viaje_programado` (migración
`009`) y en `simulador.ruta`/`simulador.viaje` (migración `008` + `deploy/db/03-schema-simulador.sql`).
Cero cambios en `telemetria.*`.

**Testing**: JUnit 5 + Mockito + `@WebMvcTest` + `MockRestServiceServer` (patrones ya usados en
`viajeprogramado`); `node --test` en `simulador-viajes/test/**`.

**Target Platform**: Linux, Docker compose (`deploy/compose.yaml`): `agrolink-ingesta` y
`simulador-viajes` en la misma red interna; el simulador sin `ports:`.

**Project Type**: web-service existente (dos componentes del mismo repo) que se modifica.

**Performance Goals**: telemetría consultable ≤ 2 min tras el aviso (SC-001), detención efectiva
≤ 1 ciclo (SC-004). Respuesta del inicio con polyline de 100 k puntos < 5 s (timeout del backend,
contrato §6).

**Constraints**: contrato v2.0.0 sin divergencias; `agrolink-ingesta` sin escritura en
`simulador.*` (FR-011); sin reintentos ni colas (FR-018); cuerpos hasta 2 MiB (contrato §5);
tope único 80 km/h (Clarifications).

**Scale/Scope**: 5 dispositivos simulados (lista cerrada de 013), un proceso de cada
componente, alcance demo/tesis.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Pre-diseño | Post-diseño |
|---|---|---|
| I. Capas de adaptación | ✅ No toca la adaptación Rinho→dominio; cambios en `viajeprogramado` y en el simulador (que emite tramas Rinho reales por UDP, sin atajos al dominio). | ✅ Sin cambios: la telemetría simulada sigue entrando por el receptor real. |
| II. Stack | ✅ Ingesta en Java/Spring/JPA/PostgreSQL. `simulador-viajes` sigue en Node: componente existente de herramienta de demo, justificado en 009; esta feature no agrega un componente nuevo. | ✅ Sin dependencias nuevas. |
| III. Mensajería | ✅ HTTP directo; se **elimina** el poller. | ✅ Detención por HTTP, sin cola ni broker (FR-018 prohíbe reintentos). |
| IV. Inmutabilidad telemetría | ✅ Ninguna lectura se edita/borra. | ✅ Migraciones `008`/`009` solo tocan `ingesta`/`simulador` (configuración mutable); `UPDATE` de estados permitido allí. |
| V. PII | ✅ Solo `tripCode`, `iotDeviceId`, coordenadas y trazado. | ✅ `motivo_detencion` es un enum, sin datos de personas. |
| VI. Seguridad | ✅ Red interna, `PuertoAccesoFilter` sin cambios (prefijo `/api/v1/vehiculos/{id}/**`), simulador sin publicar. No se invoca la excepción TLS. | ✅ Límite de cuerpo en el simulador (4 MiB) y en ingesta (413) evita abuso de tamaño. |
| VII. Conectividad | ✅ Inicio/detención en cualquier orden (tombstone `DETENIDO`); progreso y espera en destino persistidos. | ✅ `avance_tramo_km` + `fin_en_destino` sobreviven reinicios; timestamps de tramas sin cambios. |
| VIII. Testing mínimo | ✅ Parseo externo nuevo: decodificación de polyline y normalización de velocidades. | ✅ Tests de completo / faltante-vacío / inválido-fuera de rango para ambos (tasks). |
| IX. Trazabilidad | ✅ Velocidades descartadas/acotadas y trazados propios se loggean y registran, no se descartan en silencio. | ✅ FR-017 deja `ultimo_error` + `NOTICE`; cada inicio/detención queda en la fila (FR-019). |
| Entregables académicos | ✅ No altera DER/HU aprobados: tablas de configuración de la simulación, fuera del modelo de negocio. | ✅ |

Sin violaciones — Complexity Tracking vacío.

## Project Structure

### Documentation (this feature)

```text
specs/014-simulacion-ruta-del-viaje/
├── spec.md
├── plan.md                              # este archivo
├── research.md                          # D-01…D-13
├── data-model.md                        # tablas, migraciones 008/009, máquina de estados
├── quickstart.md                        # validación end-to-end
├── contracts/
│   ├── ingesta-simulacion-http.md       # COPIA del contrato v2.0.0 de AgroLinkBackend 026
│   └── simulador-viajes-http.md         # interno: POST /rutas extendido + POST /viajes/detener
├── checklists/requirements.md
└── tasks.md                             # /speckit-tasks
```

### Source Code (repository root)

```text
# agrolink-ingesta
src/main/java/ar/utn/agrolink/ingesta/
├── IngestaApplication.java                       # − @EnableScheduling
└── viajeprogramado/
    ├── DispositivosSimuladosConocidos.java       # sin cambios
    ├── ViajeProgramado.java                      # estados nuevos, columnas nuevas, transiciones
    ├── ViajeProgramadoRepository.java            # − consulta del poller
    ├── ViajeProgramadoService.java               # iniciar / detener (research.md D-03)
    ├── ViajeProgramadoController.java            # POST inicio, POST detencion, errores {error, detalle}
    ├── SimuladorViajesClient.java                # arrancarViaje (+polyline/velocidades/tripCode), detenerViaje
    ├── SimulacionResultado.java                  # + motivo, trazado, velocidades, efecto
    ├── IniciarViajeRequest.java                  # NUEVO (reemplaza ProgramarViajeRequest)
    ├── DetenerViajeRequest.java                  # NUEVO
    ├── InicioViajeDto.java / DetencionViajeDto.java   # NUEVOS (reemplazan ViajeProgramadoDto)
    ├── ErrorRespuesta.java                       # NUEVO cuerpo {error, detalle, ...}
    ├── ValidacionException.java / TrazadoInvalidoException.java /
    │   PayloadDemasiadoGrandeException.java / ViajeDeOtroDispositivoException.java /
    │   SimuladorNoDisponibleException.java       # NUEVOS
    ├── DispositivoNoSimuladoException.java / ViajeNoModificableException.java   # se conservan
    └── (BORRADOS) ViajeSimuladoScheduler, ReprogramarViajeRequest, ProgramarViajeRequest,
        ViajeProgramadoDto, ViajeProgramadoNoEncontradoException, CoordenadasNoDisponiblesException
src/main/resources/application.yaml               # − agrolink.viaje-programado.poll-interval-ms
src/test/java/ar/utn/agrolink/ingesta/viajeprogramado/
├── ViajeProgramadoServiceTest.java               # reescrito sobre la tabla de decisión
├── ViajeProgramadoControllerIntegrationTest.java # reescrito sobre el contrato v2
├── SimuladorViajesClientTest.java                # cuerpos reenviados + mapeo de errores
├── DispositivosSimuladosConocidosTest.java       # sin cambios
└── (BORRADO) ViajeSimuladoSchedulerTest.java

# Migraciones / schema
deploy/migrations/008_simulador_ruta_del_viaje.sql
deploy/migrations/009_viaje_simulado_inmediato.sql
deploy/db/03-schema-simulador.sql                 # mismas columnas para volúmenes nuevos

# simulador-viajes
simulador-viajes/src/
├── index.js                          # espera en destino, cicloSegundos desde config, emisión extraída
├── http/rutaHttpServer.js            # + POST /viajes/detener, límite de cuerpo, nuevos status
├── services/routeGenerationService.js  # rama polyline (sin OSRM), validación 500 m, velocidades
├── services/iniciarViajeService.js   # + tripCode / finEnDestino al crear el viaje
├── services/densificacionRutaService.js  # devuelve también la velocidad de cada sub-tramo
├── domain/avanceRuta.js              # despacho legado vs avanzarPorVelocidad
├── domain/polyline.js                # NUEVO decodificador precisión 5
├── domain/velocidadesTramo.js        # NUEVO normalización [25, 80] / default 40
├── domain/limitesVelocidad.js        # + VELOCIDAD_MIN_TRAMO_KMH = 25, VELOCIDAD_DEFAULT_KMH = 40
├── db/rutaRepository.js              # + velocidades_kmh
├── db/viajeRepository.js             # insertarViaje(+tripCode, finEnDestino), detenerViaje
└── db/flotaRepository.js             # lee/escribe velocidades_kmh, trip_code, fin_en_destino, avance_tramo_km
simulador-viajes/test/                # tests nuevos/actualizados por módulo
```

**Structure Decision**: se modifican los dos componentes existentes del repo sin agregar
servicios. Nombres de tabla/paquete/clases principales se conservan (research.md D-02); la
correlación con el simulador pasa a una columna propia (D-06).

## Riesgos y notas

- **Despliegue**: `agrolink-ingesta` + `simulador-viajes` + migraciones antes que AgroLinkBackend
  (contrato §7). Si el simulador viejo recibe `polyline`, la ignora y traza con OSRM: por eso
  ambos componentes salen juntos.
- **Velocidad fija de `4302f7e`**: se conserva solo para rutas sin velocidades; las rutas con
  velocidades la reemplazan (Assumptions del spec pide confirmarlo con quien hizo ese cambio).
- **Camión auto-creado**: si el dispositivo no existe en `simulador.camion`, se crea `seca`
  (comportamiento de 011); la temperatura BLE en espera (US4) solo aplica a camiones
  `refrigerada` ya configurados.
- **SC-006** se verifica con duraciones planificadas ≥ 10 min por la resolución de un ciclo
  (research.md D-09).

## Complexity Tracking

> Sin violaciones de la constitución — tabla omitida.
