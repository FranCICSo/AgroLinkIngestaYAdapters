# Phase 0 Research: Automated Build, Publish & Deploy Pipeline

## D-01: Trigger branch and workflow shape

**Decision**: Reuse the exact three-job shape of `AgroLinkBackend/.github/workflows/ci-cd.yml`
(`test` → `build-and-push` → `deploy`), but trigger on `master` instead of `main`, plus
`workflow_dispatch` for on-demand runs (FR-002, FR-013).

**Rationale**: This repository's default/main branch is `master` (confirmed via repo
state), whereas AgroLinkBackend's is `main`. Keeping every other structural choice
identical minimizes new concepts for the maintainer to learn and satisfies the user's
explicit "as it's done in Backend project" request.

**Alternatives considered**: A single monolithic job — rejected, it would lose the
existing "tests gate everything" separation (FR-001/FR-003) and the ability to see which
stage failed at a glance (FR-010, Constitution Principle IX).

## D-02: Registry and image tagging

**Decision**: Push to `ghcr.io/${{ github.repository }}` using `docker/login-action`
with `${{ github.actor }}` / `${{ secrets.GITHUB_TOKEN }}` (no extra secret needed to
*push* from Actions), and tag with `docker/metadata-action` using the same two tags as
Backend: `type=raw,value=latest` and `type=sha,prefix=sha-,format=short` (FR-005).

**Rationale**: `GITHUB_TOKEN` already has `packages: write` when the job declares that
permission — matches Backend exactly, no new registry secret required for the push
side. The `sha-` tag gives the traceability FR-005/SC-003 require; `latest` gives the
server a stable pull target.

**Alternatives considered**: A separate PAT for pushing — rejected, unnecessary since
`GITHUB_TOKEN` already suffices for push-only within the same repository, and adding it
would just be one more secret to rotate for no benefit.

## D-03: Multi-architecture build

**Decision**: Add `docker/setup-qemu-action` + `docker/setup-buildx-action` and build
with `platforms: linux/arm64` (Backend also builds `linux/amd64` for its own dual-target
needs; here `linux/arm64` alone is sufficient since the only deploy target is the OCI
Ampere A1 VM, but building both is harmless and keeps parity with Backend for any future
local amd64 dev use) (FR-006).

**Rationale**: `deploy/README.md` already documents that the production VM is
ARM64-only and that non-multi-arch images "hubiera roto el despliegue" (D-11 in that
runbook, re: TimescaleDB). The existing Dockerfile's base images
(`maven:3.9-eclipse-temurin-21`, `eclipse-temurin:21-jre-alpine`) are themselves
published for `linux/arm64/v8`, so no Dockerfile change is required — only the CI build
platform flags.

**Alternatives considered**: Building only `linux/amd64` and cross-compiling/emulating
at deploy time — rejected, unsupported by `docker compose pull` and unnecessary given
QEMU-based multi-arch build already works for the sibling project.

## D-04: Applying pending DDL migrations (mechanism)

**Decision**: A new `deploy/migrations/` directory holds ordered, immutable SQL files
(`NNN_description.sql`). A new `deploy/scripts/apply-migrations.sh`, executed on the VM
over the same SSH session as the rest of the deploy step, ensures a
`public.schema_migrations(version text primary key, applied_at timestamptz not null
default now())` table exists (via `docker compose exec -T timescaledb psql ... -c
"CREATE TABLE IF NOT EXISTS ..."`), then for each migration file not already present as
a row, pipes its content into `docker compose exec -T timescaledb psql -v
ON_ERROR_STOP=1 -1 -U postgres -d "$POSTGRES_DB"` (the `-1` flag wraps the whole script
in a single transaction so a mid-script failure leaves no partial DDL applied) and, only
on success, records the version in `schema_migrations` inside that same transaction
(FR-014, FR-015; per clarification "pipeline applies migrations directly, before
touching the running service").

**Rationale**: Reuses the `psql` binary already inside the running `timescaledb`
container — no new dependency to install on the VM or in the image. Filename-ordered,
tracked-by-name migrations is the simplest mechanism that satisfies "applied at most
once" without introducing a JVM migration framework (Constitution Principle II: no
unjustified new stack element) or a manual approval step that would defeat the
automation goal.

