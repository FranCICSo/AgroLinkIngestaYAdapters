# Phase 0 Research: Seed Local Telemetry Readings

No `[NEEDS CLARIFICATION]` markers remained from the spec, but the feature description asked
for "a seeder layer as it is done in AgroLinkBackend," and this project's deployment model and
DB role split differ enough from AgroLinkBackend's that a direct port of that pattern would be
unsafe. This document records the resulting design decisions.

## D-01: Why not a Spring `ApplicationRunner` seeder like AgroLinkBackend's `LocalDataSeeder`

**Decision**: Do not add a Spring component to `agrolink-ingesta` for seeding.

**Rationale**: AgroLinkBackend's `LocalDataSeeder` works because that service's own DB role can
write. Here, `deploy/db/02-roles.sql` grants `agrolink_ingesta` (the role `agrolink-ingesta`
connects as) `SELECT` only on `telemetria.lectura_telemetria` — by design, per Principle IV,
so the reporting/status service can never write telemetry. Only `rinho_receptor` (the Node UDP
receptor's role) has `INSERT`. A Spring seeder running inside `agrolink-ingesta` would fail with
a permissions error, or would require weakening the role split that Principle IV depends on —
not an acceptable trade for a dev convenience. This is also why the project's own integration
test (`LecturaTelemetriaRepositoryIntegrationTest`) inserts its fixtures via a raw JDBC
connection using `RINHO_RECEPTOR_DB_USER`/`PASSWORD`, not through the app's own repository.

**Alternatives considered**:
- Temporarily granting `INSERT` to `agrolink_ingesta` in local environments only: rejected —
  would require environment-conditional grants in `02-roles.sql`, adding permanent complexity
  to a security-relevant file for a one-off dev convenience (Principle III: no infra/complexity
  without demonstrated need).
- A Spring component in the `rinho-receptor` Node service instead: rejected — that service has
  no concept of "local-only bootstrap," is stateless UDP-frame-in/DB-row-out, and adding
  environment-branching logic there mixes a dev concern into the production ingestion path.

## D-02: Why not an entry in `deploy/db/` (docker-entrypoint-initdb.d)

**Decision**: The seed script lives in a new `deploy/seed/` directory, not `deploy/db/`.

**Rationale**: `deploy/compose.yaml` mounts `./db:/docker-entrypoint-initdb.d:ro` for the
`timescaledb` service, and this is the *same* `compose.yaml` + `.env` pattern used to run the
stack on the Oracle Cloud production VM (`deploy/README.md` §2) — there is no separate
"local" vs. "prod" compose file or Spring profile in this project (confirmed: no
`application-local.yaml` exists, only `src/main/resources/application.yaml`). Anything dropped
into `deploy/db/` runs automatically, once, on every fresh volume in every environment,
including production. That would directly violate spec FR-004 ("seeding MUST have no effect on
... production"). Keeping the seed script in its own directory, invoked only by an explicit
Makefile target a developer runs by hand, makes production-safety structural rather than a
matter of remembering not to run something.

**Alternatives considered**:
- An environment-variable gate (e.g., only insert `if $SEED_LOCAL_DATA=true`) inside a script
  still placed under `deploy/db/`: rejected — still auto-executes by default on the VM unless
  the operator remembers to leave the variable unset in `deploy/.env`; a silent default that
  can accidentally seed production data is worse than requiring an explicit action.

## D-03: Idempotency mechanism

**Decision**: `INSERT INTO telemetria.lectura_telemetria (...) VALUES (...), (...) ON CONFLICT
(dispositivo_id, momento_evento, frame_hash) DO NOTHING;`

**Rationale**: This is exactly the natural key the schema already enforces via
`lectura_dedup_uq` (`deploy/db/02-roles.sql`, decision D-07 of feature 001). Re-running the
script is then a true no-op on the second and later runs — no duplicate rows, no error — which
directly satisfies FR-003 and the immutability rule in FR-005 (an `ON CONFLICT ... DO NOTHING`
never touches an existing row, unlike `DO UPDATE`).

## D-04: Invocation mechanism

**Decision**: A new `make seed-telemetry` target that runs
`docker compose exec -T timescaledb psql "postgresql://$$RINHO_RECEPTOR_DB_USER:$$RINHO_RECEPTOR_DB_PASSWORD@localhost:5432/$$POSTGRES_DB?options=--search_path=telemetria" -f -` piping in `deploy/seed/seed-demo-telemetry.sql`, reusing the same `deploy/.env` variables the `receptor` service already uses.

**Rationale**: Consistent with the project's existing Makefile conventions (`make dev`,
`make timescaledb`, `make db-reset` already wrap `docker compose` calls with env loaded from
`deploy/.env`); requires no new tool (`psql` already ships in the `timescale/timescaledb` image
used by the `timescaledb` service); requires the stack to already be up (`timescaledb` healthy),
matching how every other Makefile target in this project behaves.

**Alternatives considered**:
- A standalone Java/JDBC CLI mirroring the integration test's `insertarFixture`: rejected as
  unnecessary complexity (Principle III) — a two-row insert doesn't need a JVM invocation when
  plain SQL run through `psql` (already available) does the same job in one file.
