---

description: "Task list for Simulador de Viajes con Dispositivos Ficticios"

---

# Tasks: Simulador de Viajes con Dispositivos Ficticios

**Input**: Design documents from `/specs/009-simulador-viajes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/simulador-frame-emission.md, quickstart.md

**Tests**: Incluidos — el plan (`Testing`, Principio VIII) y `quickstart.md` §1 ya nombran los
archivos de test esperados (`avanceRuta.test.js`, `sintesisCan.test.js`, `sintesisBle.test.js`,
`frameBuilder.test.js`, `udpClient.test.js`).

**Organization**: Tasks agrupadas por historia de usuario de `spec.md` (US1–US5, en orden de
prioridad).

## Path Conventions

Proyecto Node.js nuevo, sibling de `rinho-receptor/` (plan.md, Project Structure):
`simulador-viajes/src/`, `simulador-viajes/test/`. Infraestructura compartida en `deploy/`.

---

## Phase 1: Setup

**Purpose**: Inicialización del proyecto `simulador-viajes/`

- [X] T001 Crear estructura de directorios `simulador-viajes/{src/{db,domain,protocol,net},test/{domain,protocol,net}}` per plan.md Project Structure
- [X] T002 Crear `simulador-viajes/package.json` (`type: module`, `engines.node >= 22`, dependencia `pg`, script `test: node --test test/**/*.test.js`, script `start: node src/index.js`) — mismo patrón que `rinho-receptor/package.json`
- [X] T003 [P] Agregar `deploy/.env.example`: variables `RECEPTOR_HOST`, `RECEPTOR_PORT`, `APUNTAR_A_PRODUCCION`, `SIMULADOR_VIAJES_DB_USER`, `SIMULADOR_VIAJES_DB_PASSWORD` (contracts/simulador-frame-emission.md §2)

**Checkpoint**: Proyecto Node.js vacío pero ejecutable (`npm install && npm test` no falla por falta de estructura)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema de datos, acceso a DB, construcción de tramas y cliente UDP — todo lo que
cada historia de usuario necesita para poder ejecutarse

**⚠️ CRITICAL**: Ninguna historia de usuario puede implementarse hasta completar esta fase

- [X] T004 Crear `deploy/db/03-schema-simulador.sql`: `CREATE SCHEMA simulador`, tablas `camion`, `ruta`, `viaje` (columnas y tipos exactos de data-model.md §1–3), rol `simulador_viajes LOGIN` con `GRANT USAGE, SELECT, INSERT, UPDATE ON simulador.*` únicamente — **sin ningún permiso sobre `telemetria`** (plan.md Storage; research.md D-08)
- [X] T005 [P] `simulador-viajes/src/config.js`: cargar `RECEPTOR_HOST`, `RECEPTOR_PORT`, `APUNTAR_A_PRODUCCION`, credenciales de DB desde variables de entorno, con validación explícita si `APUNTAR_A_PRODUCCION=true` sin `RECEPTOR_HOST` apuntando a la VM (FR-012)
- [X] T006 [P] `simulador-viajes/src/db/pool.js`: pool `pg` con el rol `simulador_viajes` (mismo patrón que `rinho-receptor/src/db/pool.js`)
- [X] T007 `simulador-viajes/src/db/flotaRepository.js`: leer camiones activos + su viaje `en_curso` y ruta asociada; actualizar `viaje.indice_actual`, `viaje.odometro_actual_km`, `viaje.estado` (depende de T006)
- [X] T008 [P] `simulador-viajes/src/protocol/frameBuilder.js`: wrapper que importa `buildFrame` desde `../../rinho-receptor/test/tools/buildFrame.js` por ruta relativa entre proyectos (research.md D-01) y arma el envelope GPS+CAN a partir de un objeto de dominio
- [X] T009 `simulador-viajes/src/net/udpClient.js`: enviar trama por `node:dgram`, esperar `>ACK;#<msgNum>;ID=...;*<checksum><` con timeout de 10s, reintentar hasta 3 veces con espera fija de 5s, loguear `warn` (camión, viaje, msgNum) si se agotan (FR-011; research.md D-03; contracts/simulador-frame-emission.md §3)

