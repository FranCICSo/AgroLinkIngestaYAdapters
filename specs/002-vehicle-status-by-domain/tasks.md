# Tasks: Consulta de Estado de Vehículo por Identificador de Dispositivo IoT

**Input**: Design documents from `/specs/002-vehicle-status-by-domain/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/agrolink-vehiculo-estado-api.yaml](./contracts/agrolink-vehiculo-estado-api.yaml), [quickstart.md](./quickstart.md)

**Tests**: Incluidos — el plan (Technical Context > Testing) fija JUnit 5 + AssertJ con el
mismo estándar de tres casos que usa la feature 001 (completa / parcial / sin datos), más un
test de integración para la separación de puertos (research.md D-01).

**Organization**: Una sola user story (US1, P1) — es la única capacidad de la spec.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede ejecutarse en paralelo (archivos distintos, sin dependencia de una tarea incompleta)
- **[Story]**: US1 para todas las tareas de la fase 3 (única historia de la spec)

## Path Conventions

Proyecto único, servicio Spring Boot existente: `src/main/java/ar/utn/agrolink/ingesta/`,
`src/test/java/ar/utn/agrolink/ingesta/`, `deploy/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Declarar la variable de entorno y el placeholder de configuración del puerto
nuevo, sin los cuales ninguna tarea posterior puede compilar ni levantarse.

- [X] T001 Agregar `VEHICULO_ESTADO_HTTP_PORT` a `deploy/.env.example`, con comentario que
      explique su propósito (puerto propio de la nueva API, distinto de `REPORTES_HTTP_PORT`
      y no publicado hoy) — ver research.md D-01.
- [X] T002 [P] Agregar la propiedad `vehiculo-estado.http-port: ${VEHICULO_ESTADO_HTTP_PORT}`
      a `src/main/resources/application.yaml`, junto al `server.port` existente.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Ampliar el modelo de datos existente y montar la separación de puertos —
ninguna parte de la User Story 1 puede implementarse sin esto.

**⚠️ CRITICAL**: Ninguna tarea de la Fase 3 puede empezar hasta cerrar esta fase.

- [X] T003 Ampliar `LecturaTelemetria` en
      `src/main/java/ar/utn/agrolink/ingesta/telemetry/LecturaTelemetria.java` para mapear
      `latitud`, `longitud`, `rumbo_grados`, `ignicion`, `tension_bateria_v`, `satelites`,
      `momento_recepcion`, `estado_interpretacion` (reusar el enum `EstadoInterpretacion`),
      `campos_faltantes` (`TEXT[]` → `List<String>`) y `datos_can` (`JSONB` → tipo crudo,
      p. ej. `String` o `Map<String,Object>` según el conversor elegido). Actualizar el
      Javadoc de la clase: ya no es una proyección mínima para el reporte de viaje, sino la
      proyección completa que usan ambos consumidores (data-model.md D-02). NO tocar
      `payload_crudo` ni `frame_hash` (siguen sin consumidor).
- [X] T004 Agregar el método
      `Optional<LecturaTelemetria> findFirstByDispositivoIdOrderByMomentoEventoDesc(String dispositivoId)`
      a `src/main/java/ar/utn/agrolink/ingesta/telemetry/LecturaTelemetriaRepository.java`
      (depende de T003; reutiliza el índice `lectura_camion_tiempo_idx` de la feature 001,
      sin migraciones nuevas).
- [X] T005 [P] Implementar `VehiculoEstadoConectorConfig` en
      `src/main/java/ar/utn/agrolink/ingesta/config/VehiculoEstadoConectorConfig.java`: un
      `WebServerFactoryCustomizer<TomcatServletWebServerFactory>` que agrega un conector
      Tomcat adicional en `${vehiculo-estado.http-port}`, sin tocar el conector por defecto
      (`server.port`) (research.md D-01). Depende de T002 (propiedad ya declarada).
- [X] T006 [P] Implementar `PuertoAccesoFilter` en
      `src/main/java/ar/utn/agrolink/ingesta/config/PuertoAccesoFilter.java`: un
      `OncePerRequestFilter` que, cuando `request.getLocalPort()` coincide con
      `vehiculo-estado.http-port`, solo deja pasar rutas bajo `/api/v1/vehiculos/**` y
      responde `404` para cualquier otra (incluido `/api/v1/reportes/viaje` y `/health`);
      cuando la petición entra por el puerto original, no aplica ninguna restricción nueva
      (research.md D-01). Depende de T002.

