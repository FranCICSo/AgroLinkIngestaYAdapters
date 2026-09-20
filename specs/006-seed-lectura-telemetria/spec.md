# Feature Specification: Seed Local Telemetry Readings

**Feature Branch**: `006-seed-lectura-telemetria`

**Created**: 2026-09-17

**Status**: Draft

**Input**: User description: "I need to implement a seader layer as it is done in AgroLinkBackend to populate data in lectura_telemetria. I need to add telemetry data with two known real readings for device 860693084873877 (event times 2026-09-17T02:08:15.259Z and 2026-09-10T03:10:30.907Z, with position, odometer, fuel, and interpretation-state fields as captured from the real device)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Realistic telemetry is available in every local environment (Priority: P1)

A developer resets their local database and starts the ingesta service in the local
environment. They need real, previously-observed telemetry readings for device
`860693084873877` to be present automatically, so they can exercise the trip-report and
vehicle-status read paths (and validate consumers such as AgroLinkBackend that depend on this
service's data) without manually crafting rows that satisfy the table's partitioning and
deduplication rules by hand.

**Why this priority**: Without this, validating any feature that reads `lectura_telemetria`
locally requires manually inserting rows that respect the hypertable's partition column and
the `(dispositivo_id, momento_evento, frame_hash)` deduplication constraint — slow, easy to get
wrong, and a poor substitute for real captured data.

**Independent Test**: Start a fresh local environment, then query telemetry readings for device
`860693084873877` — the two known readings should exist, fully populated, without any manual
data entry.

**Acceptance Scenarios**:

1. **Given** a fresh local environment, **When** the ingesta service and its database finish
   starting, **Then** a telemetry reading for device `860693084873877` with event time
   `2026-09-17T02:08:15.259Z` exists with position `(-34.601150, -58.441300)`, speed `0.0` km/h,
   heading `131`, odometer `0` km sourced from GPS, fuel `0.0%`, `9` satellites, interpretation
   state `PARCIAL` with missing fields `momentoEvento` and `combustiblePct`, and its original raw
   payload and frame hash preserved unchanged.
2. **Given** a fresh local environment, **When** the ingesta service and its database finish
   starting, **Then** a telemetry reading for device `860693084873877` with event time
   `2026-09-10T03:10:30.907Z` exists with position `(-27.806560, -64.296830)`, speed `0.0` km/h,
   heading `11`, odometer `17315.569` km sourced from GPS, fuel `0.0%`, `12` satellites,
   interpretation state `PARCIAL` with missing fields `momentoEvento` and `combustiblePct`, and
   its original raw payload and frame hash preserved unchanged.
3. **Given** those seeded readings, **When** a trip-report or vehicle-status query is run for
   device `860693084873877` over a time range covering both event times, **Then** both readings
   are returned in the result, ordered by event time, with no manual setup beyond starting the
   local environment.

---

### Edge Cases

- Restarting the local environment repeatedly, or re-running the seeding step against a
  database that already contains these two readings, MUST NOT create duplicate rows and MUST
  NOT fail — the readings' natural key is `(dispositivo_id, momento_evento, frame_hash)`.
- Seeding MUST NOT ever run against, or insert data into, a production or test database — only
  the local development environment is affected.
- Seeding MUST NOT update or delete any existing reading, including these two once inserted:
  `lectura_telemetria` is insert-only and immutable, and seeding does not get an exception to
  that rule.
- If a reading with the same natural key already exists locally with different field values
  (e.g., from prior manual testing), seeding MUST leave the existing row untouched rather than
  overwrite it, since overwriting would require an update on an insert-only table.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The local environment MUST include a telemetry reading for device
  `860693084873877` at event time `2026-09-17T02:08:15.259Z` (received at
  `2026-09-17T02:08:15.265483Z`) with: latitude `-34.601150`, longitude `-58.441300`, speed
  `0.0` km/h, heading `131`, odometer `0` km from source `GPS`, fuel level `0.0%`, `9`
  satellites, interpretation state `PARCIAL`, missing fields `momentoEvento` and
  `combustiblePct`, CAN data `{"2": "", "3": "", "14": "", "2A": "", "2C": ""}`, raw payload
  `>REQ00000000000000-3460115-058441300001317F0000000000000130109FFFF1119;1=,2=,3=,B=,14=,15=,2A=,2C=;#0004;ID=860693084873877;*59<`,
  frame hash `b5e53b98806a25df520ae0a4dc9db48f9bd40fa10fc5bbe9f5370c2663cf90e4`, message number
  `0004`, and report id `00`.
- **FR-002**: The local environment MUST include a telemetry reading for device
  `860693084873877` at event time `2026-09-10T03:10:30.907Z` (received at
  `2026-09-10T03:10:31.739054Z`) with: latitude `-27.806560`, longitude `-64.296830`, speed
  `0.0` km/h, heading `11`, odometer `17315.569` km from source `GPS`, fuel level `0.0%`, `12`
  satellites, interpretation state `PARCIAL`, missing fields `momentoEvento` and
  `combustiblePct`, empty CAN data, raw payload
  `manual-insert-860693084873877-20260910T031030907Z`, and frame hash
  `c2c9df544e76292467ffa3f7d625e8268a151cd6dc73bed85f67940d50f31600`.
- **FR-003**: Seeding these readings MUST be idempotent: running it against a local database
  that already has one or both readings (matched by device id, event time, and frame hash)
  MUST NOT insert duplicates and MUST NOT fail.
- **FR-004**: Seeding MUST apply only to the local development environment and MUST have no
  effect on test or production data.
- **FR-005**: Seeding MUST perform inserts only — it MUST NOT update or delete any existing row
  in `lectura_telemetria`, consistent with the table's insert-only, immutable design.
- **FR-006**: The seeded readings MUST be retrievable through the same read paths the ingesta
  service already exposes for real telemetry (e.g., trip report and vehicle status queries) with
  no code changes required to those paths.

### Key Entities *(include if feature involves data)*

- **Lectura de Telemetría (Telemetry Reading)**: A single immutable, insert-only record of a
  device's reported state at one point in time — device id, event time, receipt time, position,
  speed, heading, odometer value and source, fuel level, satellite count, interpretation
  completeness state with any missing fields, raw CAN bus data, the original raw payload, and a
  frame hash used for deduplication. This feature adds two known real-world instances of this
  entity for device `860693084873877`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After starting a fresh local environment, both specified telemetry readings for
  device `860693084873877` are queryable within the same startup time budget as the rest of the
  local environment's seeded data, with no manual steps.
- **SC-002**: Restarting the local environment any number of times never changes the count of
  matching readings for device `860693084873877` beyond the two specified — no duplicates
  appear.
- **SC-003**: A developer can validate any telemetry-dependent read feature against a real
  device id end-to-end locally (ingesta service and any consuming service) without writing a
  single manual SQL insert.

## Assumptions

- This feature seeds only the `lectura_telemetria` table owned by this service (the ingesta
  adaptation layer). It does not create or modify the corresponding vehicle/fleet or telemetry
  provider records in AgroLinkBackend — those are already covered by that project's own local
  seeding for device `860693084873877` (plate `AH690AJ`, provider `RINHO1`).
- The two readings are seeded verbatim, including their original raw payload strings and frame
  hashes, rather than as newly fabricated synthetic data, since they are real previously-captured
  samples.
- The database-generated identity column (`id`) is not treated as a requirement — the two
  readings are matched and deduplicated by `(dispositivo_id, momento_evento, frame_hash)`, not by
  a specific numeric id.
- "Local environment" means the same local/development setup already used for this project's
  existing local database bring-up; this feature does not introduce a new environment.
