# Phase 0 — Research: Ingesta de lecturas de sensores BLE

**Feature**: `008-ble-sensor-ingestion` | **Date**: 2026-09-27

Las decisiones de negocio están en `spec.md` (Clarifications, sesión 2026-09-27). Este
documento cubre las decisiones **técnicas**. Fuente del protocolo:
`docs/handoff/ble-sensores.md` (análisis de `docs.rinho.com.ar`, sin hardware).

---

## D-01: Cómo separar GPS / CAN / BLE dentro del body

**Decision**: `splitBody` (`rinho-receptor/src/net/udpServer.js`) pasa de "todo lo que
sigue al primer `;` es CAN" a un split posicional del body en segmentos por `;`:

| Posición | Segmento |
|----------|----------|
| 0 | GPS (con el prefijo `REQ` ya quitado) |
| 1 | CAN (puede faltar o venir vacío) |
| 2 | BLE (opcional) |
| ≥ 3 | Inesperados: se ignoran y se registra un `log.warn` con la trama cruda |

`frame.js` ya conserva en el body todo segmento que no sea `#msgNum` ni `ID=`, unido por
`;`, así que el tercer segmento llega a `splitBody`. **Pero hoy descarta todos los
segmentos vacíos** (`.filter((seg) => seg !== '')`), no solo el vacío final que siempre
deja `;*`. Con un CAN vacío (`REQ<gps>;;T0=...`), el segmento BLE se correría a la
posición 1 y se leería como CAN. Por eso `parseOneFrame` pasa a descartar **solo el
último** elemento vacío (el que produce el `;` antes del `*`) y conserva los intermedios.
Para las tramas actuales no cambia nada: un segmento vacío intermedio solo llega al body
como CAN vacío, y `parseCanSection('')` ya devuelve un mapa vacío.

**Rationale**: La sección CAN usa IDs hex de 1–2 caracteres, así que `B` y `B0` son IDs
CAN válidos: reconocer BLE por sus claves (`T0`/`H0`/`B0`) es ambiguo (spec FR-002). La
posición es la única señal que no se puede confundir.

**Alternatives considered**:
- *Dejar `frame.js` como está y suponer CAN siempre no vacío* — es lo que hace el equipo
  real con `QEQ,5` (emite `1=,2=,...` aunque no haya ECU), pero atar el orden posicional
  a un supuesto no verificado (D-07) es innecesario cuando el arreglo es de una línea.
- *Detectar el segmento BLE por la forma de sus claves* — descartado por la colisión
  con `B0`.
- *Prefijo propio para el segmento (p. ej. `;BLE:T0=...`)* — cambiaría el formato
  documentado en el handoff y gastaría bytes del límite de 239 del reporte de usuario;
  no aporta nada mientras el orden sea fijo.

---

## D-02: Parser del segmento BLE

**Decision**: Módulo nuevo `rinho-receptor/src/protocol/bleSection.js`,
`parseBleSection(text) → Map<clave, valorString>`, con la misma forma que
`parseCanSection`: pares separados por `,`, clave y valor separados por el primer `=`,
valores como string opaco. El mapper decide el tipo.

**Rationale**: Con la misma forma que el parser CAN, el mapper trata ambos segmentos igual
y el parser queda testeable por separado (Principio VIII). No se reutiliza
`parseCanSection` directamente porque son contratos distintos que pueden divergir cuando
se verifique con hardware (D-07).

**Alternatives considered**: reutilizar `parseCanSection` sin wrapper — funciona hoy,
pero ata dos contratos del fabricante independientes a una misma función.

---

## D-03: Validación numérica de los valores BLE

**Decision**: Un valor BLE se acepta solo si cumple `^-?\d+(\.\d+)?$`, y en ese caso
se convierte con `Number()`. Cualquier otro valor (vacío incluido) → `null`; si además
queda registrado en `campos_faltantes` depende de si el segmento vino (D-04).

**Rationale**: `Number()` solo acepta cosas que no son lecturas: `Number('')` es `0`
(lectura inventada), y `Number(' 12 ')`, `Number('0x1A')`, `Number('1e3')` y
`Number('Infinity')` dan valores que el sensor nunca envió. Con un patrón explícito, lo
guardado se reconstruye desde `payload_crudo` sin ambigüedad (SC-004).

**Alternatives considered**: `Number.isNaN(Number(raw))`, como en los resolvers CAN.
Descartado por los casos de arriba (para CAN el riesgo es el mismo, pero corregirlo ahí
está fuera de alcance).

---

## D-04: Efecto sobre `estado_interpretacion` y `campos_faltantes`

**Decision**:

| Situación | Valor | ¿Entra en `campos_faltantes`? | ¿Degrada a `PARCIAL`? |
|-----------|-------|-------------------------------|------------------------|
| Segmento BLE ausente o vacío | `null` | No | No |
| Segmento presente, clave del slot 0 ausente | `null` | Sí | Sí |
| Segmento presente, `T0=` (valor vacío) | `null` | Sí | Sí |
| Segmento presente, valor no numérico | `null` | Sí | Sí |
| Valor numérico fuera de rango físico | tal cual | No | No |

Nombres en `campos_faltantes`: `bleTemperaturaC`, `bleHumedadPct`, `bleBateria`.

**Rationale**:
- FR-007: la ausencia del segmento es el caso normal hoy. Si degradara, todas las
  lecturas actuales pasarían a `PARCIAL`, rompiendo SC-002.
- Si el segmento vino, el equipo está configurado para informar el sensor, y que falte
  un valor es tan relevante como que falte un ID CAN: mismo criterio que
  `combustiblePct`.
- Fuera de rango se guarda tal cual, por la spec (Edge Cases) y por coherencia con la
  feature 003.

---

