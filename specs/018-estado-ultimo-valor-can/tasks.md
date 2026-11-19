# Tasks: Último valor CAN no nulo en la consulta de estado

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md)

**Nota**: plan retroactivo. Las tareas `[X]` se hicieron entre el 15 y el 17 de noviembre de 2026;
las `[ ]` están pendientes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede hacerse en paralelo (no depende de otra tarea pendiente)
- **[Story]**: historia del spec (US1 y US2)

---

## Phase 1: Foundational (ingesta)

- [X] T001 Crear la proyección `UltimosValoresCan` en `src/main/java/ar/utn/agrolink/ingesta/telemetry/UltimosValoresCan.java`.
- [X] T002 Agregar `findUltimosValoresCanNoNulos` con la consulta `public.last() FILTER` en `src/main/java/ar/utn/agrolink/ingesta/telemetry/LecturaTelemetriaRepository.java` (research.md D-01 y D-02).

## Phase 2: US1 + US2 - Último valor no nulo con su momento (P1) 🎯 MVP

- [X] T003 [US1] [US2] Agregar los seis campos `*Momento` a `src/main/java/ar/utn/agrolink/ingesta/estado/CanBusDto.java`.
- [X] T004 [US1] [US2] En `src/main/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoService.java`, consultar la ventana de 24 h anclada a la última lectura y mapear los campos arrastrables desde la proyección (research.md D-03).
- [X] T005 [P] [US1] [US2] Tests unitarios en `src/test/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoServiceTest.java`: arrastre con su momento, campos no arrastrables en `null` y ventana sin valores.
- [X] T006 [US1] [US2] Test de integración contra TimescaleDB real en `src/test/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoServiceIntegrationTest.java`: tipos de la proyección, alias, ventana de 24 h y lectura fuera de la ventana. Resultado: 105 tests, 0 fallos y 0 salteados.

## Phase 3: Adaptación de AgroLinkBackend (FR-008, FR-009)

- [X] T007 Agregar `odometroMomento`, `temperaturaRefrigeranteCMomento` y `esDeLaUltimaLectura` a `VehiculoEstadoResponse`, con un constructor compatible de 5 argumentos (research.md D-07).
- [X] T008 En `BleTemperatureTelemetrySyncService.evaluateEngineTemperature`, no evaluar `ENGINE_OVERHEAT` con una temperatura arrastrada (FR-008).
- [X] T009 En `IngestaVehiculoEstadoClient.fetchEstado`, tratar un odómetro arrastrado como "sin odómetro en este ciclo" (FR-009).
- [X] T010 [P] Tests en `BleTemperatureTelemetrySyncServiceTest` y en `IngestaVehiculoEstadoClientTest`. Resultado: 1070 tests unitarios del backend, 0 fallos.
- [X] T011 [P] Enmiendas en las specs `012-odometer-telemetry-sync` y `016-ble-temperature-alerts` del backend, y en la spec `016-alerta-temperatura-motor` de este repo.
- [ ] T012 Correr los tests de integración del backend (`mvn verify`, `*IT` de failsafe), en especial `BleTemperatureTelemetrySyncSchedulerIT` y `OdometerTelemetrySyncSchedulerIT`.

## Phase 4: Polish

- [X] T013 Documentación: esta spec y el contrato v7.0.0 (`contracts/agrolink-vehiculo-estado-api.yaml`).
- [ ] T014 Desplegar el backend antes o junto con la ingesta (plan.md, Despliegue).
- [ ] T015 Verificar en producción: con el Rinho real, consultar `/estado` justo después de una trama sin CAN y comprobar que `combustiblePct` no viene en `null` y que `combustiblePctMomento` es anterior a `dispositivo.momentoEvento`.

## Dependencies

- T002 depende de T001. T004 depende de T002 y de T003. T005 y T006 dependen de T004.
- La fase 3 depende solo del contrato (T003). T014 depende de T006 y de T010.
