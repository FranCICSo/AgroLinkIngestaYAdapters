# Phase 0 — Research: Exposición estructurada de campos CAN bus

**Feature**: `003-can-fields-expansion` | **Date**: 2026-09-13 (revisado tras Clarifications)

Todas las incógnitas de negocio ya están resueltas en `spec.md` (sección Clarifications).
Este documento cubre las decisiones **técnicas** necesarias para implementarlas, y
reemplaza la versión anterior de este archivo (que solo cubría `2A`/`2C` y excluía VIN).

---

## D-01: Cómo aplicar el cambio de esquema sin herramienta de migraciones

**Decision**: Editar `deploy/db/01-schema.sql` directamente, agregando

```sql
vin                           VARCHAR(20),
rpm                            SMALLINT,
combustible_consumido_l        NUMERIC(10,2),
temperatura_refrigerante_c     SMALLINT,
presion_aceite_kpa             SMALLINT,
```

a la definición de `telemetria.lectura_telemetria`, justo después de `combustible_pct`.
Para un entorno ya desplegado, documentar en `quickstart.md` el `ALTER TABLE` equivalente
(`docker-entrypoint-initdb.d` solo ejecuta los scripts la primera vez que se crea el
volumen de datos).

**Rationale**: Mismo mecanismo ya usado para `odometro_m`/`combustible_pct` (feature 001)
y para la primera versión de esta feature. No hay Flyway/Liquibase en el proyecto;
introducirlo ahora para cinco columnas nullable sería una complejidad no justificada.

**Alternatives considered**: sin cambios respecto de la versión anterior de este
documento — ver el historial de `git log -p` de este archivo si se necesita el detalle de
por qué se descartó adoptar una herramienta de migraciones o hacer backfill histórico.

---

## D-02: Dónde vive la extracción de cada valor CAN

**Decision**:
- `1` (VIN), `2` (RPM), `14` (combustible consumido) y `2A`/`2C` (temperatura de
  refrigerante / presión de aceite) se resuelven en
  `rinho-receptor/src/domain/lecturaMapper.js`, cada uno con su propio `resolveX(can,
  camposFaltantes)`, con el mismo patrón que `resolveCombustiblePct`: leer del `Map` que
  produce `parseCanSection`, si falta o está vacío empujar el nombre del campo a
  `camposFaltantes` y devolver `null`. **Sin** el chequeo de rango que sí tiene
  `resolveCombustiblePct` (`isValidCombustible`) — el spec (Edge Cases) pide exponer el
  valor reportado tal cual, sin validarlo físicamente.
  - **VIN es la única excepción de tipo**: no se convierte a número (contrato
    `rinho-eq-frame.md`, discrepancia (c) — es alfanumérico, `1M8GDM9A_KP042788`). Su
    "resolver" solo verifica que la clave exista y no esté vacía; si falta, `null` +
    `camposFaltantes.push('vin')`.
  - Los cinco identificadores se agregan a `CAN_IDS_PROMOVIDOS`. `1` (VIN) ya estaba en
    ese set desde el diseño original (evitaba que el VIN llegara a `datos_can`), pero
    nunca tuvo un resolver que capturara su valor — quedaba en un limbo de "ni
    columna ni JSON", es decir, descartado en la práctica. Ahora sí lo captura.
- `3` (velocidad de rueda) es el **único** identificador que sigue sin promover: no se
  pidió como columna (spec, Clarifications). El servicio Java lo lee a demanda, por
  clave, desde `datos_can` ya persistido, en el momento de construir la respuesta de
  `GET .../estado` — nunca desde `payload_crudo`.

**Rationale**: Sigue el criterio ya fijado en el spec ampliado: cinco valores pedidos
explícitamente como columna nueva (VIN, RPM, combustible consumido, temperatura de
refrigerante, presión de aceite), uno explícitamente descartado como columna (velocidad
de rueda). Mantener a `lecturaMapper.js` como único lugar que interpreta la trama del
fabricante (Principio I) evita que el servicio Java necesite conocer nada del formato de
trama Rinho.

**Alternatives considered**:
- *Promover también velocidad de rueda a columna*: simplificaría el Constitution Check
  (eliminaría la última nota de Principio I), pero el usuario no la pidió como columna al
  ampliar el alcance — se deja como mejora futura si aparece esa necesidad, documentada en
  Complexity Tracking del plan.

---

## D-03: Tipo y nombre de las columnas nuevas

**Decision**:

