---

description: "Tareas de la feature 019: desvío térmico manual de la carga refrigerada"
---

# Tasks: Activar y cerrar a mano el desvío térmico de la carga refrigerada

**Input**: Documentos de diseño en `specs/019-falla-carga-refrigerada-http/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/simulador-falla-carga-http.md, quickstart.md

**Tests**: Incluidos. La quickstart §7 los enumera y el Principio VIII de la constitución los exige
para los campos nuevos que acepta `/rutas`. Se escriben antes de la implementación de cada fase y
deben fallar primero.

**Organization**: Por historia de usuario. US1 (activar) y US2 (cerrar) son P1 y juntas forman el
MVP. US3 (consultar) es P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (otro archivo, sin dependencias pendientes)
- **[Story]**: historia de usuario a la que pertenece (US1, US2, US3)
- Rutas relativas a la raíz del repo `AgroLinkIngestaAdaptacion/`

---

## Phase 1: Setup (infraestructura compartida)

**Purpose**: esquema y configuración que usan todas las historias.

- [X] T001 Crear `deploy/migrations/013_add_desvio_termico_carga.sql` (data-model.md §1 y §2):
  - Agrega a `simulador.viaje` las columnas `falla_carga_sentido VARCHAR(5) CHECK (falla_carga_sentido IN ('arriba','abajo'))`, `falla_carga_activada_en TIMESTAMPTZ` y `falla_carga_desactivada_en TIMESTAMPTZ`.
  - Agrega a `simulador.camion` las columnas `umbral_min_c NUMERIC(4,1)` y `umbral_max_c NUMERIC(4,1)`.
  - Todas con `ADD COLUMN IF NOT EXISTS`.
  - Reemplaza el `CHECK` de `falla_tipo`: un bloque `DO $$ ... $$` busca en `pg_constraint` todo `CHECK` de `simulador.viaje` cuya definición mencione `falla_tipo` y lo borra. Después crea `viaje_falla_tipo_check` con `falla_tipo IN ('apertura_puerta','falla_compresor','desvio_termico')` (plan.md, Riesgos).
  - Encabezado con un comentario que diga que solo toca configuración del simulador (Principio IV).
- [X] T002 [P] Replicar en `deploy/db/03-schema-simulador.sql`:
  - las columnas nuevas de `CREATE TABLE simulador.camion` y de `CREATE TABLE simulador.viaje`;
  - el `CHECK` de `falla_tipo` con el valor `desvio_termico`.
- [X] T003 [P] Agregar `CARGA_DESVIO_MARGEN_C` (default 4) y `CARGA_DESVIO_SIN_UMBRALES_C` (default 8), con comentarios:
  - a `deploy/.env.example`;
  - al `environment:` del servicio `simulador-viajes` en `deploy/compose.yaml`, con la misma sintaxis `${VAR:-default}` que las variables `MOTOR_*`.

---

## Phase 2: Foundational (prerrequisitos de todas las historias)

**Purpose**: que el simulador conozca el rango del viaje (FR-014, FR-015) y pueda sintetizar el
desvío. Ninguna historia funciona bien sin esta fase.

**⚠️ CRITICAL**: completar antes de las fases 3 a 5.

### Tests

- [X] T004 [P] Tests de `loadCargaDesvioConfig` en `simulador-viajes/test/config/cargaDesvio.test.js`:
  - defaults `{ margenC: 4, sinUmbralesC: 8 }`;
  - rechaza `CARGA_DESVIO_MARGEN_C` < 2,5 o no numérico;
  - rechaza `CARGA_DESVIO_SIN_UMBRALES_C` ≤ 0 o no numérico.
- [X] T005 [P] Tests del modo `desvio_termico` en `simulador-viajes/test/domain/sintesisBle.test.js`, con setpoint 5 y rango 2 a 8 (research.md D-03):
  - `arriba`: desde 5, supera 8 en ≤ 3 tramas y supera 10 desde la tercera;
  - durante 200 tramas se mantiene en [11,5, 12,5];
  - `abajo`: queda por debajo de 2 en ≤ 3 tramas y se mantiene en [-2,5, -1,5];
  - sin umbrales (`umbralMinC`/`umbralMaxC` nulos), con setpoint 2,5: el objetivo es 10,5 o -5,5;
  - después del desvío, el modo `normal` vuelve al rango en ≤ 5 tramas;
  - `objetivoDesvio(...)` devuelve el objetivo esperado en cada caso.
- [X] T006 [P] Tests de umbrales en `/rutas` (Principio VIII) en `simulador-viajes/test/services/routeGenerationService.test.js`. Con `tipoCarga: 'refrigerada'` y setpoint válido:
  - acepta ambos umbrales válidos;
  - rechaza con `motivo: 'validacion'` solo el mínimo, solo el máximo, un umbral no numérico, fuera de ±50 o con el mínimo mayor que el máximo;
  - con carga seca, umbrales presentes no provocan error.
- [X] T007 [P] Tests en `simulador-viajes/test/services/iniciarViajeService.test.js`:
  - el alta de un camión refrigerado guarda `umbral_min_c`/`umbral_max_c` (parámetros del `INSERT`);
  - un camión existente los actualiza en `actualizarCargaCamion`;
  - con carga seca quedan en `null`.
  - Ajustar `fakePool` a los parámetros nuevos de ambas queries.
- [X] T008 [P] Tests en `src/test/java/ar/utn/agrolink/ingesta/viajeprogramado/SimuladorViajesClientTest.java`:
  - con umbrales 2 y 7, el JSON trae `$.camion.umbralTermicoMinC == 2` y `$.camion.umbralTermicoMaxC == 7`, además del `setpointTempC` 4,5 existente;
  - sin umbrales, ambos campos no existen.

### Implementation

- [X] T009 [P] Implementar `loadCargaDesvioConfig(env)` en `simulador-viajes/src/config.js`, con las validaciones de data-model.md §4, e incluirla como `cargaDesvio` en `loadConfig`.
- [X] T010 Extender `simulador-viajes/src/domain/sintesisBle.js` (research.md D-03, depende de T009 para los defaults):
  - exportar `objetivoDesvio({ sentido, umbralMinC, umbralMaxC, setpointTempC, config })`;
  - agregar el modo `desvio_termico`: `t = anterior + (objetivo - anterior) × 0,6 + ruido(±0,3)`;
  - `sintetizarBle` recibe además `umbralMinC`, `umbralMaxC`, `sentido` y `config` (default `{ margenC: 4, sinUmbralesC: 8 }`);
  - los modos `normal`, `apertura_puerta` y `falla_compresor` no cambian.
- [X] T011 Validar `umbralTermicoMinC`/`umbralTermicoMaxC` en `validarCamion` de `simulador-viajes/src/services/routeGenerationService.js` (data-model.md §2: juntos, numéricos, dentro de ±50, mínimo ≤ máximo, solo con carga refrigerada).
- [X] T012 Guardar los umbrales en el camión:
  - en `simulador-viajes/src/db/camionRepository.js`: `insertarCamion` y `actualizarCargaCamion` reciben `umbralMinC`/`umbralMaxC` y los escriben en `umbral_min_c`/`umbral_max_c`;
  - en `simulador-viajes/src/services/iniciarViajeService.js`: `resolverCarga` los toma de `camion.umbralTermicoMinC`/`umbralTermicoMaxC` con carga refrigerada, y en otro caso los deja en `null`.
- [X] T013 Leer las columnas nuevas en `simulador-viajes/src/db/flotaRepository.js`:
  - en `obtenerViajesEnCurso`: `c.umbral_min_c`, `c.umbral_max_c`, `v.falla_carga_sentido`, `v.falla_carga_activada_en` y `v.falla_carga_desactivada_en`;
  - en `mapRow`: `camion.umbralMinC`/`umbralMaxC` como `Number` o `null`, y `viaje.fallaCargaSentido`, `fallaCargaActivadaEn` y `fallaCargaDesactivadaEn`.
- [X] T014 [P] Agregar `umbralTermicoMinC` y `umbralTermicoMaxC` (`BigDecimal`, omitidos si son `null`) a `CamionRequest` en `src/main/java/ar/utn/agrolink/ingesta/viajeprogramado/SimuladorViajesClient.java`. En `camion(...)` se completan desde `getUmbralTermicoMinC()`/`getUmbralTermicoMaxC()` cuando `esCargaRefrigerada()`. Actualizar el Javadoc del método.
- [X] T015 [P] Crear `simulador-viajes/src/domain/registroTemperaturaCarga.js`, con `registrarTemperaturaCarga(camionId, t)` y `obtenerTemperaturaCarga(camionId)`, igual que `registroTemperaturaMotor.js`.

**Checkpoint**: `npm test` y los tests de la ingesta pasan. Un `/rutas` con umbrales los deja en
`simulador.camion`.

---

## Phase 3: User Story 1 — Activar el desvío térmico con un curl (Priority: P1) 🎯 MVP

**Goal**: un `POST` lleva la temperatura de la carga fuera del rango del viaje desde la trama
siguiente y la mantiene ahí (FR-001 a FR-006, FR-011 a FR-013, FR-016 a FR-019).

**Independent Test**: quickstart §2 y §4. Después del `POST`, las tramas de `900002` traen la
temperatura por encima de 8 °C (o por debajo de 2 °C con `?sentido=abajo`) y el backend termina
abriendo la alerta térmica.

### Tests

- [X] T016 [P] [US1] Crear `simulador-viajes/test/http/fallaCargaHandler.test.js`, con repositorio falso y reloj fijo como `fallaMotorHandler.test.js`, que cubra el `POST` del contrato §1:
  - `ACTIVADA` con sentido por defecto `arriba` y `objetivoC` 12;
  - `?sentido=abajo` con `objetivoC` -2;
  - `ACTIVADA` con `reemplaza: 'falla_compresor'`;
  - `YA_ACTIVA` que conserva el sentido vigente aunque se pida otro;
  - errores: 400 por sentido inválido y por `camionId` inválido, 404, 409 `sin_viaje_en_curso` (también con el camión inactivo) y 409 `sin_carga_refrigerada`;
  - 405 para `PUT`;
  - se loguea `info` con `efecto` y `sentido`.
- [X] T017 [P] [US1] Tests de `determinarModoBle` en `simulador-viajes/test/domain/modoBle.test.js`. Si se mueve a `src/domain/modoBle.js` (ver T020), verificar:
  - devuelve `desvio_termico` con `fallaTipo: 'desvio_termico'`;
  - `falla_compresor` y `apertura_puerta` siguen igual.

### Implementation

- [X] T018 [US1] Agregar a `simulador-viajes/src/db/viajeRepository.js`:
  - `mapFallaCarga(row)` (`fallaTipo`, `fallaCargaSentido`, `fallaCargaActivadaEn`, `fallaCargaDesactivadaEn`);
  - `obtenerCamionConCargaYViajeEnCurso(pool, camionId)`: como `obtenerCamionYViajeEnCurso`, pero además con `c.tipo_carga`, `c.setpoint_temp_c`, `c.umbral_min_c`, `c.umbral_max_c` y las columnas de falla de carga del viaje;
  - `activarDesvioTermico(pool, viajeId, sentido, ahora)` con la escritura de data-model.md §1 y `WHERE id = $1 AND estado = 'en_curso'`.
- [X] T019 [US1] Crear `simulador-viajes/src/http/fallaCargaHandler.js` con `crearFallaCargaHandler({ pool, repo, temperaturaDe, reloj, log, config })` y `RUTA_FALLA_CARGA = /^\/camiones\/([^/?]*)\/falla-carga\/?(?:\?.*)?$/`:
  - parsea `sentido` de la query con `URL`/`URLSearchParams`, `arriba` por defecto;
  - valida `camionId` y el método (`POST`, `GET`, `DELETE`; cualquier otro, 405);
  - resuelve 404 / 409 `sin_viaje_en_curso` / 409 `sin_carga_refrigerada`;
  - implementa el `POST` del contrato §1, con `objetivoC` calculado por `objetivoDesvio` (T010).
  - `GET` y `DELETE` responden 405 hasta las fases 4 y 5.
- [X] T020 [US1] En `simulador-viajes/src/index.js` (research.md D-04):
  - `determinarModoBle` devuelve `desvio_termico` cuando `viaje.fallaTipo === 'desvio_termico'`;
  - pasa a `sintetizarBle` `umbralMinC`, `umbralMaxC`, `sentido: viaje.fallaCargaSentido` y `config: cargaDesvioConfig`, fijado en `main()` desde `config.cargaDesvio`, igual que `motorConfig`;
  - la temperatura anterior se toma solo si `estado.viajeIdBle === viaje.id`, y se guarda `viajeIdBle: viaje.id` en `estadoPorCamion`;
  - llama a `registrarTemperaturaCarga(camion.id, ble.temperaturaC)` cuando hay segmento BLE.
  - Si `determinarModoBle` se mueve a `src/domain/modoBle.js` para poder testearlo (T017), importarlo desde ahí.
- [X] T021 [US1] Rutear `RUTA_FALLA_CARGA` en `simulador-viajes/src/http/rutaHttpServer.js`:
  - `crearRutaHttpServer` recibe `fallaCargaHandler` inyectable;
  - si no se inyecta, `crearFallaCargaHandler({ pool, config: cargaDesvio })`, recibiendo la config desde `iniciarRutaHttpServer` en `index.js`;
  - try/catch con log `error` y 500, igual que `falla-motor`;
  - actualizar el comentario de cabecera con la ruta nueva.

**Checkpoint**: quickstart §2, §4 y las filas `POST` de §5 andan contra el simulador local.

---

## Phase 4: User Story 2 — Cerrar el desvío térmico con un curl (Priority: P1) 🎯 MVP

**Goal**: un `DELETE` cierra la falla de carga vigente y la temperatura vuelve al rango en las
tramas siguientes (FR-007 a FR-009, FR-018).

**Independent Test**: quickstart §3 y la parte de cierre de §6. Después del `DELETE`, la temperatura
vuelve al rango en 1 o 2 tramas y el backend resuelve la alerta.

### Tests

- [X] T022 [P] [US2] Agregar a `simulador-viajes/test/http/fallaCargaHandler.test.js` el `DELETE` del contrato §2:
  - `DESACTIVADA` con `tipoCerrado: 'desvio_termico'`;
  - `DESACTIVADA` con `tipoCerrado: 'falla_compresor'` y `'apertura_puerta'`;
  - `YA_INACTIVA`;
  - errores 404 / 409, como en el `POST`;
  - se loguea `info` con `tipoCerrado`.

### Implementation

- [X] T023 [US2] Agregar `cerrarFallaCarga(pool, viajeId, ahora)` a `simulador-viajes/src/db/viajeRepository.js`, con la escritura de data-model.md §1 (`falla_tipo` e índice a `NULL`, `falla_carga_desactivada_en = now`, `WHERE id = $1 AND estado = 'en_curso'`).
- [X] T024 [US2] Implementar `DELETE` en `simulador-viajes/src/http/fallaCargaHandler.js` según el contrato §2.

**Checkpoint**: MVP completo. Quickstart §2 a §4 y la convivencia con la falla por SQL de §6 andan.

---

## Phase 5: User Story 3 — Consultar el estado del desvío (Priority: P2)

**Goal**: un `GET` informa estado, sentido, horas, rango y última temperatura emitida (FR-010).

**Independent Test**: quickstart §1, y el `GET` antes y después de activar y de cerrar.

### Tests

- [X] T025 [P] [US3] Agregar a `simulador-viajes/test/http/fallaCargaHandler.test.js` el `GET` del contrato §3:
  - `inactivo` sin falla;
  - `activo`, con `sentido`, `objetivoC` y `activadaEn`;
  - `otra_falla` con una falla por SQL;
  - después de un cierre: `desactivadaEn` informado y `sentido`/`objetivoC` en `null`;
  - `umbralMinC`/`umbralMaxC` en `null` cuando el camión no los tiene;
  - `ultimaTemperaturaC` desde `temperaturaDe` y `null` si no hay;
  - errores 404 / 409.

### Implementation

- [X] T026 [US3] Implementar `GET` en `simulador-viajes/src/http/fallaCargaHandler.js` según el contrato §3. El estado se deriva de `fallaTipo` con la tabla de data-model.md §1.

**Checkpoint**: las tres operaciones andan. Quickstart §1 a §6 completa.

---

## Phase 6: Polish & Cross-Cutting

- [X] T027 [P] Actualizar `simulador-viajes/README.md`:
  - en "Forzar una falla de carga refrigerada (para demos)", poner primero los `curl` de activar (con y sin `?sentido=abajo`), consultar y cerrar, con el mismo formato que la sección del motor;
  - dejar los `UPDATE` actuales como alternativa;
  - agregar los tiempos de apertura y cierre de la alerta y cómo acortarlos con `AGROLINK_ALERT_THERMAL_CHECKINTERVALMS` / `AGROLINK_ALERT_THERMAL_TOLERANCEMINUTES` (FR-020, research.md D-06);
  - documentar `CARGA_DESVIO_MARGEN_C` y `CARGA_DESVIO_SIN_UMBRALES_C`.
- [X] T028 [P] Agregar `umbralTermicoMinC`/`umbralTermicoMaxC` a la tabla del bloque `camion` en `specs/011-generar-ruta-simulada/contracts/rutas-http-api.md`, enlazando a `contracts/simulador-falla-carga-http.md` §5.
- [X] T029 Correr `cd simulador-viajes && npm test` y, desde la raíz, `JAVA_HOME=<jdk21> mvn test -Dtest='SimuladorViajesClientTest,ViajeProgramado*Test'`. Todo en verde.
- [ ] T030 Aplicar la migración (`make migrate`) y ejecutar `quickstart.md` §1 a §6 contra el stack local, con los tiempos del backend acortados. Anotar en este archivo cualquier desvío respecto de lo esperado.
  - **Avance 2026-11-22 (parcial)**: migración `013` aplicada con `make migrate`. Se probaron contra la base real, con el rol `simulador_viajes`, solo los handlers nuevos, levantados en un puerto aparte (8091), sobre el viaje 64 de `tel-demo-003`:
    - todas las filas `POST`/`GET`/`DELETE`, 400, 404, 405 y 409 `sin_carga_refrigerada` respondieron como el contrato;
    - el `CHECK` nuevo acepta `desvio_termico`;
    - sin umbrales, el objetivo fue setpoint − 8 (−4,5);
    - el viaje quedó otra vez con `falla_tipo = NULL`.
  - **Pendiente**: reiniciar `simulador-viajes` y `agrolink-ingesta` con este código y correr quickstart §1 a §6. Falta ver las tramas fuera del rango, la alerta del backend abriéndose y cerrándose, el reinicio y el fin de viaje.

---

## Dependencies & Execution Order

- **Setup (T001–T003)**: sin dependencias. T001 va primero porque T013 y T018 leen sus columnas.
- **Foundational (T004–T015)**: depende de Setup. Bloquea todas las historias.
  - Tests: T004 a T008, en paralelo entre sí.
  - Implementación: T009 → T010. T011 → T012 → T013. T014 y T015 son independientes.
- **US1 (T016–T021)**: depende de Foundational. T018 → T019 → T021. T020 depende de T010, T013 y T015.
- **US2 (T022–T024)**: depende de US1, porque comparte el handler y el ruteo.
- **US3 (T025–T026)**: depende de US1. Puede ir antes o después de US2, pero toca el mismo archivo
  del handler, así que no en paralelo con T024.
- **Polish (T027–T030)**: T027 y T028 pueden ir apenas termina US1. T029 y T030 van al final.

```text
T001 ─┬─ T002, T003
      └─ Foundational: T004–T008 (tests) → T009→T010 · T011→T012→T013 · T014 · T015
                         └─ US1: T016,T017 → T018→T019→T021 · T020
                               ├─ US2: T022 → T023→T024
                               └─ US3: T025 → T026
                                     └─ Polish: T027, T028 → T029 → T030
