# Contract: `.github/workflows/ci-cd.yml`

## Triggers

| Trigger | Effect |
|---|---|
| `push` to `master` | Runs all three jobs: `test` → `build-and-push` → `migrate-and-deploy`. |
| `pull_request` to `master` | Runs `test` only (FR-013). |
| `workflow_dispatch` (manual) | Runs all three jobs, same as a `push` (FR-002). |

## Required repository secrets (input contract)

| Secret | Used by | Purpose |
|---|---|---|
| `CR_PAT` | `migrate-and-deploy` job, remote script | GitHub PAT with `read:packages`/`write:packages`, used by the VM (outside of Actions) to `docker login ghcr.io` and pull the new image. |
| `OCI_HOST` | `migrate-and-deploy` job | SSH hostname/IP of the production VM. |
| `OCI_USERNAME` | `migrate-and-deploy` job | SSH user on the VM. |
| `OCI_SSH_KEY` | `migrate-and-deploy` job | Private key for that SSH user. |

`GITHUB_TOKEN` (implicit, no setup needed) is used by `build-and-push` to push both
images to `ghcr.io/${{ github.repository }}` and
`ghcr.io/${{ github.repository }}-rinho-receptor` — not a repository secret the
maintainer needs to create.

## Jobs (output contract — what each job guarantees)

### `test`
- Runs `mvn clean test -B` against JDK 21.
- **Guarantee**: if this job fails, no later job runs (FR-001, FR-003).

### `build-and-push`
- **Depends on**: `test` succeeding.
- **Condition**: only on `push`/`workflow_dispatch` to `master` (FR-013).
- Builds two `linux/arm64` images, independently tagged and pushed:
  - `agrolink-ingesta`: from the repository root `Dockerfile` (context `.`), published
    to `ghcr.io/${{ github.repository }}` tagged `latest` and `sha-<short-sha>`
    (FR-004, FR-005, FR-006).
  - `rinho-receptor`: from `rinho-receptor/Dockerfile` (context `./rinho-receptor`),
    published to `ghcr.io/${{ github.repository }}-rinho-receptor`, same tag scheme.
    Extended scope (post-FR-006): the pipeline originally covered only
    `agrolink-ingesta`; `rinho-receptor` changes went undeployed until a runtime error
    ("column odometro_m does not exist", after `odometro_m` → `odometro_km`, migration
    001) surfaced the gap.
- **Guarantee**: if either push to the registry fails, `migrate-and-deploy` does not run.

### `migrate-and-deploy`
- **Depends on**: `build-and-push` succeeding.
- **Condition**: same as `build-and-push`.
- Copies `deploy/migrations/*.sql` to the VM (`appleboy/scp-action`).
- Connects over SSH (`appleboy/ssh-action`) and runs, in order:
  1. `deploy/scripts/apply-migrations.sh` — see `migration-script.md` contract. Any
     non-zero exit here **stops the job**; the running `agrolink-ingesta` and
     `rinho-receptor` containers are never touched (FR-015).
  2. `docker compose -f deploy/compose.yaml pull agrolink-ingesta rinho-receptor`
     (requires both services to declare an `image:` in `deploy/compose.yaml` pointing
     at the registry paths above — `build:` alone is not pullable).
  3. `docker compose -f deploy/compose.yaml up -d --no-deps agrolink-ingesta
     rinho-receptor` (`timescaledb` is the only service left untouched — FR-008,
     extended scope).
  4. For each of `agrolink-ingesta` and `rinho-receptor`: poll `docker inspect
     --format='{{.State.Health.Status}}' <container>` until `healthy` or a bounded
     number of attempts is exhausted (FR-009). On timeout: print `docker logs --tail 80
     <container>` and exit non-zero (FR-010). `agrolink-ingesta` is checked before
     `rinho-receptor`.
  5. `docker image prune -f` (FR-011).
- **Concurrency**: `concurrency: { group: deploy-agrolink-stack, cancel-in-progress:
  false }` at the workflow level — overlapping runs queue rather than interleave (D-07).
- **Known trade-off**: restarting `rinho-receptor` on every deploy causes a brief UDP
  outage for any field device actively reporting during the restart window (a handful
  of seconds). Accepted deliberately when the pipeline was extended to cover this
  service, in exchange for `rinho-receptor` no longer silently drifting from what's on
  `master`.
