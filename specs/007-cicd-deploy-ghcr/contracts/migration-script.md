# Contract: `deploy/scripts/apply-migrations.sh`

## Purpose

Applies pending, not-yet-applied SQL files from a migrations directory to the
`timescaledb` service's database, in order, tracking progress in
`public.schema_migrations` (FR-014). Designed to run on the production VM, invoked by
the CI pipeline over SSH — see `ci-cd-workflow.md`.

## Invocation

```bash
./apply-migrations.sh <compose-file> <migrations-dir> <postgres-db-env-var-name>
# e.g.
./apply-migrations.sh deploy/compose.yaml deploy/migrations POSTGRES_DB
```

## Preconditions

- Run from a directory where `docker compose -f <compose-file> ps` can reach a running,
  healthy `timescaledb` service.
- `<migrations-dir>` contains zero or more `NNN_description.sql` files, already present
  on disk (copied there by the CI job before invocation — see `ci-cd-workflow.md`).
- The `POSTGRES_DB` environment variable (or whichever name is passed) is set in the
  shell's environment (already the case on the VM via `deploy/.env`, loaded by
  `docker compose`).

## Behavior

1. Ensure `public.schema_migrations(version text primary key, applied_at timestamptz not
   null default now())` exists (`CREATE TABLE IF NOT EXISTS`).
2. List `<migrations-dir>/*.sql`, sorted lexically.
3. For each file whose name is not already a row in `schema_migrations`:
   a. Pipe the file's content into
      `docker compose -f <compose-file> exec -T timescaledb psql -v ON_ERROR_STOP=1 -1
      -U postgres -d "$POSTGRES_DB"`.
   b. On success, insert `(filename, now())` into `schema_migrations`, in the same `psql
      -1` transaction (append the `INSERT` as the final statement piped in, so a failure
      anywhere in the file prevents the row from being recorded).
   c. On failure: print the file name and `psql`'s error output, then **exit non-zero
      immediately** — do not attempt subsequent files.
4. If no files are pending, exit `0` immediately (no-op deploy is a normal, healthy
   outcome — matches FR-002's on-demand redeploy scenario).

## Exit codes (output contract)

| Code | Meaning | Pipeline effect |
|---|---|---|
| `0` | All pending migrations applied (or none were pending). | `migrate-and-deploy` proceeds to restart `agrolink-ingesta` (FR-014). |
| non-zero | A migration file failed to apply. | `migrate-and-deploy` job fails at this step; `agrolink-ingesta` and the database are left exactly as they were (FR-015). |

## Idempotency guarantee

Re-running the script with the same `<migrations-dir>` contents twice in a row (e.g.,
FR-002's on-demand redeploy trigger, or two overlapping runs per D-07) is safe: the
second run finds every file already recorded in `schema_migrations` and performs no
writes.