| Columna | Tipo SQL | Origen CAN | Nota |
|---------|----------|------------|------|
| `vin` | `VARCHAR(20)` | `1` | Alfanumérico, nunca convertido a número. 20 caracteres cubre el VIN de 17 caracteres estándar más margen (el pedido original hablaba de "16 dígitos ASCII"). |
| `rpm` | `SMALLINT` | `2` | El pedido original especifica "4 dígitos entero" (máx. 9999); `SMALLINT` (hasta 32767) alcanza sin `CHECK` de rango — el spec pide no validar rango físico. |
| `combustible_consumido_l` | `NUMERIC(10,2)` | `14` | El pedido original especifica "8 dígitos + 2 decimales"; unidad confirmada en litros por el usuario (Clarifications). |
| `temperatura_refrigerante_c` | `SMALLINT` | `2A` | Sin cambios respecto de la versión anterior de este documento. |
| `presion_aceite_kpa` | `SMALLINT` | `2C` | Sin cambios respecto de la versión anterior de este documento. |

Todas nullable, sin `CHECK` de rango (spec, Edge Cases: exponer valores fuera de rango tal
como se reportan). Mapeo Java: `String vin`, `Integer rpm`, `Double combustibleConsumidoL`,
`Integer temperaturaRefrigeranteC`, `Integer presionAceiteKpa` en `LecturaTelemetria`.

**Rationale**: Mismo criterio de tipos que las columnas ya existentes (`SMALLINT` para
enteros acotados como `rumbo_grados`; `NUMERIC` con dos decimales para magnitudes con
fracción como `combustible_pct`; `VARCHAR` con margen para identificadores de texto como
`dispositivo_id`).

**Alternatives considered**:
- *`INTEGER` en vez de `SMALLINT` para `rpm`*: el pedido original acota a 4 dígitos
  (máx. 9999); `SMALLINT` alcanza y es consistente con el resto del esquema. Si en el
  futuro aparece un motor que reporte más de 32767 rpm (no existe en la práctica), se
  amplía entonces.
- *`VARCHAR(17)` estricto para `vin`*: se prefiere `VARCHAR(20)` con margen, igual
  criterio que `dispositivo_id VARCHAR(20)`, para no bloquear una trama real si el
  fabricante reporta un VIN con algún caracter de relleno.

---

## D-04: Forma de leer `datos_can` del lado Java sin agregar dependencias

**Decision**: Sin cambios respecto de la versión anterior de este documento — un helper
de una sola responsabilidad, `DatosCanCrudoReader`, en el paquete `estado/`, usando
`com.fasterxml.jackson.databind.ObjectMapper` (ya transitivo). La única diferencia es de
**alcance de uso**: antes se usaba para tres campos (RPM, velocidad de rueda, combustible
consumido), ahora solo para uno (velocidad de rueda), porque los otros dos pasaron a ser
columnas propias (D-02). La clase se mantiene igual de genérica (no se acopla a un único
id) por si en el futuro aparece otro campo que deba leerse a demanda sin columna propia.

**Rationale**: Ver la versión anterior de este documento — el razonamiento no cambia.

**Alternatives considered**: sin cambios.

---

## D-05: Corrección de la documentación del protocolo (feature 001)

**Decision**: Corregir `specs/001-ingesta-adaptacion-telemetria/contracts/rinho-eq-frame.md`
en los puntos que esta feature deja objetivamente desactualizados:
- Tabla §4 y tabla de la sección CAN en §5-bis: el "Destino" de `1`, `2`, `14`, `2A` y `2C`
  pasa de `datos_can` (o "⛔ descartado") a su columna nueva correspondiente.
- Discrepancia (c): quitar la frase "podría enmascarar el descarte del VIN que exige el
  Principio V" (el VIN ya no se descarta); conservar la regla técnica real y vigente —el
  parser no debe convertir el VIN a número, se trata como string opaco.
- Discrepancia (d): quitar "no debe usarse para ningún cálculo hasta confirmar la unidad"
  (la unidad ya está confirmada en litros); dejar una nota de que el valor de la trama de
  ejemplo (`30000`) sigue siendo alto para el tipo de vehículo observado — posible trama
  sintética o contador acumulado de larga data, dato a tener en cuenta al interpretar
  valores históricos, pero ya no un bloqueo de unidad.

**Rationale**: Dejar esta documentación sin corregir induciría al mismo error que motivó
la sesión de clarificación (una cita de "Principio V" que nunca aplicó al VIN). El
contrato de protocolo es la referencia que se consulta al tocar `lecturaMapper.js`; si
queda desactualizado, el próximo cambio en esa zona hereda el mismo malentendido.

**Alternatives considered**:
- *Dejar la documentación vieja y solo corregir el código*: rechazado — es exactamente el
  patrón que ya causó el malentendido original (código y documentación divergentes sobre
  una regla de la Constitución).

---

## Resumen de decisiones

| Decisión | Sección |
|----------|---------|
| Mecanismo de cambio de esquema sin migraciones | D-01 |
| Ubicación de cada extracción de valor CAN (5 en receptor, 1 en Java a demanda) | D-02 |
| Tipo/nombre de las 5 columnas nuevas | D-03 |
| Lectura de `datos_can` del lado Java sin dependencias nuevas (ahora 1 solo campo) | D-04 |
| Corrección de la documentación del protocolo (feature 001) | D-05 |
