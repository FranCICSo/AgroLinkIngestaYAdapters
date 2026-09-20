# Feature Specification: Automated Build, Publish & Deploy Pipeline

**Feature Branch**: `007-cicd-deploy-ghcr`

**Created**: 2026-09-20

**Status**: Draft

**Input**: User description: "As it done in Backend project AgroLinkBackend/.github/workflows/ci-cd.yml I need to implement an action to deploy this project automatically in claude. For that reason I should set some secrets on the repo (you will tell me which). Also I need to upload java project on a docker registry ghcr.io (tell me how)."

## Clarifications

### Session 2026-09-20

- Q: When a database schema (DDL) change is included in a deploy, how should the pipeline apply it to the production database? → A: Track applied changes in a small migrations-history table; each deploy applies only new, not-yet-applied ordered scripts, in order.
- Q: Who/what actually applies the pending migration — the pipeline itself, or the application at startup? → A: The pipeline itself applies pending migrations directly against the database before touching the running service.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic release on merge (Priority: P1)

As the maintainer of AgroLink Ingesta, when I merge a change into the main branch, I want the ingestion service to be automatically tested, packaged, published, and rolled out to the production server, so that releases stop requiring manual SSH sessions and manual `docker` commands on the VM.

**Why this priority**: This is the core value of the feature — it removes the manual, error-prone deployment step that exists today and is the direct trigger for this request.

**Independent Test**: Merge a trivial, low-risk change into the main branch and confirm that, without any manual action, the new version becomes the one running on the production server, and that the previous manual deployment procedure is no longer required.

**Acceptance Scenarios**:

1. **Given** a change has been merged into the main branch, **When** the automated pipeline runs, **Then** the change is tested, a new versioned artifact is produced, published to a container registry, and rolled out to the production server without any manual step.
2. **Given** the automated tests fail for a merged change, **When** the pipeline runs, **Then** no new artifact is published and the production server keeps running the previously deployed version.

---

### User Story 2 - On-demand redeploy (Priority: P2)

As the maintainer, I want to trigger a deployment on demand (without needing a new code change), so that I can redeploy the current version after fixing server-level infrastructure issues, or recover from a failed automatic run.

**Why this priority**: Mirrors the manual-trigger capability already present in the Backend project's pipeline and gives the maintainer a recovery path independent of source changes.

**Independent Test**: Manually trigger the pipeline without pushing new code and confirm the currently released version is redeployed successfully to the production server.

**Acceptance Scenarios**:

1. **Given** no new code has been pushed, **When** the maintainer manually triggers the pipeline, **Then** the pipeline runs the same test-publish-deploy sequence and the production server ends up running the expected version.

---

### User Story 3 - Visible failure on bad deploy (Priority: P3)

As the maintainer, I want a deployment that leaves the service unhealthy to be automatically detected and clearly reported, so that I don't have to manually check the server to find out a release broke something.

**Why this priority**: Reduces the risk introduced by full automation — without this, a broken release could go unnoticed until it affects real telemetry ingestion.

**Independent Test**: Force a deploy of a version that fails to start correctly and confirm the pipeline run is reported as failed, with enough information (recent logs) to diagnose the problem, without needing to log into the server first.

**Acceptance Scenarios**:

1. **Given** a newly deployed version does not become healthy within a bounded waiting time, **When** the health check step evaluates it, **Then** the pipeline run is marked as failed and surfaces the service's recent logs.

### Edge Cases

