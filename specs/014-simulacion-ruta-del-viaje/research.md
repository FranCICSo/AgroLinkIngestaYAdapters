# Phase 0 — Research: Simulación inmediata sobre la ruta del viaje, con detención

**Feature**: `014-simulacion-ruta-del-viaje` | **Date**: 2026-10-21

Contrato externo (no negociable acá): [`contracts/ingesta-simulacion-http.md`](./contracts/ingesta-simulacion-http.md),
copia byte a byte de `AgroLinkBackend/specs/026-simulacion-al-iniciar-viaje/contracts/ingesta-simulacion-http.md`
v2.0.0. Las decisiones de abajo resuelven **cómo** lo cumple este repo; ninguna cambia su forma.

No quedó ningún `NEEDS CLARIFICATION` en el Technical Context: el spec y sus Clarifications
están cerrados, y lo que el spec delegó al plan (correlación tripCode↔viaje del simulador,
formato del trazado, límites de tamaño) se resuelve en D-05, D-06 y D-11.

---

## D-01 — Arranque síncrono dentro del request; se elimina el poller

**Decision**: `POST …/viajes-simulados` llama a `simulador-viajes` dentro del mismo request y
responde con el resultado (`202`/`200`/`4xx`/`502`). Se borran `ViajeSimuladoScheduler`, su
test, `@EnableScheduling` de `IngestaApplication` (era su único uso) y la propiedad
`agrolink.viaje-programado.poll-interval-ms`.

**Rationale**: FR-001 exige arranque inmediato y el contrato devuelve `estado: ARRANCADO` o
`502 simulador_no_disponible` en la misma respuesta: solo es posible si la llamada al simulador
ocurre en el request. Sin horario no hay nada que encolar (SC-003: cero disparos por horario).
Además el poller es lo único que podría "revivir" filas `PENDIENTE` viejas: quitarlo es la mitad
de FR-016/FR-017.

**Alternatives considered**: mantener el poller con intervalo corto y marcar la fila para
"disparo inmediato" — reintroduce exactamente el comportamiento que el spec reemplaza y no puede
devolver `502` sincrónicamente.

## D-02 — El registro por viaje evoluciona sobre la misma tabla, sin renombrar

**Decision**: se conserva `ingesta.viaje_programado` y las clases del paquete
`viajeprogramado` (`ViajeProgramado`, `ViajeProgramadoService`, …). Cambian sus estados y se
agregan columnas (data-model.md §1). Migración `009_viaje_simulado_inmediato.sql`:

