# Phase 0 Research: Odómetro en kilómetros en la consulta de estado

No quedaron `NEEDS CLARIFICATION` en el Technical Context del plan. Este documento
registra las decisiones de diseño que sí requerían elegir entre alternativas.

## D-01: Nombre y tipo del campo reemplazado

**Decision**: `canBus.odometroM` (`Long`, metros) se reemplaza por `canBus.odometroKm`
(`Double`, kilómetros). No se agrega un campo adicional en paralelo.

**Rationale**: El proyecto tiene una convención explícita de nombrar los campos del
contrato con el sufijo de su unidad (`velocidadRuedaKmh`, `combustibleConsumidoL`,
`temperaturaRefrigeranteC`, `presionAceiteKpa`, `tensionBateriaV` — ver
`CanBusDto.java`). Renombrar a `odometroKm` sigue esa misma convención y hace el cambio
de unidad autoevidente para cualquier consumidor nuevo, en vez de dejar un nombre
`odometroM` que ahora mentiría sobre la unidad real. El tipo pasa de `Long` a `Double`
porque una cantidad en kilómetros derivada de una medición en metros deja de ser
naturalmente entera (184.3 km).

**Alternatives considered**:
- *Mantener `odometroM` en metros y agregar `odometroKm` en paralelo*: descartado (spec,
  Assumptions) — duplica el dato, viola la convención de "una sola unidad por campo, sin
  mezclar" (D-05 de la feature 001) y deja ambigüedad sobre cuál es el campo "oficial".
- *Reusar el nombre `odometroM` pero cambiarle la unidad a km*: descartado — rompe la
  convención de sufijo-como-unidad del propio contrato y es más peligroso para
  consumidores existentes (mismo nombre, semántica distinta, sin ninguna señal en el
  tipo o el nombre de que cambió).

## D-02: Dónde ocurre la conversión

**Decision**: La conversión metros → kilómetros ocurre en
`EstadoVehiculoService.mapearCanBus`, al construir el `CanBusDto` de respuesta
(`odometroKm = lectura.getOdometroM() / 1000.0`, con `null` si `getOdometroM()` es
`null`). El valor persistido (`LecturaTelemetria.odometroM`, columna `odometro_m`) no
cambia de unidad ni de tipo.

**Rationale**: Es exactamente el punto donde hoy el dominio interno (metros) ya se
traduce al contrato expuesto (`CanBusDto`) — es la capa de adaptación de la Feature 002/
003, no un lugar nuevo. Mantener el almacenamiento en metros preserva la decisión D-05
de la feature 001 ("everything in meters, never mix units" en la ingesta) y evita que
`ReporteViajeService` (que calcula deltas de viaje en metros y rastrea
`odometroOrigenMixto`) tenga que cambiar.

**Alternatives considered**:
- *Convertir a km en el almacenamiento (columna `odometro_m` → `odometro_km`)*:
  descartado — requeriría migración de esquema, tocaría `ReporteViajeService` y el
  receptor Rinho (`resolveOdometro`), y contradice la decisión ya tomada de que todo el
  pipeline de ingesta trabaja en metros para no mezclar unidades entre fuentes (ECU en
  km convertido a m, GPS nativo en m).
- *Convertir en el cliente/consumidor de la API*: descartado — es exactamente lo que la
  spec busca evitar (SC-001: sin conversión de unidades del lado del consumidor).

## D-03: Precisión de la conversión

**Decision**: División de punto flotante sin redondeo (`metros / 1000.0`, `Double`).

**Rationale**: FR-002 exige no perder información significativa respecto del valor
almacenado en metros. Una división directa en `double` preserva toda la precisión del
`Long` de metros (los valores de odómetro reales, del orden de 10^7-10^8 metros, están
muy por debajo de la precisión exacta de un `double`, que es exacta hasta 2^53). No hay
necesidad de `BigDecimal` ni de fijar una cantidad de decimales en el modelo — eso es,
a lo sumo, una decisión de formato de presentación fuera del alcance de este backend.

**Alternatives considered**:
- *Redondear a 1 decimal*: descartado — pierde información (SC-002 exige que
  `odometroKm * 1000` reproduzca el valor original en metros).
- *`BigDecimal`*: descartado por sobre-ingeniería — no hay riesgo de error de
  representación relevante a esta escala de valores, y el resto del contrato ya usa
  `Double` para magnitudes similares (`combustibleConsumidoL`, `tensionBateriaV`).

## D-04: Manejo de odómetro desconocido

**Decision**: Si `lectura.getOdometroM()` es `null`, `odometroKm` es `null` (no `0.0`).
`odometroOrigen` sigue su comportamiento actual, sin cambios.

**Rationale**: FR-004 y la convención ya vigente en `CanBusDto` (todo campo puede ser
`null` = "no informado", nunca un valor inventado, ver contrato de la feature 003,
`SC-004`). No hay razón para tratar el odómetro de forma distinta al resto de los
campos de `canBus`.

**Alternatives considered**: Ninguna — es la aplicación directa de un patrón ya
establecido en el mismo DTO para los otros ocho campos.
