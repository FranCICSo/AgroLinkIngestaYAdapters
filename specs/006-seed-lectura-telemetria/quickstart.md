# Quickstart: Seed Local Telemetry Readings

Validates spec `006-seed-lectura-telemetria` end-to-end against a real local TimescaleDB.

## Prerequisites

- `deploy/.env` exists and is populated (see `deploy/README.md` §2.3) — in particular
  `RINHO_RECEPTOR_DB_USER`/`RINHO_RECEPTOR_DB_PASSWORD` and `POSTGRES_DB`.
- The local stack's `timescaledb` service is up: `make timescaledb` (or `make dev` / `make stack`).

## Run the seed

```bash
make seed-telemetry
```

This runs `deploy/seed/seed-demo-telemetry.sql` against the running `timescaledb` container
using the `rinho_receptor` role (the only role with `INSERT` — see `research.md` D-01/D-04).

## Verify (Acceptance Scenarios 1–3 of spec.md)

```bash
cd deploy && set -a && . ./.env && set +a && cd ..
docker compose -f deploy/compose.yaml exec -T timescaledb \
  psql "postgresql://${AGROLINK_INGESTA_DB_USER}:${AGROLINK_INGESTA_DB_PASSWORD}@localhost:5432/${POSTGRES_DB}" \
  -c "SET search_path TO telemetria; SELECT momento_evento, latitud, longitud, odometro_km, estado_interpretacion
      FROM lectura_telemetria
      WHERE dispositivo_id = '860693084873877'
        AND frame_hash IN ('b5e53b98806a25df520ae0a4dc9db48f9bd40fa10fc5bbe9f5370c2663cf90e4',
                            'c2c9df544e76292467ffa3f7d625e8268a151cd6dc73bed85f67940d50f31600')
      ORDER BY momento_evento;"
```

Expected output: exactly the 2 seeded rows, ordered by `momento_evento` (filtering by
`frame_hash` keeps this query correct even in a local database that also has unrelated prior
telemetry for this device from earlier manual testing):

| momento_evento | latitud | longitud | odometro_km | estado_interpretacion |
|---|---|---|---|---|
| 2026-09-10 03:10:30.907+00 | -27.806560 | -64.296830 | 17315.569 | PARCIAL |
| 2026-09-17 02:08:15.259+00 | -34.601150 | -58.441300 | 0 | PARCIAL |

Note this query intentionally connects as `AGROLINK_INGESTA_DB_USER` (`SELECT`-only) — proving
the seeded rows are readable through the exact same role/path the real reporting/status
features use (spec FR-006), not just through the writer role used to seed them.

## Idempotency check (Edge Case / FR-003)

Re-run the seed and re-run the verify query — the count for each of the two seeded natural
keys MUST stay at exactly 1, and the command MUST exit successfully both times:

```bash
make seed-telemetry
make seed-telemetry   # second run: "INSERT 0 0" (conflict, no error, no duplicates)
```

## Production-safety check (FR-004)

Confirm the seed script is never part of the automatic database bootstrap:

```bash
grep -R "seed-demo-telemetry" deploy/compose.yaml   # expect: no match
ls deploy/db/                                        # expect: only 01-schema.sql, 02-roles.sql
```

`deploy/seed/seed-demo-telemetry.sql` only runs when a developer explicitly invokes
`make seed-telemetry` — it is never mounted into `docker-entrypoint-initdb.d`, so a production
deployment (which reuses the same `deploy/compose.yaml`) never executes it.
