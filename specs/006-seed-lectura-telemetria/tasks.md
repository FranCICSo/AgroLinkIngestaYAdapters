---

description: "Task list for feature 006-seed-lectura-telemetria"
---

# Tasks: Seed Local Telemetry Readings

**Input**: Design documents from `/specs/006-seed-lectura-telemetria/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Not explicitly requested in spec.md, and Principle VIII (testing) does not apply —
this feature adds no parsing/adaptation logic, only a static data fixture (see plan.md
Technical Context → Testing). Verification instead happens via the manual `quickstart.md`
scenarios, captured below as tasks so they aren't skipped.

**Organization**: This feature has a single user story (US1, P1) in spec.md — no P2/P3 stories
exist, so there is one story phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1)
- Include exact file paths in descriptions

## Path Conventions

Single project (existing `AgroLinkIngestaAdaptacion` repo root). No `src/` changes — this
feature only touches `deploy/` and `Makefile` per plan.md's Project Structure.

---

## Phase 1: Setup

**Purpose**: Create the location for the seed script, kept structurally separate from
`deploy/db/` so it can never be auto-mounted into `docker-entrypoint-initdb.d` (research.md D-02).

- [X] T001 Create the `deploy/seed/` directory (e.g. via an empty `deploy/seed/.gitkeep` if the
      repo's tooling requires a placeholder to track an otherwise-empty directory in git).

**Checkpoint**: `deploy/seed/` exists and is untouched by `deploy/compose.yaml`'s
`docker-entrypoint-initdb.d` mount (that mount only covers `deploy/db/`).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The idempotent SQL fixture is the one artifact every part of US1 depends on
(Makefile target, manual verification, production-safety check all reference this file).

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Write `deploy/seed/seed-demo-telemetry.sql`: a single
      `INSERT INTO telemetria.lectura_telemetria (...) VALUES (...), (...) ON CONFLICT
      (dispositivo_id, momento_evento, frame_hash) DO NOTHING;` statement inserting exactly the
      two rows specified in `data-model.md` (device `860693084873877`, event times
      `2026-09-17T02:08:15.259Z` and `2026-09-10T03:10:30.907Z`, with all columns from the
      data-model.md table — including `momento_recepcion`, position, speed, heading, odometer +
      origin, fuel, satellites, `estado_interpretacion`, `campos_faltantes`, `datos_can`,
      `payload_crudo`, `frame_hash`, `msg_num`, `reporte_id`). Set the search path to
      `telemetria` at the top of the file (`SET search_path TO telemetria;`) so the statement
      does not depend on the connecting role's default search path.

**Checkpoint**: Running the SQL file directly with `psql` against a schema-initialized local
TimescaleDB (as the `rinho_receptor` role) inserts exactly 2 rows and exits 0.

---

## Phase 3: User Story 1 - Realistic telemetry is available in every local environment (Priority: P1) 🎯 MVP

**Goal**: A developer can get the two real `860693084873877` telemetry readings into their
local TimescaleDB with one command, without hand-writing SQL, and without any risk of that
command ever touching the production database.

**Independent Test**: Start `timescaledb` locally, run the new command, then query
`lectura_telemetria` for device `860693084873877` (as the read-only `agrolink_ingesta` role) and
see both readings.

### Implementation for User Story 1

- [X] T003 [US1] Add a `seed-telemetry` Makefile target in `Makefile` that: loads
      `deploy/.env`, runs
      `docker compose -f deploy/compose.yaml exec -T timescaledb psql "postgresql://$$RINHO_RECEPTOR_DB_USER:$$RINHO_RECEPTOR_DB_PASSWORD@localhost:5432/$$POSTGRES_DB" -f -` piping in `deploy/seed/seed-demo-telemetry.sql` (per research.md D-04), and add it to the
      `.PHONY` list alongside the existing targets. Add one line for it under the `help:` target's
      usage text, next to the other `make` commands.

### Verification for User Story 1

- [X] T004 [US1] Run `make timescaledb && make seed-telemetry`, then verify Acceptance Scenarios
      1–3 from `spec.md` using the read-only verification query in `quickstart.md` (connecting as
      `AGROLINK_INGESTA_DB_USER`): confirm both rows exist with the exact field values listed in
      `data-model.md`, ordered by `momento_evento`.
- [X] T005 [US1] Verify idempotency (spec.md Edge Cases / FR-003): run `make seed-telemetry` a
      second time against the same database and confirm the row count for device
      `860693084873877` stays at 2 and the command exits successfully (no error, no duplicates).
- [X] T006 [P] [US1] Verify production-safety (spec.md Edge Cases / FR-004): confirm
      `deploy/compose.yaml` contains no reference to `seed-demo-telemetry.sql` or `deploy/seed/`,
      and that `deploy/db/` still only contains `01-schema.sql` and `02-roles.sql` — i.e., the
      seed script is structurally unreachable from `docker-entrypoint-initdb.d` and therefore
      never runs against the Oracle Cloud production VM.

**Checkpoint**: User Story 1 is fully functional — `make seed-telemetry` is documented,
idempotent, and provably isolated from production.

---

## Phase 4: Polish & Cross-Cutting Concerns

- [X] T007 [P] Add a short note to `deploy/README.md` pointing local developers at
      `make seed-telemetry` (e.g. near the existing "Puesta en marcha" section), so the command
      is discoverable without reading the Makefile.
- [X] T008 Run the full `specs/006-seed-lectura-telemetria/quickstart.md` script end to end one
      more time after T007, to confirm the documentation change didn't drift from the actual
      commands.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup (needs `deploy/seed/` to exist) — BLOCKS User
  Story 1.
- **User Story 1 (Phase 3)**: Depends on Foundational phase completion.
- **Polish (Phase 4)**: Depends on User Story 1 being complete.

### Within User Story 1

- T003 (Makefile target) depends on T002 (the SQL file it invokes must already exist).
- T004 (acceptance verification) depends on T003.
- T005 (idempotency) depends on T004 (needs the first successful seed already applied).
- T006 (production-safety grep) has no runtime dependency on the others — it only inspects
  static files — so it may run any time after T002, in parallel with T003–T005.

### Parallel Opportunities

- T006 can run in parallel with T003/T004/T005 (different files, read-only inspection).
- T007 (README) can run in parallel with T004–T006 (different file, no shared state).

---

## Parallel Example: User Story 1

```bash
# Once T002 (SQL file) is done, these can proceed concurrently:
Task: "Verify deploy/compose.yaml and deploy/db/ contain no reference to the seed script (T006)"
Task: "Add seed-telemetry Makefile target (T003), then run acceptance + idempotency checks (T004, T005)"
```

---

## Implementation Strategy

### MVP First (and only) — User Story 1

1. Complete Phase 1: Setup (T001).
2. Complete Phase 2: Foundational (T002) — this is the entire data fixture.
3. Complete Phase 3: User Story 1 (T003–T006).
4. **STOP and VALIDATE**: `quickstart.md` end to end.
5. Complete Phase 4: Polish (T007–T008).

There is no incremental multi-story delivery for this feature — spec.md defines exactly one
user story, so the MVP *is* the complete feature.

---

## Notes

- [P] tasks = different files or read-only checks, no shared state.
- This feature intentionally has no `[US2]`/`[US3]` tasks — spec.md has a single P1 story.
- Commit after Phase 2 (the SQL fixture) and after Phase 3 (Makefile target + verified).
- Do not add a Spring/Java seeder component — research.md D-01 explains why that path is
  blocked by the `agrolink_ingesta` role's read-only grant (Principle IV) and would need to be
  re-litigated at the constitution level, not worked around here.
