# Tasks: Odómetro en kilómetros en la consulta de estado

**Input**: Design documents from `/specs/004-odometer-kilometers/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Incluidos. El cambio modifica el mapeo de la capa de adaptación
(`EstadoVehiculoService`), cubierta hoy por `EstadoVehiculoServiceTest`; actualizar y
extender esos tests es parte del propio cambio, no un extra opcional (Principio VIII de
la constitución).

**Organization**: Feature de una sola historia de usuario (P1, spec.md). No hay fases
de Setup ni Foundational: no se agrega infraestructura ni dependencias nuevas, se
modifica código ya existente en un proyecto ya inicializado.

## Path Conventions

Proyecto único Spring Boot: `src/main/java/...`, `src/test/java/...` (ver plan.md,
Project Structure).

---

## Phase 1: User Story 1 - Consultar el odómetro del vehículo en kilómetros (Priority: P1) 🎯 MVP

**Goal**: `GET /api/v1/vehiculos/{dispositivoId}/estado` devuelve `canBus.odometroKm`
(kilómetros) en vez de `canBus.odometroM` (metros), preservando `odometroOrigen` y sin
tocar el almacenamiento interno.

**Independent Test**: Consultar el estado de un vehículo con un odómetro conocido (ECU
o GPS) y verificar que el valor devuelto en `canBus.odometroKm` equivale al valor en
metros almacenado dividido 1000, y que un vehículo sin odómetro conocido devuelve
`canBus.odometroKm: null` (quickstart.md, Escenarios 1-3).

### Tests for User Story 1 ⚠️

> Estos tests deben fallar contra el código actual (que todavía expone `odometroM`)
> antes de aplicar los cambios de implementación de más abajo.

- [X] T001 [US1] En `src/test/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoServiceTest.java`,
      reemplazar la aserción `assertThat(dto.canBus().odometroM()).isEqualTo(184_300L)`
      (método `lecturaCompleta_devuelveTodosLosBloques...`, ~línea 160) por
      `assertThat(dto.canBus().odometroKm()).isEqualTo(184.3)` (origen ECU, sin cambios
      en `odometroOrigen`). De paso se agregó la aserción de `odometroOrigen()`, que no
      estaba cubierta en este test.
- [X] T002 [P] [US1] Desviación respecto del enunciado original: la fixture
      `lecturaParcialSinFixGps` ya tenía `odometroM = 184_300L` (no `null`), así que
      agregarle una aserción de `odometroKm` nulo ahí habría sido incorrecto. En su lugar
      se agregó un nuevo test, `sinOdometroConocido_devuelveOdometroKmNulo`, con una
      lectura dedicada (`odometroM = null`, `odometroOrigen = null`) que verifica
      `dto.canBus().odometroKm()` y `dto.canBus().odometroOrigen()` en `null` (FR-004:
      odómetro desconocido no es `0.0`).
- [X] T003 [P] [US1] Agregado `lecturaConOdometroDeOrigenGps_seExponeEnKilometros` en el
      mismo archivo: arma una lectura con `odometroM = 150_000L` y `OrigenOdometro.GPS`
      (reutilizando el helper de construcción de `LecturaTelemetria` por reflexión ya
      presente en el archivo) y verifica que `dto.canBus().odometroKm()` es `150.0` y
      `dto.canBus().odometroOrigen()` es `OrigenOdometro.GPS` (spec, Acceptance Scenario 3;
      antes el archivo solo cubría origen ECU).

### Implementation for User Story 1

- [X] T004 [US1] En `src/main/java/ar/utn/agrolink/ingesta/estado/CanBusDto.java`,
      reemplazar el campo `Long odometroM` por `Double odometroKm` en el record, y
      actualizar el Javadoc de la clase para describir `odometroKm` en vez de remitir a
      `odometroM` (research.md D-01).
- [X] T005 [US1] En
      `src/main/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoService.java`,
      método `mapearCanBus`, reemplazado `lectura.getOdometroM()` por la conversión a
      kilómetros: `null` si `lectura.getOdometroM()` es `null`, o
      `lectura.getOdometroM() / 1000.0` en caso contrario (research.md D-02, D-03, D-04).
      `lectura.getOdometroOrigen()` y el resto del mapeo quedaron sin cambios.

**Checkpoint**: `mvn -pl . test -Dtest=EstadoVehiculoServiceTest` → 6/6 tests OK (Tests
run: 6, Failures: 0, Errors: 0).

---

## Phase 2: Polish & Cross-Cutting Concerns

**Purpose**: Cierre del cambio de contrato, sin lógica nueva.

- [X] T006 [P] Revisadas las referencias a `odometroM` fuera de `specs/004-odometer-kilometers/`:
      solo aparecen en `specs/001..003/` (historial, no se editan),
      `LecturaTelemetria.java` y `ReporteViajeServiceTest.java` (persistencia interna en
      metros, fuera de alcance por spec/Assumptions). `README.md` y `deploy/` no
      mencionan el campo. Nada que cambiar.
- [ ] T007 Ejecutar la validación manual de `specs/004-odometer-kilometers/quickstart.md`
      (Escenarios 1-3 y validación de precisión) contra el stack local levantado según
      `deploy/README.md`. **Pendiente**: no ejecutado en esta sesión (decisión del
      usuario — la cobertura de tests unitarios (T001-T003, 6/6 OK) se consideró
      suficiente por ahora; queda como validación manual a cargo del usuario antes de
      dar por cerrada la feature end-to-end).

---

## Dependencies & Execution Order

- T001, T002, T003 (tests) no dependen entre sí — pueden escribirse en paralelo, pero
  todos antes de T004-T005 (deben fallar primero contra el código actual).
- T004 bloquea a T005 (el DTO debe tener `odometroKm` antes de que el servicio pueda
  poblarlo).
- T006 y T007 (Polish) dependen de que T001-T005 estén completos y en verde.

## Parallel Example: User Story 1

```bash
# Los tres tests pueden escribirse en paralelo (mismo archivo, pero ediciones en
# métodos distintos sin dependencias entre sí):
Task: "T001 Actualizar aserción odometroM -> odometroKm en EstadoVehiculoServiceTest.java"
Task: "T002 Agregar aserción odometroKm null en test de lectura parcial"
Task: "T003 Agregar test de odómetro con origen GPS"
```

## Implementation Strategy

### MVP = toda la feature

Esta feature es una sola historia de usuario P1 sin sub-alcance razonable menor: no
tiene sentido entregar "la mitad" del cambio de contrato. Orden sugerido:

1. T001-T003 (tests, deben fallar)
2. T004-T005 (implementación, tests pasan)
3. T006-T007 (limpieza y validación manual)
