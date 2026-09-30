---

description: "Task list for feature 010-estado-temperatura-ble"
---

# Tasks: Temperatura del sensor BLE en la consulta de estado

**Input**: Design documents from `/specs/010-estado-temperatura-ble/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/agrolink-vehiculo-estado-api.yaml, quickstart.md

**Tests**: Incluidos. El Principio VIII de la constitución exige tests para esta capa;
research.md D-05 acota su alcance a dos casos (valor presente / ausente), porque el
parseo de texto ya ocurrió en `rinho-receptor` (feature 008).

**Organization**: Una sola historia de usuario (spec.md, US1, P1) — es la funcionalidad
completa. No hay fases Setup ni Foundational: no hay dependencias nuevas, ni esquema
nuevo (la columna ya existe desde la feature 008), ni infraestructura compartida que
preceda a US1.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede ejecutarse en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: US1 (única historia de esta feature)

## Path Conventions

Ampliación de un componente existente (sin proyecto nuevo, ver plan.md):
- Servicio de lectura (Java/Spring Boot): `src/main/java/ar/utn/agrolink/ingesta/`, `src/test/java/ar/utn/agrolink/ingesta/`
- Tests: `mvn test` (no se versiona `mvnw`; requiere Maven local)

---

## Phase 1: User Story 1 - Ver la temperatura de la carga junto con el resto del estado del vehículo (Priority: P1) 🎯 MVP

**Goal**: `GET /api/v1/vehiculos/{dispositivoId}/estado` incluye `canBus.bleTemperaturaC`
con el valor de la columna `ble_temperatura_c` de la lectura más reciente, `null` cuando
no hay valor, sin afectar ningún otro campo de la respuesta.

**Independent Test**: quickstart.md §2 (valor presente) y §3 (ausente): consultar el
estado de un vehículo y verificar `canBus.bleTemperaturaC`.

### Tests for User Story 1

- [X] T001 [P] [US1] En `src/test/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoServiceTest.java`, agregar el parámetro `Double bleTemperaturaC` al método privado `lectura(...)` (después de `tensionBateriaV`, antes de `satelites`, mismo orden que los campos del constructor de la entidad) y `set(l, "bleTemperaturaC", bleTemperaturaC);` en su cuerpo. Actualizar las 5 llamadas existentes a `lectura(...)` para pasar el nuevo argumento: `lecturaCompleta` y los 3 casos inline con `4.2`; `lecturaParcialSinFixGps` con `null`.
- [X] T002 [US1] En el mismo archivo, en el test `lecturaCompleta_devuelveLosTresBloquesPoblados`, agregar `assertThat(dto.canBus().bleTemperaturaC()).isEqualTo(4.2);`.
- [X] T003 [US1] En el mismo archivo, en el test `lecturaParcialSinFixGps_posicionEnNullPeroLecturaSeDevuelve`, agregar `assertThat(dto.canBus().bleTemperaturaC()).isNull();`.

### Implementation for User Story 1

- [X] T004 [P] [US1] En `src/main/java/ar/utn/agrolink/ingesta/telemetry/LecturaTelemetria.java`, agregar el campo `@Column(name = "ble_temperatura_c") private Double bleTemperaturaC;` (después de `tensionBateriaV`, antes de `satelites`, agrupado con los demás campos de sensor/CAN) y su getter `public Double getBleTemperaturaC() { return bleTemperaturaC; }` (junto a `getTensionBateriaV()`). Sin setter (la entidad es `@Immutable`, Principio IV). Actualizar el comentario de cabecera de la clase si sigue enumerando los campos por feature.
- [X] T005 [P] [US1] En `src/main/java/ar/utn/agrolink/ingesta/estado/CanBusDto.java`, agregar `Double bleTemperaturaC` como último componente del record (después de `tensionBateriaV`) y una línea al Javadoc de la clase describiendo el campo: temperatura de un sensor BLE de carga (feature 008 ingesta, feature 010 exposición), `null` si no fue reportada.
- [X] T006 [US1] En `src/main/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoService.java`, en `mapearCanBus`, agregar `lectura.getBleTemperaturaC()` como último argumento del constructor de `CanBusDto` (depende de T004 y T005).
- [X] T007 [US1] Correr `mvn test` y confirmar que pasan `EstadoVehiculoServiceTest` (T001-T003) y el resto de la suite sin regresiones (ningún test preexistente distinto de los tocados en T001-T003 cambia).

**Checkpoint**: `mvn test` pasa completo. Con el stack levantado, quickstart.md §2-§5 pasan.

---

## Phase 2: Polish & Cross-Cutting Concerns

- [X] T008 [P] En `README.md` (raíz), en la fila de la tabla "APIs expuestas" del endpoint de estado, agregar "y temperatura de un sensor BLE de carga" a la descripción del bloque CAN bus.
- [X] T009 Si hay Docker disponible y el stack de `deploy/compose.yaml` está levantado con la migración `003_add_ble_sensor_fields.sql` (feature 008) ya aplicada, ejecutar quickstart.md §2-§5 de punta a punta y anotar el resultado. Si no, dejar constancia de que la validación end-to-end quedó pendiente, sin marcarla como hecha.

---

## Dependencies & Execution Order

- T001 → T002, T003 (misma firma del helper `lectura`, deben aplicarse en orden dentro del mismo archivo).
- T004, T005 en paralelo (archivos distintos); ambos deben estar antes de T006.
- T006 depende de T004 y T005.
- T007 depende de T001-T006 (corre toda la suite, incluidos los tests ampliados).
- T008 es independiente de todo lo anterior.
- T009 depende de T004-T007 (necesita el código funcionando) y de la migración 003 de la feature 008 ya aplicada en el stack.

## Parallel Example: User Story 1

```bash
# En paralelo, archivos distintos:
Task: "T004 Agregar bleTemperaturaC a LecturaTelemetria.java"
Task: "T005 Agregar bleTemperaturaC a CanBusDto.java"
```

## Implementation Strategy

### MVP (única historia)

1. T001-T003 (tests) antes o junto con T004-T006 (implementación) — TDD si se prefiere,
   ya que son cambios pequeños y acoplados.
2. T004 y T005 en paralelo, luego T006.
3. T007 valida la suite completa.
4. Desplegar: no requiere migración nueva (la columna ya existe desde la feature 008); un
   simple rebuild/redeploy de `agrolink-ingesta` alcanza.

No hay incrementos adicionales: la spec tiene una sola historia de usuario.