**Checkpoint**: Con datos insertados a mano en `simulador.*`, es posible construir y enviar una trama válida al receptor manualmente desde un script de prueba

---

## Phase 3: User Story 1 - Generar telemetría realista sin hardware físico (Priority: P1) 🎯 MVP

**Goal**: Un camión simulado activo, con ruta y viaje configurados, emite una trama UDP válida
cada 60s y aparecen lecturas nuevas en `telemetria.lectura_telemetria`.

**Independent Test**: Levantar el simulador contra un receptor local con el camión 1 (datos
reales de referencia) activo, y verificar lecturas nuevas y coherentes con la ruta.

### Tests for User Story 1

- [X] T010 [P] [US1] `simulador-viajes/test/domain/avanceRuta.test.js`: avanza entre dos puntos consecutivos de la ruta; llega a una parada (velocidad 0, ignición apagada); completa la ruta y genera el viaje de vuelta invertido (FR-006, FR-007, FR-014)
- [X] T011 [P] [US1] `simulador-viajes/test/protocol/frameBuilder.test.js`: trama con CAN construida coincide en ancho (66 GPS) y checksum con `calculateChecksum` de `rinho-receptor/src/protocol/frame.js`

### Implementation for User Story 1

- [X] T012 [P] [US1] `simulador-viajes/src/domain/avanceRuta.js`: calcula posición/velocidad/rumbo/odómetro entre el punto actual y el siguiente de `ruta.puntos`, detecta parada de entrega (`ruta.paradas`) y aplica velocidad 0 + ignición apagada mientras dura, y dispara el viaje de vuelta al llegar al último punto (FR-006, FR-007, FR-014; research.md D-07)
- [X] T013 [P] [US1] `simulador-viajes/src/domain/sintesisCan.js`: RPM en función de velocidad, combustible % decreciente + combustible consumido acumulado según distancia, presión de aceite estable en marcha/caída en ralentí (FR-008; research.md D-05)
- [X] T014 [US1] Completar `simulador-viajes/src/protocol/frameBuilder.js` para tomar la salida de `avanceRuta.js` + `sintesisCan.js` y producir el envelope GPS+CAN completo con `#msgNum` (depende de T008, T012, T013)
- [X] T015 [US1] `simulador-viajes/src/index.js`: loop principal con un `setInterval`/temporizador independiente por camión activo cada 60s, que lee la flota (T007), avanza el viaje (T012–T014) y envía por UDP (T009) (FR-001, FR-002, FR-003)
- [X] T016 [US1] `deploy/seed/simulador-camion-1.sql`: inserta el camión 1 (`id='900001'`, VIN `LGWEEUA55TL612021`, `odometro_inicial_km=150200`), su ruta de 88 puntos (a partir de `deploy/seed/lectura_telemetria_sample.csv`) y su viaje inicial `en_curso`/`sentido='ida'` (data-model.md; spec Assumptions)
- [X] T017 [US1] Ejecutar validación manual de `quickstart.md` §1–4 (tests unitarios, levantar stack, cargar camión 1, ver lecturas nuevas cada 60s con odómetro subiendo desde 150200)

**Checkpoint**: US1 funciona de punta a punta de forma independiente — es el MVP demostrable

---

## Phase 4: User Story 2 - Simular temperatura de carga refrigerada para medias reses (Priority: P2)

**Goal**: Camiones con carga refrigerada emiten temperatura/humedad BLE realistas, incluidas dos
fallas planificadas (apertura de puerta, falla de compresor).

**Independent Test**: Configurar el camión 1 como refrigerado y verificar temperatura/humedad
BLE estables alrededor del setpoint; forzar una falla de compresor y verificar que cruza el
umbral de alerta (quickstart.md §5).

### Tests for User Story 2