**Checkpoint**: Modelo de datos ampliado y separación de puertos lista — la User Story 1 ya
puede implementarse.

---

## Phase 3: User Story 1 - Consultar el estado actual de un vehículo por identificador de dispositivo (Priority: P1) 🎯 MVP

**Goal**: `GET /api/v1/vehiculos/{dispositivoId}/estado`, alcanzable desde el puerto externo
dedicado, devuelve el estado (posición, CAN bus, dispositivo) de la lectura más reciente de
ese identificador, o un `404`/`400` explícito cuando corresponde.

**Independent Test**: Levantar el stack, invocar la consulta contra `VEHICULO_ESTADO_HTTP_PORT`
para un `dispositivoId` con lecturas, y verificar que el payload coincide con la fila de
`momento_evento` más reciente en base — según `quickstart.md` §2-3.

### Tests for User Story 1 ⚠️

> Escribir estos tests primero; deben fallar antes de la implementación.

- [X] T007 [P] [US1] Test `EstadoVehiculoServiceTest` en
      `src/test/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoServiceTest.java` con los
      tres casos obligatorios: lectura completa (todos los bloques poblados), lectura
      parcial (sin fix GPS → `posicion` en null, `estadoInterpretacion = PARCIAL`), y sin
      ninguna lectura (→ `VehiculoSinTelemetriaException`). Incluir también un caso con dos
      lecturas fuera de orden de llegada, verificando que se devuelve la de `momento_evento`
      mayor (FR-006).
- [X] T008 [P] [US1] Test de integración `PuertoAccesoFilterTest` en
      `src/test/java/ar/utn/agrolink/ingesta/estado/PuertoAccesoFilterTest.java`: levantando
      el contexto Spring Boot completo con ambos conectores, verificar que una petición a
      `/api/v1/reportes/viaje` por `vehiculo-estado.http-port` responde `404`, y que
      `/api/v1/vehiculos/{id}/estado` responde por ese mismo puerto (depende de T005, T006).

### Implementation for User Story 1

- [X] T009 [P] [US1] Crear `PosicionDto` (record: `latitud`, `longitud`, `velocidadKmh`,
      `rumboGrados`, todos nullable) en
      `src/main/java/ar/utn/agrolink/ingesta/estado/PosicionDto.java`.
- [X] T010 [P] [US1] Crear `CanBusDto` (record: `odometroM`, `odometroOrigen`,
      `combustiblePct`, `datosCanCrudos`, todos nullable) en
      `src/main/java/ar/utn/agrolink/ingesta/estado/CanBusDto.java`.
- [X] T011 [P] [US1] Crear `DispositivoInfoDto` (record: `dispositivoId`, `momentoEvento`,
      `momentoRecepcion`, `ignicion`, `tensionBateriaV`, `satelites`,
      `estadoInterpretacion`, `camposFaltantes`) en
      `src/main/java/ar/utn/agrolink/ingesta/estado/DispositivoInfoDto.java`.
- [X] T012 [US1] Crear `EstadoVehiculoDto` (record: `posicion`, `canBus`, `dispositivo`) en
      `src/main/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoDto.java` (depende de
      T009-T011).
- [X] T013 [P] [US1] Crear `VehiculoSinTelemetriaException` en
      `src/main/java/ar/utn/agrolink/ingesta/estado/VehiculoSinTelemetriaException.java`,
      con `dispositivoId` y mensaje, siguiendo el mismo patrón que `SinDatosException`
      (feature 001).
- [X] T014 [US1] Implementar `EstadoVehiculoService` en
      `src/main/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoService.java`: valida que
      `dispositivoId` no esté vacío/en blanco (si lo está, delega en el controller vía
      excepción de argumento inválido — ver T015), busca con
      `findFirstByDispositivoIdOrderByMomentoEventoDesc`, lanza
      `VehiculoSinTelemetriaException` si no hay resultado, y mapea la fila a
      `EstadoVehiculoDto` agrupando en los tres bloques (data-model.md). Depende de T004,
      T012, T013.
- [X] T015 [US1] Implementar `EstadoVehiculoController` en
      `src/main/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoController.java`:
      `GET /api/v1/vehiculos/{dispositivoId}/estado`; responde `400` (mismo formato
      `application/problem+json` que ya usa `ReporteViajeController`) si `dispositivoId` está
      vacío o en blanco (FR-009); delega el resto en `EstadoVehiculoService`. Depende de
      T014.
