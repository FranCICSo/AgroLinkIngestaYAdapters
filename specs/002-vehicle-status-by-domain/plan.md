# Implementation Plan: Consulta de Estado de Vehículo por Identificador de Dispositivo IoT

**Branch**: `002-vehicle-status-by-domain` | **Date**: 2026-09-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-vehicle-status-by-domain/spec.md`

## Summary

Nueva consulta HTTP de solo lectura en el servicio existente `agrolink-ingesta` (Spring
Boot): `GET /api/v1/vehiculos/{dispositivoId}/estado` devuelve un único objeto con la
lectura de telemetría más reciente de ese dispositivo, agrupada en tres bloques (posición,
CAN bus, dispositivo). El identificador de dispositivo es el que AgroLinkBackend ya resolvió
desde la patente del vehículo (`Vehicle.iotDeviceId`); este servicio nunca conoce la patente
ni llama a AgroLinkBackend — la integración es unidireccional (spec, Clarifications).

No se agrega tabla ni servicio nuevo: se amplía el mapeo JPA de `LecturaTelemetria`
(feature 001) para exponer columnas que hoy existen en el schema pero no tenían consumidor
(posición, indicadores del dispositivo, CAN bus crudo), y se reutiliza el índice
`(dispositivo_id, momento_evento DESC)` ya existente.

La única pieza de infraestructura nueva es la publicación de un **segundo puerto HTTP**
propio de `agrolink-ingesta` (`VEHICULO_ESTADO_HTTP_PORT`, distinto de 8080 y del puerto
interno `REPORTES_HTTP_PORT`) para que esta consulta sea alcanzable desde fuera del
despliegue (FR-011), sin exponer accidentalmente `/api/v1/reportes/viaje`, que permanece
interno (research.md D-01).

## Technical Context

**Language/Version**: Java 21 (LTS), Spring Boot 3.3.x — mismo servicio `agrolink-ingesta`
de la feature 001, sin proyecto nuevo.

**Primary Dependencies**: `spring-boot-starter-web`, `spring-boot-starter-data-jpa`,
`org.postgresql:postgresql` (ya presentes, sin dependencias nuevas). El segundo conector
HTTP (research.md D-01) usa la API estándar de Spring Boot
(`WebServerFactoryCustomizer<TomcatServletWebServerFactory>`), sin librerías adicionales.

**Storage**: Misma TimescaleDB / tabla `telemetria.lectura_telemetria` de la feature 001.
Sin migraciones nuevas: se reutiliza el índice `lectura_camion_tiempo_idx`
(`dispositivo_id`, `momento_evento DESC`) para el `LIMIT 1` de esta consulta.

**Testing**: JUnit 5 + AssertJ, mismo patrón que `ReporteViajeServiceTest` (feature 001):
identificador con lectura completa, con lectura parcial (sin fix GPS), y sin ninguna
lectura (404). Un test de integración adicional verifica el filtro por puerto de
research.md D-01 (una petición a `/api/v1/reportes/viaje` por el puerto nuevo debe dar 404).

**Target Platform**: Mismo entorno que la feature 001 — VM Oracle Cloud Always Free, Ampere
A1, linux/arm64, Docker + Docker Compose. Sin cambios de plataforma.

**Project Type**: Ampliación de un servicio backend HTTP existente (no se agrega ningún
proyecto ni servicio nuevo).

**Performance Goals**: Consulta puntual por clave + orden + `LIMIT 1` sobre un índice ya
existente — latencia esperada de milisegundos, muy por debajo de cualquier umbral relevante
para un piloto de pocos camiones.

**Constraints**:
- No debe cambiar la accesibilidad actual de `/api/v1/reportes/viaje` (permanece interno —
  spec, Assumptions).
- Sin mensajería ni servicios nuevos (Principio III): la separación de puertos se resuelve
  dentro del mismo proceso (research.md D-01).
- El puerto nuevo debe publicarse en la Security List/firewall de la VM, igual que se hizo
  para el puerto UDP del receptor en la feature 001 (ver quickstart.md §1 y deploy/README.md).

**Scale/Scope**: Una sola consulta nueva, sobre los mismos datos de la feature 001. Sin
cambios de escala respecto del piloto ya dimensionado (1 camión real, diseño válido para al
menos 5 concurrentes).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Gate | Estado |
|-----------|------|--------|
| I. Arquitectura desacoplada por capas de adaptación | Esta feature no toca el parser/mapper del receptor; consume el modelo de dominio ya normalizado (`LecturaTelemetria`). `datos_can` se expone tal cual, sin reinterpretar el formato del fabricante en esta capa. | ✅ PASS |
| II. Stack Java/Spring Boot + PostgreSQL/TimescaleDB + Spring Data JPA | Se implementa íntegramente en el servicio Spring Boot ya existente, sin stack nuevo. | ✅ PASS |
| III. Sin mensajería sin justificación de escala | Consulta HTTP directa, sin broker. La separación de puertos se resuelve con un conector adicional del mismo servidor embebido, no con infraestructura nueva. | ✅ PASS |
| IV. Inmutabilidad de datos crudos | Solo lectura: `LecturaTelemetriaRepository` sigue extendiendo el marcador `Repository` (no `CrudRepository`), sin métodos de escritura. La ampliación del mapeo JPA no agrega ningún camino de `UPDATE`/`DELETE`. | ✅ PASS |
| V. Minimización de datos personales | Los campos expuestos (posición, CAN, indicadores de dispositivo) son los mismos que persiste la feature 001; ninguno es un dato personal de un conductor. | ✅ PASS |
| VI. Seguridad como línea base | La consulta pasa a ser accesible externamente por diseño (FR-011): se documenta como exposición intencional, no como brecha. Sin TLS en esta fase (mismo estado que el resto del servicio HTTP hoy — ver Complexity Tracking); credenciales de base siguen por variables de entorno, sin cambios. | ⚠️ PASS con nota (ver Complexity Tracking) |
| VII. Tolerancia a fallos de conectividad | La consulta usa `momento_evento` (no `momento_recepcion`) como criterio de "más reciente" (FR-006), consistente con el principio: una lectura atrasada que llega después no debe hacer parecer "más nuevo" un dato viejo. | ✅ PASS |
| VIII. Testing mínimo esperado | Esta feature no es lógica de parseo/adaptación de datos externos (esa cobertura ya la exige y cumple la feature 001) — es una consulta de lectura. Aun así se cubre con los 3 casos análogos (completa, parcial, sin datos) siguiendo el mismo estándar. | ✅ PASS |
| IX. Trazabilidad y no reproceso silencioso | La consulta expone `estadoInterpretacion` y `camposFaltantes` tal como los persistió el receptor, en vez de ocultarlos: quien consume esta API ve si la lectura estaba degradada. | ✅ PASS |

**Alineación con entregables académicos**: no se modifica el modelo de datos ni se contradice
ningún entregable aprobado (WBS, DER, Historias de Usuario, Gestión de Riesgos); es una
consulta adicional de solo lectura sobre datos ya modelados en la feature 001.

### Post-Design Re-check (después de Phase 1)

Re-evaluado tras generar `data-model.md`, `contracts/` y `quickstart.md`: sin violaciones
nuevas. El único ⚠️ (Principio VI) se mantiene como nota, no como violación: la spec exige
explícitamente que esta consulta sea alcanzable desde fuera del despliegue (FR-011), y el
proyecto ya expone HTTP sin TLS en esta fase piloto (ninguna otra ruta del sistema lo tiene
tampoco). Agregar TLS solo para esta ruta sin resolverlo para el resto del servicio sería
una mejora parcial e inconsistente; se documenta como trabajo futuro en Complexity Tracking.
El diseño de datos no agrega ninguna escritura nueva ni cambia el régimen insert-only de la
tabla.

## Project Structure

### Documentation (this feature)

```text
specs/002-vehicle-status-by-domain/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── agrolink-vehiculo-estado-api.yaml
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/main/java/ar/utn/agrolink/ingesta/
├── config/
│   ├── HealthController.java              # Sin cambios
│   ├── VehiculoEstadoConectorConfig.java  # NUEVO: registra el conector Tomcat adicional (research.md D-01)
│   └── PuertoAccesoFilter.java            # NUEVO: restringe rutas por puerto de entrada (research.md D-01)
├── telemetry/
│   ├── LecturaTelemetria.java             # AMPLIADO: + latitud, longitud, rumbo_grados,
│   │                                       #   ignicion, tension_bateria_v, satelites,
│   │                                       #   momento_recepcion, estado_interpretacion,
│   │                                       #   campos_faltantes, datos_can (research.md D-02)
│   ├── LecturaTelemetriaRepository.java   # AMPLIADO: + findFirstByDispositivoIdOrderByMomentoEventoDesc
│   ├── EstadoInterpretacion.java          # Sin cambios (reutilizado)
│   └── OrigenOdometro.java                # Sin cambios (reutilizado)
├── report/                                # Sin cambios (feature 001)
└── estado/                                # NUEVO paquete
    ├── EstadoVehiculoController.java      # GET /api/v1/vehiculos/{dispositivoId}/estado
    ├── EstadoVehiculoService.java         # Búsqueda de la lectura más reciente + mapeo a DTO
    ├── EstadoVehiculoDto.java             # posicion + canBus + dispositivo
    ├── PosicionDto.java
    ├── CanBusDto.java
    ├── DispositivoInfoDto.java
    └── VehiculoSinTelemetriaException.java # → 404 application/problem+json (FR-007/FR-008)