- [X] T018 [P] [US2] `simulador-viajes/test/domain/sintesisBle.test.js`: operación normal (± ruido alrededor del setpoint); apertura de puerta (pico y recuperación exponencial); falla de compresor (sube sostenido y cruza 7°C); camión sin carga refrigerada → sin datos BLE (FR-013, FR-015, FR-016, FR-017; research.md D-06)

### Implementation for User Story 2

- [X] T019 [P] [US2] `simulador-viajes/src/domain/sintesisBle.js`: implementa las tres fórmulas de research.md D-06 (normal, apertura de puerta ligada a `ruta.paradas`, falla de compresor a partir de `viaje.falla_indice_disparo`) devolviendo `null` cuando `camion.tipo_carga !== 'refrigerada'`
- [X] T020 [US2] Extender `simulador-viajes/src/protocol/frameBuilder.js` para agregar el segmento BLE (`T0`/`H0`) en la posición 2, después del CAN, solo cuando `sintesisBle.js` devuelve datos (depende de T014, T019; contrato `specs/008-ble-sensor-ingestion/contracts/rinho-ble-segment.md`)
- [X] T021 [US2] Extender `flotaRepository.js` (T007) para leer `camion.setpoint_temp_c`/`setpoint_humedad_pct` y `viaje.falla_tipo`/`falla_indice_disparo`, validando que un camión `refrigerada` tenga ambos setpoints (data-model.md §1)
- [X] T022 [US2] Ejecutar validación manual de `quickstart.md` §5 (editar `tipo_carga` en caliente, ver BLE aparecer sin reiniciar; forzar `falla_compresor` y verificar SC-006)

**Checkpoint**: US1 + US2 funcionan juntas — la demo de cadena de frío para medias reses es posible

---

## Phase 5: User Story 3 - Administrar la flota simulada sin reiniciar el proceso (Priority: P3)

**Goal**: Agregar/editar/desactivar camiones en `simulador.*` tiene efecto sin reiniciar el
proceso.

**Independent Test**: Con el simulador corriendo, agregar un segundo camión activo y verificar
que empieza a emitir dentro de un ciclo; marcar uno inactivo y verificar que deja de emitir sin
afectar a los demás.

### Implementation for User Story 3

- [X] T023 [US3] Ajustar `simulador-viajes/src/index.js` (T015) para releer `simulador.camion`/`simulador.viaje` completos al inicio de cada ciclo de 60s, en vez de cachear la flota en memoria entre ciclos (FR-004; research.md D-04)
- [X] T024 [US3] En `flotaRepository.js`, excluir camiones con `activo=false` de la lista que arma el loop, sin afectar el temporizador de los demás camiones activos
- [X] T025 [US3] Ejecutar validación manual: agregar un segundo camión con `INSERT` directo en `simulador.camion`/`ruta`/`viaje` mientras el proceso corre, y confirmar que emite dentro de un ciclo sin reinicio; marcarlo `activo=false` y confirmar que deja de emitir

**Checkpoint**: US1 + US2 + US3 — la flota se administra completamente en caliente

---

## Phase 6: User Story 4 - Reintentar cuando el receptor no confirma recepción (Priority: P4)

**Goal**: Ante falta de ACK, el camión simulado reintenta con un límite acotado en vez de perder
la trama en silencio.

**Independent Test**: Detener el receptor, dejar el simulador enviando, y verificar reintentos +
descarte logueado tras 3 intentos; al reanudar el receptor, el siguiente ciclo persiste con
normalidad (quickstart.md §6).

### Tests for User Story 4

- [X] T026 [P] [US4] `simulador-viajes/test/net/udpClient.test.js`: sin respuesta ACK reintenta hasta 3 veces con el mismo `msgNum`; recibe ACK en el segundo intento → no reintenta más; agota los 3 → loguea `warn` con camión/viaje/msgNum y no bloquea el ciclo siguiente (research.md D-03)

### Implementation for User Story 4

