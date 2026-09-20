# Phase 1 Data Model: Automated Build, Publish & Deploy Pipeline

This feature's "entities" are operational/CI artifacts, not JPA domain entities — no
changes to `telemetria.lectura_telemetria` or any existing application table.

## Schema Migration (new persisted table: `public.schema_migrations`)

Tracks which ordered DDL scripts under `deploy/migrations/` have already been applied to
the production database, so `apply-migrations.sh` (D-04) can apply each one at most once.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `version` | `text` | PRIMARY KEY | The migration filename, e.g. `001_add_x_index.sql`; sorted lexically to determine apply order. |
| `applied_at` | `timestamptz` | `NOT NULL DEFAULT now()` | When the migration was applied on this database. |

**Lifecycle**: A row is inserted exactly once, in the same transaction as the migration
file's own DDL (via `psql -1`), immediately after that file's statements succeed. If the
file's statements fail, the transaction rolls back and no row is inserted — the file
remains pending for the next successful run (FR-014, FR-015).

**Relationships**: None to existing domain tables. Lives in the `public` schema (the
default schema of the `agrolink_telemetria` database), separate from the `telemetria`
schema used by domain data, so it is clearly infra bookkeeping rather than telemetry
data (Constitution Principle IV — telemetry rows are never touched by this table).

## Migration File (source-controlled artifact, not a DB row)

| Field | Type | Notes |
|---|---|---|
| filename | `NNN_description.sql` | `NNN` is a zero-padded, monotonically increasing 3-digit sequence; `description` is a short kebab-case summary. |
| content | SQL DDL | Must be written so it can run once, top to bottom, inside a single transaction (no `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction block). |

**Validation rules** (enforced by review, not tooling, at this stage — see quickstart.md
authoring guidance):
- Filenames must sort in the exact order they are meant to apply (`001_`, `002_`, ...);
  never renumber or edit an already-shipped file — always add a new one.
- Must not contain `UPDATE`/`DELETE` against `telemetria.lectura_telemetria` or any
  other already-persisted telemetry rows (Constitution Principle IV).

## Pipeline Run (conceptual — GitHub Actions run, not a stored entity)

| Field | Source | Notes |
|---|---|---|
| trigger | `github.event_name` | `push` (merge to `master`) or `workflow_dispatch` (on-demand, FR-002). |
| commit / tag | `github.sha` → image tag `sha-<short-sha>` | Traceability link required by FR-005/SC-003. |
| outcome | job/step conclusion | `test` failure ⇒ FR-003; publish failure ⇒ edge case; migration failure ⇒ FR-015; health-check failure ⇒ FR-010. |

## Deployment Target (existing VM, unchanged shape — documented for reference)

| Component | Identity | Touched by this feature? |
|---|---|---|
| `timescaledb` | existing compose service | Only via `docker compose exec` to run migrations (FR-014); container itself is never restarted by this pipeline. |
| `rinho-receptor` | existing compose service | Not touched (spec Assumptions). |
| `agrolink-ingesta` | existing compose service | Replaced (`--no-deps` restart) and health-polled by this pipeline (FR-007, FR-009). |
