# Tasks: Proveedor Samsara por webhook — exceso de velocidad severo

**Input**: Design documents from `specs/015-samsara-webhook-exceso-velocidad/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Incluidos. El Principio VIII de la constitución exige tests unitarios de toda lógica de
adaptación y parseo de datos externos (completo / faltante / inválido).

**Repos**: las rutas son relativas a `ProyectoFinal/`:
- `AgroLinkIngestaAdaptacion/` (`agrolink-ingesta` + `simulador-viajes`), abreviado **ING/** y
  **SIM/** (= `AgroLinkIngestaAdaptacion/simulador-viajes/`);
- `AgroLinkBackend/`, abreviado **BE/** (= `AgroLinkBackend/src/main/java/org/example/agrolink/`)
  y **BET/** (= `AgroLinkBackend/src/test/java/org/example/agrolink/`);
- `AgroLink/`, abreviado **FE/** (= `AgroLink/src/`).

Rama en los tres repos: `feature/samsara-webhook-exceso-velocidad`.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Crear la migración `AgroLinkIngestaAdaptacion/deploy/migrations/009_add_evento_samsara.sql`: hypertable `telemetria.evento_samsara` con las columnas, índices y grants de data-model.md §1 (sin UPDATE/DELETE para ningún rol)
- [X] T002 [P] Agregar las variables `SAMSARA_*` (data-model.md §2) a `AgroLinkIngestaAdaptacion/deploy/.env.example` y al servicio `simulador-viajes` de `AgroLinkIngestaAdaptacion/deploy/compose.yaml`

---

## Phase 2: Foundational (bloquea las historias)

- [X] T003 [P] Crear la lista cerrada `VehiculosSamsaraSimulados` (`281474977000101`, `281474977000102`) en ING/src/main/java/ar/utn/agrolink/ingesta/viajeprogramado/VehiculosSamsaraSimulados.java
- [X] T004 [P] Crear la lista cerrada de vehículos Samsara (id, patente, nombre, VIN) en SIM/src/samsara/vehiculosSamsara.js
- [X] T005 [P] Agregar `SAMSARA_DEVICE_IDS` e `isSamsaraSimulated` a BE/trip/simulacion/SimulatedDeviceRegistry.java
- [X] T006 [P] Tests de disjunción de listas Samsara/Rinho en ING/src/test/java/ar/utn/agrolink/ingesta/viajeprogramado/VehiculosSamsaraSimuladosTest.java, SIM/test/samsara/vehiculosSamsara.test.js y BET/trip/simulacion/SimulatedDeviceRegistryTest.java
- [X] T007 Sembrar en BE/common/bootstrap/LocalDataSeeder.java el proveedor `SAMSARA` como `ACTIVE` y los vehículos `AGL007`/`AGL008` (proveedor `SAMSARA`, `iotDeviceId` = ids de T005) en el tenant demo

**Checkpoint**: identidades y listas listas en los tres componentes.

---

## Phase 3: User Story 1 — El operador ve los excesos reportados por Samsara (P1) 🎯 MVP

**Goal**: un webhook manual a ingesta termina como alerta abierta y luego cerrada en el frontend.

**Independent Test**: quickstart.md Escenario 1 (curl Started → alerta activa, Ended → resuelta).

### Ingesta: recepción y consulta

- [X] T008 [P] [US1] Test de `ExtractorEventoSamsara` (completo / campos faltantes / fechas inválidas / no JSON) en ING/src/test/java/ar/utn/agrolink/ingesta/samsara/ExtractorEventoSamsaraTest.java
- [X] T009 [P] [US1] Implementar `ExtractorEventoSamsara` (JSON → campos de consulta, data-model §1) en ING/src/main/java/ar/utn/agrolink/ingesta/samsara/ExtractorEventoSamsara.java
- [X] T010 [US1] Implementar la entidad `EventoSamsara` (@Immutable) y `EventoSamsaraRepository` (insert nativo `ON CONFLICT DO NOTHING RETURNING id`, consulta por cursor con margen de 2 s) en ING/src/main/java/ar/utn/agrolink/ingesta/samsara/
- [X] T011 [US1] Implementar `SamsaraEventoService` y los DTO de respuesta en ING/src/main/java/ar/utn/agrolink/ingesta/samsara/SamsaraEventoService.java y EventoSamsaraDto.java
- [X] T012 [US1] Implementar `SamsaraWebhookController` (`POST /api/v1/proveedores/samsara/webhook`, `GET /api/v1/proveedores/samsara/eventos`) según contracts/samsara-webhook-http.md y contracts/samsara-eventos-consulta-http.md en ING/src/main/java/ar/utn/agrolink/ingesta/samsara/SamsaraWebhookController.java
- [X] T013 [US1] Permitir el prefijo `/api/v1/proveedores/samsara/` por el puerto publicado en ING/src/main/java/ar/utn/agrolink/ingesta/config/PuertoAccesoFilter.java
- [X] T014 [P] [US1] Test web del controlador (guardado, duplicado, JSON inválido, validación de `despuesDe`/`limite`) en ING/src/test/java/ar/utn/agrolink/ingesta/samsara/SamsaraWebhookControllerTest.java

### Backend: consumo, adaptación, episodios y alertas

- [X] T015 [P] [US1] Crear el record `DrivingEvent` en BE/drivingevent/DrivingEvent.java
- [X] T016 [P] [US1] Test de `SamsaraSpeedingEventAdapter` (Started y Ended completos, faltantes, inválidos, tipo no soportado) en BET/telemetry/samsara/SamsaraSpeedingEventAdapterTest.java
- [X] T017 [US1] Implementar `SamsaraSpeedingEventAdapter` y el DTO `EventoSamsaraResponse` en BE/telemetry/samsara/
- [X] T018 [US1] Eliminar BE/telemetry/adapter/SamsaraTelemetryAdapter.java y sus referencias o tests (research D-15)
- [X] T019 [US1] Implementar `IngestaSamsaraEventosClient` (RestClient con los timeouts del contrato) en BE/telemetry/samsara/IngestaSamsaraEventosClient.java
- [X] T020 [US1] Crear la entidad `ProviderEventCursor` y su repositorio en BE/telemetry/samsara/
- [X] T021 [US1] Crear la entidad `SpeedingEpisode` y `SpeedingEpisodeRepository` (único `(vehicle_id, start_time)`, event ids únicos) en BE/drivingevent/
- [X] T022 [US1] Extender `Alert` (+`SPEEDING`, +`speedingEpisode`) y `AlertDto.AlertResponse` (+`speeding`) en BE/alert/Alert.java y BE/alert/AlertDto.java
- [X] T023 [US1] Crear `AlertTypeCheckSchemaFix`, que recrea `alerts_type_check` con todos los valores del enum si no admite `SPEEDING`, en BE/common/bootstrap/AlertTypeCheckSchemaFix.java
- [X] T024 [US1] Agregar `openSpeedingAlert`, `closeSpeedingAlert`, `getDrivingAlerts(tenantId)` a BE/alert/AlertService.java; `publishDriving` a BE/alert/SseAlertPublisher.java; el caso SPEEDING a BE/notification/push/AlertPushNotifier.java; y `GET /api/v1/alerts/driving` a BE/alert/AlertController.java
- [X] T025 [US1] Implementar `SpeedingEpisodeService.apply` (reglas 1–5 de data-model §3.2) en BE/drivingevent/SpeedingEpisodeService.java
- [X] T026 [US1] Implementar `SamsaraEventosSyncService` (páginas hasta vaciar, una transacción por evento con avance de cursor, solo si SAMSARA está ACTIVE) y `SamsaraEventosSyncScheduler` (`fixedDelay` configurable y desactivable) en BE/telemetry/samsara/
- [X] T027 [US1] Agregar `agrolink.telemetry.samsara.*` a AgroLinkBackend/src/main/resources/application.yml y desactivar el scheduler en la configuración de tests
- [X] T028 [P] [US1] Test de `SpeedingEpisodeService` (orden normal, cierre, vehículo por patente de respaldo, vehículo desconocido, proveedor distinto) en BET/drivingevent/SpeedingEpisodeServiceTest.java

### Frontend: alertas de conducción

- [X] T029 [P] [US1] Agregar `'SPEEDING'`, `SpeedingInfo` y `getDrivingAlerts` en FE/services/thermalAlertService.ts
- [X] T030 [US1] Crear el hook `useDrivingAlerts` (carga inicial + SSE `driving-alert`), siguiendo FE/hooks/useThermalAlerts.ts, en FE/hooks/useDrivingAlerts.ts
- [X] T031 [US1] Soportar `category='SPEEDING'` (patente, proveedor, inicio, fin/duración o "En curso") en FE/components/alertas/ThermalAlertTable.tsx
- [X] T032 [US1] Agregar la pestaña "Conducción" y la tarjeta KPI en FE/app/admin/alertas/page.tsx, sin cambiar el cálculo de las tarjetas existentes

**Checkpoint**: US1 se puede demostrar con curl (quickstart §1).

---

## Phase 4: User Story 2 — Simulación de excesos por umbral (P1)

**Goal**: el emisor manda Started/Ended solo por cruce de umbral, durante viajes Samsara.

**Independent Test**: quickstart.md Escenario 3.

### Emisor (simulador-viajes)

- [X] T033 [P] [US2] Implementar el bloque `samsara` validado (data-model §2) en SIM/src/config.js, con su test en SIM/test/samsara/config.test.js
- [X] T034 [P] [US2] Implementar `modeloVelocidad` (OU + ráfagas Poisson, rng inyectable, research D-07) en SIM/src/samsara/modeloVelocidad.js
- [X] T035 [P] [US2] Implementar `detectorExceso` (histéresis de 20 s, fin forzado, research D-08) en SIM/src/samsara/detectorExceso.js
- [X] T036 [P] [US2] Implementar `payloadSamsara` (sobre del contrato samsara-webhook-http.md) en SIM/src/samsara/payloadSamsara.js
- [X] T037 [P] [US2] Implementar `webhookClient` (`fetch` + timeout 3 s, nunca lanza) en SIM/src/samsara/webhookClient.js
- [X] T038 [US2] Implementar `emisorSamsara` (estado por vehículo, ciclo, `iniciarViaje`, `detenerViaje`, logs de envío) en SIM/src/samsara/emisorSamsara.js
- [X] T039 [US2] Agregar `POST /samsara/viajes` y `POST /samsara/viajes/{tripCode}/detencion` (contracts/simulacion-samsara-avisos.md §3) en SIM/src/http/rutaHttpServer.js y arrancar el emisor en SIM/src/index.js
- [X] T040 [P] [US2] Tests: modelo (determinismo, frecuencia en 8 h dentro de 1–4 con λ por defecto, base bajo el umbral), detector (solo cruces, histéresis, fin forzado), payload y emisor (inicio, idempotencia, reemplazo, detención con exceso abierto) en SIM/test/samsara/

### Avisos de viaje (ingesta y backend)

- [X] T041 [US2] Implementar `SimuladorSamsaraClient` en ING/src/main/java/ar/utn/agrolink/ingesta/viajeprogramado/SimuladorSamsaraClient.java
- [X] T042 [US2] Implementar `AvisoViajeSamsaraService` (validación mínima, conversión de hora local a offset, traducción de respuestas) en ING/src/main/java/ar/utn/agrolink/ingesta/viajeprogramado/AvisoViajeSamsaraService.java
- [X] T043 [US2] Despachar a Samsara en `programar` y agregar el mapeo `POST …/{tripCode}/detencion` en ING/src/main/java/ar/utn/agrolink/ingesta/viajeprogramado/ViajeProgramadoController.java
- [X] T044 [P] [US2] Test del despacho Samsara (inicio sin coordenadas, detención, `502` si el simulador no responde, no-Samsara sin cambios) en ING/src/test/java/ar/utn/agrolink/ingesta/viajeprogramado/AvisoViajeSamsaraServiceTest.java
- [X] T045 [US2] Publicar el evento también para Samsara en BE/trip/TripService.java y, en BE/trip/simulacion/SimulatedTripNotificationListener.java, enviar para Samsara un inicio sin ruta (solo `tripCode` + `estimatedStartDateTime`)
- [X] T046 [P] [US2] Test del listener para Samsara (no resuelve ruta, envía inicio mínimo) en BET/trip/simulacion/SimulatedTripNotificationListenerTest.java
- [X] T047 [US2] Aplicar el delta v2.1 (contracts/simulacion-samsara-avisos.md §1) en AgroLinkBackend/specs/026-simulacion-al-iniciar-viaje/contracts/ingesta-simulacion-http.md y en su copia AgroLinkIngestaAdaptacion/specs/014-simulacion-ruta-del-viaje/contracts/ingesta-simulacion-http.md

**Checkpoint**: demo completa (quickstart §3).

---

## Phase 5: User Story 3 — Robustez ante reintentos, desorden y no soportados (P2)

**Goal**: duplicados, fin antes que inicio y tipos desconocidos no generan inconsistencias.

**Independent Test**: quickstart.md Escenario 2.

- [X] T048 [US3] Completar en `SpeedingEpisodeService` el fin antes que el inicio (episodio creado cerrado, sin reapertura), el evento duplicado sin efecto y la inconsistencia id/patente registrada, en BE/drivingevent/SpeedingEpisodeService.java
- [X] T049 [P] [US3] Tests de esos casos y de avance de cursor ante evento rechazado en BET/drivingevent/SpeedingEpisodeServiceTest.java y BET/telemetry/samsara/SamsaraEventosSyncServiceTest.java

---

## Phase 6: Polish

- [X] T050 [P] Documentar el emisor Samsara (variables, demo con λ alto) en AgroLinkIngestaAdaptacion/simulador-viajes/README.md
- [X] T051 Ejecutar las suites: `mvn test` (ingesta), `npm test` (simulador), `mvn test` (backend) y los tests del frontend; corregir regresiones
- [X] T052 Marcar tareas completadas en este archivo

---

## Dependencies & Execution Order

- Setup (T001–T002) → Foundational (T003–T007) → US1 → US2 → US3 → Polish.
- Dentro de US1: ingesta (T008–T014) antes del sync del backend (T019, T026); frontend (T029–T032)
  depende solo del contrato de alertas (T022/T024).
- US2 depende de US1: el emisor envía al webhook de T012 y las alertas de T024 lo hacen visible.
- US3 extiende T025.

## Parallel Opportunities

- T002–T006 en paralelo (archivos y repos distintos).
- En US1: T008/T009, T015/T016 y T029 en paralelo. El bloque frontend es independiente del bloque
  ingesta.
- En US2: T033–T037 en paralelo (módulos puros), mientras se hacen T041–T042 en ingesta.

## Implementation Strategy

MVP = US1 (webhook manual → alerta visible). Después, US2 completa la demo con el emisor. US3
agrega robustez sin cambiar contratos.