**Alternatives considered**:
- Embedding Flyway/Liquibase in the Java app (runs migrations at boot) — rejected per
  the clarification session: it can't guarantee "don't replace the running service if
  migration fails" (FR-015), since the new container has already started by the time an
  in-app migration runs.
- Re-running the full `deploy/db/*.sql` idempotently on every deploy with no tracking
  table — rejected: those scripts are written as one-shot `CREATE TABLE`/`CREATE ROLE`
  statements (not `IF NOT EXISTS`-guarded throughout, e.g. role creation), so blind
  re-execution would error out on the second run; rewriting them all to be safely
  re-runnable was judged riskier than adding a small tracking table.

## D-05: Migration file source of truth on the VM & the "baseline" question

**Decision**: `deploy/migrations/` starts **empty** at the moment this feature ships.
`deploy/db/01-schema.sql` / `02-roles.sql` are left exactly as they are (still used only
by `docker-entrypoint-initdb.d` for a brand-new empty volume). Every schema change from
this point forward is authored as a new file under `deploy/migrations/` instead of
editing `deploy/db/`. The CI job copies the current `deploy/migrations/` directory to
the VM with `appleboy/scp-action` immediately before running
`apply-migrations.sh`, so the VM always has exactly the set of migration files present
in the commit being deployed.

**Rationale**: Because `deploy/migrations/` starts empty, there is nothing to baseline —
the already-applied schema from `deploy/db/` is simply never represented as a
migration file, so the tracking table starts empty and the first real entry is the
first genuinely new DDL change authored after this feature ships. This directly
resolves the "baseline" assumption recorded in spec.md without needing to reverse-engineer
which of the existing statements were already applied on the live database.

**Alternatives considered**: Converting `01-schema.sql`/`02-roles.sql` into the first
tracked migrations and pre-marking them "applied" on the live DB — rejected as
needless churn and a source of drift risk (the live DB's actual history may not match
file contents byte-for-byte after the manual fixes noted in `deploy/db/01-schema.sql`'s
own comments, e.g. the odometer column migration).

## D-06: Health verification without a host-published app port

**Decision**: Poll `docker inspect --format='{{.State.Health.Status}}' agrolink-ingesta`
(the container already has a `healthcheck:` block in `deploy/compose.yaml` hitting its
internal `/health` endpoint) in a bounded retry loop, instead of `curl`-ing the app port
directly from the host as Backend's pipeline does (FR-009, FR-010, SC-004).

**Rationale**: `deploy/compose.yaml` intentionally does not publish
`REPORTES_HTTP_PORT` to the host (only `VEHICULO_ESTADO_HTTP_PORT` is published, per
that file's own comments and feature 002's research.md D-01) — so a host-side `curl` to
the reports port, as Backend's pipeline does, is not possible here. Docker's own
healthcheck status is reachable from the host via the Docker CLI regardless of port
publication and requires no compose/env changes.

**Alternatives considered**: Publishing `REPORTES_HTTP_PORT` to the host just to allow a
`curl` health check — rejected, it would reopen a port the project's own compose
comments and feature 002 deliberately keep internal-only, for no gain over the
already-available Docker healthcheck status.

## D-07: Failure isolation between concurrent runs

**Decision**: Rely on GitHub Actions' default `concurrency` behavior is *not* enough on
its own — add an explicit `concurrency: { group: deploy-agrolink-ingesta, cancel-in-progress:
false }` at the workflow level so a second run triggered while one is mid-deploy queues
behind it instead of interleaving two simultaneous SSH sessions against the same VM and
database.

**Rationale**: Directly resolves the spec's edge case "what happens if two pipeline
runs are triggered close together" — queuing (not cancelling) ensures both changes are
still applied, in order, and the VM always converges to the latest one, without two
`apply-migrations.sh` invocations racing against the same `schema_migrations` table.

**Alternatives considered**: `cancel-in-progress: true` — rejected, cancelling a run
mid-deploy could leave the migration step half-applied or the container replacement
half-done; queuing is safer for a stateful deploy.