- [X] T016 [US1] Agregar el `@ExceptionHandler(VehiculoSinTelemetriaException.class)` en
      `EstadoVehiculoController.java` que traduce a `404 application/problem+json` con
      `dispositivoId` como propiedad extra, siguiendo el mismo patrón que
      `ReporteViajeController.handleSinDatos` (feature 001). Depende de T015.
- [X] T017 [US1] Publicar el puerto nuevo en `deploy/compose.yaml`: agregar
      `VEHICULO_ESTADO_HTTP_PORT` a `environment` del servicio `agrolink-ingesta` y un bloque
      `ports: - "${VEHICULO_ESTADO_HTTP_PORT}:${VEHICULO_ESTADO_HTTP_PORT}"`, dejando
      `REPORTES_HTTP_PORT` sin publicar (sin cambios ahí). Depende de T005 (el conector debe
      existir para que publicar el puerto tenga efecto).
- [X] T018 [P] [US1] Documentar en `deploy/README.md` la regla de firewall/Security List
      nueva (ingress TCP al `VEHICULO_ESTADO_HTTP_PORT`), siguiendo el mismo formato que la
      regla UDP del receptor documentada para la feature 001.
- [X] T019 [US1] Ejecutar `quickstart.md` completo (§1-§4) contra el stack levantado con
      `docker compose up -d` y confirmar los cuatro criterios (✅ SC-004 sin regresión, ✅
      US1/SC-001/SC-002, ✅ SC-003, tests unitarios en verde). Depende de T007-T018.

**Checkpoint**: User Story 1 (única historia de la spec) completa y validable de punta a
punta de forma independiente.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias, arranca de inmediato.
- **Foundational (Phase 2)**: depende de Setup — bloquea toda la Fase 3.
- **User Story 1 (Phase 3)**: depende de Foundational completo.

### Dentro de la User Story 1

- Tests (T007, T008) deben escribirse y fallar antes de implementar.
- DTOs (T009-T011) antes de `EstadoVehiculoDto` (T012).
- DTOs + excepción (T012, T013) antes del servicio (T014).
- Servicio antes del controller (T015) y su exception handler (T016).
- Controller funcionando antes de publicar el puerto en compose (T017).
- Todo lo anterior antes de la validación end-to-end (T019).

### Parallel Opportunities

- T001 y T002 en paralelo (Setup).
- T005 y T006 en paralelo, una vez cerrado T002 (Foundational).
- T007 y T008 en paralelo (tests de US1, archivos distintos).
- T009, T010, T011, T013 en paralelo (DTOs y excepción son archivos independientes).
- T018 puede correr en paralelo con T017 (documentación vs. compose).

---

## Parallel Example: Foundational

```bash
Task: "Implementar VehiculoEstadoConectorConfig en src/main/java/ar/utn/agrolink/ingesta/config/VehiculoEstadoConectorConfig.java"
Task: "Implementar PuertoAccesoFilter en src/main/java/ar/utn/agrolink/ingesta/config/PuertoAccesoFilter.java"
```

## Parallel Example: User Story 1 (DTOs)

```bash
Task: "Crear PosicionDto en src/main/java/ar/utn/agrolink/ingesta/estado/PosicionDto.java"
Task: "Crear CanBusDto en src/main/java/ar/utn/agrolink/ingesta/estado/CanBusDto.java"
Task: "Crear DispositivoInfoDto en src/main/java/ar/utn/agrolink/ingesta/estado/DispositivoInfoDto.java"
Task: "Crear VehiculoSinTelemetriaException en src/main/java/ar/utn/agrolink/ingesta/estado/VehiculoSinTelemetriaException.java"
```

---

## Implementation Strategy

### MVP First (única historia)

1. Completar Fase 1: Setup.
2. Completar Fase 2: Foundational (crítico — bloquea todo).
3. Completar Fase 3: User Story 1.
4. **STOP y VALIDAR**: correr `quickstart.md` de punta a punta (T019).
5. Esto **es** el alcance completo de la feature — no hay historias P2/P3 pendientes.

### Notes

- No hay `[P]` entre T003 y T004: mismo archivo/paquete lógico, la segunda depende de la
  primera.
- Commitear después de cada tarea o grupo lógico (Setup, Foundational, Tests US1,
  DTOs+excepción, Service+Controller, Deploy+docs).
- Verificar que T007/T008 fallan antes de implementar T009-T016.
