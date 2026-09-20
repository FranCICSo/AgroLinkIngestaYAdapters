# Implementation Plan: Exposición estructurada de campos CAN bus

**Branch**: `003-can-fields-expansion` | **Date**: 2026-09-13 (revisado tras Clarifications, sesión 2026-09-13) | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-can-fields-expansion/spec.md`

**Nota de revisión**: Este plan reemplaza por completo la versión anterior (que solo
cubría `2A`/`2C` y excluía el VIN). El alcance creció en la sesión de `/speckit-clarify`
del 2026-09-13: ahora también persiste VIN, RPM y combustible consumido, y reubica
`tensionBateriaV`. Ver spec.md, sección Clarifications, para el detalle de cada decisión.

## Summary

Tres cambios encadenados, uno por capa (Principio I):

1. **Receptor Node (`rinho-receptor/`)**, la única capa de adaptación del protocolo Rinho:
   promueve cinco identificadores CAN a columnas propias de
   `telemetria.lectura_telemetria` — `1` (VIN), `2` (RPM), `14` (combustible consumido, en
   litros), `2A` (temperatura de refrigerante) y `2C` (presión de aceite) — siguiendo el
   mismo patrón ya usado para `B` (odómetro) y `15` (combustible %). El VIN deja de
   descartarse: la cita previa a "Principio V" para justificar su descarte era una
   interpretación demasiado amplia de esa regla (protege datos personales de choferes, no
   identificadores de vehículo) y se corrige como parte de esta feature (spec,
   Clarifications). `3` (velocidad de rueda) es el único identificador que **no** obtiene
   columna propia — sigue viajando solo dentro de `datos_can`.
2. **Servicio de lectura Java (`agrolink-ingesta`)**: el DTO `CanBusDto` de
   `GET /api/v1/vehiculos/{dispositivoId}/estado` deja de exponer `datosCanCrudos` y en su
   lugar expone, cada uno con nombre propio, los nueve valores soportados: VIN, RPM,
   velocidad de rueda, odómetro (ya existente), combustible consumido, nivel de
   combustible (ya existente), temperatura de refrigerante, presión de aceite, y tensión
   de batería. Los ocho primeros vienen de columnas propias salvo velocidad de rueda, que
   se lee a demanda desde `datos_can` ya persistido (sin volver a tocar la trama original).
3. **Reubicación de `tensionBateriaV`**: deja de estar en el bloque `dispositivo` de la
   respuesta y pasa a estar exclusivamente en `canBus` (cambio de ruptura aceptado
   deliberadamente, spec Clarifications). No es un dato nuevo — ya existe como columna
   (`tension_bateria_v`, feature 001) y ya estaba mapeado en `LecturaTelemetria` (feature
   002); solo cambia en qué bloque de la respuesta aparece.

No se agrega ningún servicio ni dependencia nueva. No hay migraciones versionadas (el
proyecto no usa Flyway/Liquibase — research.md D-01): el cambio de esquema se aplica
editando `deploy/db/01-schema.sql` directamente. Además de estos tres cambios de código,
la documentación del protocolo (`specs/001-ingesta-adaptacion-telemetria/contracts/rinho-eq-frame.md`)
queda desactualizada en varios puntos (la cita de "Principio V" para el VIN, el destino de
`2`/`14`/`2A`/`2C`, y la nota de "unidad sin confirmar" del combustible consumido) y se
corrige como parte de esta feature.

## Technical Context

**Language/Version**: Java 21 (Spring Boot 3.3.4) para el servicio de lectura
`agrolink-ingesta`; Node.js ≥22 (ES modules) para el receptor `rinho-receptor/` — mismos
dos componentes ya existentes, sin proyecto nuevo.

**Primary Dependencies**: `spring-boot-starter-web`, `spring-boot-starter-data-jpa`,
`org.postgresql:postgresql` (Java, ya presentes); `pg` ^8.13.0 (Node, ya presente). Sin
dependencias nuevas: el parseo de `datos_can` en el lado Java (solo para `velocidadRuedaKmh`
ahora, ver research.md D-02) usa Jackson (`com.fasterxml.jackson.databind.ObjectMapper`),
ya disponible transitivamente vía `spring-boot-starter-web`.

**Storage**: Misma TimescaleDB / tabla `telemetria.lectura_telemetria`. Se agregan cinco
columnas nuevas (`vin VARCHAR(20)`, `rpm SMALLINT`, `combustible_consumido_l NUMERIC(10,2)`,
`temperatura_refrigerante_c SMALLINT`, `presion_aceite_kpa SMALLINT`, todas nullable) vía
edición directa de `deploy/db/01-schema.sql` (research.md D-01 — sin herramienta de
migraciones).

**Testing**: JUnit 5 + Mockito + AssertJ para el lado Java (mismo patrón que
`EstadoVehiculoServiceTest`, fixtures de `LecturaTelemetria` construidas por reflexión);
`node:test` + `node:assert/strict` para el lado Node (mismo patrón que
`lecturaMapper.test.js`). Principio VIII exige, para cada resolver nuevo (VIN, RPM,
combustible consumido, temperatura de refrigerante, presión de aceite) y para el lector
Java de `datos_can`, los tres casos mínimos: dato completo, dato faltante/vacío, dato
inválido (no numérico, salvo VIN que es alfanumérico por definición — su caso "inválido"
es simplemente string vacío/ausente).

**Target Platform**: Mismo entorno que las features 001/002 — VM Oracle Cloud Always
Free, Ampere A1, linux/arm64, Docker Compose. Sin cambios de plataforma ni de topología de
despliegue.

**Project Type**: Ampliación de dos servicios backend ya existentes dentro del mismo
monorepo (receptor de ingesta + servicio de lectura HTTP). Sin frontend.

**Performance Goals**: Sin cambios respecto del estado actual — cinco columnas más en un
`INSERT` ya existente, y una lectura de un JSON ya cargado en memoria para un solo campo
(`velocidadRuedaKmh`). Sin impacto de latencia perceptible.

**Constraints**:
- No se introduce mensajería ni servicios nuevos (Principio III).
- El receptor Node sigue siendo el único punto de contacto con el formato de trama del
  fabricante (Principio I): el lado Java solo lee, para `velocidadRuedaKmh`, el JSON ya
  normalizado que el receptor persistió en `datos_can`, nunca la trama cruda
  (`payload_crudo`).
- El VIN se trata siempre como string opaco, nunca se convierte a número (contrato
  `rinho-eq-frame.md`, discrepancia (c)) — sigue siendo cierto con el VIN ya persistido.
- El cambio de esquema (`01-schema.sql`) solo se aplica automáticamente en un volumen de
  Postgres nuevo; un entorno ya desplegado requiere un `ALTER TABLE` manual documentado en
  `quickstart.md`.
- El cambio de `tensionBateriaV` de bloque es una ruptura de contrato HTTP aceptada
  deliberadamente (spec, Assumptions) — se documenta en `contracts/` para que los
  consumidores existentes (AgroLinkBackend) lo adapten, no se mantiene compatibilidad
  hacia atrás con un campo duplicado.

**Scale/Scope**: Cinco columnas nuevas sobre una tabla ya existente, un DTO reestructurado
con reubicación de un campo entre dos bloques, sin cambios de escala respecto del piloto
ya dimensionado en las features 001/002.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Gate | Estado |
|-----------|------|--------|
| I. Arquitectura desacoplada por capas de adaptación | La promoción de `1`/`2`/`14`/`2A`/`2C` a columnas ocurre en `rinho-receptor` (única capa de adaptación), igual que `B`/`15`. El servicio Java lee `datos_can` (un JSON ya normalizado, no la trama original) solo para `velocidadRuedaKmh` — el único valor que sigue sin columna propia. | ⚠️ PASS con nota (ver Complexity Tracking) |
| II. Stack Java/Spring Boot + PostgreSQL/TimescaleDB + Spring Data JPA | Ambos componentes tocados ya usan el stack establecido; sin stack nuevo. | ✅ PASS |
| III. Sin mensajería sin justificación de escala | Sin cambios de topología: HTTP directo (servicio de lectura) e INSERT directo (receptor). | ✅ PASS |
| IV. Inmutabilidad de datos crudos | Las columnas nuevas se agregan con `ALTER TABLE ADD COLUMN` (nullable, sin `DEFAULT` destructivo); ninguna fila existente se actualiza. El `INSERT` del receptor sigue siendo `ON CONFLICT DO NOTHING`. `payload_crudo` no se toca — sigue conteniendo el VIN byte a byte, igual que antes de esta feature (nunca se descartó del crudo, solo del modelo de dominio). | ✅ PASS |
| V. Minimización de datos personales | El VIN identifica al **vehículo**, no a una persona (chofer); Principio V protege nombres/DNI/CUIL de choferes, no identificadores de vehículo. La cita previa de "Principio V" para descartar el VIN era una interpretación demasiado amplia (spec, Clarifications, sesión 2026-09-13) — se corrige, no se enmienda la Constitución. Ningún campo de esta feature es un dato personal de conductor. | ✅ PASS (interpretación corregida, no una excepción al principio) |
| VI. Seguridad como línea base | Sin cambios de superficie de red, puertos ni credenciales. | ✅ PASS |
| VII. Tolerancia a fallos de conectividad | Las lecturas históricas sin los campos nuevos (columnas → `NULL`) y las lecturas nuevas sin esos sensores reportados se tratan igual: "no informado", nunca un valor inventado (FR-010), consistente con el criterio ya usado para `combustible_pct`. | ✅ PASS |
| VIII. Testing mínimo esperado | Cinco resolvers Node nuevos (VIN, RPM, combustible consumido, temp. refrigerante, presión de aceite) y el lector Java de `datos_can` (ahora usado solo para velocidad de rueda) requieren sus 3 casos mínimos cada uno. Dos tests existentes de `lecturaMapper.test.js` que hoy afirman el descarte del VIN quedan obsoletos y se reemplazan (no se dejan como falsos positivos silenciosos). | ✅ PASS (compromiso de cobertura documentado) |
| IX. Trazabilidad y no reproceso silencioso | Un valor no reportado no se descarta silenciosamente: queda como `null` explícito ("no informado", FR-010) y — para los campos promovidos a columna — sigue empujando a `campos_faltantes`, igual que ya hace `combustible_pct`. | ✅ PASS |

**Alineación con entregables académicos**: no se contradice ningún entregable aprobado
(WBS, DER, Historias de Usuario, Gestión de Riesgos); es una ampliación de campos ya
previstos conceptualmente como "datos CAN bus" en el DER de la feature 001. La corrección
de la interpretación del Principio V sobre el VIN no cambia el DER (el VIN no es una
entidad ni un dato de conductor en ese diagrama).

### Post-Design Re-check (después de Phase 1)

Re-evaluado tras generar `research.md`, `data-model.md`, `contracts/` y `quickstart.md`:
sin violaciones nuevas. La única nota (Principio I) se reduce respecto de la versión
anterior de este plan: ahora solo un campo (`velocidadRuedaKmh`) se lee a demanda desde
`datos_can` del lado Java, en vez de tres. El diseño de datos no introduce ninguna
escritura nueva sobre filas existentes ni cambia el régimen insert-only de la tabla.

## Project Structure

### Documentation (this feature)

```text
specs/003-can-fields-expansion/
├── plan.md              # This file
├── spec.md              # Feature specification (revisada, Clarifications sesión 2026-09-13)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── agrolink-vehiculo-estado-api.yaml   # v3.0.0 — reemplaza a la versión anterior de esta misma feature
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
rinho-receptor/src/domain/
├── lecturaMapper.js          # AMPLIADO: + resolveVin(1), resolveRpm(2), resolveCombustibleConsumido(14),
│                              #   resolveTemperaturaRefrigerante(2A), resolvePresionAceite(2C);
│                              #   los 5 agregados a CAN_IDS_PROMOVIDOS (VIN ya estaba, pero sin resolver);
│                              #   comentario de buildDatosCan actualizado (ya no dice "VIN descartado")
rinho-receptor/src/db/
├── lecturaRepository.js      # AMPLIADO: + columnas vin, rpm, combustible_consumido_l,
│                              #   temperatura_refrigerante_c, presion_aceite_kpa en el INSERT
rinho-receptor/test/
├── lecturaMapper.test.js     # AMPLIADO Y CORREGIDO: reemplaza los 2 tests que hoy afirman el
│                              #   descarte del VIN; + 3 casos por cada uno de los 5 resolvers nuevos

