-- Seed local telemetry readings for device 860693084873877 (feature 006).
--
-- NOT part of docker-entrypoint-initdb.d (deploy/db/): this file is never auto-executed by
-- deploy/compose.yaml, in any environment, including the production VM (see
-- specs/006-seed-lectura-telemetria/research.md, D-02). Run it explicitly via
-- `make seed-telemetry`, which connects as the rinho_receptor role -- the only role with
-- INSERT on telemetria.lectura_telemetria (Principio IV, deploy/db/02-roles.sql).
--
-- Idempotent: ON CONFLICT targets the same natural key as the existing lectura_dedup_uq
-- unique index, so re-running this file is a no-op on the second and later runs.

SET search_path TO telemetria;

INSERT INTO lectura_telemetria (
    dispositivo_id, momento_evento, momento_recepcion,
    latitud, longitud, velocidad_kmh, rumbo_grados,
    odometro_km, odometro_origen, combustible_pct,
    ignicion, satelites, estado_interpretacion, campos_faltantes, datos_can,
    payload_crudo, frame_hash, msg_num, reporte_id
) VALUES
    (
        '860693084873877', '2026-09-17 02:08:15.259000+00', '2026-09-17 02:08:15.265483+00',
        -34.601150, -58.441300, 0.0, 131,
        0, 'GPS', 0.0,
        false, 9, 'PARCIAL', ARRAY['momentoEvento', 'combustiblePct'],
        '{"2": "", "3": "", "14": "", "2A": "", "2C": ""}'::jsonb,
        '>REQ00000000000000-3460115-058441300001317F0000000000000130109FFFF1119;1=,2=,3=,B=,14=,15=,2A=,2C=;#0004;ID=860693084873877;*59<',
        'b5e53b98806a25df520ae0a4dc9db48f9bd40fa10fc5bbe9f5370c2663cf90e4', '0004', '00'
    ),
    (
        '860693084873877', '2026-09-10 03:10:30.907000+00', '2026-09-10 03:10:31.739054+00',
        -27.806560, -64.296830, 0.0, 11,
        17315.569, 'GPS', 0.0,
        false, 12, 'PARCIAL', ARRAY['momentoEvento', 'combustiblePct'],
        '{}'::jsonb,
        'manual-insert-860693084873877-20260910T031030907Z',
        'c2c9df544e76292467ffa3f7d625e8268a151cd6dc73bed85f67940d50f31600', NULL, NULL
    )
ON CONFLICT (dispositivo_id, momento_evento, frame_hash) DO NOTHING;
