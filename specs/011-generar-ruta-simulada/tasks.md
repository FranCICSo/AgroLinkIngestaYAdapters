# Tasks: Generación de Rutas Simuladas desde Origen/Destino

**Input**: Design documents from `/specs/011-generar-ruta-simulada/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md,
data-model.md, contracts/, quickstart.md

**Tests**: Incluidas — el Principio VIII de la constitución exige cobertura mínima para toda
lógica de adaptación de datos externos (acá: la respuesta de OSRM), y `plan.md` § Technical
Context ya especifica los 3 casos mínimos.

**Organization**: Tareas agrupadas por historia de usuario (spec.md), para que cada una sea
implementable y testeable de forma independiente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede ejecutarse en paralelo (archivos distintos, sin dependencias)
- **[Story]**: A qué historia de usuario pertenece (US1, US2)

## Path Conventions

Proyecto Node.js existente `simulador-viajes/` (feature 009), extendido in-place — ver
`plan.md` § Project Structure. Todas las rutas son relativas a la raíz del repo.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Preparar la restricción de unicidad en `simulador.ruta` (data-model.md §1,
research.md D-03) de la que depende la persistencia de ambas historias.

- [X] T001 [P] Crear migración idempotente `deploy/migrations/005_add_ruta_nombre_unique.sql`
      (`ALTER TABLE simulador.ruta ADD CONSTRAINT ruta_nombre_unique UNIQUE (nombre);`, mismo
      patrón que 001-004)
- [X] T002 [P] Actualizar `deploy/db/03-schema-simulador.sql`: columna `nombre` de
      `simulador.ruta` pasa a `VARCHAR(100) UNIQUE NOT NULL` (para volúmenes nuevos)

**Checkpoint**: Restricción de unicidad lista en ambos caminos de aplicación de schema (volumen
nuevo y migración sobre uno existente).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Módulos de acceso a I/O externo (OSRM, Postgres) que el servicio de generación de
ambas historias va a reutilizar tal cual.

**⚠️ CRITICAL**: Ninguna historia de usuario puede empezar hasta completar esta fase.

- [X] T003 [P] Implementar cliente OSRM en `simulador-viajes/src/net/osrmClient.js`: arma la URL
      `GET /route/v1/driving/{lon1},{lat1};...;{lonN},{latN}?overview=full&geometries=geojson`
      (research.md D-01), aplica un timeout de 5000 ms, y normaliza en un único resultado de
      fallo los tres casos de research.md D-06 (timeout, HTTP no-200, body.code distinto de Ok)
- [X] T004 [P] Implementar `simulador-viajes/src/db/rutaRepository.js`: `INSERT INTO
      simulador.ruta (nombre, puntos, paradas) VALUES (...)`, capturando el error Postgres
      `23505 unique_violation` y devolviendo `{ ok: false, motivo: 'nombre_duplicado' }` en vez
      de propagar el error crudo (data-model.md §1, research.md D-03)

**Checkpoint**: Fundamento listo — las historias de usuario pueden empezar.

---

## Phase 3: User Story 1 - Generar una ruta a partir de origen y destino (Priority: P1) 🎯 MVP

**Goal**: Un endpoint HTTP interno que, dado origen/destino (y opcionalmente paradas), traza la
ruta sobre calles reales vía OSRM y persiste la fila en `simulador.ruta` en una única llamada —
sin interpolación, sin paso de confirmación separado (spec.md US1, FR-001 a FR-004, FR-009,
FR-010, FR-011).

**Independent Test**: Invocar `POST /rutas` con un origen/destino/nombre válidos y verificar que
la respuesta es `201` con una fila nueva persistida en `simulador.ruta` cuyo `puntos` no está
vacío y empieza/termina en las coordenadas pedidas (contracts/rutas-http-api.md).

### Tests for User Story 1 ⚠️

- [X] T005 [P] [US1] Unit tests para `routeGenerationService` en
      `simulador-viajes/test/services/routeGenerationService.test.js`: (a) origen/destino
      válidos con OSRM devolviendo una ruta completa, (b) distancia trivial entre origen y
      destino rechazada **sin** llamar a OSRM (research.md D-02), (c) OSRM responde sin ruta o
      no responde dentro del timeout (research.md D-06) — ver plan.md § Technical Context >
      Testing
- [X] T006 [P] [US1] Unit tests para `rutaRepository` en
      `simulador-viajes/test/db/rutaRepository.test.js`: inserta una ruta nueva correctamente;
      un segundo `INSERT` con el mismo `nombre` devuelve `nombre_duplicado` sin dejar una fila
      parcial

### Implementation for User Story 1

- [X] T007 [US1] Implementar `simulador-viajes/src/services/routeGenerationService.js`: valida
      la entrada (`nombre` no vacío; distancia Haversine origen↔destino ≥ 50 m, research.md
      D-02; cada parada con `lat`/`lon` numéricos y `duracionMin` > 0 — data-model.md §2), arma
      la lista de coordenadas (origen + paradas en orden + destino) y llama a `osrmClient`
      (T003), mapea `geometry.coordinates` a `puntos` (`{lat, lon}`) y las paradas a `{indice,
      duracion_min}` sobre ese array (research.md D-01/D-07), persiste con `rutaRepository`
      (T004) y devuelve el `GenerarRutaResultado` de data-model.md §3 (depende de T003, T004)
- [X] T008 [US1] Implementar `simulador-viajes/src/http/rutaHttpServer.js` con `node:http`:
      `POST /rutas` parsea el body JSON, llama a `routeGenerationService` (T007), y mapea el
      resultado a `201/400/409/422` exactamente como documenta
      `contracts/rutas-http-api.md` (depende de T007)
- [X] T009 [US1] Agregar `PUERTO_HTTP` (opcional) a `simulador-viajes/src/config.js` y arrancar
      `rutaHttpServer` desde `simulador-viajes/src/index.js` sólo si esa variable está definida;
      confirmar que `deploy/compose.yaml` **no** publica ese puerto al host (research.md D-04,
      FR-006) — depende de T008
- [X] T010 [US1] Loguear, dentro de `routeGenerationService.js`, cada rechazo (validación,
      `nombre_duplicado`, `trazado_no_disponible`) con nombre de ruta, coordenadas y motivo
      concreto antes de devolver el resultado de fallo (Principio IX) — depende de T007

**Checkpoint**: User Story 1 es funcional y testeable de forma independiente vía
`POST /rutas`.

---

## Phase 4: User Story 2 - Reemplazar el flujo manual por un comando repetible (Priority: P2)

**Goal**: Un comando CLI (`npm run crear-ruta --`) que produce el mismo resultado persistido que
el endpoint HTTP, para uso directo del equipo sin pasar por HTTP (spec.md US2, FR-007).

**Independent Test**: Ejecutar `npm run crear-ruta -- --nombre ... --origenLat ... --destinoLat
...` y verificar que queda persistida una fila nueva en `simulador.ruta` equivalente a la que
produce `POST /rutas` con los mismos parámetros (contracts/crear-ruta-cli.md).

### Implementation for User Story 2

- [X] T011 [US2] Implementar `simulador-viajes/src/cli/crearRuta.js`: parsea `--nombre`,
      `--origenLat`, `--origenLon`, `--destinoLat`, `--destinoLon` y `--paradas` (JSON opcional)
      desde `process.argv` (mismo estilo manual que ya usa `config.js`, sin dependencia nueva),
      llama a `routeGenerationService` (T007) y mapea el resultado a los exit codes/mensajes de
      `contracts/crear-ruta-cli.md`
- [X] T012 [US2] Agregar el script `"crear-ruta": "node src/cli/crearRuta.js"` a
      `simulador-viajes/package.json` (depende de T011)

**Checkpoint**: User Stories 1 y 2 funcionan ambas de forma independiente, sin lógica duplicada
entre el endpoint HTTP y el CLI (research.md D-05).

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Validación de punta a punta y documentación.

- [X] T013 [P] Actualizar `docs/handoff/simulador-viajes.md` con una nota breve sobre cómo
      generar una ruta nueva (endpoint y comando), reemplazando la mención a edición manual de
      `simulador.ruta` si existiera
- [X] T014 Ejecutar de punta a punta `quickstart.md` (pasos 1-6: levantar OSRM, aplicar la
      migración, correr tests, generar por CLI y por HTTP, y verificar los rechazos de nombre
      duplicado y distancia trivial)

---

## Phase 6: OSRM self-hosted en el proceso de deploy (FR-012, research.md D-08)

**Purpose**: Tras la Clarification de que operar OSRM es parte del alcance de esta feature
(proyecto de tesis/PoC), agregarlo como un servicio más del proceso de deploy reproducible del
repo, en vez de dejarlo como pasos manuales documentados aparte.

- [X] T015 [P] Agregar el servicio `osrm` a `deploy/compose.yaml` (imagen
      `osrm/osrm-backend`, `profile: ["simulador"]`, sin `ports:`, `OSRM_BASE_URL` de
      `simulador-viajes` apunta por default a `http://osrm:5000`)
