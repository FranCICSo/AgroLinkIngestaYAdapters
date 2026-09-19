# Implementation Plan: Odómetro en kilómetros en la consulta de estado

**Branch**: `004-odometer-kilometers` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-odometer-kilometers/spec.md`

## Summary

La consulta de estado del vehículo (`GET /api/v1/vehiculos/{dispositivoId}/estado`)
expone hoy el odómetro como `canBus.odometroM` (metros, `Long`). Esta feature cambia
esa unidad a kilómetros: el campo pasa a llamarse `canBus.odometroKm` (`Double`), sin
tocar el almacenamiento interno (`lectura_telemetria.odometro_m` sigue en metros, tal
como fija D-05 de la feature 001). La conversión ocurre exclusivamente en el mapeo de
`EstadoVehiculoService` hacia `CanBusDto`, dividiendo el valor almacenado en metros por
1000 sin redondeo. `odometroOrigen` (ECU/GPS) no cambia.

## Technical Context

**Language/Version**: Java 21 (Spring Boot), sin cambios respecto de la feature 003.

**Primary Dependencies**: Spring Boot Web, Spring Data JPA — sin nuevas dependencias.

**Storage**: PostgreSQL/TimescaleDB. Sin cambios de esquema: `lectura_telemetria.odometro_m`
sigue almacenando metros (`BIGINT`); esta feature no toca la tabla.

**Testing**: JUnit 5 + AssertJ (`EstadoVehiculoServiceTest`), igual que en la feature 002/003.

**Target Platform**: Linux server (contenedor Docker), sin cambios.

**Project Type**: Servicio web único (backend Spring Boot) — sin frontend ni segundo proyecto.

**Performance Goals**: N/A — es una división aritmética sobre un valor ya en memoria; no
introduce I/O ni cambia la complejidad de la consulta.

**Constraints**: El cambio es una ruptura de contrato deliberada y acotada (spec,
Assumptions): `canBus.odometroM` deja de existir, reemplazado por `canBus.odometroKm`.
No se mantienen ambos campos en paralelo.

**Scale/Scope**: Alcanza únicamente al bloque `canBus` de `EstadoVehiculoDto` y a su
contrato OpenAPI. No alcanza a `ReporteViajeService` (usa `odometroM` internamente para
calcular deltas de viaje en metros, fuera del alcance de esta feature — ver spec,
Assumptions) ni a la persistencia de `LecturaTelemetria`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Arquitectura Desacoplada por Capas de Adaptación**: ✅ Cumple. La conversión de
  unidad se hace en la capa de adaptación existente (`EstadoVehiculoService`, al mapear
  de `LecturaTelemetria` — modelo de dominio interno en metros — a `CanBusDto` —
  contrato expuesto en kilómetros). El dominio interno no se toca.
- **II. Stack Tecnológico del Backend**: ✅ Cumple. Java/Spring Boot, sin nueva
  infraestructura ni cambio de stack.
- **III. Mensajería Solo por Necesidad Demostrada**: ✅ No aplica — no se introduce
  mensajería.
- **IV. Inmutabilidad de los Datos Crudos de Telemetría**: ✅ Cumple. No se modifica
  ningún registro persistido; `odometro_m` sigue siendo la fuente de verdad en metros.
  La conversión a km es de solo lectura, calculada a demanda en cada respuesta.
- **V. Minimización de Datos Personales Identificables**: ✅ No aplica — el odómetro no
  es un dato personal.
- **VI. Seguridad como Línea Base**: ✅ No aplica — esta feature no toca transporte ni
  autenticación.
- **VII. Tolerancia a Fallos de Conectividad**: ✅ No aplica — no cambia el pipeline de
  ingesta, solo la consulta de estado derivada.
- **VIII. Testing Mínimo Esperado**: ✅ Cumple (ver Fase 1 / tasks): se actualizan los
  tests existentes de `EstadoVehiculoServiceTest` para el caso con odómetro conocido
  (ECU y GPS) y el caso sin odómetro conocido (`null`).
- **IX. Trazabilidad y No Reproceso Silencioso**: ✅ No aplica — no cambia el manejo de
  datos no interpretables; un odómetro desconocido sigue siendo `null`, no un valor
  inventado (FR-004).

**Resultado**: Sin violaciones. No se requiere Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/004-odometer-kilometers/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/main/java/ar/utn/agrolink/ingesta/estado/
├── CanBusDto.java                  # odometroM (Long) -> odometroKm (Double)
├── EstadoVehiculoService.java      # mapearCanBus: conversión metros -> km
└── (sin otros cambios en el paquete estado)

src/test/java/ar/utn/agrolink/ingesta/estado/
└── EstadoVehiculoServiceTest.java  # asserts sobre odometroKm en vez de odometroM

specs/004-odometer-kilometers/contracts/
└── agrolink-vehiculo-estado-api.yaml   # OpenAPI v4.0.0: odometroM -> odometroKm
```

**Structure Decision**: Proyecto único (backend Spring Boot existente,
`AgroLinkIngestaAdaptacion`). El cambio se localiza en el paquete
`ar.utn.agrolink.ingesta.estado`, que ya es la capa de adaptación responsable de
traducir `LecturaTelemetria` (dominio interno) al contrato de la consulta de estado. No
se crean paquetes ni proyectos nuevos.

## Complexity Tracking

*Sin violaciones de la Constitution Check — sección no aplicable.*
