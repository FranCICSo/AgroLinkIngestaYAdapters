# Quickstart: Validating the Automated Build, Publish & Deploy Pipeline

## Prerequisites

- Repo secrets set (see `contracts/ci-cd-workflow.md`): `CR_PAT`, `OCI_HOST`,
  `OCI_USERNAME`, `OCI_SSH_KEY`.
- The production VM already runs the stack per `deploy/README.md` (this feature does
  not provision the VM).
- `packages: write` permission granted to the workflow (declared in the workflow YAML,
  no manual repo setting needed beyond the default).

## 1. Validate the test → build → push stages (no deploy risk)

1. Open a PR against `master` with a trivial change (e.g., a comment).
2. Confirm the `test` job runs and the `build-and-push`/`migrate-and-deploy` jobs do
   **not** run (FR-013 — PRs only test).
3. Merge the PR (or push directly to `master` for a first end-to-end run).
4. Confirm in the Actions run: `test` passes → `build-and-push` publishes
   `ghcr.io/<owner>/<repo>:latest` and `ghcr.io/<owner>/<repo>:sha-<short-sha>` (check the
   "Packages" tab of the repo, or `docker manifest inspect ghcr.io/<owner>/<repo>:latest`).

## 2. Validate migration application (safe, empty-directory case first)

Since `deploy/migrations/` starts empty (D-05), the very first pipeline run is a
guaranteed no-op for the migration step:

1. Confirm the `migrate-and-deploy` log shows `apply-migrations.sh` exiting `0` with a
   "nothing pending" message.
2. On the VM, confirm the tracking table now exists but is empty:
   ```bash
   docker compose -f deploy/compose.yaml exec timescaledb \
     psql -U postgres -d "$POSTGRES_DB" -c 'select * from public.schema_migrations;'
   ```

## 3. Validate a real schema change end-to-end

1. Add `deploy/migrations/001_example.sql` with a harmless, reversible-in-spirit change,
   e.g.:
   ```sql
   COMMENT ON TABLE telemetria.lectura_telemetria IS 'managed by 007-cicd-deploy-ghcr migrations';
   ```
   (Per data-model.md's validation rules: never `UPDATE`/`DELETE` telemetry rows here.)
2. Push to `master` (or re-run `workflow_dispatch`).
3. Confirm `schema_migrations` now has one row: `001_example.sql`.
4. Re-run the pipeline again (FR-002, on-demand) with no new migration file added:
   confirm the step is a no-op (file already recorded) — validates the idempotency
   guarantee in `contracts/migration-script.md`.

## 4. Validate migration-failure isolation (FR-015)

1. Add a deliberately broken migration file, e.g. `deploy/migrations/002_broken.sql`
   containing invalid SQL.
2. Push/trigger the pipeline.
3. Confirm: the `migrate-and-deploy` job fails at the migration step, the
   `agrolink-ingesta` container is **not** restarted (check `docker compose ps` shows
   the same container ID/uptime as before the run), and `schema_migrations` has **no**
   row for `002_broken.sql`.
4. Remove/fix the broken file and re-run to confirm recovery.

## 5. Validate health-check failure reporting (FR-009, FR-010, SC-004)

1. Temporarily push a build that fails to start correctly (e.g., a bad env var) to a
   throwaway branch merged into `master` in a test window.
2. Confirm the pipeline fails within ~2 minutes of the container replacement, and the
   Actions log includes the last 80 lines of `docker logs agrolink-ingesta`.

## 6. Validate on-demand redeploy (FR-002, SC-005)

1. With no new commits, trigger the workflow manually via **Actions → Run workflow**.
2. Confirm the currently published `latest` image is redeployed and the health check
   passes again.
