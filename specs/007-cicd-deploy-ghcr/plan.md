# Implementation Plan: Automated Build, Publish & Deploy Pipeline

**Branch**: `007-cicd-deploy-ghcr` | **Date**: 2026-09-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-cicd-deploy-ghcr/spec.md`

> **Actualización (2026-09-22)**: el alcance de este plan se amplió después de la
> primera implementación. `rinho-receptor` fue excluido deliberadamente (ver más abajo,
> "per spec Assumptions"), pero eso dejó un cambio real (`odometro_m` → `odometro_km`,
> feature 005) sin desplegar: el pipeline solo reiniciaba `agrolink-ingesta`, así que
> `rinho-receptor` siguió corriendo con código viejo hasta fallar en producción con
> `column "odometro_m" does not exist` una vez que la migración de esquema (aplicada a
> mano, ahora trackeada como `deploy/migrations/001_odometro_m_to_odometro_km.sql`) le
> quitó esa columna de abajo. El texto original de este plan se deja sin reescribir
> (documenta la decisión inicial y su razonamiento); el contrato actualizado con el
> comportamiento vigente está en `contracts/ci-cd-workflow.md`.

## Summary

Add a GitHub Actions pipeline — mirroring `AgroLinkBackend/.github/workflows/ci-cd.yml`
— that on every merge to `master` (or on manual `workflow_dispatch`) runs `mvn clean
test`, builds a `linux/arm64` (and `linux/amd64`) image of `agrolink-ingesta`, pushes it
to `ghcr.io`, then connects to the existing OCI VM over SSH to: (1) apply any pending,
not-yet-applied database schema (DDL) scripts directly against `timescaledb` — tracked
in a `schema_migrations` table so each script runs exactly once and a failure here never
touches the running service — and, only if that succeeds, (2) pull and restart the
`agrolink-ingesta` container via `docker compose`, poll its container healthcheck until
healthy or timeout, and prune old images. `rinho-receptor` and `timescaledb` are left
untouched by this pipeline (per spec Assumptions).

## Technical Context

**Language/Version**: YAML (GitHub Actions workflow) + POSIX shell (remote deploy/migration
script executed over SSH). No changes to the Java 21 / Spring Boot application code.

**Primary Dependencies**: `docker/setup-qemu-action`, `docker/setup-buildx-action`,
`docker/login-action`, `docker/metadata-action`, `docker/build-push-action`,
`appleboy/scp-action`, `appleboy/ssh-action` (same family already used by AgroLinkBackend);
`psql` client (already present inside the `timescale/timescaledb` image used by the
`timescaledb` service, invoked via `docker compose exec`).

**Storage**: PostgreSQL + TimescaleDB (existing `timescaledb` service in `deploy/compose.yaml`,
unchanged). A new `public.schema_migrations` tracking table is created by the migration
runner on first use.

**Testing**: Existing `mvn clean test` (JUnit, per Constitution Principle VIII) gates the
pipeline before any publish/deploy step, unchanged from today.

**Target Platform**: GitHub Actions `ubuntu-latest` runners (build) → Oracle Cloud Always
Free `VM.Standard.A1.Flex` (ARM64) instance already running the stack, per
`deploy/README.md`.

**Project Type**: CI/CD & operations automation for an existing single-service backend
(`agrolink-ingesta`) inside a multi-container deploy stack. No new application feature
code.

**Performance Goals**: End-to-end pipeline (test → build/push → migrate → redeploy →
health-verify) completes within a few minutes, matching the AgroLinkBackend pipeline's
existing health-poll budget (`MAX_ATTEMPTS=20`, `SLEEP_SECONDS=5` ⇒ ~100s ceiling after
container replacement, satisfying SC-004's 2-minute bound).

**Constraints**: Image must be usable on ARM64 (multi-arch build via QEMU, as the
existing Dockerfile is single-arch-agnostic Maven/Temurin but was never built for
ARM64 in CI before); `REPORTES_HTTP_PORT` is not published to the VM host (only
`VEHICULO_ESTADO_HTTP_PORT` is, per `deploy/compose.yaml`), so the deploy script MUST
verify health via the container's own Docker healthcheck status (`docker inspect`),
not a host-side `curl`, unlike the Backend pipeline; only the `agrolink-ingesta`
container may be restarted (`--no-deps`), `timescaledb` and `rinho-receptor` MUST stay
running; secrets MUST never appear in logs.

**Scale/Scope**: Single VM, three long-running services, low deploy frequency (academic
project cadence — a handful of releases, not continuous high-volume deploys).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. Arquitectura Desacoplada por Capas de Adaptación | N/A — no telemetry-parsing/adaptation code is touched by this feature. **PASS** |
| II. Stack Tecnológico del Backend | No new backend stack introduced for the app; the migration runner reuses the `psql` binary already bundled in the existing `timescale/timescaledb` image, it does not add a JVM migration library or a new persistence pattern. **PASS** |
| III. Mensajería Solo por Necesidad Demostrada | No broker introduced. **PASS** |
| IV. Inmutabilidad de los Datos Crudos de Telemetría | This feature only automates applying schema (DDL) scripts that a developer already authored; it does not itself write, edit, or delete telemetry rows. Authors of future migration scripts remain responsible for not writing destructive `UPDATE`/`DELETE` against `telemetria.lectura_telemetria` — called out in quickstart.md as an authoring guideline. **PASS** |
| V. Minimización de Datos Personales Identificables | Not affected. **PASS** |
| VI. Seguridad como Línea Base | All registry/server credentials (`CR_PAT`, `OCI_HOST`, `OCI_USERNAME`, `OCI_SSH_KEY`) are stored as GitHub Actions repository secrets, never committed, and GitHub Actions masks secret values in logs by default; SSH transport is already encrypted. This is unrelated to the constitution's device→server TLS carve-out (that applies only to the Rinho UDP link). **PASS** |
| VII. Tolerancia a Fallos de Conectividad | N/A — CI/CD concern, not telemetry ingestion. **PASS** |
| VIII. Testing Mínimo Esperado | No new adaptation/parsing logic is added, so no new unit-test obligation is triggered; the existing test suite continues to gate every deploy (FR-001). **PASS** |
| IX. Trazabilidad y No Reproceso Silencioso | Every failure mode (failed tests, failed publish, failed migration, failed health check) fails the pipeline run loudly with logs surfaced (FR-010), instead of silently continuing. **PASS** |

No violations identified. Complexity Tracking table intentionally left empty.

## Project Structure

### Documentation (this feature)

```text
specs/007-cicd-deploy-ghcr/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
.github/
└── workflows/
    └── ci-cd.yml                  # NEW — GitHub Actions pipeline (test → build/push → migrate → deploy)

