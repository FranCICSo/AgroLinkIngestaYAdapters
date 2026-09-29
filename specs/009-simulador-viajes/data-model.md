# Phase 1 — Data Model: Simulador de Viajes con Dispositivos Ficticios

**Feature**: `009-simulador-viajes` | **Date**: 2026-09-28

Schema Postgres nuevo, `simulador`, en el mismo clúster TimescaleDB que `telemetria` — tablas
regulares (NO hypertables), mutables, editables en caliente vía `psql`/DataGrip (FR-004). Ningún
camino de código del simulador escribe en `telemetria.*`: solo lee/escribe su propio schema y
envía UDP al receptor real, que es quien persiste la telemetría (ver plan.md, Constraints).

## 1. `simulador.camion`

| Columna | Tipo | Null | Notas |
|---------|------|------|-------|
| `id` | `VARCHAR(6)` PK | no | Rango reservado `900001`–`900999` (research.md D-02) |
| `nombre` | `VARCHAR(50)` | no | Patente o alias del camión ficticio |
| `vin` | `VARCHAR(20)` | sí | Opcional; el camión 1 usa `LGWEEUA55TL612021` (dato real de campo) |
| `tipo_carga` | `VARCHAR(20)` | no | `seca` \| `refrigerada` |
| `setpoint_temp_c` | `NUMERIC(4,1)` | sí | Solo si `tipo_carga = 'refrigerada'`; ref. medias reses: 1–4 °C |
| `setpoint_humedad_pct` | `NUMERIC(5,2)` | sí | Solo si `tipo_carga = 'refrigerada'`; ref. medias reses: 85–90% |
| `odometro_inicial_km` | `NUMERIC(10,3)` | no | Punto de partida del odómetro acumulado (camión 1: `150200`) |
| `activo` | `BOOLEAN` | no | `DEFAULT true`; en `false` el camión no emite (US3) |

**Validaciones** (aplicadas por el simulador antes de emitir, no por `CHECK` de Postgres — para
poder loguear el motivo en vez de que la fila falle a insertar por accidente al editarla a mano):
- `id` debe matchear `^900[0-9]{3}$`.
- `setpoint_temp_c`/`setpoint_humedad_pct` obligatorios si `tipo_carga = 'refrigerada'`, ausentes
  si `tipo_carga = 'seca'` (US2, escenario 4: sin carga refrigerada no hay segmento BLE).

## 2. `simulador.ruta`

| Columna | Tipo | Null | Notas |
|---------|------|------|-------|
| `id` | `SERIAL` PK | no | |
| `nombre` | `VARCHAR(100)` | no | Referencia humana (ej. "Mercado Central → depósito X") |
| `puntos` | `JSONB` | no | Arreglo ordenado `[{lat, lon}, ...]`; ruta 1: los 88 puntos reales del dispositivo `860693084873877` |
| `paradas` | `JSONB` | no | Arreglo de índices sobre `puntos` marcados como entrega (`[{indice, duracion_min}]`); 1–3 por ruta |

- `puntos` y `paradas` usan JSONB (no una tabla hija) porque se leen siempre completos por
  camión y nunca se consultan por campo individual — no hay necesidad demostrada de
  normalizarlos (Principio III aplicado por analogía a diseño de datos).

## 3. `simulador.viaje`

| Columna | Tipo | Null | Notas |
|---------|------|------|-------|
| `id` | `SERIAL` PK | no | |
| `camion_id` | `VARCHAR(6)` FK → `camion.id` | no | |
| `ruta_id` | `INTEGER` FK → `ruta.id` | no | |
| `sentido` | `VARCHAR(6)` | no | `ida` \| `vuelta` — determina si `ruta.puntos` se recorre en orden o invertido (research.md D-07) |
| `indice_actual` | `INTEGER` | no | `DEFAULT 0`; posición actual dentro de `ruta.puntos` (en el sentido del viaje) |
| `odometro_actual_km` | `NUMERIC(10,3)` | no | Arranca en `camion.odometro_inicial_km`, acumula con la distancia entre puntos consecutivos |
| `estado` | `VARCHAR(12)` | no | `en_curso` \| `finalizado` — un viaje `finalizado` dispara la creación automática del siguiente (FR-014) |
| `falla_tipo` | `VARCHAR(20)` | sí | `NULL` \| `apertura_puerta` \| `falla_compresor` (FR-015/FR-016) |
| `falla_indice_disparo` | `INTEGER` | sí | Índice de `ruta.puntos` en el que arranca la falla; `NULL` si `falla_tipo` es `NULL` |

- Un camión tiene como máximo un viaje `en_curso` a la vez (invariante de aplicación, no
  `UNIQUE` de Postgres — permite corregir a mano un estado inconsistente sin pelear con una
  restricción).
- `apertura_puerta` solo tiene sentido si `falla_indice_disparo` coincide con un índice marcado
  en `ruta.paradas`; el simulador lo valida al leer la configuración y lo ignora con un log si no
  coincide, en vez de fallar el ciclo completo (US3, edge case de config inválida).

## 4. Entidad derivada: trama emitida (no persiste en `simulador.*`)

Cada ciclo de 60 s, por camión activo con viaje `en_curso`, el simulador arma (no persiste
localmente, solo construye en memoria y envía por UDP):

| Origen | Campo de la trama | Fuente |
|--------|--------------------|--------|
| GPS | lat/lon/velocidad/rumbo | `ruta.puntos[indice_actual]` vs. el punto anterior |
| GPS | odómetro | `viaje.odometro_actual_km` |
| GPS | ignición | `false` mientras el punto actual es una parada en curso, `true` en movimiento |
| CAN | `2` (RPM), `15` (combustible %), `14` (consumido L), `2C` (presión aceite) | `domain/sintesisCan.js` (research.md D-05) |
| CAN | `1` (VIN) | `camion.vin` |
| BLE | `T0`/`H0` | `domain/sintesisBle.js` (research.md D-06), solo si `camion.tipo_carga = 'refrigerada'` |
| Envelope | `ID` | `camion.id` |
| Envelope | `#msgNum` | contador incremental por camión, para poder esperar el ACK (FR-011) |

Esta fila es exactamente lo que el receptor real termina insertando en
`telemetria.lectura_telemetria` — el simulador nunca la escribe directo (ver Constraints en
plan.md).
