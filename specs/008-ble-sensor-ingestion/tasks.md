---

description: "Task list for feature 008-ble-sensor-ingestion"
---

# Tasks: Ingesta de lecturas de sensores BLE

**Input**: Design documents from `/specs/008-ble-sensor-ingestion/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/rinho-ble-segment.md, quickstart.md

**Tests**: Incluidos. El Principio VIII de la constitución exige tests unitarios para
todo parseo/adaptación (caso completo, faltante e inválido), y SC-002 exige probar la no
regresión.

**Organization**: Por historia de usuario (spec.md). US1 y US2 son P1; US3 es P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: Historia a la que pertenece (US1, US2, US3)

## Path Conventions

- Receptor Node: `rinho-receptor/src/`, `rinho-receptor/test/`
- Esquema: `deploy/db/`, `deploy/migrations/`
- Documentación: `docs/guias/`, `specs/`
- Tests: `cd rinho-receptor && npm test` (`node --test test/**/*.test.js`)

---

## Phase 1: Setup

**Purpose**: Verificar la precondición de numeración de migraciones.

- [X] T001 Verificar que `deploy/migrations/002_add_can_fields.sql` exista y esté trackeado (`git ls-files deploy/migrations`). Si no está trackeado, **no** commitearlo por cuenta propia: avisar al usuario que `003` lo asume (research.md D-06) y seguir.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Esquema y separación posicional de segmentos. US1 y US2 dependen de esto.

**⚠️ CRITICAL**: Ninguna historia empieza hasta terminar esta fase.

- [X] T002 [P] Crear `deploy/migrations/003_add_ble_sensor_fields.sql` con un comentario inicial en el estilo de `002_add_can_fields.sql` (motivo: feature 008, research.md D-05/D-06, idempotencia) y `ALTER TABLE telemetria.lectura_telemetria ADD COLUMN IF NOT EXISTS ble_temperatura_c NUMERIC, ADD COLUMN IF NOT EXISTS ble_humedad_pct NUMERIC, ADD COLUMN IF NOT EXISTS ble_bateria NUMERIC;`. Sin `DEFAULT`, sin `UPDATE`/`DELETE`, sin sentencias no transaccionales (reglas 3 y 4 de `deploy/migrations/README.md`).
- [X] T003 [P] En `deploy/db/01-schema.sql`, agregar las mismas tres columnas (`ble_temperatura_c NUMERIC`, `ble_humedad_pct NUMERIC`, `ble_bateria NUMERIC`) después de `presion_aceite_kpa` y antes de `ignicion`, alineadas como las demás, con un comentario de una línea: batería BLE cruda, unidad sin confirmar (% o mV), feature 008.
- [X] T004 [P] Cambiar `parseOneFrame` en `rinho-receptor/src/protocol/frame.js` para descartar **solo el último** elemento vacío de `beforeStar.split(';')` (el que deja el `;` antes del `*`) en vez de `.filter((seg) => seg !== '')`, conservando los vacíos intermedios. Actualizar el comentario existente para explicar por qué: el orden posicional GPS/CAN/BLE (research.md D-01).
- [X] T005 [P] Agregar a `rinho-receptor/test/frame.test.js`: (a) una trama `>REQ<gps>;;T0=1;ID=2326;*CS<` (checksum calculado con `calculateChecksum`) produce `body === 'REQ<gps>;;T0=1'`; (b) las tramas `VENDOR_FRAME` y `REAL_FRAME` producen el mismo `body` que antes.
- [X] T006 Crear `rinho-receptor/src/protocol/bodySections.js` exportando `splitBody(body)` → `{ gpsText, canText, bleText, extraSegments }`: quita el prefijo de 3 caracteres (`REQ`), hace `split(';')` y asigna por posición: 0 GPS, 1 CAN (`''` si falta), 2 BLE (`''` si falta), el resto en `extraSegments` (array). Comentario de cabecera: la identificación es posicional porque `B`/`B0` son IDs CAN válidos (contracts/rinho-ble-segment.md §3).
- [X] T007 [P] Crear `rinho-receptor/test/bodySections.test.js` con casos: solo GPS; GPS+CAN; GPS+CAN+BLE; GPS + CAN vacío + BLE (`'REQ<gps>;;T0=1'` → `canText ''`, `bleText 'T0=1'`); 4 segmentos → el cuarto en `extraSegments`; `B0=5` en posición 1 queda en `canText`, nunca en `bleText`.
- [X] T008 En `rinho-receptor/src/net/udpServer.js`, borrar la función local `splitBody`, importar la de `../protocol/bodySections.js` y, si `extraSegments.length > 0`, emitir `log.warn('Trama con segmentos inesperados en el body: se ignoran', { raw: frame.raw, from: rinfo.address, extraSegments })` sin rechazar la trama. Por ahora `bleText` no se usa (lo conecta T015).

**Checkpoint**: `npm test` pasa completo y la migración queda lista.

---

## Phase 3: User Story 1 - Registrar temperatura y humedad de la carga (Priority: P1) 🎯 MVP

**Goal**: Una trama con segmento BLE persiste `ble_temperatura_c`, `ble_humedad_pct` y `ble_bateria` del slot 0, con ACK igual que un EQ.

**Independent Test**: quickstart.md §3 y §5 (trama de `buildFrame --ble`, consulta SQL de las columnas `ble_*`).

### Tests for User Story 1

- [X] T009 [P] [US1] Crear `rinho-receptor/test/bleSection.test.js` para `parseBleSection`: pares completos (`T0=23.5,H0=45.0,B0=3012` → Map con 3 entradas string); `T0=` → `'T0'` con valor `''`; texto vacío → Map vacío; par sin `=` ignorado; claves de otros slots (`T1=20`) presentes en el Map (el filtrado es del mapper).
- [X] T010 [P] [US1] Agregar a `rinho-receptor/test/lecturaMapper.test.js` los casos de data-model.md §2, usando `REAL_FRAME` para GPS/CAN y un `Map` BLE construido en el test: completo → `bleTemperaturaC 23.5`, `bleHumedadPct 45`, `bleBateria 3012`, `COMPLETA`; `T0=` → `null` + `'bleTemperaturaC'` en `camposFaltantes` + `PARCIAL`; clave `H0` ausente con segmento presente → `null` + `'bleHumedadPct'`; inválidos `abc`, `0x1A`, `1e3`, ` 12`, `Infinity` → `null` + faltante; cero válido `T0=0` y `B0=0` → `0` (no `null`, sin faltante: SC-003); negativo `-5.25` → `-5.25`; fuera de rango `900` → `900` sin faltante; `T1=20` y `X0=1` → no aparecen en la lectura ni en `datosCan`.

### Implementation for User Story 1

- [X] T011 [P] [US1] Crear `rinho-receptor/src/protocol/bleSection.js` exportando `parseBleSection(text)` con la misma forma que `parseCanSection` (`src/protocol/canObd.js`): Map de clave → valor string opaco, split por `,` y primer `=`, `''` → Map vacío. Comentario de cabecera: formato de contracts/rinho-ble-segment.md §4, por qué no reutiliza `parseCanSection` (research.md D-02), y que el mapper decide el tipo.
- [X] T012 [US1] En `rinho-receptor/src/domain/lecturaMapper.js`: agregar las constantes `BLE_TEMPERATURA = 'T0'`, `BLE_HUMEDAD = 'H0'`, `BLE_BATERIA = 'B0'`, el patrón `/^-?\d+(\.\d+)?$/` y una función `resolveBle(ble, clave, nombreCampo, camposFaltantes)`: si `ble` es `null` o está vacío devuelve `null` sin tocar `camposFaltantes`; si la clave falta, está vacía o no cumple el patrón devuelve `null` y agrega `nombreCampo`; si no, devuelve `Number(raw)`. Comentar las reglas D-03/D-04 (por qué no `Number.isNaN`, y por qué la ausencia del segmento no degrada).
- [X] T013 [US1] En `mapFrameToLectura` (`rinho-receptor/src/domain/lecturaMapper.js`), aceptar el parámetro `ble = null` y agregar al objeto devuelto, después de `presionAceiteKpa`, `bleTemperaturaC`, `bleHumedadPct` y `bleBateria` (nombres de faltante iguales). No tocar `buildDatosCan`: las claves BLE nunca entran en `datosCan`.
- [X] T014 [US1] En `rinho-receptor/src/db/lecturaRepository.js`, agregar `ble_temperatura_c, ble_humedad_pct, ble_bateria` al `INSERT_SQL` después de `presion_aceite_kpa`, renumerar los placeholders (`$1`…`$27`) y agregar `lectura.bleTemperaturaC, lectura.bleHumedadPct, lectura.bleBateria` al array de parámetros en la misma posición.
- [X] T015 [US1] En `rinho-receptor/src/net/udpServer.js`, importar `parseBleSection`, parsear `bleText` y pasar `ble` a `mapFrameToLectura`, dentro del mismo `try` de parseo existente. Exportar `handleFrame` (hoy es privada) sin cambiar su firma, para poder testearla con socket y repositorio falsos (T019).
- [X] T016 [P] [US1] En `rinho-receptor/test/tools/buildFrame.js`: agregar la opción `ble = ''`; si `ble` no está vacío, el body es `REQ<gps>;<can>;<ble>` (con `can` vacío queda `REQ<gps>;;<ble>`, research.md D-08); agregar el flag CLI `--ble` y un ejemplo con `--ble` en el comentario de uso.
- [X] T017 [US1] Agregar a `rinho-receptor/test/lecturaMapper.test.js` un test de punta a punta del receptor sin DB: construir con `buildFrame({ deviceId: '2326', can: '1=,2=,3=,B=,14=,15=,2A=,2C=', ble: 'T0=23.5,H0=45.0,B0=3012', msgNum: '0012' })`, pasarlo por `parseDatagram` → `splitBody` → `parseGpsSection`/`parseCanSection`/`parseBleSection` → `mapFrameToLectura`, y verificar los tres valores BLE, `payloadCrudo` idéntico a la trama y `msgNum '0012'`.
- [X] T018 [P] [US1] Crear `rinho-receptor/test/lecturaRepository.integration.test.js` siguiendo el patrón de `rinho-receptor/test/lecturaTardia.test.js` (mismo `canRunIntegration()` con `loadConfig()`, `test(..., { skip: !canRunIntegration() })`, pool con `createPool`/`closePool`): persistir con `createLecturaRepository` una lectura fixture con `bleTemperaturaC: 23.5`, `bleHumedadPct: 45`, `bleBateria: 3012` y el resto de los campos de `lecturaFixture`, leerla con `SELECT ble_temperatura_c, ble_humedad_pct, ble_bateria, presion_aceite_kpa, reporte_id ... WHERE frame_hash = $1` y verificar cada columna (`Number(...)` sobre los `NUMERIC`, que `pg` devuelve como string), para detectar un corrimiento de placeholders en el `INSERT` (T014). Segundo caso: las tres propiedades en `null` → las tres columnas `NULL`.
- [X] T019 [P] [US1] Crear `rinho-receptor/test/udpServer.test.js` para `handleFrame` (exportada en T015) con un repositorio falso (`{ persist: async (l) => { capturada = l; return { inserted: true, deduplicated: false }; } }`) y un socket falso (`{ send: (buf, port, address, cb) => { enviado = { buf, port, address }; cb?.(); } }`): (a) trama de `buildFrame({ deviceId: '2326', can: '1=,2=,3=,B=,14=,15=,2A=,2C=', ble: 'T0=23.5,H0=45.0,B0=3012', msgNum: '0012' })` pasada por `parseDatagram` → `capturada` tiene `bleTemperaturaC 23.5`, `bleHumedadPct 45`, `bleBateria 3012` y el ACK se envía al `rinfo.port`/`rinfo.address` de origen (spec US1 escenario 3); (b) la misma trama sin `ble` → ACK igual y las tres propiedades `ble*` en `null`; (c) repositorio que lanza error → no se envía ACK.

**Checkpoint**: `npm test` pasa (T018 corre solo con base disponible; T019 siempre). Con el stack levantado, quickstart.md §3 y §5 pasan.

---

## Phase 4: User Story 2 - Las tramas actuales siguen funcionando sin cambios (Priority: P1)

**Goal**: Cero regresiones para tramas EQ sin segmento BLE (FR-003, FR-007, SC-002).

**Independent Test**: quickstart.md §4 y todos los tests previos a la feature sin modificar.

- [X] T020 [P] [US2] Agregar a `rinho-receptor/test/lecturaMapper.test.js`: `REAL_FRAME` sin `ble` (y con `ble: new Map()`) → las tres propiedades `ble*` en `null`, `estadoInterpretacion === 'COMPLETA'` y ningún nombre `ble*` en `camposFaltantes`; `VENDOR_FRAME` sin `ble` → mismo `camposFaltantes` que antes de la feature (sin entradas `ble*`).
- [X] T021 [US2] Correr `cd rinho-receptor && npm test` y confirmar que **ningún test preexistente** se modificó para hacerlo pasar (`git diff` sobre los tests existentes solo agrega casos). Si alguno falla, arreglar el código, no el test.

**Checkpoint**: US1 y US2 juntas son el incremento desplegable.

---

## Phase 5: User Story 3 - Referencia de protocolo y guía de puesta en marcha (Priority: P2)

**Goal**: Contrato EQ corregido y guía para configurar un sensor real (FR-011, FR-013).

**Independent Test**: Con solo `docs/guias/configuracion-sensor-ble.md` se puede configurar el equipo, capturar una trama y compararla con la esperada (spec US3, escenario 3).

- [X] T022 [P] [US3] En `specs/001-ingesta-adaptacion-telemetria/contracts/rinho-eq-frame.md` §1: cambiar la fila `dd..dd` a "Destino del reporte (p. ej. `GPRS`, `LOG`, `SMx`); opcional", con una nota ⚠️ **Corrección** en el estilo de las existentes explicando que no son campos de datos personalizados. En §2, agregar debajo del envelope una línea que remita a `specs/008-ble-sensor-ingestion/contracts/rinho-ble-segment.md` para el tercer segmento opcional (BLE).
- [X] T023 [P] [US3] Crear `docs/guias/configuracion-sensor-ble.md` (en español, estilo de los contratos del repo) con estas secciones: 1) Qué hace falta (sensor BLE compatible, MAC, acceso de configuración al equipo); 2) Emparejar el sensor (`>SBS00E,<MAC>,10,120,0<`, significado de cada parámetro según el handoff, marcando lo no verificado); 3) Plantilla del reporte de usuario (`SUC00` exacto de contracts/rinho-ble-segment.md §1, reglas de tokens, límite de 239 bytes); 4) Regla de envío (`SRL` con `GU000H` y el destino; ejemplo `>SRL00E;TRG=TD00+;CND=IGN;ACC={GU000H;@LOG}<` del fabricante, más la variante que envía por GPRS en vez de LOG, marcada como a verificar); 5) Trama esperada por el receptor (ejemplo del contrato §2); 6) Capturar una trama real (`>QU0<` para consultar el reporte, logs del receptor, consulta SQL de `payload_crudo` y columnas `ble_*`); 7) Checklist de verificación H-1…H-8 (contracts/rinho-ble-segment.md §5), cada uno con qué mirar y qué hacer si falla; 8) Qué actualizar si el formato real difiere (bleSection.js, bodySections.js, contrato, esta guía, en la misma entrega, FR-013). Enlazar `docs/handoff/ble-sensores.md` como fuente.
- [X] T024 [P] [US3] En `docs/handoff/ble-sensores.md`, agregar al principio una línea de estado: "Implementado en `specs/008-ble-sensor-ingestion/`; guía operativa en `docs/guias/configuracion-sensor-ble.md`". No borrar el resto (queda como registro del análisis).

**Checkpoint**: las tres historias completas.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T025 [P] En `README.md` (raíz), agregar `008-ble-sensor-ingestion/` a la lista de specs y una línea a la descripción de la ingesta: segmento BLE opcional (slot 0), guía en `docs/guias/configuracion-sensor-ble.md`.
- [X] T026 [P] En `rinho-receptor/README.md`, documentar en una o dos líneas que el body se separa por posición (GPS/CAN/BLE) en `src/protocol/bodySections.js` y que el segmento BLE es opcional.
- [ ] T027 Si hay Docker disponible, ejecutar quickstart.md §2–§5 contra el stack local (`deploy/compose.yaml`) y anotar el resultado. Si no, dejar constancia de que la validación de punta a punta quedó pendiente, sin marcarla como hecha.
- [X] T028 Revisar `specs/008-ble-sensor-ingestion/checklists/requirements.md` y marcar el estado final; confirmar que spec.md FR-001…FR-013 tienen, cada uno, al menos una tarea completada.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias. No bloquea (solo advierte).
- **Foundational (Phase 2)**: bloquea US1 y US2. T006 → T007 y T008; T004 → T005.
- **US1 (Phase 3)**: depende de Phase 2. T011 → T009 verificable; T012 → T013 → T014/T015; T016 → T017; T014 → T018; T015 + T016 → T019.
- **US2 (Phase 4)**: depende de T013 (firma del mapper con `ble`). T021 va al final de US1+US2.
- **US3 (Phase 5)**: independiente del código; puede ir en paralelo desde el principio. T023 usa el contrato de la 008, que ya existe.
- **Polish (Phase 6)**: después de las historias.

### Parallel Opportunities

- Phase 2: T002, T003, T004/T005 y T006/T007 en paralelo (archivos distintos).
- US1: T009, T011 y T016 en paralelo; después, T010 junto a T012.
- US3: T022, T023 y T024 en paralelo entre sí y con cualquier fase de código.

## Parallel Example: User Story 1

```bash
# En paralelo, archivos distintos:
Task: "T011 Crear rinho-receptor/src/protocol/bleSection.js"
Task: "T009 Crear rinho-receptor/test/bleSection.test.js"
Task: "T016 Opción ble en rinho-receptor/test/tools/buildFrame.js"
```

## Implementation Strategy

### MVP (US1 + US2)

1. Phase 1 → Phase 2 (esquema + split posicional).
2. US1 (persistencia BLE) y US2 (no regresión): van juntas, porque desplegar US1 sin US2
   verificada arriesga la ingesta actual.
3. **Validar** con `npm test` y quickstart.md §3–§5, y desplegar: el pipeline aplica `003`
   antes de reiniciar el receptor.

### Incremental

- US3 (documentación) puede entregarse antes, después o en paralelo; no cambia comportamiento.
- Cuando llegue un sensor real: seguir `docs/guias/configuracion-sensor-ble.md` §6–§8. Si el
  formato difiere, abrir una feature nueva en vez de ajustar el parser sin contrato.
