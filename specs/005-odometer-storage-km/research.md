# Phase 0 Research: Almacenar el odómetro en kilómetros

No quedaron `NEEDS CLARIFICATION` en el Technical Context del plan. Este documento
registra las decisiones que sí requerían elegir entre alternativas, incluyendo la
verificación del pedido original contra la documentación del fabricante.

## D-01: Verificación contra la fuente primaria del fabricante

**Decision**: Se confirma que el bus CAN del Rinho Spider IoT reporta el odómetro de
ECU (identificador `B`) en **kilómetros**, tal como indica
`docs.rinho.com.ar/comandos/configuracion-y-consulta-de-estados/canbus/comandos-canxx`
(citado en el pedido de esta feature). Este proyecto ya tenía ese mismo hecho
identificado y documentado desde la feature 001 (`research.md`, decisión D-05,
sesión de clarificación 2026-08-14): "CAN `B` × 1000 [para llevarlo] a metros" — es
decir, el proyecto siempre supo que la fuente es km; lo que hacía era convertirla a
metros para almacenar, y la feature 004 la volvía a convertir a km solo al responder.

**Rationale**: Antes de tocar código hay que confirmar que el pedido no repite el
error que ya ocurrió una vez en este proyecto (memoria: un dato de marketing del
fabricante indujo un error de protocolo que llegó a un plan). Acá es al revés: la fuente
primaria (documentación técnica de comandos, no marketing) confirma exactamente lo que
el pedido asume, y coincide con lo que el propio código del proyecto ya sabía y
compensaba con una conversión. No hay contradicción que resolver, solo una conversión
redundante que eliminar.

**Alternatives considered**: Ninguna — es una verificación, no una decisión de diseño.

## D-02: Qué conversión desaparece y cuál aparece

**Decision**:
- **ECU** (CAN id `B`, `resolveOdometro` en `lecturaMapper.js`): deja de multiplicar por
  1000. El valor crudo (ya en km) se persiste tal cual, como `Number`, sin más
  transformación que el `Number(...)` que ya existía para parsearlo.
- **GPS** (campo nativo de la sección GPS, `eqParser.js`, `odometroGpsM`, en metros):
  pasa a dividirse por 1000 antes de persistirse, en el mismo punto (`resolveOdometro`),
  ya que el fallback GPS es la única fuente que sigue naciendo en una unidad distinta a
  la de almacenamiento.
- `eqParser.js` (parseo de la trama cruda) **no cambia**: sigue devolviendo
  `odometroGpsM` en metros, tal como lo define el contrato del fabricante para ese
  campo — la conversión de unidad es responsabilidad de la capa de mapeo a dominio
  (`lecturaMapper.js`), no del parser de bajo nivel.

**Rationale**: Mantiene el principio ya establecido (D-05, feature 001) de que
`resolveOdometro` es el único punto que decide y normaliza la unidad final del
odómetro, cualquiera sea su origen; solo cambia cuál es esa unidad final (de metros a
kilómetros).

**Alternatives considered**:
- *Convertir en `eqParser.js`*: descartado — ese módulo parsea la trama a su
  representación más fiel al protocolo del fabricante (metros, tal como lo define el
  contrato); mezclar ahí una decisión de unidad de almacenamiento de AgroLink violaría
  la separación entre "parseo de protocolo" y "mapeo a dominio" que el propio código ya
  tiene.

## D-03: Alcance sobre `ReporteViajeService` y su contrato

**Decision**: `ReporteViajeService` pasa a calcular `distanciaKm` (resta directa de
odómetros ya en km) en vez de `distanciaM`. La fórmula de `tasaConsumoPromedio`
(`combustibleConsumidoPct / (distanciaM / 1000.0)`) se simplifica a
`combustibleConsumidoPct / distanciaKm` — el resultado numérico no cambia, solo deja de
necesitar la división intermedia porque el numerador de esa división ya está en km.
`ReporteViajeDto.distanciaM` (`long`) se reemplaza por `distanciaKm` (`double`); el
contrato `agrolink-reportes-api.yaml` sube de 1.0.0 a 2.0.0 documentando el reemplazo.