- `PENDIENTE` → `CANCELADO`, con `ultimo_error = 'Cancelada al desplegar 014: modo programado
  eliminado'` y un `RAISE NOTICE` con la cantidad (FR-017: "marcarse como canceladas y
  registrarse"). Se hace en SQL de despliegue, no en un `ApplicationRunner`, para que ocurra
  exactamente una vez y antes de que arranque la versión nueva.
- `DISPARADO` → `ARRANCADO` (mismo significado: la simulación se arrancó).
- `CHECK (estado IN ('ARRANCADO','DETENIDO','ERROR','CANCELADO'))`; `CANCELADO` queda solo como
  estado histórico de filas migradas (ningún camino nuevo lo produce).
- `trip_code` pasa a `VARCHAR(64)` (el contrato admite 1..64; hoy es 50).
- `estimated_start_date_time`, coordenadas y `nombre_ruta` pasan a `NULL`-ables: una detención
  de un `tripCode` desconocido crea una fila `DETENIDO` sin coordenadas (D-03).

**Rationale**: FR-019 pide "un registro por viaje" y el spec dice que evoluciona la
planificación de 013. Renombrar tabla y clases es churn sin cambio de comportamiento y rompe el
historial de `schema_migrations`/greps; el nombre queda documentado como legado.

**Alternatives considered**: tabla nueva `ingesta.viaje_simulado` + migrar filas — dos tablas
con la misma clave natural durante la transición, sin beneficio.

## D-03 — Tabla de decisión de inicio y detención en `agrolink-ingesta`

Clave de búsqueda: `tripCode` (UNIQUE). Siempre primero la lista cerrada (`404
dispositivo_no_simulado`) y la validación del cuerpo (`400 validacion` / `413`).

**Inicio** (`ViajeProgramadoService.iniciar`):

| Fila existente para `tripCode` | Acción | Respuesta |
|---|---|---|
| de **otro** dispositivo (cualquier estado) | nada | `409 viaje_de_otro_dispositivo` (+ `dispositivoId` dueño) |
| mismo dispositivo, `ARRANCADO` | nada (no llama al simulador) | `200 SIN_CAMBIOS` |
| mismo dispositivo, `DETENIDO` | nada | `409 viaje_no_modificable`, `estadoActual: DETENIDO` |
| ninguna / `ERROR` / `CANCELADO` (legado) | (re)escribe datos del aviso, llama al simulador | éxito → `ARRANCADO`, `202 ARRANCADA`; fallo → ver D-05 |

**Detención** (`ViajeProgramadoService.detener`):

| Fila existente para `tripCode` | Acción | Respuesta |
|---|---|---|
| de **otro** dispositivo | nada | `409 viaje_de_otro_dispositivo` |
| mismo dispositivo, `ARRANCADO` | detención acotada en el simulador (D-07) | ok → `DETENIDO`, `200` con el `efecto` que devuelve el simulador (`DETENIDA` o `SIN_SIMULACION_EN_CURSO` si ya había sido reemplazado); fallo → `502`, la fila queda `ARRANCADO` con `ultimo_error` (una detención posterior puede reintentar) |
| mismo dispositivo, `ERROR` | detención acotada **best-effort** (un timeout pudo haber arrancado igual) | `DETENIDO`, `200` con el efecto del simulador; si el simulador falla: `200 SIN_SIMULACION_EN_CURSO` + `WARN` |
| mismo dispositivo, `DETENIDO` / `CANCELADO` | `DETENIDO` | `200 SIN_SIMULACION_EN_CURSO` |
| ninguna | inserta fila `DETENIDO` (tombstone, solo `tripCode`/dispositivo) | `200 SIN_SIMULACION_EN_CURSO` |

**Rationale**: reproduce las filas de §2.2/§3.2 del contrato tal cual. El tombstone cubre
"detención antes que inicio" (Edge Cases, contrato §3.2). La simulación de un viaje anterior
reemplazado sigue con su fila en `ARRANCADO`: no hace falta un estado `REEMPLAZADO` porque la
detención en el simulador está acotada al `tripCode` (D-07) y devuelve `SIN_SIMULACION_EN_CURSO`
sola (FR-013).

**Concurrencia**: el backend manda un único inicio por viaje desde un listener `@Async`; dos
inicios concurrentes del mismo `tripCode` quedan protegidos por el `UNIQUE(trip_code)`: el
perdedor recibe `DataIntegrityViolationException`, se relee la fila y se responde según la tabla
(típicamente `200 SIN_CAMBIOS`). No se agrega locking adicional (escala de demo).

## D-04 — Cuerpo de error JSON plano `{error, detalle, …}`

**Decision**: los handlers del controller dejan de devolver `ProblemDetail`
(`application/problem+json` con `detail`) y devuelven `application/json` con
`{ "error", "detalle", ...extras }` exactamente como el contrato §1. Códigos usados:
`validacion`, `trazado_invalido`, `dispositivo_no_simulado`, `viaje_no_modificable`,
`viaje_de_otro_dispositivo`, `payload_demasiado_grande`, `simulador_no_disponible`.
`CoordenadasNoDisponiblesException` (`coordenadas_no_disponibles`) se reemplaza por
`validacion`; `ViajeProgramadoNoEncontradoException` desaparece (la detención es idempotente y
no hay más PUT/DELETE).

**Rationale**: el contrato fija el nombre `detalle`; `ProblemDetail` serializa `detail`. Un JSON
de cuerpo inválido (Jackson) también se mapea a `400 validacion` vía
`HttpMessageNotReadableException`.

## D-05 — Validación repartida: estructura en ingesta, geometría en el simulador

**Decision**:

- `agrolink-ingesta` valida lo que no requiere decodificar: campos obligatorios, rangos de
  `lat`/`lon`, `tripCode` 1..64, `velocidadesKmh` sin `polyline` → `400 validacion`;
  `polyline.length() > 1_000_000` o `velocidadesKmh.size() > 99_999` → `413
  payload_demasiado_grande`. Luego reenvía `polyline` y `velocidadesKmh` **sin tocar** a
  `simulador-viajes`.
- `simulador-viajes` es el **único** que decodifica la polyline (precisión 5, `lat,lon`) y
  valida geometría: no decodificable, `< 2` puntos, extremo a `> 500 m` de origen/destino →
  `400 trazado_invalido`; `> 100 000` puntos → `413 payload_demasiado_grande`.
- Mapeo de la respuesta del simulador en ingesta: `400 trazado_invalido` → `400
  trazado_invalido`; `413` → `413`; cualquier otro `4xx`/`5xx`, error de red o timeout → `502
  simulador_no_disponible`. En todos los fallos la fila queda `ERROR` con `ultimo_error` y se
  loggea `WARN` con `tripCode` + `dispositivoId` (FR-018), sin reintento.

**Rationale**: un solo decodificador (Node, donde además se densifica) evita dos
implementaciones del algoritmo de polyline que podrían discrepar. El decodificador es parseo de
dato externo → tests de Principio VIII en `simulador-viajes`.

**Alternatives considered**: decodificar también en Java para responder `trazado_invalido` sin
ir al simulador — duplicación pura; el simulador igual tiene que decodificar.

## D-06 — Correlación tripCode ↔ viaje del simulador: columna propia, no el nombre de ruta

**Decision**: nueva columna `simulador.viaje.trip_code VARCHAR(64) NULL`. `POST /rutas` acepta
un `tripCode` opcional (requiere `camion`); si viene, el viaje creado lo guarda y queda con
`fin_en_destino = true` (D-10). El nombre de ruta deja de ser la clave: ingesta lo arma por
intento como `Viaje {tripCode} #{epochMillis}` (≤ 6 + 64 + 15 = 85 < 100), para que un reinicio
tras `ERROR` no choque con `UNIQUE(simulador.ruta.nombre)` (`409 nombre_duplicado`).

Backfill (migración `008`): para cada fila `DISPARADO` de `ingesta.viaje_programado`, se setea
`trip_code` en el viaje `en_curso` del mismo `camion_id` cuya ruta se llame `'Viaje ' ||
trip_code` (las vueltas automáticas reusan la ruta, así que también matchean). Así la detención
funciona también sobre simulaciones disparadas por el modo anterior.

**Rationale**: "Viaje {tripCode}" es frágil: es texto libre que cualquier ruta de CLI puede
usar, no sobrevive a un reintento (nombre único) y no distingue viajes de vuelta. Una columna
indexable permite el `UPDATE … WHERE camion_id = $1 AND trip_code = $2 AND estado = 'en_curso'`
que garantiza FR-013 por construcción.

**Alternatives considered**: buscar por `ruta.nombre` (frágil, ver arriba); guardar el
`viajeId` del simulador en ingesta (un viaje con vuelta automática cambia de id; y obliga a
ingesta a conocer ids internos del simulador).

## D-07 — Detención en el simulador: `POST /viajes/detener`

**Decision**: nuevo endpoint en `src/http/rutaHttpServer.js`:
`POST /viajes/detener` con `{ "dispositivoId", "tripCode" }` → `db/viajeRepository.detenerViaje`
hace `UPDATE simulador.viaje SET estado = 'finalizado' WHERE camion_id = $1 AND trip_code = $2
AND estado = 'en_curso' RETURNING id`. `200 { efecto: "DETENIDA", viajeIds: [...] }` si afectó
filas, `200 { efecto: "SIN_SIMULACION_EN_CURSO" }` si no; `400 validacion` si falta algún campo.
`finalizarViajesEnCurso(camionId)` (reemplazo al arrancar otro viaje) no cambia.

**Rationale**: cuerpo JSON en vez de path params evita parsear/decodificar URLs con `node:http`
puro (el server no tiene router). El `UPDATE` acotado es atómico: un ciclo del daemon en vuelo
solo hace `actualizarProgresoViaje` (no toca `estado`), así que no puede revivir el viaje; al
ciclo siguiente ya no aparece en `obtenerViajesEnCurso` (SC-004: ≤ 1 ciclo de 60 s).
`agrolink-ingesta` sigue sin acceso de escritura al schema `simulador` (FR-011): todo pasa por
HTTP.

## D-08 — Velocidades por tramo persistidas con la ruta

**Decision**: nueva columna `simulador.ruta.velocidades_kmh JSONB NULL`: array de enteros km/h,
uno por segmento de `puntos` **ya densificado** (largo `puntos.length − 1`). Reglas
(`domain/velocidadesTramo.js`, nuevo):

| Origen de la ruta | `velocidades_kmh` |
|---|---|
| `polyline` + `velocidadesKmh` coherentes | recibidas, `round(clamp(v, 25, 80))` (resguardo: tope único 80, sin urbano/ruta — Clarifications) — `velocidades: RECIBIDAS` (o `ACOTADAS` si algún valor se acotó) |
| `polyline` + `velocidadesKmh` de largo ≠ `n − 1` o con valores no numéricos | se descartan; todas = 40 km/h (default actual de `avanceRuta`) — `velocidades: DESCARTADAS`, `WARN` |
| `polyline` sin `velocidadesKmh` | todas = 40 — `velocidades: POR_DEFECTO` |
| OSRM (sin polyline), **sin** `paradas` | `round(clamp(osrmSpeed × 3.6, 25, 80))` — misma regla §4 del contrato (FR-008a) — `velocidades: OSRM` |
| OSRM **con** `paradas`, rutas sembradas, manuales, `scripts/densificar-seed.js` | `NULL` → algoritmo actual de ~40 km/h (FR-008a, FR-015) |

Al densificar, cada sub-tramo hereda la velocidad de su tramo original; la densificación usa esa
misma velocidad (FR-008: "las mismas velocidades para densificar").

**Rationale**: `avanzar` corre en el daemon, en otro momento que la generación: la velocidad
tiene que vivir en la base (lo pide el pedido del usuario y el Edge Case de reinicio). El piso
25 coincide con el piso de velocidad objetivo del simulador y con el contrato §4. Las rutas con
paradas se dejan con el algoritmo actual porque su itinerario expande puntos repetidos y los
índices dejarían de corresponder a los segmentos; ninguna ruta avisada por el backend trae
paradas.

## D-09 — Avance por velocidad de tramo con posición interpolada y remanente persistido

**Decision**: `domain/avanceRuta.avanzar` despacha según `ruta.velocidadesKmh`:

- `null` → algoritmo actual sin cambios (incluido el ~40 km/h de `4302f7e`).
- array → `avanzarPorVelocidad`: presupuesto de **tiempo** del ciclo `Δt = cicloSegundos`;
  ruido de media cero por ciclo `r ∈ U(−3, +3)` (variación verosímil de 012); en cada segmento
  `i` la velocidad efectiva es `clamp(v_i + r, 25, 80)`; se consume el segmento restante
  (`d_i − avanceTramoKm`) mientras alcance el tiempo y, si no alcanza, se avanza la fracción y se
  devuelve el nuevo `avanceTramoKm`. La posición es la **interpolación** sobre el segmento (sigue
  sobre el trazado: SC-002), la velocidad reportada es `distancia / Δt` (≤ 80 siempre: SC-006),
  el rumbo es el del segmento actual. Persistencia nueva: `simulador.viaje.avance_tramo_km
  NUMERIC(10,4) NOT NULL DEFAULT 0` junto a `indice_actual`. `sentido = 'vuelta'` recorre
  `puntos` y `velocidades` invertidos.
- `index.js` pasa `cicloSegundos = config.cicloMs / 1000` (hoy usa el default 60 aunque
  `SIMULADOR_CICLO_MS` sea otro; con avance por tiempo eso aceleraría el camión).

**Rationale**: el algoritmo actual solo avanza vértices enteros y descarta el remanente: con la
densificación por `ceil`, un tramo de 1,5 km a 80 km/h queda en dos piezas de 0,75 km y se
recorre a ~45 km/h — imposible cumplir el ±10 % de SC-006/contrato §4. Avanzar por tiempo con
remanente persistido hace que el tiempo simulado coincida con `T_plan = Σ d_i / v_i` salvo el
sesgo del clamp en los extremos (≤ ~1 %).

**Granularidad de la medición de SC-006**: el daemon emite cada 60 s, así que la llegada se
observa con resolución de un ciclo. Error máximo atribuible a la cuantización ≈ 60 s, < 10 %
para duraciones planificadas ≥ 10 min (demo típica: decenas de minutos a horas). Viajes más
cortos quedan acotados por un ciclo; se documenta en quickstart.md.

## D-10 — Espera en destino para viajes avisados

**Decision**: nueva columna `simulador.viaje.fin_en_destino BOOLEAN NOT NULL DEFAULT false`,
`true` solo cuando `POST /rutas` trae `tripCode`. En `index.js`, si `avanzar` devuelve
`completado`:

- `finEnDestino` → **emite** la trama de estacionado (último punto, velocidad 0, ignición
  apagada, RPM de ralentí vía `sintetizarCan`, BLE normal si `refrigerada`) y deja el viaje
  `en_curso` con `indice_actual` en el último punto. No llama a `finalizarYCrearVuelta`.
- si no → comportamiento actual (`finalizarYCrearVuelta`, sin trama ese ciclo) (FR-015).

El ciclo en que el camión **alcanza** el destino también emite (con la velocidad del último
tramo) y persiste el índice final. Como el estado de espera es `en_curso` + índice final +
flag, un reinicio del proceso retoma estacionado (Edge Case). La espera es indefinida hasta
`POST /viajes/detener` o hasta que otro inicio del mismo camión lo reemplace (limitación
aceptada en Assumptions).

**Alternatives considered**: nuevo `estado = 'en_destino'` en `simulador.viaje` — obliga a
cambiar el `CHECK` y todas las consultas que filtran `en_curso`, sin ganancia.

## D-11 — Límites de tamaño y cuerpos grandes

**Decision**: contrato §5. `agrolink-ingesta`: Jackson (Boot 3.3.4 → 2.17) tiene
`maxStringLength` 20 M por defecto y Tomcat no limita cuerpos JSON: 2 MiB entra sin configurar;
se agrega un test con un cuerpo de ~2 MiB. `simulador-viajes`: `leerBodyJson` hoy no tiene tope;
se le agrega `LIMITE_BODY_BYTES = 4 MiB` → `413 payload_demasiado_grande` (holgura sobre 2 MiB
para el JSON de reenvío). `simulador.ruta.puntos` de 100 k puntos densificados ≈ 4–6 MB en
JSONB: aceptable para Postgres; `obtenerViajesEnCurso` lo relee cada ciclo (pocos camiones).

## D-12 — Timeouts, logging y registro (FR-018/FR-019)

**Decision**: se mantienen `connect-timeout-ms: 2000` y `read-timeout-ms: 5000` de
`SimuladorViajesClient`, sin reintentos. Con polyline el simulador no consulta OSRM y responde en
< 1 s típico; en el camino OSRM puede acercarse a 5 s, en cuyo caso el backend (timeout 5 s,
contrato §6) registra "resultado desconocido" — aceptado por el contrato. Logs `INFO` en éxito
(con `trazado` y `velocidades`) y `WARN` en todo fallo, siempre con `tripCode` + `dispositivoId`.
Sin polyline se loggea `INFO` "trazado propio: puede no coincidir con el mapa" (FR-009). La fila
guarda estado, `trazado`, `velocidades`, `motivo_detencion`, `detenido_en` y `ultimo_error`.

## D-13 — Compatibilidad de rutas CLI/manuales y del contrato de `POST /rutas`

**Decision**: `POST /rutas` sin `tripCode`/`polyline` responde y se comporta igual que hoy
(201, mismo cuerpo), salvo que las rutas OSRM sin paradas ahora persisten velocidades y avanzan
por tramo (FR-008a, cambio pedido). `src/cli/crearRuta.js` no cambia de interfaz y conserva la
vuelta automática (FR-015, SC-005 solo aplica a viajes avisados). La respuesta `201` agrega
`trazado` y `velocidades` (campos nuevos, retrocompatibles).