deploy/db/
├── 01-schema.sql              # AMPLIADO: + vin VARCHAR(20), rpm SMALLINT, combustible_consumido_l NUMERIC(10,2),
│                              #   temperatura_refrigerante_c SMALLINT, presion_aceite_kpa SMALLINT

specs/001-ingesta-adaptacion-telemetria/contracts/
├── rinho-eq-frame.md          # CORREGIDO: tablas §4 y §5-bis (destino de 1/2/14/2A/2C), nota (c)
│                              #   (ya no cita "descarte del VIN por Principio V"), nota (d)
│                              #   (unidad de combustible consumido confirmada en litros)

src/main/java/ar/utn/agrolink/ingesta/
├── telemetry/
│   └── LecturaTelemetria.java        # AMPLIADO: + vin (String), rpm (Integer), combustibleConsumidoL (Double),
│                                     #   temperaturaRefrigeranteC (Integer), presionAceiteKpa (Integer)
└── estado/
    ├── CanBusDto.java                # REESTRUCTURADO: fuera datosCanCrudos; + vin, rpm, velocidadRuedaKmh,
    │                                  #   combustibleConsumidoL, temperaturaRefrigeranteC, presionAceiteKpa,
    │                                  #   tensionBateriaV (reubicado desde DispositivoInfoDto)
    ├── DispositivoInfoDto.java        # AMPLIADO: - tensionBateriaV (se muda a CanBusDto)
    ├── EstadoVehiculoService.java     # AMPLIADO: mapearCanBus construye los 9 campos; mapearDispositivo
    │                                  #   deja de incluir tensionBateriaV
    └── DatosCanCrudoReader.java       # NUEVO: helper de solo lectura sobre el JSON de datos_can
                                       #   (leerEntero/leerDecimal por id CAN; usado solo para "3" ahora)