## D-05: Tipos de columna

**Decision**: Tres columnas nullable en `telemetria.lectura_telemetria`, todas
`NUMERIC` **sin precisión ni escala**:

| Columna | Contenido |
|---------|-----------|
| `ble_temperatura_c` | Temperatura del sensor 0, °C |
| `ble_humedad_pct` | Humedad relativa del sensor 0, % |
| `ble_bateria` | Batería del sensor 0, valor crudo; unidad pendiente (% o mV) |

**Rationale**:
- Si una lectura no entra en la columna, el `INSERT` falla y el receptor no manda ACK
  (`udpServer.js`). El equipo reintenta la misma trama **para siempre**, así que un tipo
  acotado convierte un valor fuera de rango en un bucle de reintentos. `NUMERIC` sin
  límites no desborda.
- `NUMERIC` sin escala tampoco redondea: guarda exactamente los decimales que mandó el
  sensor (SC-001, SC-004). `DOUBLE PRECISION` introduce error binario (23.5 sí es exacto,
  23.1 no).
- `ble_bateria` no lleva unidad en el nombre y admite `3012` (mV) o `85` (%) sin cambio de
  esquema (spec, Clarifications).
- El prefijo `ble_` agrupa las columnas y evita confundir `ble_temperatura_c` con
  `temperatura_refrigerante_c` (CAN).

**Alternatives considered**:
- `NUMERIC(5,1)` / `NUMERIC(7,2)` — riesgo de desborde y de reintento infinito, ver
  arriba.
- Nombres del handoff (`temperatura_c`, `humedad_pct`, `bateria_sensor_mv`) — ambiguos
  junto a las columnas CAN, y `_mv` fija una unidad no confirmada.
- Tabla hija por slot — descartada en la clarificación (solo slot 0).

---

## D-06: Aplicación del esquema: migración `003` + `01-schema.sql`

**Decision**:
- Nuevo `deploy/migrations/003_add_ble_sensor_fields.sql`, con
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` para las tres columnas. Se aplica en cada
  deploy con `deploy/scripts/apply-migrations.sh` (feature 007).
- Las mismas tres columnas se agregan a `deploy/db/01-schema.sql`, para volúmenes nuevos.

**Rationale**: Es el mecanismo vigente desde la feature 007
(`deploy/migrations/README.md`). Las regla 3 (una transacción) y la 4 (sin
`UPDATE`/`DELETE`) se cumplen: solo se agregan columnas nullable sin `DEFAULT`, así que
ninguna fila existente se toca (Principio IV). Los `GRANT` de `02-roles.sql` son de tabla,
no de columna, así que `rinho_receptor` puede insertar en las columnas nuevas sin cambios
de roles.

**Dependencia**: `002_add_can_fields.sql` todavía no está trackeado en git. El número
`003` supone que `002` se commitea y shipea antes o junto con esta feature. Si `002`
cambiara de número, `003` debe quedar mayor que él (regla 1 del README).

**Alternatives considered**: solo editar `01-schema.sql`, como en la feature 003 —
dejaría producción sin las columnas, y el `INSERT` del receptor fallaría con cada trama
(sin ACK, reintentos infinitos) desde el primer deploy.

---

## D-07: Supuestos del formato que solo el hardware puede confirmar

**Decision**: No se diseña para variantes del formato especulativas. El receptor acepta
exactamente el formato del handoff, y los supuestos sin verificar quedan listados en el
contrato (`contracts/rinho-ble-segment.md` §5) y en la guía de puesta en marcha
(FR-013), cada uno con cómo se detecta y qué ajustar:

| Supuesto | Qué pasa si es falso |
|----------|----------------------|
| `QEQ,5` + `#` producen la sección GPS de 66 caracteres (`#` = `AA`) | `parseGpsSection` falla por largo; la trama se rechaza con `log.error` y la trama cruda. Visible, no silencioso. |
| `QEQ,5` incluye la sección CAN antes del segmento BLE | El segmento BLE se interpreta como CAN: los valores quedan en `datos_can` y las columnas BLE en `null`. Detectable en la guía comparando la trama capturada. |
| `QEQ,5` no agrega su propio `;ID=`/checksum | Pueden quedar dos `ID=` o un checksum inválido; la trama se rechaza con log. |
| El reporte `GU` por UDP lleva `#msgNum` | Sin `#`, la lectura se persiste pero no hay ACK (comportamiento ya existente). |
| Unidad de `batt` | Solo cambia la documentación; `ble_bateria` no tiene unidad en el nombre (D-05). |
| Formato de `QBS00.temp` (decimales, ×10) | Si viene ×10 (como `SUV`), se guarda el crudo; se corrige en una feature posterior con datos reales. |

**Rationale**: No hay sensor físico. Tolerar formatos inventados sería código sin
contrato que lo respalde; la memoria del proyecto ya registra que la documentación del
fabricante llevó a un error de protocolo. Lo que sí importa es que un formato distinto
**falle a la vista** (log o evidencia en la lectura), nunca en silencio (Principio IX).

---

## D-08: Herramienta de tramas de prueba

**Decision**: `buildFrame` (`rinho-receptor/test/tools/buildFrame.js`) acepta la opción
`ble` (string con los pares, p. ej. `T0=23.5,H0=45.0,B0=3012`) y el flag CLI `--ble`. Si
se pasa `ble` sin `can`, se emite el segmento CAN vacío (`REQ<gps>;;<ble>`) para
respetar el orden posicional (D-01; funciona gracias al cambio en `frame.js`). El checksum
se recalcula sobre la trama final, como ya hace.

**Rationale**: FR-010. Las tramas fixture de los tests y del quickstart salen de la
misma herramienta que ya se usa para concurrencia y para el quickstart de la 001.
