# Tasks: Arranque automático de la simulación en el horario planificado del viaje

**Input**: Design documents from `/specs/013-autostart-simulacion-viaje/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (todos presentes)

**Tests**: Incluidos — `plan.md` (Testing) y `quickstart.md` § 2 ya los dan por esperados; cubren
los 3 casos críticos por componente (análogo al Principio VIII de la constitución, aunque esta
feature no es una capa de parseo de telemetría).

**Organization**: Tareas agrupadas por user story de `spec.md` (US1 = P1, US2 = P2). Todas las
rutas son de este repo (`agrolink-ingesta`); el lado de AgroLinkBackend (repo separado) se
documenta en `contracts/agrolink-backend-trip-hook.md` y no tiene tareas propias acá — su
implementación es responsabilidad de ese otro repo.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede correr en paralelo (archivos distintos, sin dependencias)
- **[Story]**: US1 o US2, mapeando a `spec.md`
- Rutas de archivo exactas, relativas a la raíz del repo

## Path Conventions

Single project Java/Spring Boot existente (`agrolink-ingesta`), ver plan.md § Project Structure:
- `src/main/java/ar/utn/agrolink/ingesta/viajeprogramado/` (paquete nuevo de esta feature)
- `src/test/java/ar/utn/agrolink/ingesta/viajeprogramado/`
- `deploy/migrations/`, `src/main/resources/application.yaml`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: estructura base y configuración antes de escribir lógica de negocio.

- [X] T001 Crear los directorios `src/main/java/ar/utn/agrolink/ingesta/viajeprogramado/` y
  `src/test/java/ar/utn/agrolink/ingesta/viajeprogramado/`
- [X] T002 [P] Crear `deploy/migrations/007_add_viaje_programado.sql` con el DDL de
  `data-model.md` § 1 (`CREATE SCHEMA ingesta`, tabla `ingesta.viaje_programado`, índice parcial
  sobre `estado = 'PENDIENTE'`, grants `SELECT/INSERT/UPDATE` + secuencias a `agrolink_ingesta`,
  sin `DELETE`)
- [X] T003 [P] Agregar a `src/main/resources/application.yaml` las propiedades
  `agrolink.simulador-viajes.base-url` (default `http://simulador-viajes:${SIMULADOR_PUERTO_HTTP:-}`),
  `agrolink.simulador-viajes.connect-timeout-ms`, `agrolink.simulador-viajes.read-timeout-ms` y
  `agrolink.viaje-programado.poll-interval-ms` (research.md D-01), todas con `${ENV_VAR:default}`
- [X] T004 Agregar `@EnableScheduling` a
  `src/main/java/ar/utn/agrolink/ingesta/IngestaApplication.java`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: entidad, repositorio, lista cerrada y cliente HTTP que ambas user stories necesitan.

**⚠️ CRITICAL**: ninguna user story puede implementarse sin esta fase.

- [X] T005 [P] Crear `DispositivosSimuladosConocidos` en
  `src/main/java/ar/utn/agrolink/ingesta/viajeprogramado/DispositivosSimuladosConocidos.java`:
  lista cerrada y método `esSimulado(String iotDeviceId)` con los 5 valores exactos de
  `spec.md` FR-001 (`geo-demo-001`, `tel-demo-003`, `tra-demo-004`, `900001`, `900002`) — NO un
  patrón genérico
- [X] T006 [P] Test unitario `DispositivosSimuladosConocidosTest` en
  `src/test/java/ar/utn/agrolink/ingesta/viajeprogramado/DispositivosSimuladosConocidosTest.java`:
  cada uno de los 5 ids matchea; un id que sólo se parece al patrón ("demo"/900001-900999, p.
  ej. `otro-demo-999` o `900050`) NO matchea; `null`/vacío no matchea
- [X] T007 [P] Crear la entidad JPA `ViajeProgramado` en
  `src/main/java/ar/utn/agrolink/ingesta/viajeprogramado/ViajeProgramado.java` mapeada a
  `ingesta.viaje_programado` (data-model.md § 1), con el enum/constantes de `estado`
  (`PENDIENTE`, `DISPARADO`, `CANCELADO`, `ERROR`)
