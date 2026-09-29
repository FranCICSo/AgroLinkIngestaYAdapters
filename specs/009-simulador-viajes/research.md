# Phase 0 — Research: Simulador de Viajes con Dispositivos Ficticios

**Feature**: `009-simulador-viajes` | **Date**: 2026-09-28

## D-01: Cómo reutilizar la construcción de tramas de `rinho-receptor`

**Decision**: Importar `buildFrame` directamente desde
`rinho-receptor/test/tools/buildFrame.js` con un import relativo entre proyectos
(`../rinho-receptor/test/tools/buildFrame.js`), sin publicarlo como paquete ni duplicar su
código.

**Rationale**: `buildFrame.js` ya es una función pura de un solo módulo ESM, sin dependencias
externas (solo importa `calculateChecksum` de `../../src/protocol/frame.js`, también puro). Ya
soporta el parámetro `ble` (usado por la feature 008 en sus propios tests) y arma GPS + CAN +
BLE + checksum exactamente como el receptor los valida. Duplicarlo en `simulador-viajes/`
arriesgaría una divergencia silenciosa entre las dos copias; extraerlo a un paquete npm interno
es complejidad de infraestructura no justificada para dos proyectos en el mismo repo
(Constitución, Principio III, aplicado por analogía a "complejidad sin necesidad demostrada").

**Alternatives considered**: (a) reescribir la construcción de tramas en `simulador-viajes/` —
rechazado, duplica el punto de mayor riesgo del sistema (formato exacto de la trama); (b) mover
`buildFrame.js` fuera de `test/tools/` a `src/` de `rinho-receptor` y exportarlo como API pública
del paquete — evaluado, pero cambia el contrato de un helper de test existente usado por
`rinho-receptor` (T061, T069) sin necesidad; se prefiere el import relativo directo, que no
requiere tocar `rinho-receptor` en absoluto.

## D-02: Rango de identificador reservado para camiones simulados

**Decision**: IDs de 6 dígitos con prefijo fijo `900` (`900001`–`900999`), en vez de imitar el
largo de 15 dígitos de un IMEI real.

**Rationale**: Un IMEI real válido siempre tiene 15 dígitos; un identificador de 6 dígitos nunca
puede colisionar con uno, sin necesidad de generar y descartar candidatos. El prefijo `900` hace
el rango reconocible a simple vista en cualquier consulta SQL o log (`dispositivo_id LIKE
'900%'`), satisfaciendo FR-010/US5 sin agregar una columna booleana `simulado` extra — la
columna `dispositivo_id` en `telemetria.lectura_telemetria` es `VARCHAR(20)`, así que un valor
más corto que un IMEI real no rompe ninguna restricción existente.

**Alternatives considered**: columna `simulado BOOLEAN` en `telemetria.lectura_telemetria` —
rechazada: violaría el espíritu del Principio IV (agregar una columna nueva a una tabla
insert-only ya estable solo para esta feature de tooling) y requeriría tocar el receptor/mapper
real para poblarla. El rango de ID resuelve la distinción sin tocar el schema de telemetría.

## D-03: Reintentos ante falta de ACK

**Decision**: Hasta 3 reintentos por trama, con backoff fijo de 5 s entre cada uno. Agotados los
3, se descarta esa trama puntual (se loguea explícito, Principio IX) y el simulador sigue con el
siguiente ciclo de 60 s — no bloquea el avance del viaje.

**Rationale**: Un dispositivo real con conectividad intermitente no acumula un backlog
indefinido de tramas viejas; reintentar unos segundos y seguir adelante es el comportamiento que
FR-011 pide imitar. Un límite acotado y fijo (no exponencial) alcanza para ejercitar US4 sin
sumar complejidad de configuración.

**Alternatives considered**: backoff exponencial — rechazado por sobre-ingeniería para una
ventana de reintento de segundos; reintentos infinitos — rechazado explícitamente por el edge
case del spec (acumularía tramas indefinidamente con el receptor caído).

## D-04: Cómo se detecta un cambio de configuración sin reiniciar (FR-004)

**Decision**: El simulador relee `simulador.camion` y `simulador.viaje` al inicio de cada ciclo
de 60 s (antes de construir las tramas de esa vuelta), en vez de mantener un caché en memoria
que requiera invalidación explícita o `LISTEN/NOTIFY`.

**Rationale**: La cadencia de emisión ya es de 60 s (FR-003): leer la configuración vigente en
cada ciclo agrega, en el peor caso, un retraso de un ciclo entre editar la tabla y ver el efecto
— muy por debajo de lo que un usuario espera de una herramienta de demo, y sin la complejidad de
un mecanismo de notificación en tiempo real que el spec no pide.