- What happens when the automated tests fail? The pipeline MUST stop before publishing or deploying anything.
- What happens when publishing the artifact to the registry fails (e.g., authentication problem)? The pipeline MUST fail the run and MUST NOT attempt to deploy an unpublished artifact.
- What happens when the production server is unreachable (network/SSH failure)? The pipeline MUST fail the run and clearly indicate the connection step that failed, leaving the currently running version untouched.
- What happens when the new version starts but never reports healthy? The pipeline MUST fail the run, surface recent logs of the affected service, and MUST NOT report success.
- What happens if two pipeline runs are triggered close together (e.g., two quick merges)? The system MUST ensure the production server ends up consistently running the version corresponding to the latest successful run, without the two runs corrupting each other's deployment.
- What happens to the other components already running on the server (database, other services) when only the ingestion service is updated? They MUST remain running and unaffected by the ingestion service's redeploy, except for schema (DDL) changes explicitly carried by the deploy per FR-014.
- What happens when a pending schema (DDL) change fails to apply? The pipeline MUST stop before replacing the running ingestion service, MUST leave the database and the currently running service exactly as they were, and MUST report the failure clearly.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST automatically run the ingestion service's automated test suite whenever a change is merged into the main branch, before any publish or deploy step runs.
- **FR-002**: The system MUST allow a maintainer to trigger the full pipeline on demand, independent of a new code merge.
- **FR-003**: The system MUST NOT proceed to publish or deploy when the automated tests fail.
- **FR-004**: On successful tests, the system MUST package the ingestion service into a versioned, deployable artifact and publish it to a container registry reachable from the production server.
- **FR-005**: Each published artifact MUST be identifiable both by a "current" marker (so the server always knows what to pull) and by a unique, traceable identifier tied to the source change it was built from (so any previously published version can be identified and, if needed, redeployed).
- **FR-006**: The published artifact MUST be usable on the production server's processor architecture (ARM64, matching the existing production VM described in the project's deployment runbook).
- **FR-007**: On successful publish, the system MUST automatically connect to the production server, retrieve the newly published artifact, and replace the currently running ingestion service with it, without manual intervention.
- **FR-008**: The deploy step MUST only affect the ingestion service; other already-running components of the stack (database, other services) MUST remain unaffected.
- **FR-009**: After replacing the running service, the system MUST verify the new version becomes healthy within a bounded waiting time before declaring the deployment successful.
- **FR-010**: If the new version does not become healthy within that time, the system MUST fail the pipeline run and surface the affected service's recent logs for diagnosis.
- **FR-011**: The system MUST perform routine cleanup of superseded artifacts on the production server after a successful deployment, to avoid unbounded disk usage growth.
- **FR-012**: All credentials required to publish to the registry and to connect to the production server MUST be stored as repository secrets and MUST NOT appear in pipeline logs or in any file committed to the repository.
- **FR-013**: The pipeline MUST only run its publish and deploy steps for changes on the main branch (or the on-demand trigger of FR-002); other branches and pull requests MUST only go through the test step.
- **FR-014**: When a change being deployed includes new database schema (DDL) changes, the deploy step itself MUST apply the pending, not-yet-applied changes directly to the production database, in order, before the running ingestion service is replaced, using a persisted record of which changes have already been applied so each one is applied at most once regardless of how many times the pipeline runs. The ingestion service MUST NOT be relied upon to apply its own schema changes at startup.
- **FR-015**: If applying a pending schema change fails, the system MUST fail the pipeline run, MUST NOT proceed to replace the running ingestion service with the new version, and MUST leave the database and the currently running service exactly as they were before the attempt.

### Key Entities

- **Pipeline Run**: One execution of the automated test → publish → deploy sequence, triggered by a merge to main or by a manual request; has an outcome (success/failure) and, on failure, an identifiable failing step.
- **Published Artifact (Container Image)**: The versioned, deployable package produced from a tested source change; identified by a "current" marker and by a unique identifier traceable back to the source change.
- **Deployment Target (Production Server)**: The remote environment where the ingestion service (and its already-running companion services) executes; receives the published artifact and reports back whether the replaced service is healthy.
- **Repository Secret**: A credential (registry access, server access) needed by the pipeline, stored outside of source code and not exposed in logs.
- **Schema Migration**: An ordered, one-time database change (DDL) tracked via a persisted applied-history on the production database, so it is applied automatically at most once, before the corresponding application version is considered ready to run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A change merged into the main branch is running on the production server with zero manual steps, end to end.
- **SC-002**: 100% of artifacts that reach the production server correspond to a run where the automated tests passed; no failing build is ever deployed.
- **SC-003**: For any version currently running on the production server, the exact source change it corresponds to can be identified in under one minute, without logging into the server.
- **SC-004**: A deployment that leaves the service unhealthy is detected and reported as a failed run within 2 minutes of the replacement happening, without requiring manual server inspection.
- **SC-005**: A maintainer can request a redeploy of the current version on demand and see it reflected on the production server without pushing a code change.

## Assumptions

- The production server is the existing Oracle Cloud (OCI) Always Free ARM64 VM described in `deploy/README.md`, already running the stack (`timescaledb`, `rinho-receptor`, `agrolink-ingesta`) via the compose file in `deploy/`; this feature automates redeploying the ingestion service onto that same server, it does not provision a new one.
- This feature's build-and-publish scope is limited to the Java ingestion service (`agrolink-ingesta`), matching the explicit request to "upload java project"; the Node.js receptor component is not built or published by this pipeline and is assumed to already be deployed and updated through its own separate process.
- "Main branch" refers to this repository's `master` branch, consistent with how the repository is currently configured, mirroring the trigger convention used by the Backend project's pipeline (which uses its own `main`).
- The container registry is GitHub Container Registry (`ghcr.io`), the same registry already used by the Backend project, so both services' images live in one place and reuse the same access pattern.
- "Bounded waiting time" for the health check defaults to the same order of magnitude already used by the Backend project's pipeline (on the order of a couple of minutes), unless the maintainer specifies otherwise later.
- Secrets required for registry publish and server access are managed through the repository's existing secret storage mechanism (the same mechanism already used by the Backend project), not through a new external system.
- The existing scripts under `deploy/db/` only run once, when the database volume is first created, so they cannot be relied on to carry future schema changes; this feature introduces the ordered, tracked migration mechanism (FR-014) needed to apply schema changes on every deploy from then on, independent of that initial-setup mechanism.
- The first time the tracked migration mechanism runs against the already-running production database, it will be baselined so the schema already delivered via `deploy/db/` is marked as applied and is not re-run; only schema changes introduced after this feature ships are treated as pending migrations.