src/main/resources/
└── application.yaml                       # + placeholder ${VEHICULO_ESTADO_HTTP_PORT}

src/test/java/ar/utn/agrolink/ingesta/
├── report/                                # Sin cambios
└── estado/
    ├── EstadoVehiculoServiceTest.java     # completa / parcial / sin datos
    └── PuertoAccesoFilterTest.java        # puerto nuevo solo sirve /api/v1/vehiculos/**

deploy/
├── compose.yaml                           # agrolink-ingesta: + ports (VEHICULO_ESTADO_HTTP_PORT), + env
├── .env.example                           # + VEHICULO_ESTADO_HTTP_PORT
└── README.md                              # + regla de firewall/Security List para el puerto nuevo
```

**Structure Decision**: Se amplía el servicio Spring Boot existente (`src/main/java/ar/utn/agrolink/ingesta/`)
con un paquete nuevo (`estado/`) siguiendo exactamente el mismo patrón que `report/`
(controller + service + DTOs + excepción de dominio → 404). No se crea ningún proyecto ni
servicio nuevo: la única pieza de infraestructura agregada es un segundo conector HTTP
dentro del mismo proceso (research.md D-01), porque el Principio III exige no introducir
complejidad de despliegue (un segundo servicio, un reverse proxy) sin necesidad demostrada,
y aquí un filtro de ~30 líneas alcanza para cumplir FR-011 sin regresión sobre la feature
001.

## Complexity Tracking

> Llenar SOLO si el Constitution Check tiene violaciones que justificar

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| **Principio VI** (nota, no violación): la nueva consulta queda expuesta por HTTP sin TLS a la red pública | La spec exige explícitamente accesibilidad externa (FR-011) para que AgroLinkBackend pueda consumirla, y el proyecto no tiene TLS resuelto todavía en ninguna de sus rutas HTTP (es un piloto académico, no una operación de flota real). Resolverlo aislado para esta sola ruta dejaría el resto del servicio igual de expuesto, sin reducir el riesgo real. | *Agregar TLS terminado en un reverse proxy solo para esta ruta*: introduce una pieza de infraestructura nueva (Nginx/Traefik + certificados) no justificada por ninguna necesidad de escala o seguridad demostrada distinta a "sería mejor tenerlo", contradiciendo el Principio III. Queda registrado como mejora obligatoria antes de operar con datos de flota reales, igual que el filtrado por IP/APN pendiente de la feature 001. |
| **Segundo conector HTTP en el mismo proceso** (research.md D-01) | Es la única forma de cumplir FR-011 (puerto propio, externo) sin exponer `/api/v1/reportes/viaje` como efecto secundario, sin duplicar infraestructura de despliegue. | *Publicar el mismo puerto único al host*: más simple, pero reabre `/api/v1/reportes/viaje` al público, contradiciendo la Assumption de la spec de no cambiar la accesibilidad de capacidades ya existentes. *Segundo microservicio*: aísla mejor pero duplica Dockerfile/healthcheck/JVM para una sola consulta de lectura, sin necesidad de escalado independiente demostrada. |