- [X] T027 [US4] Confirmar en `udpClient.js` (T009) que el log de descarte incluye `camion.id`, `viaje.id` y `msgNum` (Principio IX; ya cubierto por T009 — esta tarea es la verificación/ajuste fino tras T026)
- [X] T028 [US4] Ejecutar validación manual de `quickstart.md` §6 (detener receptor, ver reintentos y descarte en logs, reanudar receptor, confirmar persistencia normal en el ciclo siguiente)

**Checkpoint**: US1–US4 — el simulador también ejercita el camino de tolerancia a fallos

---

## Phase 7: User Story 5 - Distinguir dispositivos simulados de reales (Priority: P5)

**Goal**: Todo camión simulado tiene un `id` en el rango reservado `900001`–`900999`, imposible
de confundir con un IMEI real.

**Independent Test**: Consultar una lectura de un camión simulado y confirmar que su
`dispositivo_id` matchea `^900[0-9]{3}$`.

### Tests for User Story 5

- [X] T029 [P] [US5] `simulador-viajes/test/db/flotaRepository.test.js`: rechaza con error explícito un camión cuyo `id` no matchea `^900[0-9]{3}$` (data-model.md §1; research.md D-02)

### Implementation for User Story 5

- [X] T030 [US5] Agregar la validación de rango de `id` en `flotaRepository.js` (T007/T021) antes de incluir un camión en el ciclo de emisión, con log explícito si se rechaza (Principio IX)
- [X] T031 [US5] Ejecutar validación manual: `SELECT dispositivo_id FROM telemetria.lectura_telemetria WHERE dispositivo_id LIKE '900%'` devuelve las lecturas del camión 1 sin cruzar ninguna otra fuente de datos

**Checkpoint**: Todas las historias de usuario (US1–US5) funcionan de forma independiente y en conjunto

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Empaquetado y validación final de todo el stack

- [X] T032 [P] `simulador-viajes/Dockerfile`: imagen Node.js 22, multi-arch ARM64 (mismo patrón que `rinho-receptor/Dockerfile`)
- [X] T033 Agregar el servicio `simulador-viajes` a `deploy/compose.yaml` (sin puertos publicados — solo cliente saliente UDP/DB; variables de entorno de T003; `depends_on: timescaledb, rinho-receptor`)
- [X] T034 [P] Actualizar `deploy/README.md` con la sección de arranque del simulador (referenciando `quickstart.md`)
- [X] T035 Ejecutar `quickstart.md` completo de punta a punta (§1–§6) y confirmar SC-001 a SC-006 del spec

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias
- **Foundational (Phase 2)**: depende de Setup — bloquea todas las historias de usuario
- **US1 (Phase 3)**: depende de Foundational únicamente — es el MVP
- **US2 (Phase 4)**: depende de Foundational; reutiliza `frameBuilder.js` de US1 (T014) pero es
  incrementalmente independiente (un camión sin carga refrigerada sigue funcionando sin US2)
- **US3 (Phase 5)**: depende de Foundational y de `index.js`/`flotaRepository.js` de US1 (los
  ajusta, no los reemplaza)
- **US4 (Phase 6)**: depende de Foundational (`udpClient.js`, T009) — independiente de US2/US3
- **US5 (Phase 7)**: depende de Foundational y de `flotaRepository.js` de US1
- **Polish (Phase 8)**: depende de todas las historias que se quieran incluir en la demo

### Parallel Opportunities

- T003 en paralelo con T001–T002
- T005, T006, T008 en paralelo entre sí (archivos distintos, sin dependencias cruzadas)
- Dentro de US1: T010, T011 en paralelo; T012, T013 en paralelo
- US2 y US4 pueden implementarse en paralelo por personas distintas una vez completa Foundational
  (tocan archivos distintos: `sintesisBle.js`/`frameBuilder.js` vs. `udpClient.js`)
- T032, T034 en paralelo

---

## Parallel Example: User Story 1