- [X] T008 [P] Crear `ViajeProgramadoRepository` en
  `src/main/java/ar/utn/agrolink/ingesta/viajeprogramado/ViajeProgramadoRepository.java`
  (`JpaRepository`): `findByTripCode(String)`,
  `findByEstadoAndEstimatedStartDateTimeLessThanEqual(String, LocalDateTime)`
- [X] T009 Crear `SimuladorViajesClient` en
  `src/main/java/ar/utn/agrolink/ingesta/viajeprogramado/SimuladorViajesClient.java`: `@Component`,
  `RestClient` configurado con `@Value` desde T003, método que hace `POST /rutas` con bloque
  `camion` (contrato `specs/011-generar-ruta-simulada/contracts/rutas-http-api.md`) y devuelve un
  resultado tipado éxito/fallo — nunca propaga `RestClientException` (research.md D-07, mismo
  patrón que `IngestaVehiculoEstadoClient`)
- [X] T010 [P] Test unitario `SimuladorViajesClientTest` en
  `src/test/java/ar/utn/agrolink/ingesta/viajeprogramado/SimuladorViajesClientTest.java`: éxito
  con un `MockRestServiceServer`/servidor fake; fallo de red, `4xx` y `5xx` traducidos a
  resultado tipado sin excepción propagada (FR-004)

**Checkpoint**: entidad, repo, lista cerrada y cliente HTTP listos — US1 y US2 pueden empezar.

---

## Phase 3: User Story 1 - Arrancar la simulación sola, en el horario planificado del viaje (Priority: P1) 🎯 MVP

**Goal**: dar de alta un viaje programado para un dispositivo de la lista cerrada deja la fila
`PENDIENTE` sin disparar antes de hora; en el horario planificado (o de inmediato si ya pasó) se
dispara sola; reprogramar/cancelar una fila `PENDIENTE` la actualiza/cierra; un dispositivo fuera
de la lista nunca dispara nada.

**Independent Test**: `POST .../viajes-simulados` con un `iotDeviceId` de la lista cerrada y
`estimatedStartDateTime` futuro → `202 PENDIENTE`; sin telemetría nueva antes de ese horario;
tras alcanzarlo, la fila pasa a `DISPARADO` y aparece telemetría fresca para ese dispositivo
(ver `quickstart.md` §§ 3-6).

### Tests for User Story 1 ⚠️

> Escribir y confirmar que fallan antes de implementar T016-T020.

- [X] T011 [P] [US1] Test de contrato en
  `src/test/java/ar/utn/agrolink/ingesta/viajeprogramado/ViajeProgramadoControllerIT.java`:
  `POST .../viajes-simulados` con un id de la lista cerrada → `202`; con un id fuera de la lista
  (incluido uno que sólo matchea el patrón "demo"/900001-900999) → `404` (FR-001/FR-003,
  contrato `contracts/viajes-simulados-http-api.md`)
- [X] T012 [P] [US1] Test unitario en
  `src/test/java/ar/utn/agrolink/ingesta/viajeprogramado/ViajeProgramadoServiceTest.java`: alta
  con `estimatedStartDateTime` futuro queda `PENDIENTE` sin llamar a `SimuladorViajesClient`;
  alta con horario ya pasado o inmediato llama a `SimuladorViajesClient` de una (FR-002/FR-002a)
- [X] T013 [P] [US1] Test unitario (mismo archivo que T012): reprogramar una fila `PENDIENTE`
  actualiza `estimatedStartDateTime` (FR-009); reprogramar una fila en cualquier otro estado
  devuelve conflicto sin modificarla
- [X] T014 [P] [US1] Test unitario (mismo archivo que T012): cancelar una fila `PENDIENTE` la
  pasa a `CANCELADO` (FR-010); cancelar una fila en cualquier otro estado devuelve conflicto
- [X] T015 [P] [US1] Test unitario `ViajeSimuladoSchedulerTest` en
  `src/test/java/ar/utn/agrolink/ingesta/viajeprogramado/ViajeSimuladoSchedulerTest.java`: el
  poller dispara únicamente filas `PENDIENTE` con `estimatedStartDateTime <= now()` y deja
  intactas las que todavía están en el futuro (SC-005)

### Implementation for User Story 1

