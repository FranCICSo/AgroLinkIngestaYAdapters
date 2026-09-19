# Phase 1 Data Model: Seed Local Telemetry Readings

No new entity, table, or schema change. This feature adds two rows to the existing
`telemetria.lectura_telemetria` hypertable (`deploy/db/01-schema.sql`), mapped in code by the
existing, unchanged `ar.utn.agrolink.ingesta.telemetry.LecturaTelemetria` entity.

## Entity: Lectura de Telemetría (existing)

Fields relevant to the two seeded rows (column → seed value), both for device
`860693084873877`:

| Column | Reading A (`2026-09-17T02:08:15.259Z`) | Reading B (`2026-09-10T03:10:30.907Z`) |
|---|---|---|
| `dispositivo_id` | `860693084873877` | `860693084873877` |
| `momento_evento` | `2026-09-17 02:08:15.259+00` | `2026-09-10 03:10:30.907+00` |
| `momento_recepcion` | `2026-09-17 02:08:15.265483+00` | `2026-09-10 03:10:31.739054+00` |
| `latitud` | `-34.601150` | `-27.806560` |
| `longitud` | `-58.441300` | `-64.296830` |
| `velocidad_kmh` | `0.0` | `0.0` |
| `rumbo_grados` | `131` | `11` |
| `odometro_km` | `0` | `17315.569` |
| `odometro_origen` | `GPS` | `GPS` |
| `combustible_pct` | `0.0` | `0.0` |
| `satelites` | `9` | `12` |
| `estado_interpretacion` | `PARCIAL` | `PARCIAL` |
| `campos_faltantes` | `{momentoEvento,combustiblePct}` | `{momentoEvento,combustiblePct}` |
| `datos_can` | `{"2": "", "3": "", "14": "", "2A": "", "2C": ""}` | `{}` |
| `payload_crudo` | `>REQ00000000000000-3460115-058441300001317F0000000000000130109FFFF1119;1=,2=,3=,B=,14=,15=,2A=,2C=;#0004;ID=860693084873877;*59<` | `manual-insert-860693084873877-20260910T031030907Z` |
| `frame_hash` | `b5e53b98806a25df520ae0a4dc9db48f9bd40fa10fc5bbe9f5370c2663cf90e4` | `c2c9df544e76292467ffa3f7d625e8268a151cd6dc73bed85f67940d50f31600` |
| `msg_num` | `0004` | `NULL` |
| `reporte_id` | `00` | `NULL` |

Columns not listed (`rpm`, `combustible_consumido_l`, `temperatura_refrigerante_c`,
`presion_aceite_kpa`, `tension_bateria_v`, `vin`) are left `NULL`/unset for both
rows, matching the source data provided — this device/message type does not report them (they
are not part of the `momentoEvento`/`combustiblePct`-only "missing fields" set because they were
never expected from this message in the first place, only the two explicitly listed fields are
flagged as missing-but-expected).

Note: `ignicion` was given as `false` in the source data for both rows; since the column is
nullable and not part of `campos_faltantes`, it is seeded as `false` (not `NULL`) for both
readings, matching the provided values.

**Natural key** (used for idempotent insert, matches `lectura_dedup_uq`):
`(dispositivo_id, momento_evento, frame_hash)`.

**No state transitions** — rows are immutable once inserted (Principle IV); this feature never
updates them after the initial insert.
