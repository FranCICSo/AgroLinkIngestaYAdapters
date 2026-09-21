---

description: "Task list for Automated Build, Publish & Deploy Pipeline"
---

# Tasks: Automated Build, Publish & Deploy Pipeline

**Input**: Design documents from `/specs/007-cicd-deploy-ghcr/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Not requested for this feature (CI/CD workflow + shell script; validation is done via the `quickstart.md` manual scenarios, referenced as checklist tasks below, not automated test files).

**Organization**: Tasks are grouped by user story (US1 = P1, US2 = P2, US3 = P3 from spec.md) to enable independent validation of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Single project, repository root. New paths introduced by this feature:
`.github/workflows/ci-cd.yml`, `deploy/migrations/`, `deploy/scripts/apply-migrations.sh`,
`deploy/README.md` (existing, extended).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the directories and documentation scaffolding every later task builds on.

- [X] T001 Create `deploy/migrations/` directory with a `deploy/migrations/README.md` documenting the naming convention (`NNN_description.sql`, zero-padded 3-digit sequence, never renumber/edit a shipped file) and the "never `UPDATE`/`DELETE` telemetry rows" authoring rule, per `data-model.md`'s Migration File validation rules. Leave the directory otherwise empty (per `research.md` D-05 — no baseline files).
- [X] T002 [P] Create `deploy/scripts/` directory (if absent) as the home for `apply-migrations.sh`.
- [X] T003 [P] Add a "CI/CD Automatizado" section header (content filled in later, T019) to `deploy/README.md` so the document structure is ready before the pipeline itself lands.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The migration-application mechanism and the base workflow (test job, triggers,
concurrency) that every user story's deploy path depends on.

**⚠️ CRITICAL**: No user story phase can be validated until this phase is complete.

- [X] T004 Implement `deploy/scripts/apply-migrations.sh` per `contracts/migration-script.md`: accepts `<compose-file> <migrations-dir> <postgres-db-env-var-name>`; ensures `public.schema_migrations(version text primary key, applied_at timestamptz not null default now())` exists via `docker compose exec -T timescaledb psql`; lists `*.sql` in `<migrations-dir>` sorted lexically; for each file not yet in `schema_migrations`, pipes it (plus a trailing `INSERT INTO schema_migrations` statement) into `docker compose exec -T timescaledb psql -v ON_ERROR_STOP=1 -1 -U postgres -d "$POSTGRES_DB"`; exits non-zero immediately on the first failing file without touching later files; exits `0` when nothing is pending.
- [X] T005 Make `deploy/scripts/apply-migrations.sh` executable (`chmod +x`) and add a `set -euo pipefail` guard at the top so any unhandled error inside the script also aborts it non-zero.
- [X] T006 Create `.github/workflows/ci-cd.yml` with `name: AgroLink Ingesta CI/CD`, top-level `env: { REGISTRY: ghcr.io, IMAGE_NAME: ${{ github.repository }} }`, and a top-level `concurrency: { group: deploy-agrolink-ingesta, cancel-in-progress: false }` block (per `research.md` D-07), plus the `on:` triggers: `push: { branches: ["master"] }`, `pull_request: { branches: ["master"] }`, `workflow_dispatch:`.
- [X] T007 In `.github/workflows/ci-cd.yml`, add the `test` job (`runs-on: ubuntu-latest`): checkout (`actions/checkout@v4`), setup JDK 21 Temurin with Maven cache (`actions/setup-java@v4`), and run `mvn clean test -B`. No conditions — runs on every trigger, including pull requests (FR-001, FR-013).

**Checkpoint**: Foundation ready — every later phase only adds jobs/steps to this same workflow file, gated on `test` succeeding.

---

## Phase 3: User Story 1 - Automatic release on merge (Priority: P1) 🎯 MVP

**Goal**: A merge to `master` is automatically tested, built, published to `ghcr.io`, migrated, and redeployed to the production VM with zero manual steps.

**Independent Test**: Merge a trivial change into `master` and confirm, per `quickstart.md` §1–3, that the new image reaches `ghcr.io` and the VM ends up running it, with no manual `ssh`/`docker` command needed.

### Implementation for User Story 1

- [X] T008 [US1] In `.github/workflows/ci-cd.yml`, add the `build-and-push` job: `needs: test`, `if: github.ref == 'refs/heads/master' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')`, `permissions: { contents: read, packages: write }`; steps: checkout, `docker/setup-qemu-action@v3`, `docker/setup-buildx-action@v3`, `docker/login-action@v3` (registry `${{ env.REGISTRY }}`, username `${{ github.actor }}`, password `${{ secrets.GITHUB_TOKEN }}`), `docker/metadata-action@v5` (images `${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}`, tags `type=raw,value=latest` and `type=sha,prefix=sha-,format=short`), `docker/build-push-action@v5` (context `.`, `platforms: linux/arm64`, `push: true`, tags/labels from metadata step, `cache-from: type=gha`, `cache-to: type=gha,mode=max`) — per `research.md` D-02/D-03.
- [X] T009 [US1] In `.github/workflows/ci-cd.yml`, add the `migrate-and-deploy` job: `needs: build-and-push`, same `if:` condition as T008, `runs-on: ubuntu-latest`.
- [X] T010 [US1] In the `migrate-and-deploy` job, add a checkout step and an `appleboy/scp-action` step copying `deploy/migrations/` (and `deploy/scripts/apply-migrations.sh`, `deploy/compose.yaml`) to `/home/ubuntu/agrolink/` on the VM, using `host: ${{ secrets.OCI_HOST }}`, `username: ${{ secrets.OCI_USERNAME }}`, `key: ${{ secrets.OCI_SSH_KEY }}`.
- [X] T011 [US1] In the `migrate-and-deploy` job, add an `appleboy/ssh-action@v1.0.3` step whose `script:` first runs `bash apply-migrations.sh deploy/compose.yaml deploy/migrations POSTGRES_DB` from `/home/ubuntu/agrolink`, and `exit`s the whole step non-zero (stopping the job before the next step) if that command fails — implementing FR-014/FR-015.
- [X] T012 [US1] Extend the same `ssh-action` script from T011 (only runs if migrations succeeded) to: `docker login ghcr.io` using `CR_PAT`/`GITHUB_ACTOR` envs (mirroring the Backend pipeline's pattern), then `docker compose -f docker-compose... pull agrolink-ingesta` and `docker compose ... up -d --no-deps agrolink-ingesta` — satisfying FR-007/FR-008 (only this service is restarted).
- [X] T013 [US1] Document the four required repository secrets (`CR_PAT`, `OCI_HOST`, `OCI_USERNAME`, `OCI_SSH_KEY`) and their purpose in the "CI/CD Automatizado" section of `deploy/README.md` created in T003, per `contracts/ci-cd-workflow.md`.
- [ ] T014 [US1] **(requires live secrets + real VM push — not run by this session)** Manually run `quickstart.md` §1 ("Validate the test → build → push stages") and §2 ("Validate migration application — safe, empty-directory case") against a real PR/merge, and record the outcome (pass/fail + any fixes) as a note in this tasks.md's Notes section or the PR description.

**Checkpoint**: User Story 1 fully functional — a merge to `master` reaches the VM automatically.

---

## Phase 4: User Story 2 - On-demand redeploy (Priority: P2)

**Goal**: A maintainer can redeploy the current published version on demand, without a new code change.

**Independent Test**: Trigger the workflow manually via **Actions → Run workflow** with no new commits, per `quickstart.md` §6, and confirm the VM ends up running the expected version again.

### Implementation for User Story 2

- [X] T015 [US2] Re-review `.github/workflows/ci-cd.yml`'s `on.workflow_dispatch:` trigger (added in T006) and the `if:` conditions on `build-and-push`/`migrate-and-deploy` (added in T008/T009): confirm `github.event_name == 'workflow_dispatch'` is included in both, so a manual run executes the full pipeline exactly like a `push` (FR-002).
- [X] T016 [US2] Confirm (by inspection of T004's implementation) that `apply-migrations.sh` is a safe no-op when every migration file is already recorded in `schema_migrations` — required so an on-demand redeploy with no new migrations doesn't fail or reapply anything (idempotency guarantee in `contracts/migration-script.md`).
- [ ] T017 [US2] **(requires live secrets + real VM — not run by this session)** Manually run `quickstart.md` §6 ("Validate on-demand redeploy") via **Actions → Run workflow** and confirm SC-005 (redeploy reflected on the VM without a code push).

**Checkpoint**: User Stories 1 and 2 both work — automatic and on-demand triggers both drive the same reliable pipeline.

---

## Phase 5: User Story 3 - Visible failure on bad deploy (Priority: P3)

**Goal**: A deployment that leaves the service unhealthy is automatically detected and clearly reported, without manual server inspection.

**Independent Test**: Force a bad deploy and confirm, per `quickstart.md` §4–5, that the pipeline run fails with the affected service's recent logs surfaced, and that the database/service were left untouched when the failure was a migration failure.

### Implementation for User Story 3

- [X] T018 [US3] Extend the `ssh-action` script (from T012) to, after `docker compose up -d --no-deps agrolink-ingesta`, poll `docker inspect --format='{{.State.Health.Status}}' agrolink-ingesta` in a bounded loop (`MAX_ATTEMPTS=20`, `SLEEP_SECONDS=5`, matching the Backend pipeline's budget per `plan.md`'s Performance Goals) until it reports `healthy` — per `research.md` D-06 (no host-published reports port here, unlike Backend).
- [X] T019 [US3] On loop timeout in T018, print `docker logs --tail 80 agrolink-ingesta` and `exit 1` from the script (failing the `migrate-and-deploy` job) — satisfying FR-009/FR-010/SC-004.
- [X] T020 [US3] Add `docker image prune -f` as the final step of the `ssh-action` script, running only after a successful health check — satisfying FR-011.
- [ ] T021 [US3] **(requires live secrets + real VM — not run by this session)** Manually run `quickstart.md` §4 ("Validate migration-failure isolation") and §5 ("Validate health-check failure reporting"), confirming in §4 that `agrolink-ingesta`'s container ID/uptime is unchanged after a deliberately broken migration file, and in §5 that a bad deploy fails within ~2 minutes with logs visible in the Actions log.

**Checkpoint**: All three user stories work independently; the full pipeline matches `contracts/ci-cd-workflow.md` end to end.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and a final full-pipeline validation pass.

- [X] T022 [P] Fill in the "CI/CD Automatizado" section of `deploy/README.md` (header added in T003) with a summary of the pipeline stages (test → build/push → migrate → deploy → health-check → cleanup), linking to `specs/007-cicd-deploy-ghcr/contracts/ci-cd-workflow.md` for the full contract, so future maintainers don't need to read the workflow YAML to understand the flow.
- [X] T023 [P] Add a short "Authoring a new migration" note to `deploy/migrations/README.md` (created in T001) pointing at `specs/007-cicd-deploy-ghcr/data-model.md`'s Migration File validation rules, for anyone adding a `NNN_description.sql` file after this feature ships.
- [ ] T024 **(requires live secrets + real VM — not run by this session)** Run the full `quickstart.md` end-to-end (all 6 sections in order) once all phases are implemented, and record any deviations found as follow-up notes.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T001/T002 create the directories T004 writes into). **BLOCKS all user stories.**
- **User Story 1 (Phase 3)**: Depends on Foundational (T006/T007 — the workflow file and `test` job must exist before jobs are appended to it).
- **User Story 2 (Phase 4)**: Depends on Foundational AND User Story 1 (it reviews/validates conditions and steps T006, T008, T009, T012 already put in place — not a meaningfully separable code path in a single-workflow-file feature like this one).
- **User Story 3 (Phase 5)**: Depends on Foundational AND User Story 1 (T018–T020 extend the same `ssh-action` script block T012 created).
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### User Story Dependencies

Unlike a typical multi-module feature, this pipeline is a single YAML file plus one script,
so US2 and US3 both extend code that US1 introduces rather than standing fully apart from
it — each phase is still independently *validatable* (its own quickstart scenarios, its own
checkpoint), but not independently *deployable* ahead of US1.

### Parallel Opportunities

- T002 and T003 (Setup) can run in parallel with each other and with T001.
- T004/T005 (the shell script) can be authored in parallel with T006/T007 (the workflow skeleton) since they're different files — no `[P]` marker was used above only because T006/T007 are two edits to the same new file done in sequence for clarity; T004–T005 as a pair can proceed alongside T006–T007 as a pair.
- T022 and T023 (Polish, different files) can run in parallel.
- All other tasks touch the same two files (`.github/workflows/ci-cd.yml`, `deploy/scripts/apply-migrations.sh`) incrementally and must stay sequential.

---

## Parallel Example: Setup + Foundational

```bash
# Setup, launched together:
Task: "Create deploy/migrations/ directory with README in deploy/migrations/README.md"
Task: "Create deploy/scripts/ directory"

# Foundational, the script and the workflow skeleton can proceed as two parallel tracks:
Task: "Implement deploy/scripts/apply-migrations.sh per contracts/migration-script.md"
Task: "Create .github/workflows/ci-cd.yml with triggers, env, concurrency, and the test job"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (CRITICAL — migration script + base workflow/test job).
3. Complete Phase 3: User Story 1 (build-and-push + migrate-and-deploy jobs, secrets documented).
4. **STOP and VALIDATE**: run `quickstart.md` §1–3 for real against a throwaway commit.
5. This is already a usable, demoable pipeline (a merge deploys automatically) — ship it.

### Incremental Delivery

1. Setup + Foundational → workflow skeleton + migration script ready.
2. Add User Story 1 → validate via quickstart §1–3 → this is the MVP.
3. Add User Story 2 → validate via quickstart §6 (mostly a review/confirmation pass, low effort).
4. Add User Story 3 → validate via quickstart §4–5 (health-check + failure-isolation hardening).
5. Polish → documentation + one full end-to-end quickstart run.

---

## Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps task to specific user story for traceability.
- Because this feature is fundamentally "one workflow file + one script", most tasks are
  sequential edits to the same two files by design — this is expected for a CI/CD feature,
  not a sign the phases should be merged; each phase still has its own checkpoint and its
  own quickstart-based independent test.
- Commit after each task or logical group (e.g., after T007 the `test`-only workflow is
  itself a safe, mergeable increment).
- Verify `mvn clean test` still passes locally before pushing any workflow-only change (it
  is unaffected by this feature, but T007 depends on it succeeding in CI).

### Implementation session note (2026-09-20)

All code/doc tasks (T001–T013, T015, T016, T018–T020, T022, T023) are implemented and
verified by static inspection + local `mvn clean test`, `bash -n`, and YAML parsing.
T014, T017, T021, T024 remain unchecked: they require pushing to `master` (or running
`workflow_dispatch`) against the *real* GitHub Actions environment with the four
repository secrets configured and the real OCI VM reachable — none of which this
session can do on the user's behalf. Run those four manually once the secrets from
`deploy/README.md` §7 are set, following `quickstart.md` end to end.

### Real-run fix (2026-09-20, after first live attempt at T014)

The first real `migrate-and-deploy` run failed at the migration step:
`deploy/.env: No such file or directory`. Cause: the assumed `APP_DIR=
"/home/ubuntu/agrolink"` didn't match this VM's actual layout. The repo owner confirmed the
real path is `/home/ubuntu/AgroLinkIngestaYAdapters/deploy/.env`; `APP_DIR` and the
`scp-action` `target` in `.github/workflows/ci-cd.yml` were updated to match. T014 should be
re-attempted with this fix in place.
