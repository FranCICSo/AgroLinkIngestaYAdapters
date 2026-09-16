---

description: "Task list for feature implementation"
---

# Tasks: Exposición estructurada de campos CAN bus

**Input**: Design documents from `/specs/003-can-fields-expansion/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Revisión**: Reemplaza por completo la versión anterior de `tasks.md` (previa a la sesión
de `/speckit-clarify` del 2026-09-13). El alcance creció de 2 a 5 columnas nuevas
(VIN, RPM y combustible consumido se suman a temperatura de refrigerante y presión de
aceite) y se agrega la reubicación de `tensionBateriaV`.

**Tests**: Incluidas. Principio VIII de la constitución exige, para toda lógica de
parseo/adaptación de datos externos, cobertura mínima de 3 casos (completo, faltante,
inválido); esta feature agrega cinco resolvers Node y una pieza de lectura Java de ese
tipo, así que sus tests no son opcionales. Además, dos tests existentes de
`lecturaMapper.test.js` que hoy afirman el descarte del VIN quedan obsoletos y deben
reemplazarse (no dejarse como falsos positivos silenciosos).

**Organization**: Tareas agrupadas por historia de usuario (spec.md) para permitir
implementación y prueba independiente de cada una.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede ejecutarse en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: A qué historia de usuario pertenece (US1, US2)
- Cada tarea incluye la ruta de archivo exacta

## Path Conventions

Monorepo con dos componentes existentes (sin proyecto nuevo, ver plan.md):
- Receptor de ingesta (Node): `rinho-receptor/src/`, `rinho-receptor/test/`
- Servicio de lectura (Java/Spring Boot): `src/main/java/ar/utn/agrolink/ingesta/`, `src/test/java/ar/utn/agrolink/ingesta/`
- Esquema de base: `deploy/db/01-schema.sql`
- Documentación de otra feature a corregir: `specs/001-ingesta-adaptacion-telemetria/contracts/rinho-eq-frame.md`

---

## Phase 1: Setup

**Purpose**: Cambio de esquema compartido, prerrequisito de ambas historias.

- [X] T001 Agregar las columnas nullable `vin VARCHAR(20)`, `rpm SMALLINT`, `combustible_consumido_l NUMERIC(10,2)`, `temperatura_refrigerante_c SMALLINT` y `presion_aceite_kpa SMALLINT` a la definición de `telemetria.lectura_telemetria` en `deploy/db/01-schema.sql`, justo después de `combustible_pct` (data-model.md; research.md D-01 y D-03)

**Checkpoint**: Un `docker compose up -d` sobre un volumen nuevo ya crea la tabla con las
cinco columnas. Para un volumen existente, el `ALTER TABLE` manual está documentado en
`quickstart.md` §1 (paso operativo, no de código).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Mapeo JPA de las columnas nuevas — bloquea el trabajo de US2, que necesita
leer estos campos desde la entidad Java.

**⚠️ CRITICAL**: Ninguna tarea de US2 puede completarse sin esta fase.

- [X] T002 Agregar los campos `vin` (`String`, `@Column(name = "vin")`), `rpm` (`Integer`, `@Column(name = "rpm")`), `combustibleConsumidoL` (`Double`, `@Column(name = "combustible_consumido_l")`), `temperaturaRefrigeranteC` (`Integer`, `@Column(name = "temperatura_refrigerante_c")`) y `presionAceiteKpa` (`Integer`, `@Column(name = "presion_aceite_kpa")`), cada uno con su getter, siguiendo el patrón ya usado por `combustiblePct`, en `src/main/java/ar/utn/agrolink/ingesta/telemetry/LecturaTelemetria.java` (depende de T001; data-model.md)

**Checkpoint**: La entidad Java compila con los cinco campos nuevos, listos para que US2
los consuma. US1 (receptor Node) no depende de esta tarea y puede avanzar en paralelo.

---

## Phase 3: User Story 1 - Consultar los valores de motor y vehículo como datos de dominio propios (Priority: P1) 🎯 MVP

**Goal**: VIN (`1`), RPM (`2`), combustible consumido (`14`, en litros), temperatura de
refrigerante (`2A`) y presión de aceite (`2C`) dejan de viajar solo dentro de `datos_can`
(o de descartarse silenciosamente, en el caso del VIN) y se persisten como columnas
propias de cada lectura de telemetría, con el mismo criterio de "no informado" ya usado
para `combustible_pct`.

**Independent Test**: Enviar una trama sintética con estos cinco identificadores poblados
(o vacíos) al receptor y verificar por SQL directo sobre `telemetria.lectura_telemetria`
que las columnas nuevas tienen el valor esperado (o `NULL`), sin necesidad de tocar el
servicio Java ni la consulta de estado (quickstart.md §3).

### Tests for User Story 1 ⚠️

> Principio VIII: escribir estos casos junto con cada resolver; deben cubrir completo,
> vacío e inválido (salvo VIN, que es alfanumérico — su caso "inválido" es simplemente
> string vacío/ausente, no un chequeo de no-numérico) antes de dar la historia por
> terminada. Esta tarea también reemplaza los 2 tests hoy obsoletos.

- [X] T005 [US1] En `rinho-receptor/test/lecturaMapper.test.js`: (a) reemplazar el test `'el VIN (CAN 1) se descarta explicitamente...'` por uno que verifique que `lectura.vin === '1M8GDM9A_KP042788'` para `REAL_FRAME` y `lectura.vin === null` + `camposFaltantes.includes('vin')` para `VENDOR_FRAME`; (b) reemplazar el test `'datos CAN no promovidos (2, 3, 14, 2A, 2C) quedan en datos_can, sin el VIN'` por uno que verifique que **solo** `datosCan['3']` sobrevive (`'45'` en `REAL_FRAME`) y que `datosCan['1']`, `['2']`, `['14']`, `['2A']`, `['2C']` son todos `undefined`; (c) agregar los 3 casos (completo/vacío/inválido) para cada uno de `rpm`, `combustibleConsumidoL`, `temperaturaRefrigeranteC`, `presionAceiteKpa` (usando `REAL_FRAME` para completo, `VENDOR_FRAME` para vacío, y una trama con p. ej. `2=ABC` para inválido) (depende de T004)

### Implementation for User Story 1

- [X] T003 [US1] Agregar `resolveVin`, `resolveRpm`, `resolveCombustibleConsumido`, `resolveTemperaturaRefrigerante` y `resolvePresionAceite` en `rinho-receptor/src/domain/lecturaMapper.js`. Los cuatro numéricos siguen el patrón de `resolveCombustiblePct` (leer del `Map`, `Number(...)`, `null` + `camposFaltantes.push(...)` si falta o no es numérico, **sin** chequeo de rango — research.md D-02). `resolveVin` es la excepción: nunca convierte a número, solo verifica que la clave exista y no esté vacía (contrato `rinho-eq-frame.md`, discrepancia (c)). Agregar `CAN_RPM`, `CAN_COMBUSTIBLE_CONSUMIDO`, `CAN_TEMP_REFRIGERANTE` y `CAN_PRESION_ACEITE` a `CAN_IDS_PROMOVIDOS` (`CAN_VIN` ya estaba); incluir los cinco valores en el objeto que arma `mapFrameToLectura`; actualizar el comentario de `buildDatosCan` (ya no debe decir "VIN descartado") (depende de T001)
- [X] T004 [US1] Actualizar la lista de columnas y los parámetros del `INSERT ... ON CONFLICT DO NOTHING` en `rinho-receptor/src/db/lecturaRepository.js` para persistir `vin`, `rpm`, `combustible_consumido_l`, `temperatura_refrigerante_c` y `presion_aceite_kpa` (depende de T003)

**Checkpoint**: `cd rinho-receptor && npm test` pasa con los tests reemplazados y los
casos nuevos; una trama sintética enviada por UDP deja la fila con las cinco columnas
pobladas (o `NULL`) y `datos_can` con una única clave restante (`"3"`) (quickstart.md §3).
User Story 1 es funcional y verificable de forma independiente, sin tocar el servicio
Java.

---

## Phase 4: User Story 2 - Ver el estado del vehículo con todos los datos CAN y de vehículo identificados (Priority: P2)

**Goal**: `GET /api/v1/vehiculos/{dispositivoId}/estado` deja de devolver `datosCanCrudos`
y en su lugar devuelve, en el bloque `canBus`, los nueve valores soportados (VIN, RPM,
velocidad de rueda, odómetro, combustible consumido, nivel de combustible, temperatura de
refrigerante, presión de aceite, tensión de batería). `tensionBateriaV` deja de estar en
el bloque `dispositivo`.

**Independent Test**: Consultar el estado de un vehículo con una lectura reciente y
verificar que `canBus` incluye los nueve campos identificados por nombre, que
`datosCanCrudos` ya no existe, y que `dispositivo` ya no tiene `tensionBateriaV`
(quickstart.md §3-4). Puede probarse con fixtures propias, sin depender de que US1 haya
corrido antes (salvo para ver valores no nulos en un entorno real).

### Tests for User Story 2 ⚠️

- [X] T009 [US2] Crear `src/test/java/ar/utn/agrolink/ingesta/estado/DatosCanCrudoReaderTest.java` con 3 casos: clave presente y numérica (devuelve el valor), clave ausente o `datosCan` vacío/`null` (devuelve `null`), valor no numérico (devuelve `null`, sin lanzar excepción) (depende de T008)
- [X] T011 [US2] Ampliar `src/test/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoServiceTest.java`: fixtures por reflexión con los cinco campos nuevos de la entidad y un `datosCan` JSON con la clave `"3"`; casos de lectura completa (los 9 campos de `canBus` con valor, `dispositivo` sin `tensionBateriaV`), lectura con datos ausentes (los 9 campos de `canBus` en `null`), y una aserción de que `CanBusDto` ya no expone `datosCanCrudos` y `DispositivoInfoDto` ya no expone `tensionBateriaV` (depende de T006, T007, T010)

### Implementation for User Story 2

- [X] T006 [P] [US2] Reestructurar `src/main/java/ar/utn/agrolink/ingesta/estado/CanBusDto.java`: quitar `datosCanCrudos`; agregar `vin` (`String`), `rpm` (`Integer`), `velocidadRuedaKmh` (`Integer`), `combustibleConsumidoL` (`Double`), `temperaturaRefrigeranteC` (`Integer`), `presionAceiteKpa` (`Integer`) y `tensionBateriaV` (`Double`, reubicado desde `DispositivoInfoDto`); conservar `odometroM`, `odometroOrigen`, `combustiblePct` sin cambios (depende de T002)
- [X] T007 [P] [US2] Quitar el campo `tensionBateriaV` de `src/main/java/ar/utn/agrolink/ingesta/estado/DispositivoInfoDto.java` (se reubica a `CanBusDto`, ver T006)
- [X] T008 [P] [US2] Crear `src/main/java/ar/utn/agrolink/ingesta/estado/DatosCanCrudoReader.java`: `Integer leerEntero(String datosCanJson, String id)` y `Double leerDecimal(String datosCanJson, String id)`, usando un `ObjectMapper` de Jackson para parsear a `Map<String, String>` una sola vez; devuelve `null` (nunca lanza) si `datosCanJson` es `null`/vacío, la clave no está, el valor está vacío, o no es numérico (research.md D-04)
- [X] T010 [US2] Reescribir `mapearCanBus` y `mapearDispositivo` en `src/main/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoService.java`: `mapearCanBus` construye el nuevo `CanBusDto` con `vin`/`rpm`/`combustibleConsumidoL`/`temperaturaRefrigeranteC`/`presionAceiteKpa`/`tensionBateriaV`/`odometroM`/`odometroOrigen`/`combustiblePct` directo desde los getters de la entidad, y `velocidadRuedaKmh` vía `DatosCanCrudoReader.leerEntero(lectura.getDatosCan(), "3")`; `mapearDispositivo` deja de pasar `tensionBateriaV` (depende de T002, T006, T007, T008)

**Checkpoint**: `mvn test` pasa con los casos nuevos; `curl .../estado` devuelve `canBus`
con los nueve campos nombrados (sin `datosCanCrudos`) y `dispositivo` sin
`tensionBateriaV` (quickstart.md §3-4). User Stories 1 y 2 funcionan de forma
independiente y en conjunto.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Consistencia documental y validación final end-to-end.

- [X] T012 [P] Corregir `specs/001-ingesta-adaptacion-telemetria/contracts/rinho-eq-frame.md` (research.md D-05): en las tablas de §4 y §5-bis, cambiar el "Destino" de `1` (de "⛔ descartado (Principio V)" a `vin`), `2` (a `rpm`), `14` (a `combustible_consumido_l`, litros), `2A` (a `temperatura_refrigerante_c`) y `2C` (a `presion_aceite_kpa`); en la discrepancia (c), quitar "podría enmascarar el descarte del VIN que exige el Principio V" y conservar solo la regla técnica vigente (el VIN nunca se convierte a número); en la discrepancia (d), quitar "no debe usarse para ningún cálculo hasta confirmar la unidad" y aclarar que la unidad ya está confirmada en litros, con una nota de que el valor de esa trama de ejemplo (`30000`) sigue siendo alto para el tipo de vehículo observado
- [X] T013 Ejecutar la validación end-to-end de `specs/003-can-fields-expansion/quickstart.md` completa (cambio de esquema, ambas suites de test, trama sintética, casos límite de §4)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Sin dependencias — puede empezar de inmediato.
- **Foundational (Phase 2)**: Depende de Setup (T001). Bloquea toda tarea de US2.
- **User Story 1 (Phase 3)**: Depende solo de Setup (T001). **No** depende de Foundational
  (T002) — el receptor Node no toca la entidad Java. Puede avanzar en paralelo con la
  Fase 2.
- **User Story 2 (Phase 4)**: Depende de Foundational (T002) para los cinco campos de
  entidad. No depende de que US1 haya terminado (puede construirse y testearse con
  fixtures propias), aunque para ver valores reales en un entorno real hace falta que US1
  esté desplegado.
- **Polish (Phase 5)**: Depende de que Phase 3 y Phase 4 estén completas.

### User Story Dependencies

- **User Story 1 (P1)**: Independiente — solo requiere T001.
- **User Story 2 (P2)**: Requiere T002 (Foundational). Independiente de US1 en su propio
  código y sus propios tests (usa fixtures, no requiere que el receptor haya corrido).

### Dentro de cada historia

- US1: T003 (resolvers) → T004 (INSERT) → T005 (tests de los resolvers, pueden escribirse
  junto con T003).
- US2: T006, T007 y T008 son independientes entre sí ([P]) → T010 (servicio) depende de
  T002, T006, T007 y T008 → T009 (test del reader) depende de T008 → T011 (test del
  servicio) depende de T006, T007 y T010.

### Parallel Opportunities

- T001 (Setup) no tiene pares para paralelizar.
- Fase 3 (US1) y Fase 2 (Foundational) pueden ejecutarse en paralelo por personas
  distintas, ya que tocan componentes distintos (Node vs. Java) y ninguna depende de la
  otra.
- Dentro de US2: T006 (`CanBusDto`), T007 (`DispositivoInfoDto`) y T008
  (`DatosCanCrudoReader`) son `[P]` — archivos distintos, sin dependencia entre sí.
- T012 (Polish, documentación de otra feature) es `[P]` respecto de T013 (son tareas de
  naturaleza distinta: edición de doc vs. validación manual).

---

## Parallel Example: User Story 2

```bash
# Una vez completado T002 (Foundational), lanzar juntos:
Task: "Reestructurar CanBusDto en src/main/java/ar/utn/agrolink/ingesta/estado/CanBusDto.java"
Task: "Quitar tensionBateriaV de DispositivoInfoDto en src/main/java/ar/utn/agrolink/ingesta/estado/DispositivoInfoDto.java"
Task: "Crear DatosCanCrudoReader en src/main/java/ar/utn/agrolink/ingesta/estado/DatosCanCrudoReader.java"
```

---

## Implementation Strategy

### MVP First (User Story 1 solamente)

1. Completar Phase 1: Setup (T001)
2. Completar Phase 3: User Story 1 (T003-T005)
3. **DETENER y VALIDAR**: correr `npm test` en `rinho-receptor` y verificar por SQL que
   las cinco columnas nuevas se pueblan correctamente con una trama sintética
   (quickstart.md §3)
4. Esto ya es un incremento entregable: los datos quedan disponibles en base, aunque la
   consulta de estado (US2) todavía no los muestre por nombre.

### Incremental Delivery

1. Setup (T001) + Foundational (T002) en paralelo con Phase 3 (US1) → ~simultáneo
2. User Story 1 completa → validar independientemente → los datos ya son de dominio
3. User Story 2 completa (requiere T002 ya hecho) → validar independientemente →
   `datosCanCrudos` desaparece de la API, `tensionBateriaV` se reubica, y los nueve
   campos de `canBus` aparecen con nombre
4. Polish (T012-T013) → consistencia documental (feature 001) + validación end-to-end
   final

---

## Notes

- `[P]` = archivos distintos, sin dependencias pendientes entre sí.
- `[Story]` mapea cada tarea a su historia de usuario para trazabilidad con spec.md.
- Los tests de esta feature no son opcionales: Principio VIII de la constitución los
  exige para toda lógica de parseo/adaptación de datos externos (los cinco resolvers Node
  y `DatosCanCrudoReader`), y dos tests existentes que hoy afirman una política ya
  revertida (descarte del VIN) deben reemplazarse, no dejarse pasar.
- Ningún test se marcó "debe fallar antes de implementar" (TDD estricto) porque no fue
  pedido explícitamente; alcanza con que la cobertura de los 3 casos exista al cerrar cada
  historia.
- Evitar: tareas vagas, dos tareas `[P]` tocando el mismo archivo, dependencias cruzadas
  entre US1 y US2 que rompan su independencia.