- [X] T016 [P] Agregar el target `osrm` al `Makefile` (descarga el extracto de `OSRM_REGION`
      vía Geofabrik, lo preprocesa con `osrm-extract`/`osrm-partition`/`osrm-customize` si
      hace falta, y levanta el contenedor — idempotente); `simulador` pasa a depender de él
- [X] T017 Actualizar `specs/011-generar-ruta-simulada/quickstart.md` §1,
      `deploy/README.md` §2.7.3 y `deploy/.env.example` para reflejar `make osrm` en vez de
      los comandos `docker run` manuales

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Sin dependencias — puede arrancar de inmediato.
- **Foundational (Phase 2)**: Depende de Setup — BLOQUEA ambas historias.
- **User Story 1 (Phase 3)**: Depende de Foundational (T003, T004).
- **User Story 2 (Phase 4)**: Depende de User Story 1 completa (T007: `crearRuta.js` llama al
      mismo `routeGenerationService` ya implementado) — a diferencia del caso general, acá la
      dependencia entre historias es intencional (research.md D-05: un único servicio detrás de
      dos entry points).
- **Polish (Phase 5)**: Depende de las historias que se quieran incluir (como mínimo, US1).

### Within Each User Story

- US1: tests (T005, T006) pueden escribirse en paralelo con T003/T004 ya implementados; el
  servicio (T007) antes del endpoint (T008); config/arranque (T009) y logging (T010) después del
  servicio.