- [X] T016 [US1] Implementar `ViajeProgramadoService.programar(...)` en
  `src/main/java/ar/utn/agrolink/ingesta/viajeprogramado/ViajeProgramadoService.java`: valida
  con `DispositivosSimuladosConocidos` (404 si no matchea), hace upsert por `tripCode` en
  `ViajeProgramadoRepository`, y si `estimatedStartDateTime` ya pasó/es inmediato dispara de una
  vía `SimuladorViajesClient` en vez de esperar al poller (depende de T005, T007, T008, T009)
- [X] T017 [US1] Implementar `ViajeProgramadoService.reprogramar(...)` y `.cancelar(...)` en el
  mismo archivo que T016 (FR-009/FR-010: ambos devuelven conflicto si la fila no está
  `PENDIENTE`)
- [X] T018 [US1] Implementar `ViajeProgramadoController` en
  `src/main/java/ar/utn/agrolink/ingesta/viajeprogramado/ViajeProgramadoController.java`:
  `POST`/`PUT`/`DELETE` bajo `/api/v1/vehiculos/{dispositivoId}/viajes-simulados(/{tripCode})`
  tal como especifica `contracts/viajes-simulados-http-api.md` (depende de T016, T017)
- [X] T019 [US1] Implementar `ViajeSimuladoScheduler` en
  `src/main/java/ar/utn/agrolink/ingesta/viajeprogramado/ViajeSimuladoScheduler.java`:
  `@Scheduled(fixedDelayString = "${agrolink.viaje-programado.poll-interval-ms}")` que relee
  `ViajeProgramadoRepository.findByEstadoAndEstimatedStartDateTimeLessThanEqual("PENDIENTE",
  now())` y dispara cada fila vencida vía `SimuladorViajesClient` (depende de T008, T009)
- [X] T020 [US1] En `SimuladorViajesClient` (o un mapper dedicado), construir el payload
  `camion`/`ruta` hacia `simulador-viajes` a partir de la fila (`nombre_ruta` derivado de
  `trip_code`, `camion.id = iot_device_id`, `odometroInicialKm` ausente/default) siguiendo
  `specs/011-generar-ruta-simulada/contracts/rutas-http-api.md`

**Checkpoint**: User Story 1 funcional y testeable de punta a punta de forma independiente.

---

## Phase 4: User Story 2 - El alta del viaje no se ve afectada si la simulación no puede arrancar (Priority: P2)

**Goal**: si `simulador-viajes` está caído o rechaza la solicitud al momento del disparo, la fila
pasa a `ERROR` con el detalle loggeado, y ninguna excepción se propaga fuera del poller ni del
controller.

**Independent Test**: con `simulador-viajes` detenido, forzar el disparo de una fila (horario ya
pasado) y verificar que queda `ERROR` con `ultimo_error` poblado, aparece en los logs, y que el
`POST`/`PUT`/`DELETE` del contrato de alta nunca devuelve `5xx` por esa causa (ver
`quickstart.md` § 7).

### Tests for User Story 2 ⚠️

- [X] T021 [P] [US2] Test unitario en `ViajeSimuladoSchedulerTest.java` (mismo archivo que T015):
  si `SimuladorViajesClient` devuelve fallo, la fila pasa a `ERROR` con `ultimo_error` poblado y
  el poller sigue su ciclo sin lanzar excepción (FR-004/FR-005)
- [X] T022 [P] [US2] Test en `ViajeProgramadoControllerIT.java` (mismo archivo que T011): el
  controller responde `202`/`200`/`204` normalmente para el alta/reprogramación/cancelación aun
  si `simulador-viajes` está caído — esa falla sólo puede manifestarse después, en el disparo del
  poller, nunca en estas llamadas (FR-004)

### Implementation for User Story 2

- [X] T023 [US2] Agregar manejo de error y logging estructurado en `ViajeSimuladoScheduler`
  (T019): capturar el resultado de fallo de `SimuladorViajesClient`, setear
  `estado = 'ERROR'` + `ultimo_error` con el detalle, y loggear con `tripCode`/`iotDeviceId`
  (FR-005)
- [X] T024 [US2] Revisar `SimuladorViajesClient` (T009) para confirmar que ningún camino de
  fallo (timeout, `4xx`, `5xx`, excepción de parseo) se escapa sin traducirse a un resultado
  tipado — ajustar si T010 revela un hueco

**Checkpoint**: US1 y US2 funcionales juntas.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: validación end-to-end y documentación.

- [X] T025 [P] Correr `mvn -q test` completo y resolver cualquier regresión en los tests ya
  existentes del repo (`estado`/`report`/`telemetry`)