```bash
# Tests de US1 en paralelo:
Task: "avanceRuta.test.js en simulador-viajes/test/domain/avanceRuta.test.js"
Task: "frameBuilder.test.js en simulador-viajes/test/protocol/frameBuilder.test.js"

# Implementación de dominio de US1 en paralelo:
Task: "avanceRuta.js en simulador-viajes/src/domain/avanceRuta.js"
Task: "sintesisCan.js en simulador-viajes/src/domain/sintesisCan.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Completar Phase 1: Setup
2. Completar Phase 2: Foundational (bloqueante)
3. Completar Phase 3: US1
4. **Validar** con `quickstart.md` §1–4 — el camión 1 ya emite telemetría real hacia el receptor
5. Demo posible en este punto (posición/CAN, sin BLE todavía)

### Incremental Delivery

1. Setup + Foundational → base lista
2. US1 → MVP demostrable (telemetría end-to-end)
3. US2 → demo de cadena de frío para medias reses
4. US3 → agregar/editar camiones sin reiniciar (útil apenas se quiera escalar de 1 a 5 camiones)
5. US4 → ejercitar tolerancia a fallos a demanda
6. US5 → salvaguarda de no confundir datos simulados con reales (conviene antes de correr contra
   staging compartido con otros)
7. Polish → empaquetado Docker + validación end-to-end completa

---

## Notes

- [P] = archivos distintos, sin dependencias entre sí
- Cada historia de usuario es completable y demostrable de forma independiente
- Commitear después de cada tarea o grupo lógico
- El camino crítico para el PoC es Setup → Foundational → US1 → US2 (medias reses es el caso de
  uso que motivó todo el simulador)

## Estado: implementación completa (2026-09-29)

Las 35 tareas están implementadas y validadas de punta a punta (unit tests + stack local real
con Docker). Desviaciones respecto a lo escrito arriba, todas funcionalmente equivalentes:

- **T015**: en vez de un `setInterval` independiente por camión, `index.js` usa un único
  `setInterval` de ciclo que procesa toda la flota con `Promise.all` — cada camión avanza de
  forma concurrente e independiente (la espera de reintentos de uno no bloquea a los demás,
  validado con 2 camiones simultáneos), pero es un solo temporizador de proceso en vez de N.
  Más simple de razonar y sin drift entre temporizadores; mismo efecto observable.
- **T014/T020**: no fue necesario "completar" `frameBuilder.js` en dos pasos — se implementó
  ya genérico (acepta GPS/CAN/BLE como datos de entrada) en la fase Foundational (T008), así
  que estas tareas quedaron satisfechas sin tocar el archivo de nuevo.
- **T004**: se aplicó manualmente contra el volumen Postgres local ya existente (no era un
  volumen nuevo) vía `docker cp` + `psql -f`, en vez de por `docker-entrypoint-initdb.d`
  automático — documentado también en `deploy/README.md` §2.7.2 para quien tenga el mismo caso.
  Se detectó además que ese volumen local no tenía aplicada la migración 003 (BLE) de la
  feature 008; se aplicó con `deploy/scripts/apply-migrations.sh` antes de poder validar US2.
- **T032/T033**: el build de `simulador-viajes` usa como contexto la raíz del repo (no la
  carpeta del proyecto) porque `frameBuilder.js` importa un archivo de `rinho-receptor/` por
  ruta relativa entre proyectos (research.md D-01) — la imagen preserva esa misma estructura
  de directorios. El servicio se agregó bajo `profiles: ["simulador"]` para que nunca arranque
  con un `docker compose up` normal de los demás servicios.

Validado en vivo (no solo unit tests): US1 end-to-end con odómetro acumulando desde 150200 km;
US2 con BLE normal y con falla de compresor subiendo sostenido; US3 agregando y desactivando un
segundo camión sin reiniciar; US4 deteniendo el receptor y viendo los 3 reintentos + descarte
logueado, con recuperación normal al reanudarlo; US5 confirmando que `dispositivo_id LIKE
'900%'` aísla las lecturas simuladas de las reales. El viaje de vuelta automático (FR-014)
también se disparó solo en una corrida real con una ruta corta de prueba.
