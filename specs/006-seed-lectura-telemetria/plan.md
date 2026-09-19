# Implementation Plan: Seed Local Telemetry Readings

**Branch**: `006-seed-lectura-telemetria` | **Date**: 2026-09-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-seed-lectura-telemetria/spec.md`

## Summary

Provide a developer-run, idempotent SQL seed script that inserts the two known real
`lectura_telemetria` readings for device `860693084873877` into a local TimescaleDB instance,
using the existing `rinho_receptor` database role (the only role with `INSERT` on that
hypertable, per Principle IV / `deploy/db/02-roles.sql`). The script lives outside
`deploy/db/` — which is auto-mounted as `docker-entrypoint-initdb.d` and therefore also runs
against the production VM — so it never executes automatically against production; a developer
invokes it explicitly (new `make seed-telemetry` target) against their own local stack.

## Technical Context

**Language/Version**: SQL (PostgreSQL 16 / TimescaleDB 2.17 dialect), invoked via `psql`
already present in the `timescaledb` container image; orchestrated with GNU Make (project
already uses a `Makefile` for all local dev commands).

**Primary Dependencies**: Existing `deploy/compose.yaml` stack (`timescaledb` service) and the
`rinho_receptor` role defined in `deploy/db/02-roles.sql` (`SELECT, INSERT` on
`telemetria.lectura_telemetria`, `USAGE` on the schema and its sequences). No new dependency.

**Storage**: TimescaleDB (PostgreSQL 16 + Timescale extension), table
`telemetria.lectura_telemetria` (hypertable partitioned on `momento_evento`, insert-only per
Principle IV, deduplicated by the existing `lectura_dedup_uq` unique index on
`(dispositivo_id, momento_evento, frame_hash)`).

**Testing**: No new automated test — this is a static, hand-verified data fixture (the two
rows are copied verbatim from already-observed real device output, not computed by new parsing
logic), so Principle VIII's testing-for-adaptation-logic requirement does not apply. Correctness
is validated manually via the `psql` query documented in `quickstart.md`.

**Target Platform**: Developer workstation running the project's local `docker compose` stack
(Linux/macOS/Windows via the existing Makefile's OS detection). Explicitly **not** run against
the Oracle Cloud production VM.

**Project Type**: Single project (existing Spring Boot service + Node receptor +
TimescaleDB stack) — this feature adds a dev-tooling script and Makefile target, no new module.

**Performance Goals**: N/A — a one-time, two-row insert.

**Constraints**:
- MUST NOT be wired into `docker-entrypoint-initdb.d` (i.e., MUST NOT live under `deploy/db/`),
  because that directory is mounted verbatim by `deploy/compose.yaml` and is the same compose
  file used to run the stack in production on the Oracle Cloud VM (`deploy/README.md` §2) —
  anything auto-executed there would also seed production data (violates spec FR-004).
- MUST use only the `rinho_receptor` role's existing privileges; MUST NOT grant new privileges
  to `agrolink_ingesta` (it stays `SELECT`-only per Principle IV) and MUST NOT alter
  `deploy/db/02-roles.sql`.
- MUST be re-runnable without error or duplication (FR-003) — achieved via
  `INSERT ... ON CONFLICT (dispositivo_id, momento_evento, frame_hash) DO NOTHING`, using the
  same natural key as the existing dedup index.
- MUST perform inserts only, never `UPDATE`/`DELETE` (FR-005, Principle IV).

**Scale/Scope**: 2 rows, 1 device id (`860693084873877`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Arquitectura Desacoplada por Capas de Adaptación | ✅ PASS | No new decoding/adaptation logic; rows are inserted already in the normalized domain shape the adaptation layer already produces. |
| II. Stack Tecnológico del Backend | ✅ PASS | No new backend feature/business logic is added (no Java code, no new Spring component); the addition is a dev-only SQL script + Makefile target, consistent with how integration test fixtures already insert data via raw SQL (`LecturaTelemetriaRepositoryIntegrationTest`). |
| III. Mensajería Solo por Necesidad Demostrada | ✅ PASS | No messaging involved. |
| IV. Inmutabilidad de los Datos Crudos de Telemetría | ✅ PASS | Script only performs `INSERT ... ON CONFLICT DO NOTHING`; never `UPDATE`/`DELETE`; matches the table's insert-only design and the existing `rinho_receptor` grants. |
| V. Minimización de Datos Personales Identificables | ✅ PASS | No personal/driver identifiers in the seeded rows. |
| VI. Seguridad como Línea Base | ✅ PASS | Credentials come from `deploy/.env` (already gitignored, never committed), reusing the existing `RINHO_RECEPTOR_DB_USER`/`PASSWORD` — no new secret, no hardcoded credential. |
| VII. Tolerancia a Fallos de Conectividad | ✅ PASS (N/A) | Not a runtime ingestion path; doesn't affect out-of-order handling. |
| VIII. Testing Mínimo Esperado | ✅ PASS (N/A) | No new parsing/adaptation code is introduced — the two rows are static, previously-observed values, not computed by this feature. |
| IX. Trazabilidad y No Reproceso Silencioso | ✅ PASS (N/A) | No new interpretation of ambiguous data; `estado_interpretacion`/`campos_faltantes` are copied as originally recorded. |

No violations — Complexity Tracking is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/006-seed-lectura-telemetria/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

No `contracts/` directory: this feature exposes no new API, CLI flag, or message schema to
other components — it is a local-only data fixture consumed exclusively through the read paths
`lectura_telemetria` already supports.

### Source Code (repository root)

```text
deploy/
├── compose.yaml            # unchanged — no new service/volume
├── db/                     # unchanged — 01-schema.sql, 02-roles.sql (auto-run in ALL envs, incl. prod)
└── seed/                   # NEW — never mounted into docker-entrypoint-initdb.d
    └── seed-demo-telemetry.sql

Makefile                    # add `seed-telemetry` target (new phony target only)
```

**Structure Decision**: Single existing project, no new module or service. The only additions
are a new `deploy/seed/` directory (kept out of `deploy/db/` on purpose, since the latter is
auto-executed by every environment that uses `deploy/compose.yaml`, including production) and
one new Makefile target that runs `psql` inside the running `timescaledb` container using the
already-configured `rinho_receptor` credentials.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

No violations recorded — table intentionally left empty.
