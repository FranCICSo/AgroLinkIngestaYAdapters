# Implementation Plan: Ingesta de lecturas de sensores BLE

**Branch**: `008-ble-sensor-ingestion` | **Date**: 2026-09-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-ble-sensor-ingestion/spec.md`

## Summary

El receptor `rinho-receptor` acepta un tercer segmento, opcional, en el body de la trama,
con las lecturas BLE del sensor 0 (`T0=<temp>,H0=<hum>,B0=<bat>`), y las persiste en
tres columnas `NUMERIC` nullable nuevas de `telemetria.lectura_telemetria`. Los segmentos
se identifican **por posición**, no por sus claves, porque `B0` también es un ID CAN
válido (research.md D-01). Las tramas EQ actuales, sin el segmento, no cambian en nada:
no degradan a `PARCIAL` ni listan faltantes (D-04). El esquema llega a producción con la
migración versionada `003` (D-06). La funcionalidad entrega además la guía de puesta en
marcha `docs/guias/configuracion-sensor-ble.md` y corrige `GEQ` en el contrato EQ. El
servicio Java no cambia (spec FR-012).

## Technical Context

**Language/Version**: Node.js ≥22 (ES modules) para `rinho-receptor/`; SQL (PostgreSQL /
TimescaleDB) para el esquema. El servicio Java/Spring Boot no se toca.

**Primary Dependencies**: `pg` ^8.13.0, ya presente. Sin dependencias nuevas.

**Storage**: TimescaleDB, hypertable `telemetria.lectura_telemetria`. Suma
`ble_temperatura_c`, `ble_humedad_pct` y `ble_bateria`, las tres `NUMERIC` nullable
(research.md D-05). Se aplican con `deploy/migrations/003_add_ble_sensor_fields.sql` y en
`deploy/db/01-schema.sql`.

**Testing**: `node:test` + `node:assert/strict` (`npm test`), mismo patrón que
`lecturaMapper.test.js`. Las tramas fixture salen de `test/tools/buildFrame.js --ble`.

**Target Platform**: Sin cambios: VM OCI Ampere A1 (linux/arm64), Docker Compose y
pipeline de la feature 007.

**Project Type**: Ampliación de un servicio existente (receptor UDP de ingesta) más
documentación.

**Performance Goals**: Sin cambios. Son tres parámetros más en un `INSERT` existente y un
split de string más por trama.

**Constraints**:
- El receptor sigue siendo el único punto que conoce el formato Rinho (Principio I).
- Ningún valor BLE sin respaldo en `payload_crudo`: no hay datos dummy (FR-008).
- Un valor fuera de rango no puede hacer fallar el `INSERT`. Si falla, no hay ACK y el
  equipo reintenta sin fin; por eso `NUMERIC` sin límites (D-05).
- Las tramas sin segmento BLE producen exactamente las mismas lecturas que hoy (SC-002).
- Sin hardware: el formato es de la documentación del fabricante; los supuestos están en
  `contracts/rinho-ble-segment.md` §5.

**Scale/Scope**: Mismo piloto. Un sensor por vehículo (slot 0).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Gate | Estado |
|-----------|------|--------|
| I. Capas de adaptación | El parseo BLE vive en `rinho-receptor/src/protocol/` y el mapeo al dominio en `lecturaMapper`; nada aguas abajo ve la trama. | ✅ PASS |
| II. Stack Java/Spring + TimescaleDB | El receptor Node ya está justificado desde la feature 001 (research D-01 de esa feature); no se agrega componente ni stack. Persistencia en la misma TimescaleDB. | ✅ PASS |
| III. Mensajería solo por necesidad | Sin broker: UDP → INSERT directo, como hoy. | ✅ PASS |
| IV. Inmutabilidad | La migración solo hace `ADD COLUMN` nullable, sin `DEFAULT` ni `UPDATE`; las filas existentes quedan en `NULL`. El `INSERT` sigue con `ON CONFLICT DO NOTHING`. | ✅ PASS |
| V. Datos personales | Temperatura, humedad y batería de un sensor de carga: ningún dato de chofer. | ✅ PASS |
| VI. Seguridad | Sin puertos, credenciales ni roles nuevos (los `GRANT` son de tabla). La excepción TLS de la 001 sigue igual: checksum + `ID` se validan antes de parsear el segmento BLE. | ✅ PASS |
| VII. Conectividad intermitente | Una trama BLE atrasada se ubica por su `momento_evento`, como cualquier lectura; la dedup por `frame_hash` cubre los reintentos. | ✅ PASS |
| VIII. Testing mínimo | `parseBleSection`, `splitBody` y los tres resolvers BLE, cada uno con caso completo, faltante y valor inválido (quickstart §1). | ✅ PASS |
| IX. Trazabilidad | Valor vacío o inválido: `NULL` + `campos_faltantes` + `PARCIAL`, la trama se persiste igual. Segmentos extra: `log.warn`. Formato distinto al esperado: fallo de parseo con log, o datos visibles en `datos_can` (D-07). Nunca un descarte silencioso. | ✅ PASS |

**Entregables académicos**: consistente con el DER, que ya prevé "sensores de frío" como
fuente de telemetría (Principio I los nombra). Son columnas nuevas en una entidad
existente; no hay entidad nueva ni contradicción.

### Post-Design Re-check (después de Phase 1)

Re-evaluado con `research.md`, `data-model.md`, `contracts/` y `quickstart.md`: sin
violaciones. El diseño agregó un cambio no previsto en el handoff: `frame.js` conserva los
segmentos vacíos intermedios (D-01). Es una corrección de fidelidad al crudo que refuerza
el Principio IX y no altera ninguna trama actual (fixtures de 001/003 en quickstart §1).
Complexity Tracking queda vacío.

## Project Structure

### Documentation (this feature)

```text
specs/008-ble-sensor-ingestion/
├── plan.md              # This file
├── spec.md              # Feature specification (Clarifications, sesión 2026-09-27)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── rinho-ble-segment.md   # Segmento BLE: formato, posición, supuestos H-1..H-8
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
rinho-receptor/src/
├── protocol/
│   ├── frame.js            # CORREGIDO: descarta solo el último segmento vacío, no los intermedios (D-01)
│   ├── bodySections.js     # NUEVO: splitBody(body) → { gpsText, canText, bleText }, posicional;
│   │                       #   movido desde net/udpServer.js para testearlo sin socket (D-01)
│   └── bleSection.js       # NUEVO: parseBleSection(text) → Map<clave, valor string> (D-02)
├── domain/
│   └── lecturaMapper.js    # AMPLIADO: + ble en la entrada; resolvers bleTemperaturaC / bleHumedadPct /
│                           #   bleBateria con validación estricta (D-03) y regla de faltantes (D-04)
├── db/
│   └── lecturaRepository.js # AMPLIADO: + ble_temperatura_c, ble_humedad_pct, ble_bateria en el INSERT
└── net/
    └── udpServer.js        # AMPLIADO: usa splitBody de protocol/, parsea BLE, warn si hay segmentos extra;
                            #   exporta handleFrame para testearla con socket/repositorio falsos