**Rationale**: `ReporteViajeService` lee `LecturaTelemetria.getOdometroM()` /
`getOdometroKm()` directamente (no pasa por `CanBusDto`); si la columna cambia de
unidad, ese servicio queda obligado a cambiar junto con ella para no calcular una
distancia en la unidad equivocada bajo un nombre que ya no describe lo que contiene.
Dejarlo en `long distanciaM` sin tocar produciría un campo que en realidad devuelve
kilómetros con el sufijo `M` — exactamente el tipo de inconsistencia que la convención
de sufijo-como-unidad del proyecto busca evitar (ver `CanBusDto`, y la propia decisión
D-01 de la feature 004).

**Alternatives considered**:
- *Dejar `ReporteViajeService` sin tocar, convirtiendo internamente `getOdometroKm() *
  1000` para simular el metro perdido*: descartado — reintroduce exactamente la
  conversión redundante que esta feature busca eliminar, solo que trasladada a otro
  archivo, y deja un campo de contrato (`distanciaM`) mintiendo sobre su unidad real de
  cálculo interno.
- *No tocar `ReporteViajeService` y dejarlo roto (comparando un `long` contra un
  `Double`)*: descartado — ni siquiera compila; no es una alternativa real.

## D-04: Cómo migran los datos ya persistidos

**Decision**: Para instalaciones nuevas, `deploy/db/01-schema.sql` define directamente
`odometro_km DOUBLE PRECISION`. Para una instalación existente (volumen ya
inicializado, donde los scripts de `docker-entrypoint-initdb.d` no se re-ejecutan), la
migración se documenta como una sentencia explícita a correr a mano contra la base:

```sql
ALTER TABLE telemetria.lectura_telemetria
    RENAME COLUMN odometro_m TO odometro_km;
ALTER TABLE telemetria.lectura_telemetria
    ALTER COLUMN odometro_km TYPE DOUBLE PRECISION USING odometro_km / 1000.0;
```

**Rationale**: El proyecto no usa Flyway/Liquibase (decisión de la feature 001, fuera
de alcance reabrirla acá); documentar la sentencia en el plan y en `deploy/README.md`
es coherente con cómo ya se documentan otras operaciones manuales de ese mismo README
(por ejemplo, resetear una contraseña de rol perdida). `RENAME` + `ALTER TYPE ... USING`
en una sola transacción implícita de `ALTER TABLE` evita una ventana donde ambas
columnas coexistan con nombres o valores ambiguos.

**Alternatives considered**:
- *Agregar `odometro_km` como columna nueva y hacer un backfill, dejando `odometro_m`
  hasta una limpieza posterior*: descartado — el propio spec (Assumptions) pide
  reemplazar, no duplicar, siguiendo el mismo criterio ya usado en la feature 004; y
  duplicar la columna reintroduce el riesgo de que algún código lea la columna vieja
  por error.
- *Migración automática al arrancar Spring Boot (código Java que corre un `ALTER TABLE`
  al boot)*: descartado — el servicio Java no es dueño del ciclo de vida del esquema
  (lo es `deploy/db/`, ejecutado por Postgres), y ejecutar DDL condicional desde código
  de aplicación agrega un mecanismo de migración ad-hoc para un solo caso, más frágil
  que una instrucción documentada.

## D-05: Precisión y casos límite

**Decision**: `odometro_km` se representa como `DOUBLE PRECISION` en la base y `Double`
en Java, igual que ya se decidió para `CanBusDto.odometroKm` en la feature 004
(research.md 004, D-03): sin redondeo, división directa donde corresponda. Un odómetro
de ECU con valor `0` km sigue siendo un dato válido (vehículo recién dado de alta), no
"desconocido"; solo `NULL` representa "desconocido" (FR-007), sin cambios respecto de
hoy.

**Rationale**: Reutiliza una decisión ya validada por la feature 004 para el mismo tipo
de magnitud, evitando introducir un criterio de precisión distinto entre dos features
que tocan el mismo dato.

**Alternatives considered**: Ninguna — es la aplicación directa de un patrón ya
establecido.