- US2: CLI (T011) antes de exponer el script de npm (T012).

### Parallel Opportunities

- T001 y T002 (Setup) — archivos distintos, sin dependencia entre sí.
- T003 y T004 (Foundational) — archivos distintos, sin dependencia entre sí.
- T005 y T006 (tests de US1) — archivos distintos.
- T013 (Polish, documentación) puede hacerse en paralelo con T014.

---

## Parallel Example: Foundational + User Story 1

```bash
# Foundational, en paralelo:
Task: "Implementar cliente OSRM en simulador-viajes/src/net/osrmClient.js"
Task: "Implementar rutaRepository en simulador-viajes/src/db/rutaRepository.js"

# Tests de User Story 1, en paralelo (tras Foundational):
Task: "Unit tests de routeGenerationService en simulador-viajes/test/services/routeGenerationService.test.js"
Task: "Unit tests de rutaRepository en simulador-viajes/test/db/rutaRepository.test.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Completar Phase 1: Setup (migración + schema).
2. Completar Phase 2: Foundational (osrmClient, rutaRepository) — bloquea todo lo demás.
3. Completar Phase 3: User Story 1 (`routeGenerationService` + `POST /rutas`).
4. **Parar y validar**: generar una ruta vía `POST /rutas` contra un OSRM local y confirmar la
   fila persistida (quickstart.md §5).
5. Esto ya cumple el criterio de aceptación completo de la spec (generar y persistir sin SQL a
   mano) — es un MVP demostrable.

### Incremental Delivery

1. Setup + Foundational → base lista.
2. User Story 1 → validar independientemente → **MVP**.
3. User Story 2 (CLI) → validar que produce el mismo resultado que el endpoint HTTP.
4. Polish → documentación + validación de punta a punta con `quickstart.md`.

---

## Notes

- `[P]` = archivos distintos, sin dependencias entre esas tareas.
- `[Story]` mapea cada tarea a su historia de usuario para trazabilidad.
- User Story 2 depende deliberadamente de que User Story 1 ya exista (mismo servicio
  compartido, research.md D-05) — es la única excepción a "historias independientes" en esta
  feature, y está documentada como tal.
- Ningún camino de error (validación, nombre duplicado, fallo de OSRM) debe dejar una fila
  parcial en `simulador.ruta` — verificar explícitamente en T005/T006.