```

## Parallel Examples

**Foundational, tests** (archivos distintos):

```text
T004 test/config/cargaDesvio.test.js
T005 test/domain/sintesisBle.test.js
T006 test/services/routeGenerationService.test.js
T007 test/services/iniciarViajeService.test.js
T008 SimuladorViajesClientTest.java
```

**Foundational, implementación** (en paralelo a la cadena del simulador):

```text
T014 SimuladorViajesClient.java      (ingesta, Java)
T015 registroTemperaturaCarga.js     (simulador)
T009 config.js                       (después T010)
```

**US1**: T016 y T017 en paralelo. Después, T020 (`index.js`) en paralelo con la cadena
T018 → T019 → T021.

## Implementation Strategy

1. **MVP = US1 + US2** (las dos P1). El pedido es "activar y cerrar". Entregar solo la activación
   dejaría el viaje en alerta sin salida salvo por SQL. Orden: Setup → Foundational → US1 → US2.
   Validar quickstart §2 a §4.
2. **Incremento 2 = US3**. El `GET` facilita la demo pero no la bloquea.
3. **Cierre = Polish**: README, contrato de `/rutas`, suite completa y quickstart de punta a punta.
4. **Deploy**: la ingesta (T014) puede salir antes que el simulador, porque el simulador actual
   ignora los campos nuevos (plan.md, Riesgos). El simulador necesita la migración `013` aplicada
   antes de arrancar.