rinho-receptor/test/
├── bleSection.test.js      # NUEVO
├── bodySections.test.js    # NUEVO
├── frame.test.js           # AMPLIADO: segmento vacío intermedio
├── lecturaMapper.test.js   # AMPLIADO: casos BLE (data-model.md §2), incluido 0 válido
├── udpServer.test.js       # NUEVO: handleFrame con BLE → persist con ble* y ACK al origen; sin ACK si falla persist
├── lecturaRepository.integration.test.js  # NUEVO: ida y vuelta de las columnas ble_* (se salta sin DB)
└── tools/buildFrame.js     # AMPLIADO: opción ble / --ble (D-08)

deploy/
├── db/01-schema.sql                          # AMPLIADO: + 3 columnas ble_* (volúmenes nuevos)
└── migrations/003_add_ble_sensor_fields.sql  # NUEVO: ADD COLUMN IF NOT EXISTS × 3 (D-06)

docs/guias/
└── configuracion-sensor-ble.md   # NUEVO (FR-013): emparejamiento, SUC/SRL, trama esperada,
                                  #   captura y comparación con la real, supuestos H-1..H-8

specs/001-ingesta-adaptacion-telemetria/contracts/
└── rinho-eq-frame.md             # CORREGIDO §1: ;@dd..dd de GEQ = destino (GPRS, LOG, SMx…);
                                  #   §2 enlaza al segmento BLE (008)
```

**Structure Decision**: Se amplía el receptor existente siguiendo sus capas actuales:
`protocol/` para lo que conoce el formato, `domain/` para la traducción al modelo, y
`db/` y `net/` sin lógica nueva de protocolo. `splitBody` pasa de `net/` a `protocol/`
porque decide la estructura de la trama (Principio I) y así se testea sin socket. No se
toca el servicio Java.

## Complexity Tracking

Sin violaciones que justificar.

## Dependencias y orden

1. `deploy/migrations/002_add_can_fields.sql` (hoy sin trackear) debe commitearse antes o
   junto con esta feature, porque `003` la asume (research.md D-06).
2. En el deploy, la migración `003` debe aplicarse **antes** de que arranque el receptor
   nuevo: si no, el `INSERT` falla por columna inexistente y no hay ACK. El pipeline ya lo
   garantiza: `.github/workflows/ci-cd.yml` corre `apply-migrations.sh` antes del
   `docker login`/pull y aborta sin tocar el servicio si la migración falla.