- [X] T026 [P] Actualizar `docs/handoff/simulador-viajes.md` y
  `docs/handoff/dispositivos-simulados.md` con una sección sobre este mecanismo de arranque
  automático y un enlace a `specs/013-autostart-simulacion-viaje/`
- [X] T027 Ejecutar manualmente `quickstart.md` de punta a punta (migración, alta,
  no-disparo-antes-de-hora, disparo en horario, reprogramación, cancelación, falla simulada) y
  confirmar cada resultado esperado
- [X] T028 [P] Dejar constancia en `docs/handoff/` (o en un issue/TODO del repo AgroLinkBackend)
  del gap señalado en `contracts/agrolink-backend-trip-hook.md`: `Trip` todavía no tiene
  origen/destino geocodificados como `lat`/`lon`, necesarios para que `SimulacionViajeClient`
  (AgroLinkBackend) arme el payload de esta feature

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias — puede arrancar de inmediato.
- **Foundational (Phase 2)**: depende de Setup. Bloquea ambas user stories.
- **User Story 1 (Phase 3)**: depende de Foundational. Sin dependencia de US2.
- **User Story 2 (Phase 4)**: depende de Foundational y de que exista el poller (T019 de US1) —
  sus tests y ajustes son sobre el mismo mecanismo que dispara US1, así que en la práctica se
  implementa después de T019, aunque es conceptualmente independiente (prueba un camino
  distinto: el de falla).
- **Polish (Phase 5)**: depende de que US1 (mínimo) esté completa; T025/T027 idealmente también
  con US2 completa.

### Parallel Opportunities

- T002, T003 (Setup) en paralelo.
- T005, T006, T007, T008, T010 (Foundational) en paralelo entre sí; T009 depende de T003
  (config) pero no de T005-T008.
- T011-T015 (tests de US1) en paralelo entre sí.
- T021-T022 (tests de US2) en paralelo entre sí.
- T025, T026, T028 (Polish) en paralelo.

---

## Parallel Example: Foundational

```bash
Task: "Crear DispositivosSimuladosConocidos en .../viajeprogramado/DispositivosSimuladosConocidos.java"
Task: "Crear la entidad JPA ViajeProgramado en .../viajeprogramado/ViajeProgramado.java"
Task: "Crear ViajeProgramadoRepository en .../viajeprogramado/ViajeProgramadoRepository.java"
Task: "Test unitario SimuladorViajesClientTest en .../viajeprogramado/SimuladorViajesClientTest.java"
```

## Parallel Example: User Story 1 (tests)

```bash
Task: "Test de contrato ViajeProgramadoControllerIT: 202 lista cerrada / 404 fuera de lista"
Task: "Test unitario ViajeProgramadoServiceTest: horario futuro vs. pasado/inmediato"
Task: "Test unitario ViajeProgramadoServiceTest: reprogramación FR-009"
Task: "Test unitario ViajeProgramadoServiceTest: cancelación FR-010"
Task: "Test unitario ViajeSimuladoSchedulerTest: solo dispara filas vencidas"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Completar Phase 1 (Setup) y Phase 2 (Foundational) — bloquean todo lo demás.
2. Completar Phase 3 (US1) → el mecanismo de arranque automático ya funciona de punta a punta.
3. **Parar y validar**: correr `quickstart.md` §§ 1-6 contra un `simulador-viajes` sano.
4. Esto ya resuelve el dolor original (curl manual) — US2 sólo agrega resiliencia ante fallas.

### Incremental Delivery

1. Setup + Foundational → base lista.
2. US1 → probar independientemente (demo/thesis checkpoint viable acá).
3. US2 → probar independientemente (apagar `simulador-viajes` y confirmar que nada se rompe).
4. Polish → `quickstart.md` completo + documentación.

---

## Notes

- [P] = archivos distintos, sin dependencias entre sí.
- [US1]/[US2] mapean a las user stories de `spec.md`.
- Las tareas de test van primero dentro de cada fase — confirmar que fallan antes de
  implementar lo correspondiente.
- El lado de AgroLinkBackend (`TripService`, `SimulacionViajeClient` nuevo) no tiene tareas en
  este archivo — es un repo separado; `contracts/agrolink-backend-trip-hook.md` documenta lo que
  ese repo debe implementar para consumir esta feature.
