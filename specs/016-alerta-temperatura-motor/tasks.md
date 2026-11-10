---
description: "Task list for 016-alerta-temperatura-motor"
---

# Tasks: Sobretemperatura de motor simulada y alerta de mantenimiento por riesgo de detención

**Input**: Design documents from `specs/016-alerta-temperatura-motor/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: incluidos. El Principio VIII de la constitución los exige para la interpretación de datos
externos, y plan.md § "Cobertura mínima" los detalla.

**Rutas**: relativas a `/home/franciscoromero/Documentos/UTN/ProyectoFinal/`. Tres repos:
`AgroLinkIngestaAdaptacion/` (simulador + deploy), `AgroLinkBackend/` y `AgroLink/` (front).

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup (infraestructura compartida)

- [X] T001 Crear la migración `AgroLinkIngestaAdaptacion/deploy/migrations/010_add_falla_motor_viaje.sql` con las columnas `falla_motor_origen` (`VARCHAR(6)` con `CHECK IN ('azar','manual')`), `falla_motor_indice_disparo INTEGER`, `falla_motor_duracion_min INTEGER CHECK (> 0)`, `falla_motor_activada_en TIMESTAMPTZ` y `falla_motor_desactivada_en TIMESTAMPTZ` sobre `simulador.viaje`, con `ADD COLUMN IF NOT EXISTS` (data-model.md §1)
- [X] T002 [P] Replicar esas columnas en `CREATE TABLE simulador.viaje` de `AgroLinkIngestaAdaptacion/deploy/db/03-schema-simulador.sql`
- [X] T003 [P] Agregar `MOTOR_FALLA_PROBABILIDAD_PCT`, `MOTOR_FALLA_DURACION_MIN_MIN`, `MOTOR_FALLA_DURACION_MAX_MIN`, `MOTOR_SUBIDA_C_POR_TRAMA` y `MOTOR_PICO_C`, con comentarios, a `AgroLinkIngestaAdaptacion/deploy/.env.example`, y pasarlas en `environment:` del servicio `simulador-viajes` de `AgroLinkIngestaAdaptacion/deploy/compose.yaml` (research.md D-06)
- [X] T004 [P] Agregar `RUN apk add --no-cache curl` antes de `USER simulador` en `AgroLinkIngestaAdaptacion/simulador-viajes/Dockerfile` (D-05)

---

## Phase 2: Foundational

- [X] T005 Implementar `loadMotorConfig(env)` en `AgroLinkIngestaAdaptacion/simulador-viajes/src/config.js` (defaults 5 / 20 / 40 / 2 / 115, validación de D-06) e incluirla como `motor` en `loadConfig`
- [X] T006 [P] Tests de `loadMotorConfig` (defaults, cada caso inválido) en `AgroLinkIngestaAdaptacion/simulador-viajes/test/config/motor.test.js`

---

## Phase 3: User Story 2 — Sobrecalentamiento simulado (P1) 🎯 parte del MVP

**Goal**: los camiones simulados envían temperatura de motor normal y se pueden sobrecalentar al azar (5 % por viaje) o a mano con `curl`.

**Independent Test**: quickstart.md §3, §4, §5 (lado simulador) y §7.

### Tests

- [X] T007 [P] [US2] Tests de `sintetizarTemperaturaMotor` (normal en [80,95] durante 1000 tramas, subida ≥105 en ≤9 tramas desde 88, estable en el pico, enfriamiento de 115 a <100 en ≤7 tramas, salida entera) en `AgroLinkIngestaAdaptacion/simulador-viajes/test/domain/sintesisTemperaturaMotor.test.js`
- [X] T008 [P] [US2] Tests de `sortearFallaMotor` (200 viajes con rng sembrado → entre 4 y 18; con 0 % nunca; índice en [10 %, 70 %]; duración en rango) y de `estadoFallaMotor` (sin_falla / pendiente / activa / terminada) en `AgroLinkIngestaAdaptacion/simulador-viajes/test/domain/fallaMotor.test.js`
- [X] T009 [P] [US2] Tests del handler HTTP (ACTIVADA, YA_ACTIVA, DESACTIVADA, YA_INACTIVA, cancelación de pendiente, 404, 409, 400, 405, GET) con repositorio falso en `AgroLinkIngestaAdaptacion/simulador-viajes/test/http/fallaMotorHandler.test.js`
- [X] T010 [P] [US2] Test de que `2A` lleva el valor de `temperaturaRefrigeranteC` en `AgroLinkIngestaAdaptacion/simulador-viajes/test/protocol/frameBuilder.test.js`

### Implementation

- [X] T011 [P] [US2] Crear `AgroLinkIngestaAdaptacion/simulador-viajes/src/domain/sintesisTemperaturaMotor.js` con los modos `normal`, `sobrecalentamiento` y `enfriamiento` de research.md D-01, más `determinarModoMotor({ activa, temperaturaAnterior })`
- [X] T012 [P] [US2] Crear `AgroLinkIngestaAdaptacion/simulador-viajes/src/domain/fallaMotor.js` con `sortearFallaMotor` y `estadoFallaMotor` (D-03, data-model.md §1)
- [X] T013 [US2] En `AgroLinkIngestaAdaptacion/simulador-viajes/src/db/viajeRepository.js`: `insertarViaje` acepta `fallaMotor` (resultado del sorteo) y lo persiste. Agregar `obtenerViajeEnCursoDeCamion`, `activarFallaMotorManual`, `desactivarFallaMotor`, `marcarFallaMotorActivada` y `marcarFallaMotorDesactivada`
- [X] T014 [US2] En `AgroLinkIngestaAdaptacion/simulador-viajes/src/db/flotaRepository.js`: leer las columnas `falla_motor_*` (en `mapRow` y en el `SELECT`) y hacer que `finalizarYCrearVuelta` acepte el sorteo del viaje de vuelta y lo inserte (sin copiar la falla anterior, FR-008)
- [X] T015 [US2] En `AgroLinkIngestaAdaptacion/simulador-viajes/src/services/iniciarViajeService.js`: sortear con la cantidad de puntos de la ruta y la config `motor`, y pasarlo a `insertarViaje`. Actualizar los llamadores (`routeGenerationService.js`, `rutaHttpServer.js`, `index.js`) para propagar la config
- [X] T016 [US2] En `AgroLinkIngestaAdaptacion/simulador-viajes/src/index.js`: calcular el estado de la falla, persistir las transiciones `pendiente→activa` y `activa→terminada` por duración, sintetizar la temperatura (reseteando el estado al cambiar de `viajeId`), enviarla en `can.temperaturaRefrigeranteC`, guardarla en `estadoPorCamion` y exponer un getter de última temperatura para el handler. Sortear también en el viaje de vuelta
- [X] T017 [US2] Crear `AgroLinkIngestaAdaptacion/simulador-viajes/src/http/fallaMotorHandler.js` según contracts/simulador-falla-motor-http.md y despacharlo desde `crearRutaHttpServer` en `AgroLinkIngestaAdaptacion/simulador-viajes/src/http/rutaHttpServer.js`
- [X] T018 [US2] Documentar el sobrecalentamiento (curl, variables, al azar) en `AgroLinkIngestaAdaptacion/simulador-viajes/README.md`

**Checkpoint**: `npm test` en verde. Con `curl` la temperatura sube en `/estado`.

---

## Phase 4: User Story 3 — La temperatura del motor no contamina la de carga (P1) 🎯 parte del MVP

**Goal**: la temperatura de carga sale solo del sensor BLE (FR-012).

**Independent Test**: spec.md, Historia 3. Sin BLE y con motor a 90 °C, no hay evaluación térmica de carga.

- [X] T019 [US3] En `AgroLinkBackend/src/main/java/org/example/agrolink/telemetry/ble/BleTemperatureTelemetrySyncService.java`, `resolveTemperature` devuelve solo `bleTemperaturaC`, y se corrige el Javadoc (D-08)
- [X] T020 [US3] Actualizar o agregar tests en `AgroLinkBackend/src/test/java/org/example/agrolink/telemetry/ble/BleTemperatureTelemetrySyncServiceTest.java`: sin BLE y con refrigerante → sin `evaluateThermalThresholds`; con BLE → usa BLE

---

## Phase 5: User Story 1 — Alerta de mantenimiento por temperatura de motor (P1) 🎯 MVP

**Goal**: el backend abre, escala y resuelve la alerta `ENGINE_OVERHEAT`, y el front la muestra.

**Independent Test**: spec.md, Historia 1. Con `/estado` devolviendo 107 → 112 → 90, una sola alerta pasa por WARNING → CRITICAL → RESOLVED.

### Modelo y configuración

- [X] T021 [P] [US1] Crear el enum `MaintenanceAlertKind { ENGINE_OVERHEAT }` en `AgroLinkBackend/src/main/java/org/example/agrolink/alert/MaintenanceAlertKind.java` y agregar a `Alert.java` los campos `maintenanceKind` (`@Enumerated STRING`, nullable), `enginePeakTempC`, `engineLastTempC` y `engineLastReadingAt`
- [X] T022 [US1] En `AgroLinkBackend/src/main/java/org/example/agrolink/alert/AlertDto.java`, agregar a `AlertResponse` los campos `maintenanceKind` y `engine` (`EngineOverheatInfo`, con umbrales) sin romper los llamadores existentes de `fromEntity`
- [X] T023 [P] [US1] Agregar en `AgroLinkBackend/src/main/java/org/example/agrolink/alert/AlertRepository.java` la consulta `findFirstByTenant_IdAndTypeAndMaintenanceKindAndAssetTypeAndAssetIdAndStatusIn`
- [X] T024 [P] [US1] Crear `AgroLinkBackend/src/main/java/org/example/agrolink/alert/engine/EngineTemperatureAlertProperties.java` (`@ConfigurationProperties("agrolink.alert.engine-temperature")`, validado en el constructor según D-12) y sumar el bloque al `application.yml` en `AgroLinkBackend/src/main/resources/application.yml`
- [X] T025 [P] [US1] Tests de properties inválidas en `AgroLinkBackend/src/test/java/org/example/agrolink/alert/engine/EngineTemperatureAlertPropertiesTest.java`

### Servicio y notificación

- [X] T026 [US1] En `AgroLinkBackend/src/main/java/org/example/agrolink/alert/SseAlertPublisher.java`, `publishMaintenance(Long tenantId, AlertResponse)` limitado al tenant (con `null` → todos), y actualizar el llamador en `AgroLinkBackend/src/main/java/org/example/agrolink/alert/AlertService.java` (D-11)
- [X] T027 [US1] Crear `AgroLinkBackend/src/main/java/org/example/agrolink/alert/engine/EngineOverheatAlertService.java` con `evaluate(Vehicle, Optional<Trip>, Integer temperatura, LocalDateTime momento)` según la máquina de data-model.md §3. Publica SSE en apertura, escalado y resolución; push en apertura y escalado
- [X] T028 [US1] Tests en `AgroLinkBackend/src/test/java/org/example/agrolink/alert/engine/EngineOverheatAlertServiceTest.java`: WARNING, CRITICAL directo, escalado sin duplicar, pico sin SSE, histéresis, resolución, ACKNOWLEDGED, null, fuera de rango, re-lectura, sin viaje, deshabilitado
- [X] T029 [US1] En `AgroLinkBackend/src/main/java/org/example/agrolink/telemetry/ble/BleTemperatureTelemetrySyncService.java`, invocar `EngineOverheatAlertService` antes del `return` temprano, en su propio try/catch (D-07), y cubrirlo en `BleTemperatureTelemetrySyncServiceTest.java`
- [X] T030 [P] [US1] Títulos y cuerpo de push para `ENGINE_OVERHEAT` en `AgroLinkBackend/src/main/java/org/example/agrolink/notification/push/AlertPushNotifier.java`

### Frontend

- [X] T031 [P] [US1] Agregar a `ThermalAlert` los tipos `maintenanceKind` y `engine` (`EngineOverheatInfo`) en `AgroLink/src/services/thermalAlertService.ts`
- [X] T032 [US1] Crear los helpers `isEngineOverheat`, `ENGINE_OVERHEAT_LABEL`, `engineOverheatSeverityLabel` y `formatEngineTemp` en `AgroLink/src/services/thermalAlertService.ts` (junto a los helpers de conducción existentes), con tests en `AgroLink/tests/unit/services/engineOverheatAlert.unit.test.ts`
- [X] T033 [US1] Renderizar las filas `ENGINE_OVERHEAT` en `AgroLink/src/components/alertas/ThermalAlertTable.tsx`: rótulo "Sobretemperatura de motor", patente y viaje, pico, severidad propia y hora de resolución
- [X] T034 [US1] Hacer que el buscador de Mantenimiento filtre también por `engine.vehiclePlate`. Se resolvió en `extractAssetRef` (`AgroLink/src/services/thermalAlertService.ts`), que `AgroLink/src/app/admin/alertas/page.tsx` ya usa para filtrar, así que `page.tsx` no cambia

**Checkpoint**: quickstart.md §4 y §5 de punta a punta.

---

## Phase 6: Polish

- [X] T035 Correr `npm test` en `AgroLinkIngestaAdaptacion/simulador-viajes`, `mvn test` (clases afectadas) en `AgroLinkBackend`, y `npm run test:unit` más `npx tsc --noEmit` en `AgroLink`
- [X] T036 [P] Documentar las variables `AGROLINK_ALERT_ENGINE_TEMP_*` (comentarios en `AgroLinkBackend/src/main/resources/application.yml`)
- [ ] T037 (pendiente, humano) Revisar en el DER aprobado si `Alerta` detalla atributos y, si es así, dejar anotada su actualización (plan.md, Constitution Check ⚠️). Lo hace una persona: no se modifica el entregable desde código

---

## Phase 7: User Story 4 — Combustible que baja y se recarga (P2, ampliación)

**Goal**: el nivel de combustible de las tramas baja con la distancia y vuelve a 100 % debajo del 7 %.

**Independent Test**: spec.md, Historia 4.

- [X] T038 [US4] En `simulador-viajes/src/domain/sintesisCan.js`, `sintetizarCombustiblePct` y `nivelCombustibleInicial` (recarga a 100 %, nivel inicial al azar, sin piso de 5 %), D-15
- [X] T039 [P] [US4] `loadCombustibleConfig` en `simulador-viajes/src/config.js` (`COMBUSTIBLE_PCT_POR_KM`, `COMBUSTIBLE_RECARGA_DEBAJO_PCT`) con tests en `simulador-viajes/test/config/motor.test.js`
- [X] T040 [US4] Pasar la configuración y loguear la recarga en `simulador-viajes/src/index.js`
- [X] T041 [P] [US4] Tests de recarga, umbral, nivel inicial, ritmo y viaje largo en `simulador-viajes/test/domain/sintesisCan.test.js`
- [X] T042 [P] [US4] Variables en `deploy/.env.example` y `deploy/compose.yaml`, sección en `simulador-viajes/README.md`
- [X] T043 [US4] Consumo como suma de bajadas en `src/main/java/ar/utn/agrolink/ingesta/report/ReporteViajeService.java`, tests en `ReporteViajeServiceTest.java` y nota en `specs/001-ingesta-adaptacion-telemetria/data-model.md`

---

## Dependencies & Execution Order

- Setup (T001–T004) → Foundational (T005–T006) → US2 (T007–T018).
- US3 (T019–T020) no depende del simulador, pero **debe** mergearse junto con o antes que US2: sin
  ella, el simulador genera alertas térmicas de carga falsas.
- US1: backend (T021–T030) independiente del simulador (se prueba mockeando `/estado`). El front
  (T031–T034) depende de T022 (forma del DTO).
- Dentro de US1: T021 → T022/T023 → T027 → T028/T029. T026 va antes de T027.

## Parallel Examples

- US2: T007, T008, T009, T010, T011 y T012 en paralelo (archivos distintos). Después, T013–T017 en secuencia.
- US1: T021, T023, T024, T025, T030 y T031 en paralelo.

## Implementation Strategy

MVP = US1 + US2 + US3 juntas (las tres P1). US1 sola no se puede demostrar sin datos simulados, y
US2 sola rompe la demo de frío sin US3. Orden sugerido: US3 (chico, quita el riesgo) → US2 → US1
backend → US1 front → Polish.