src/test/java/ar/utn/agrolink/ingesta/estado/
├── EstadoVehiculoServiceTest.java    # AMPLIADO: fixtures con los nuevos campos, canBus y dispositivo reestructurados
└── DatosCanCrudoReaderTest.java      # NUEVO: clave presente / clave ausente / valor no numérico
```

**Structure Decision**: Se amplían los dos componentes ya existentes siguiendo exactamente
sus patrones actuales — cinco resolvers más en `lecturaMapper.js` (mismo estilo que
`resolveCombustiblePct`) y un helper de lectura aislado (`DatosCanCrudoReader`) en el
paquete `estado/` del lado Java, ahora usado para un solo campo. `EstadoVehiculoService`
se mantiene como orquestador simple. No se crea ningún paquete ni servicio nuevo. Se
incluye además la corrección de un documento de otra feature (`001-.../contracts/rinho-eq-frame.md`)
porque su contenido queda objetivamente desactualizado por las decisiones de esta feature
(citación incorrecta de un principio, destino de campos, unidad confirmada) — dejarlo sin
corregir induciría al mismo error que motivó la sesión de clarificación.

## Complexity Tracking

> Llenar SOLO si el Constitution Check tiene violaciones que justificar

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| **Principio I** (nota, no violación): el servicio Java interpreta la clave de protocolo `3` dentro de `datos_can` para darle nombre propio en la respuesta | La spec (US2/FR-008) exige que la consulta de estado deje de exponer un bloque sin interpretar; velocidad de rueda es el único valor que no obtuvo columna propia (spec, Clarifications — el usuario pidió columna para VIN/RPM/combustible consumido pero no para velocidad de rueda), así que la única forma de nombrarlo sin agregar una columna es leerlo del JSON ya persistido en el momento de responder. `DatosCanCrudoReader` solo conoce una clave de un diccionario ya producido por el receptor (no el framing/checksum del protocolo Rinho) — no se duplica lógica de decodificación de trama. | *Promover también velocidad de rueda a columna*: resolvería la nota sin ambigüedad, pero el usuario explícitamente no la pidió como columna (a diferencia de VIN/RPM/combustible consumido, que sí pidió); se deja como mejora futura si aparece esa necesidad. *Mover el parseo de `datos_can` al receptor y persistir un DTO ya aplanado*: rompería la compatibilidad con lecturas históricas sin este cambio, sin beneficio adicional para un solo campo restante. |
