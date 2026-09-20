# Tasks: Almacenar el odómetro en kilómetros

**Input**: Design documents from `/specs/005-odometer-storage-km/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Incluidos. El cambio modifica lógica de mapeo de la capa de adaptación
(`resolveOdometro` en `rinho-receptor`) y dos servicios de dominio Java
(`EstadoVehiculoService`, `ReporteViajeService`), todos cubiertos hoy por tests
existentes; actualizarlos es parte del propio cambio (Principio VIII de la
constitución).

**Organization**: Feature de una sola historia de usuario (P1, spec.md). No hay fases
de Setup ni Foundational: no se agrega infraestructura ni dependencias nuevas.

## Path Conventions

Monorepo con dos componentes ya existentes: `rinho-receptor/` (Node.js, ingesta) y
`src/main/java/...` / `src/test/java/...` (Spring Boot, dominio y APIs). Ver plan.md,
Project Structure.

---

## Phase 1: User Story 1 - El odómetro se guarda y se calcula en kilómetros de punta a punta (Priority: P1) 🎯 MVP

**Goal**: El odómetro se persiste en `telemetria.lectura_telemetria.odometro_km`
(kilómetros), la ingesta deja de convertir el valor de ECU (ya en km) y convierte el de
GPS (metros → km), y tanto `/estado` como `/api/v1/reportes/viaje` calculan sobre esa
misma unidad sin conversiones intermedias.

**Independent Test**: Persistir una lectura con odómetro de ECU conocido (en km) y
verificar que el valor guardado, el expuesto por `/estado` y el usado por el reporte de
viaje son consistentes entre sí sin ningún factor de 1000 de por medio; repetir con
origen GPS y confirmar la conversión metros→km en ese caso.

### Tests for User Story 1 ⚠️

> Estos tests deben fallar contra el código actual (que todavía asume metros) antes de
> aplicar los cambios de implementación de más abajo.

- [X] T001 [P] [US1] En `rinho-receptor/test/lecturaMapper.test.js`, actualizado el test
      `'fallback de odometro: CAN B (ECU, km) tiene prioridad sobre GPS (metros)'`:
      `assert.equal(lectura.odometroKm, 66010)` (sin multiplicar — el valor crudo ya es
      km). Actualizado también `'sin dato CAN B: usa el campo GPS...'` (renombrado a
      "...convertido a km"): `assert.equal(lectura.odometroKm, 0x010836f1 / 1000)`.
      `node --test`: 22/22 OK.
- [X] T002 [P] [US1] En
      `src/test/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoServiceTest.java`,
      el helper `lectura(...)` pasa a tomar `Double odometroKm` (antes `Long
      odometroM`) y setea el campo reflection `"odometroKm"`; los fixtures
      (`lecturaCompleta`, `lecturaParcialSinFixGps`, y el `lectura(...)` inline del test
      de origen GPS) ahora pasan el valor ya en km directo (`184.3`, `150.0`) en vez de
      metros con `_000L`. Las aserciones de `dto.canBus().odometroKm()` no cambiaron de
      valor esperado (ya estaban en km desde la feature 004).
- [X] T003 [P] [US1] En
      `src/test/java/ar/utn/agrolink/ingesta/report/ReporteViajeServiceTest.java`:
      helper `lectura(...)` cambiado a `Double odometroKm` / `set(l, "odometroKm",
      odometroKm)`; todos los fixtures convertidos de metros a km (`100_000L` →
      `100.0`, `150_000L` → `150.0`, `200_000L` → `200.0`, `110_000L` → `110.0`,
      `66_010_000L` → `66010.0`, `66_000_000L` → `66000.0`); toda aserción
      `dto.distanciaM()` reemplazada por `dto.distanciaKm()` con el valor ya en km; la
      aserción de `tasaConsumoPromedio` en `cincoMetricas_sobreConjuntoConocido` pasó de
      `30.0 / (100_000L / 1000.0)` a `30.0 / 100.0` (mismo resultado numérico).
- [X] T004 [P] [US1] En
      `src/test/java/ar/utn/agrolink/ingesta/telemetry/LecturaTelemetriaRepositoryIntegrationTest.java`,
      renombrada la columna en el `INSERT` literal de `insertarFixture`, de
      `odometro_m` a `odometro_km` (el valor `1000` de la fixture queda igual — el test
      no hace aserciones sobre ese valor, solo verifica orden por `momento_evento`).

### Implementation for User Story 1

- [X] T005 [US1] En `deploy/db/01-schema.sql`, reemplazado `odometro_m BIGINT` por
      `odometro_km DOUBLE PRECISION` en la definición de
      `telemetria.lectura_telemetria`, con un comentario junto a la columna que remite
      a `specs/005-odometer-storage-km/research.md` (D-04) para quien necesite migrar
      un volumen ya inicializado.
- [X] T006 [P] [US1] En `deploy/README.md` (sección §2.5), agregada una nota con la
      sentencia de migración manual de research.md D-04 (`RENAME COLUMN` + `ALTER
      COLUMN ... TYPE DOUBLE PRECISION USING odometro_km / 1000.0`) para quien tenga un
      volumen ya inicializado antes de esta feature.
- [X] T007 [US1] En `rinho-receptor/src/domain/lecturaMapper.js`, función
      `resolveOdometro`: caso ECU devuelve `{ odometroKm: km, odometroOrigen: 'ECU' }`
      (sin `Math.round(km * 1000)`); fallback GPS devuelve `{ odometroKm:
      gps.odometroGpsM / 1000, odometroOrigen: 'GPS' }`. Comentario de la función
      actualizado. También actualizadas las dos referencias a la desestructuración de
      `resolveOdometro` y al objeto de retorno de `mapFrameToLectura` (antes
      `odometroM`, ahora `odometroKm`) — no estaban listadas explícitamente en el
      enunciado original de esta tarea, pero son parte del mismo cambio de forma.
      `eqParser.js` no se tocó: `odometroGpsM` sigue siendo metros nativos.
- [X] T008 [P] [US1] En `rinho-receptor/src/db/lecturaRepository.js`: `INSERT_SQL`
      ahora lista `odometro_km`; el arreglo de parámetros de `persist` pasa
      `lectura.odometroKm`.
- [X] T009 [P] [US1] En `rinho-receptor/test/lecturaTardia.test.js`, función
      `lecturaFixture`: renombrada la propiedad `odometroM: 1000` a `odometroKm: 1000`.
- [X] T010 [US1] En
      `src/main/java/ar/utn/agrolink/ingesta/telemetry/LecturaTelemetria.java`:
      renombrado el campo `Long odometroM` (columna `@Column(name = "odometro_m")`) a
      `Double odometroKm` (columna `@Column(name = "odometro_km")`), y su getter
      `getOdometroM()` a `getOdometroKm()`. Referencia a `odometroM` en el Javadoc de
      clase actualizada a `odometroKm`.
- [X] T011 [US1] En
      `src/main/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoService.java`,
      método `mapearCanBus`: eliminada la conversión de la feature 004 y pasado
      `lectura.getOdometroKm()` directo al `CanBusDto` (mismo tipo/nombre de campo,
      sin el cálculo intermedio).
- [X] T012 [US1] En
      `src/main/java/ar/utn/agrolink/ingesta/report/ReporteViajeDto.java`,
      reemplazado el campo `long distanciaM` por `double distanciaKm` en el record.
- [X] T013 [US1] En
      `src/main/java/ar/utn/agrolink/ingesta/report/ReporteViajeService.java`,
      método `calcular`: `distanciaKm` (`double`) calculada como
      `conOdometro.get(size-1).getOdometroKm() - conOdometro.get(0).getOdometroKm()`;
      `tasaConsumoPromedio` simplificado a `combustibleConsumidoPct / distanciaKm`;
      `tasaNoCalculable` ajustado a `distanciaKm == 0.0 || ...`; `distanciaKm` pasado
      al construir el `ReporteViajeDto`.

**Checkpoint**: `node --test rinho-receptor/test/lecturaMapper.test.js` → 22/22 OK.
`mvn -pl . test` (suite completa, no solo los tres archivos previstos) → 27/27 OK, 4
skipped (tests de integración que requieren el stack Docker levantado, sin cambios en
su condición de skip).

---

## Phase 2: Polish & Cross-Cutting Concerns

**Purpose**: Cierre del cambio de contrato y limpieza de referencias, sin lógica nueva.

- [X] T014 [P] Revisadas las referencias a `odometro_m` / `odometroM` / `distanciaM`
      fuera de `specs/005-odometer-storage-km/` y de las specs históricas
      (`specs/001..004/`, sin editar). Se encontró y corrigió una referencia viva fuera
      del alcance original de la tarea: el Javadoc de comentario en
      `src/main/java/ar/utn/agrolink/ingesta/telemetry/OrigenOdometro.java` decía
      "...se uso para odometro_m", corregido a "odometro_km". `README.md` de nivel raíz
      no menciona el campo. `eqParser.js` sigue usando `odometroGpsM` (metros nativos
      del parser de bajo nivel) deliberadamente — no tocado (research.md D-02).
- [ ] T015 Ejecutar la validación manual de
      `specs/005-odometer-storage-km/quickstart.md` (Escenarios 1-3 y validaciones de
      consistencia) contra el stack local levantado según `deploy/README.md`.
      **Pendiente**: no ejecutado en esta sesión (decisión del usuario — la cobertura
      de tests automatizados (22/22 Node, 27/27 Java) se consideró suficiente por
      ahora; queda como validación manual a cargo del usuario, y es especialmente
      relevante para probar la migración manual de un volumen ya inicializado
      (T006/research.md D-04), que ningún test automatizado ejercita.

---

## Dependencies & Execution Order

- T001-T004 (tests) no dependen entre sí — pueden escribirse en paralelo, pero todos
  antes de la implementación (deben fallar primero contra el código actual).
- T005 (esquema) bloquea a T008 (INSERT de `rinho-receptor`) y a T010 (entidad Java).
- T006 (documentación de migración manual) puede hacerse en paralelo con cualquier otra
  tarea — no bloquea ni depende de código.
- T007 (mapper) bloquea a T008 (repository) y a T009 (fixture de test de integración,
  por consistencia de forma).
- T010 (entidad Java) bloquea a T011 (estado) y a T012 (DTO de reporte), que a su vez
  bloquea a T013 (servicio de reporte).
- T014-T015 (Polish) dependen de que T001-T013 estén completos y en verde.

## Parallel Example: User Story 1

```bash
# Los cuatro conjuntos de tests pueden escribirse en paralelo (archivos distintos):
Task: "T001 Actualizar asserts de resolveOdometro en lecturaMapper.test.js"
Task: "T002 Actualizar fixtures/asserts de odometro en EstadoVehiculoServiceTest.java"
Task: "T003 Actualizar fixtures/asserts de odometro y distancia en ReporteViajeServiceTest.java"
Task: "T004 Renombrar columna en el INSERT de LecturaTelemetriaRepositoryIntegrationTest.java"

# T005 (schema) y T006 (doc de migración) también son independientes entre sí:
Task: "T005 Actualizar deploy/db/01-schema.sql"
Task: "T006 Documentar migración manual en deploy/README.md"
```

## Implementation Strategy

### MVP = toda la feature

Esta feature es una sola historia de usuario P1 sin sub-alcance razonable menor: dejar
la ingesta en km pero el reporte de viaje en metros (o viceversa) sería un estado
intermedio roto, no un incremento entregable. Orden sugerido:

1. T001-T004 (tests, deben fallar)
2. T005-T006 (esquema y documentación de migración)
3. T007-T009 (ingesta `rinho-receptor`)
4. T010-T013 (dominio y reportes Java)
5. T014-T015 (limpieza y validación manual)
