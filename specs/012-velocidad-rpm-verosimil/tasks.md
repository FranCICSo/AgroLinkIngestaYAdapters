---

description: "Task list for feature implementation"
---

# Tasks: Velocidad y RPM verosímiles en el simulador de viajes

**Input**: Design documents from `/specs/012-velocidad-rpm-verosimil/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md (sin `contracts/` — esta feature no agrega ni cambia interfaces externas, ver plan.md)

**Tests**: Incluidos — el Principio VIII de la constitución exige tests mínimos para lógica de adaptación de datos externos, y esta feature introduce justamente eso (densificación del trazado de OSRM/seed).

**Organization**: Tareas agrupadas por user story (US1 = P1 velocidad, US2 = P2 RPM) para poder implementar y validar cada una por separado.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede correr en paralelo (archivos distintos, sin dependencias entre sí)
- **[Story]**: US1 o US2, según `spec.md`
- Todas las rutas de archivo son relativas a la raíz del repo salvo que se indique lo contrario

## Path Conventions

Proyecto único existente: `simulador-viajes/src/`, `simulador-viajes/test/` (Node.js 22, ESM). Un
script de regeneración de seed vive en `simulador-viajes/scripts/`. Los `.sql` de seed están en
`deploy/seed/`.

---

## Phase 1: Setup

**Purpose**: No hay inicialización de proyecto nueva — `simulador-viajes` ya existe con sus
dependencias, test runner y entry points. Única tarea: establecer una línea base antes de tocar
código.

- [X] T001 Correr `cd simulador-viajes && npm test` y registrar el resultado actual (todos los
      tests existentes deben seguir pasando después de cada fase de esta feature — ninguna tarea
      posterior debe romperlos) — **Baseline: 30/30 pass**

---

## Phase 2: Foundational

**Purpose**: Prerrequisitos bloqueantes compartidos por ambas historias de usuario.

**Nota**: No hay tareas foundational para esta feature. US1 (velocidad, densificación del
trazado) y US2 (RPM, constantes de `sintesisCan.js`) son completamente independientes entre sí —
ninguna requiere un cambio de esquema, dependencia nueva, ni infraestructura compartida antes de
empezar (ver plan.md § Technical Context, Constraints). Se puede empezar directamente por la
Fase 3.

**Checkpoint**: Nada que esperar — ambas historias pueden arrancar en paralelo.

---

## Phase 3: User Story 1 - Velocidad verosímil durante todo el viaje simulado (Priority: P1) 🎯 MVP

**Goal**: Ninguna trama simulada reporta una velocidad por encima del máximo verosímil de su
tipo de vía (60 km/h urbano, 80 km/h ruta), para rutas nuevas generadas vía OSRM y para los
camiones ya sembrados (`camion-1`, `camion-2`).

**Independent Test**: Generar una ruta con un tramo urbano y uno de ruta/autopista (quickstart.md
§2), ejecutar el simulador de punta a punta (quickstart.md §3), y verificar que ninguna trama
excede el máximo verosímil de su tramo. Repetir contra los camiones de seed (quickstart.md §4).

### Tests for User Story 1 ⚠️

> Escribir estos tests primero; deben fallar antes de la implementación.

- [X] T002 [P] [US1] Tests del resampler en `simulador-viajes/test/services/densificacionRutaService.test.js`: (a) trazado sin saltos grandes queda sin cambios (no-op), (b) un salto mayor a lo recorrible en un ciclo a la velocidad objetivo se densifica con los puntos intermedios esperados (verificar que ningún par consecutivo del resultado supere el umbral), (c) dos puntos idénticos (distancia 0) no agrega puntos ni lanza error — ver research.md D-04
- [X] T003 [P] [US1] Ampliar `simulador-viajes/test/services/routeGenerationService.test.js`: el fixture `respuestaOsrmOk()` debe incluir un objeto `annotation` (`speed`) por leg (research.md D-02); agregar una aserción de que, en la ruta persistida, ningún par de puntos consecutivos en `puntos` supera la distancia máxima recorrible a su velocidad objetivo acotada (FR-002), y que `paradas[].indice` sigue apuntando al punto más cercano correcto tras la densificación

### Implementation for User Story 1

- [X] T004 [P] [US1] Crear `simulador-viajes/src/domain/limitesVelocidad.js` exportando `VELOCIDAD_MAX_URBANA_KMH = 60` y `VELOCIDAD_MAX_RUTA_KMH = 80` (research.md D-06/FR-002), para que el resampler y cualquier otro consumidor futuro no dupliquen estos valores
- [X] T005 [US1] Implementar `simulador-viajes/src/services/densificacionRutaService.js` con `densificarTrazado(puntosOriginales, { cicloSegundos, velocidadPorSegmentoKmh })` → `puntosDensificados`, aplicando el algoritmo de research.md D-04 (interpolación lineal lat/lon, `n = ceil(d / distanciaMaxima) - 1` puntos intermedios por segmento) hasta que T002 pase
- [X] T006 [US1] Modificar `simulador-viajes/src/net/osrmClient.js` para pedir `annotations=speed` además de `overview=full&geometries=geojson` (ver nota más abajo: se simplificó de `speed,distance,duration` a solo `speed`, único valor que se consume), y devolver junto a `puntos` una función `velocidadPorSegmentoKmh(indice)` derivada de `routes[0].legs[].annotation.speed` (convertida de m/s a km/h — research.md D-02 riesgo de unidades, pendiente de verificar contra un servidor OSRM real)
- [X] T007 [US1] Modificar `simulador-viajes/src/services/routeGenerationService.js`: tras obtener `resultadoOsrm.puntos`/`velocidadPorSegmentoKmh`, llamar a `densificarTrazado()` **antes** de calcular `paradasConIndice` con `indiceMasCercano()`, acotando cada segmento a `min(valor_osrm, VELOCIDAD_MAX_RUTA_KMH)` (research.md D-03) (depende de T005, T006)
- [X] T008 [US1] Confirmar con T003 que la ruta persistida en `simulador.ruta` cumple el invariante de data-model.md §1 (depende de T007) — **34/34 tests pasan, sin regresiones**
- [X] T009 [US1] Crear script de un solo uso `simulador-viajes/scripts/densificar-seed.js`: lee los arreglos `puntos`/`paradas` de `deploy/seed/simulador-camion-1.sql` y `-2.sql`, corre `densificarTrazado()` con `velocidadPorSegmentoKmh` constante en `VELOCIDAD_MAX_URBANA_KMH` (research.md D-05 — sin anotación OSRM disponible para datos ya capturados/hechos a mano), recalcula los índices de `paradas` con el mismo criterio de "punto más cercano" que `routeGenerationService.js`, e imprime los nuevos arreglos listos para pegar en el `.sql` (depende de T005) — **camion-1: 88→98 puntos, máx. sub-tramo 0.98 km; camion-2: 9→27 puntos, máx. sub-tramo 1.00 km (umbral 1 km)**
- [X] T010 [US1] Correr `simulador-viajes/scripts/densificar-seed.js` y regenerar `deploy/seed/simulador-camion-1.sql` y `deploy/seed/simulador-camion-2.sql` con los arreglos `puntos`/`paradas` ya densificados, preservando el resto de cada archivo (nombre, idempotencia `ON CONFLICT`/`WHERE NOT EXISTS`) (depende de T009) — **JSON validado, diff mínimo confirmado**

**Checkpoint**: User Story 1 queda completa y verificable de forma independiente (quickstart.md §2–4) sin tocar nada de User Story 2.

---

## Phase 4: User Story 2 - RPM coherente con la velocidad y el contexto (Priority: P2)

**Goal**: El RPM reportado cae en un rango verosímil (ralentí 600–800, crucero en ruta
1200–1800) y deja de alcanzar el techo configurado (2200) salvo en el extremo de 80 km/h.

**Independent Test**: Llamar a `sintetizarCan()` directamente (sin depender de User Story 1) con
`velocidadKmh` en 0, en un valor de crucero urbano y en 80 km/h, y verificar los rangos de RPM
resultantes (quickstart.md §1, fila `sintesisCan.test.js`).

### Tests for User Story 2 ⚠️

> Escribir estos tests primero; deben fallar antes de la implementación.

- [X] T011 [US2] Ampliar `simulador-viajes/test/domain/sintesisCan.test.js`: ajustar la aserción de ralentí existente a 600–800 (hoy `>=650 && <=850`); agregar un caso de velocidad de crucero en ruta (80 km/h) que verifique `rpm` dentro de 1200–1800; agregar un caso que confirme que `rpm` nunca alcanza `RPM_MAX` (2200) para ninguna velocidad dentro del rango verosímil (0–80 km/h) — research.md D-07, data-model.md §4 — **confirmado en rojo: a 60 km/h la fórmula vieja ya daba 2200**

### Implementation for User Story 2

- [X] T012 [US2] Ajustar las constantes de `simulador-viajes/src/domain/sintesisCan.js` (`RPM_RALENTI_BASE=700`, `RPM_POR_KMH=10`, sin el offset `-50`; `RPM_MAX` sin cambios) para que el mapeo velocidad→RPM cumpla data-model.md §4 (ralentí 600–800, 1500 RPM a 80 km/h, dentro de 1200–1800) — **6/6 tests de `sintesisCan.test.js` pasan; 36/36 en toda la suite**

**Checkpoint**: User Stories 1 y 2 funcionan de forma independiente entre sí; juntas, ningún viaje simulado produce velocidad ni RPM inverosímiles (SC-001 a SC-003).

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Validación final y documentación — no agrega comportamiento nuevo.

- [ ] T013 Correr `simulador-viajes/quickstart.md` §5 (revisión cualitativa, SC-004): graficar velocidad vs. tiempo de un viaje completo ciudad → ruta → ciudad y confirmar ausencia de picos inexplicables — **pendiente: requiere levantar el stack completo (`make dev`/`make simulador`), que descarga un extracto OSM de cientos de MB y tarda varios minutos; no se corrió de forma autónoma, ver nota de completion report**
- [X] T014 [P] Actualizar `docs/handoff/simulador-viajes.md` con una nota sobre esta corrección (densificación del trazado + rangos de RPM) y el link a `specs/012-velocidad-rpm-verosimil/`
- [X] T015 Correr `cd simulador-viajes && npm test` una última vez y confirmar que todos los tests (los de T001 más los nuevos/ampliados de US1 y US2) pasan juntos — **36/36 pass**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Sin dependencias — arranca de inmediato
- **Foundational (Phase 2)**: Vacía — no bloquea nada
- **User Story 1 (Phase 3)**: Depende solo de Phase 1 (T001). No depende de US2.
- **User Story 2 (Phase 4)**: Depende solo de Phase 1 (T001). No depende de US1 — puede
  implementarse y validarse en paralelo con la Fase 3 por un desarrollador distinto.
- **Polish (Phase 5)**: Depende de que ambas historias deseadas estén completas (T013/T015
  ejercitan el viaje simulado completo, que necesita US1 y US2 juntas para dar SC-001–SC-003)

### Dentro de User Story 1

T002/T003 (tests) antes que T005 (deben fallar primero) → T004 puede ir en paralelo con T002/T003
→ T005 depende de T004 → T006 es independiente de T004/T005 (archivo distinto) pero T007 depende
de ambos (T005, T006) → T008 depende de T007 → T009 depende de T005 → T010 depende de T009.

### Dentro de User Story 2

T011 (test) antes que T012 (debe fallar primero).

### Parallel Opportunities

- T002, T003 y T004 pueden correr en paralelo (archivos distintos, sin dependencias entre sí)
- Toda la Fase 3 (US1) puede correr en paralelo con toda la Fase 4 (US2) — son historias
  independientes trabajadas por personas distintas
- T014 (documentación) puede correr en paralelo con T013/T015

---

## Parallel Example: User Story 1

```bash
# Lanzar juntos los tests + la constante compartida de User Story 1:
Task: "Tests del resampler en test/services/densificacionRutaService.test.js"
Task: "Ampliar routeGenerationService.test.js con fixture de annotation"
Task: "Crear src/domain/limitesVelocidad.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Completar Fase 1: Setup (T001)
2. Completar Fase 3: User Story 1 (T002–T010)
3. **Parar y validar**: quickstart.md §2–4 — rutas nuevas y camiones de seed ya sin picos de
   velocidad (SC-001, SC-002)
4. Esto ya es demostrable: aunque el RPM todavía escale mal en el extremo superior (US2
   pendiente), el problema más visible del reporte original ("150 km/h en la ciudad") queda
   resuelto

### Incremental Delivery

1. Setup → Fase 3 (US1) → validar → demo (MVP: velocidad verosímil)
2. Fase 4 (US2) → validar → demo (RPM también verosímil)
3. Fase 5 (Polish) → validación cualitativa final y documentación

### Parallel Team Strategy

Con dos personas: una completa US1 (T002–T010), la otra US2 (T011–T012) en simultáneo tras
T001 — se integran naturalmente porque no comparten archivos ni datos.

---

## Notes

- [P] = archivos distintos, sin dependencias entre sí
- [US1]/[US2] mapean cada tarea a su historia de usuario en `spec.md`
- Verificar que los tests fallan antes de implementar (T002/T003 antes de T005–T007; T011 antes
  de T012)
- Commitear después de cada tarea o grupo lógico
- No existe `contracts/` para esta feature (plan.md): ningún task toca el CLI/HTTP de la feature
  011, que quedan con la misma firma de entrada/salida