deploy/
├── compose.yaml                   # MINOR EDIT — added `container_name: agrolink-ingesta`
│                                   #              to the existing service definition, since
│                                   #              the default `<project>-agrolink-ingesta-1`
│                                   #              name is not stable enough for the deploy
│                                   #              script's `docker inspect`/`docker logs`
│                                   #              calls (D-06)
├── db/                            # UNCHANGED — one-time docker-entrypoint-initdb.d scripts
│   ├── 01-schema.sql
│   └── 02-roles.sql
├── migrations/                    # NEW — ordered, tracked schema-change scripts (starts empty)
│   └── (future NNN_description.sql files land here, one per future DDL change)
└── scripts/
    └── apply-migrations.sh        # NEW — remote runner: creates schema_migrations if absent,
                                    #        applies pending files in order, aborts pipeline on failure

src/                                # UNCHANGED — existing agrolink-ingesta application code
└── ...

pom.xml                             # UNCHANGED
Dockerfile                          # UNCHANGED (already produces a portable JRE-alpine image;
                                     #            ARM64-ness comes from the CI build platform flag,
                                     #            not from Dockerfile edits)
```

**Structure Decision**: Single-project layout (Option 1) is kept as-is; this feature adds
only CI/CD and deploy-time assets (`.github/workflows/`, `deploy/migrations/`,
`deploy/scripts/`) alongside the existing `deploy/` runbook structure. No `src/` changes.
`rinho-receptor/` (Node.js) is untouched, consistent with the spec's Assumptions.