**Alternatives considered**: `LISTEN/NOTIFY` de Postgres para reaccionar al instante — rechazado
por complejidad no justificada (Principio III aplicado por analogía); caché en memoria con TTL —
equivalente en efecto a releer cada ciclo, pero con más código.

## D-05: Fórmulas de síntesis CAN (RPM, combustible, presión de aceite)

**Decision**:
- **RPM**: `700 + velocidad_kmh * 25`, con tope en `2200`. En parada con ignición encendida
  queda en el ralentí base (`700`–`800` con ruido ±20).
- **Combustible %**: arranca en el valor configurado del camión (ref. 85% para el camión 1) y
  baja `0.05` puntos porcentuales por km recorrido, sin bajar de un piso configurable (evita
  llegar a 0% en viajes largos de demo).
- **Combustible consumido L**: acumulado, `0.35 L/km` recorrido (consumo urbano típico de un
  camión mediano), nunca decrece.
- **Presión de aceite kPa**: `380` ± ruido (±15) en marcha; `90` ± ruido (±10) en ralentí o
  parada.

**Rationale**: Valores de referencia de la trama real de campo (combustible 85%, RPM/presión en
reposo) más relaciones simples y monotónicas con la velocidad/distancia — suficiente para que
los datos se vean creíbles en una demo sin modelar un motor real.

**Alternatives considered**: ninguna relación (valores constantes) — descartado, es exactamente
el problema que tiene la trama real capturada y que motivó sintetizar estos campos.

## D-06: Fórmulas de síntesis BLE (temperatura/humedad de medias reses)

**Decision**:
- **Normal**: temperatura = `setpoint_temp_c` ± ruido (±0.3 °C); humedad =
  `setpoint_humedad_pct` ± ruido (±2 pp).
- **Apertura de puerta** (en una parada marcada como entrega): la temperatura sube linealmente
  hasta `setpoint + 4°C` durante la parada, y al retomar el viaje vuelve a acercarse al setpoint
  de forma exponencial (recupera ~63% de la diferencia cada 2 lecturas), quedando de nuevo en
  rango normal después de unos minutos de viaje.
- **Falla de compresor**: a partir del punto del viaje configurado, la temperatura sube
  `0.15 °C` por lectura de forma sostenida, sin mecanismo de recuperación, hasta el final del
  viaje — cruza el umbral de alerta (7 °C, ver Assumptions del spec) unos minutos después de
  iniciada la falla.
- **Batería del sensor**: valor fijo con ruido chico (no se modela descarga: fuera del alcance
  de esta feature).

**Rationale**: Reproduce los tres escenarios pedidos por el handoff original y por US2 del spec
con la menor cantidad de parámetros posible; el umbral de 7 °C y el setpoint de medias reses
(1–4 °C) ya están documentados en las Assumptions del spec.

**Alternatives considered**: modelo físico de transferencia de calor — rechazado, sobre-ingeniería
para el objetivo de demo; el spec solo pide que el umbral se cruce de forma reproducible
(SC-006), no una simulación térmica precisa.

## D-07: Viaje de vuelta automático (FR-014)

**Decision**: Al llegar al último punto de la ruta, el simulador crea una nueva fila en
`simulador.viaje` para el mismo camión y la misma ruta, con un flag `sentido = 'vuelta'` que
invierte el orden de recorrido de los puntos (mismas paradas, mismo orden relativo).

**Rationale**: Reutiliza la ruta ya cargada sin necesitar una segunda entrada en `simulador.ruta`
duplicada en sentido inverso — la inversión es una operación sobre el arreglo de puntos ya
existente, no un dato nuevo a mantener.

**Alternatives considered**: cargar dos rutas por camión (ida y vuelta) — rechazado, duplica
datos que son la misma secuencia de puntos invertida.

## D-08: Orden de scripts de init de Postgres

**Decision**: `deploy/db/03-schema-simulador.sql`, después de `01-schema.sql` (telemetría) y
`02-roles.sql` (roles existentes) — Docker ejecuta los scripts de
`docker-entrypoint-initdb.d` en orden alfabético.

**Rationale**: Sigue la convención numérica ya establecida por los dos scripts existentes; un
nuevo rol (`simulador_viajes`) y su schema se agregan sin modificar los dos archivos ya
estables, minimizando el diff sobre infraestructura compartida.

**Alternatives considered**: agregar las tablas `simulador.*` dentro de `01-schema.sql` —
rechazado, mezclaría el schema insert-only de telemetría (Principio IV) con configuración
mutable de una herramienta de desarrollo en el mismo archivo.
