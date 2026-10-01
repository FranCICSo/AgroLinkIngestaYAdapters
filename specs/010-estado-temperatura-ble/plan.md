# Implementation Plan: Temperatura del sensor BLE en la consulta de estado

**Branch**: `010-estado-temperatura-ble` | **Date**: 2026-09-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-estado-temperatura-ble/spec.md`

## Summary

La feature 008 dejó `ble_temperatura_c` persistida en `telemetria.lectura_telemetria` pero
invisible para `GET /api/v1/vehiculos/{dispositivoId}/estado` (esa spec, FR-012: alcance
limitado a ingesta). Esta feature agrega un solo campo nuevo, `canBus.bleTemperaturaC`, al
servicio Java `agrolink-ingesta`: la entidad JPA `LecturaTelemetria` gana el campo mapeado
a la columna ya existente, y `EstadoVehiculoService` lo pasa directo a `CanBusDto`, sin
resolución adicional (research.md D-02). Humedad y batería del sensor quedan fuera (spec,
Assumptions). Es un cambio aditivo al contrato HTTP (v6.0.0): sin ruptura, sin reubicar
ningún campo existente.

## Technical Context

**Language/Version**: Java 21 (Spring Boot 3.3.4), `agrolink-ingesta`. `rinho-receptor`
(Node.js) no se toca: la columna y su llenado ya existen desde la feature 008.

**Primary Dependencies**: Sin dependencias nuevas — `spring-boot-starter-data-jpa`,
`org.postgresql:postgresql`, ya presentes.

**Storage**: Misma tabla `telemetria.lectura_telemetria`, sin cambio de esquema: la
columna `ble_temperatura_c` (`NUMERIC` nullable) ya existe desde la migración `003`
(feature 008).

**Testing**: JUnit 5 + Mockito + AssertJ (mismo patrón que `EstadoVehiculoServiceTest`,
fixtures de `LecturaTelemetria` construidas por reflexión). Principio VIII: dos casos
(valor presente, valor ausente) — no aplica un tercer caso de "valor inválido" a este
servicio (research.md D-05): el parseo de texto ya ocurrió en `rinho-receptor`.

**Target Platform**: Sin cambios — VM OCI Ampere A1, Docker Compose.

**Project Type**: Ampliación de un servicio backend ya existente (lectura HTTP de solo
lectura). Sin frontend, sin proyecto nuevo.

**Performance Goals**: Sin cambios. Un campo `Double` más leído de una entidad ya cargada
por fila; sin consulta adicional a la base (research.md D-02: no requiere el helper
`DatosCanCrudoReader`, que sí hace una deserialización JSON por fila).

**Constraints**:
- El servicio Java sigue sin conocer el formato de trama del fabricante (Principio I): lee
  un `Double`/`null` ya resuelto por `rinho-receptor`, nunca texto crudo.
- Cambio aditivo al contrato HTTP: ningún consumidor existente de `canBus` necesita
  cambiar nada para seguir funcionando (a diferencia de la reubicación de
  `tensionBateriaV` en la feature 003).
- Humedad y batería del sensor BLE quedan fuera de alcance (spec, Assumptions) — no se
  agrega ningún campo para ellas en esta feature.

**Scale/Scope**: Un campo nuevo en una entidad JPA, un DTO y un contrato ya existentes.
Sin cambios de escala.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Gate | Estado |
|-----------|------|--------|
| I. Arquitectura desacoplada por capas de adaptación | `rinho-receptor` sigue siendo el único punto de contacto con el protocolo Rinho; esta feature solo lee, del lado Java, un valor de dominio ya resuelto (`Double`/`null`), nunca la trama ni un JSON a interpretar. | ✅ PASS |
| II. Stack Java/Spring Boot + PostgreSQL/TimescaleDB + Spring Data JPA | Amplía el componente ya existente con el stack ya establecido; sin stack nuevo. | ✅ PASS |
| III. Sin mensajería sin justificación de escala | Sin cambios de topología: HTTP directo, SELECT directo. | ✅ PASS |
| IV. Inmutabilidad de datos crudos | Sin escritura nueva: `LecturaTelemetria` sigue `@Immutable`, sin setters; esta feature solo agrega un getter de solo lectura sobre una columna ya persistida. | ✅ PASS |
| V. Minimización de datos personales | La temperatura de la carga no es un dato personal de conductor. | ✅ PASS |
| VI. Seguridad como línea base | Sin cambios de superficie de red, puertos ni credenciales. | ✅ PASS |
| VII. Tolerancia a fallos de conectividad | Una lectura histórica sin `ble_temperatura_c` (columna `NULL`) se comporta igual que cualquier otro campo "no informado" ya existente en `canBus`. | ✅ PASS |
| VIII. Testing mínimo esperado | Dos casos cubren esta capa (research.md D-05): valor presente y valor ausente. No hay parseo de texto en esta capa que pueda producir un tercer caso de "dato inválido" — esa responsabilidad ya la cumple `rinho-receptor` (feature 008, Principio VIII de esa feature). | ✅ PASS (alcance de testing acotado por diseño, no por omisión — ver research.md D-05) |
| IX. Trazabilidad y no reproceso silencioso | Sin segmento BLE o con valor inválido en origen, la columna es `NULL` y así se expone (`null` en el JSON) — nunca 0 ni un campo omitido del contrato (FR-002). | ✅ PASS |

**Entregables académicos**: consistente con el DER (la temperatura de carga ya está
prevista conceptualmente desde la feature 008 como dato de telemetría); esta feature no
agrega una entidad nueva, solo expone una columna ya modelada.

### Post-Design Re-check (después de Phase 1)

Re-evaluado tras generar `research.md`, `data-model.md`, `contracts/` y `quickstart.md`:
sin violaciones nuevas ni notas adicionales. El diseño no introduce ningún helper de
lectura a demanda (a diferencia de `DatosCanCrudoReader` para `velocidadRuedaKmh`): al ser
un campo con columna propia, es una lectura directa de la entidad, más simple que el caso
que la nota del Principio I documentó en la feature 003.

## Project Structure

### Documentation (this feature)

```text
specs/010-estado-temperatura-ble/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── agrolink-vehiculo-estado-api.yaml   # v6.0.0 — reemplaza a la v5.0.0 (feature 005)
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/main/java/ar/utn/agrolink/ingesta/
├── telemetry/
│   └── LecturaTelemetria.java        # AMPLIADO: + bleTemperaturaC (Double, columna
│                                     #   ble_temperatura_c) y su getter
└── estado/
    ├── CanBusDto.java                # AMPLIADO: + bleTemperaturaC (Double, ultimo campo)
    └── EstadoVehiculoService.java    # AMPLIADO: mapearCanBus pasa lectura.getBleTemperaturaC()

src/test/java/ar/utn/agrolink/ingesta/estado/
└── EstadoVehiculoServiceTest.java    # AMPLIADO: fixtures con bleTemperaturaC presente/ausente
```

**Structure Decision**: Se amplían tres archivos ya existentes del mismo componente
(`agrolink-ingesta`), siguiendo exactamente el patrón ya usado por los campos con columna
propia de la feature 003 (p. ej. `temperaturaRefrigeranteC`). No se crea ningún paquete,
servicio ni helper nuevo — a diferencia de `DatosCanCrudoReader`, que existe solo para el
caso sin columna propia (`velocidadRuedaKmh`), que no aplica acá (research.md D-02).
`rinho-receptor` no se toca.

## Complexity Tracking

Sin violaciones que justificar.
