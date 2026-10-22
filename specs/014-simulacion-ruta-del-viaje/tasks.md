---

description: "Task list for 014-simulacion-ruta-del-viaje"
---

# Tasks: Simulación inmediata sobre la ruta del viaje, con detención

**Input**: Design documents from `/specs/014-simulacion-ruta-del-viaje/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ingesta-simulacion-http.md, contracts/simulador-viajes-http.md, quickstart.md

**Tests**: Incluidos. La constitución (Principio VIII) exige tests de la lógica de parseo de datos
externos (polyline, velocidades) en sus tres casos, y el paquete `viajeprogramado` ya tiene tests
por clase que hay que reescribir porque cambia su comportamiento.

**Organization**: por historia de usuario del spec. Rutas: `src/…` = `agrolink-ingesta` (Java);
`simulador-viajes/src/…` = simulador (Node). Paquete Java abreviado como
`viajeprogramado/` = `src/main/java/ar/utn/agrolink/ingesta/viajeprogramado/` y
`viajeprogramado-test/` = `src/test/java/ar/utn/agrolink/ingesta/viajeprogramado/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1…US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: esquema y constantes que todas las historias usan.

- [ ] T001 [P] Crear `deploy/migrations/008_simulador_ruta_del_viaje.sql` según data-model.md §2–§3: `simulador.ruta.velocidades_kmh JSONB NULL`; `simulador.viaje.trip_code VARCHAR(64) NULL`, `fin_en_destino BOOLEAN NOT NULL DEFAULT false`, `avance_tramo_km NUMERIC(10,4) NOT NULL DEFAULT 0`; índice parcial `viaje_camion_trip_en_curso_idx`; backfill de `trip_code` para viajes `en_curso` de filas `DISPARADO` cuya ruta es `'Viaje ' || trip_code` (research.md D-06). Idempotente (`IF NOT EXISTS`), sin tocar `telemetria.*`, comentario de cabecera con la feature y el motivo, como las migraciones 005/006
- [ ] T002 [P] Crear `deploy/migrations/009_viaje_simulado_inmediato.sql` según data-model.md §1: `trip_code` → `VARCHAR(64)`; `DROP NOT NULL` en `estimated_start_date_time`, coordenadas y `nombre_ruta`; columnas `trazado` (CHECK `RECIBIDO`/`PROPIO`), `velocidades`, `motivo_detencion`, `detenido_en`; reemplazar el CHECK de `estado` buscando su nombre en `pg_constraint` dentro de un `DO $$` (con `RAISE NOTICE` de la cantidad de `PENDIENTE` cancelados), `UPDATE` `PENDIENTE`→`CANCELADO` con `ultimo_error = 'Cancelada al desplegar 014: modo programado eliminado'` y `DISPARADO`→`ARRANCADO`, nuevo `CHECK (estado IN ('ARRANCADO','DETENIDO','ERROR','CANCELADO'))`; `DROP INDEX IF EXISTS ingesta.viaje_programado_pendiente_idx` (FR-017)
- [ ] T003 [P] Agregar las mismas columnas/índice de T001 (sin el backfill) a las definiciones de `simulador.ruta` y `simulador.viaje` en `deploy/db/03-schema-simulador.sql`, con comentario que remita a la migración 008
- [ ] T004 [P] Agregar `VELOCIDAD_MIN_TRAMO_KMH = 25` y `VELOCIDAD_DEFAULT_KMH = 40` a `simulador-viajes/src/domain/limitesVelocidad.js` (comentario: piso del contrato §4 / default histórico de `avanceRuta`), y hacer que `simulador-viajes/src/domain/avanceRuta.js` use `VELOCIDAD_DEFAULT_KMH` en lugar de su constante local `VELOCIDAD_URBANA_OBJETIVO_KMH` sin cambiar el comportamiento

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: retirar el modo programado y dejar el modelo, los errores y el acceso a datos listos
para las cuatro historias.

**⚠️ CRITICAL**: ninguna historia empieza antes de terminar esta fase.

- [ ] T005 Borrar `viajeprogramado/ViajeSimuladoScheduler.java`, `viajeprogramado-test/ViajeSimuladoSchedulerTest.java`, `viajeprogramado/ReprogramarViajeRequest.java` y `viajeprogramado/ViajeProgramadoNoEncontradoException.java`; quitar `@EnableScheduling` (y su import/comentario) de `src/main/java/ar/utn/agrolink/ingesta/IngestaApplication.java`; quitar `agrolink.viaje-programado.poll-interval-ms` de `src/main/resources/application.yaml` y actualizar el comentario de `agrolink.simulador-viajes` ("arranca y detiene la simulacion al aviso de AgroLinkBackend, spec 014") (FR-016, research.md D-01)
- [ ] T006 Actualizar `viajeprogramado/ViajeProgramado.java` a data-model.md §1: constantes `ARRANCADO`, `DETENIDO`, `ERROR`, `CANCELADO` (quitar `PENDIENTE`/`DISPARADO`/`estaPendiente`), campos `trazado`, `velocidades`, `motivoDetencion`, `detenidoEn`; constructor de tombstone `ViajeProgramado.detenido(tripCode, iotDeviceId, motivo)`; método `prepararArranque(estimatedStart, origen/destino lat/lon, nombreRuta)` que reescribe los datos del aviso; transiciones `marcarArrancado(trazado, velocidades)` (limpia `ultimoError`), `marcarError(detalle)`, `registrarErrorDetencion(detalle)` (no cambia estado), `marcarDetenido(motivo)` (setea `detenidoEn`); actualizar Javadoc (spec 014, sin horario)
- [ ] T007 Quitar `findByEstadoAndEstimatedStartDateTimeLessThanEqual` de `viajeprogramado/ViajeProgramadoRepository.java` y actualizar su comentario (sin poller); conservar `findByTripCode`
- [ ] T008 [P] Crear `viajeprogramado/ErrorRespuesta.java` (record serializado como `{ "error", "detalle", ...extras }` con `@JsonAnyGetter` para extras como `dispositivoId`/`estadoActual`, `@JsonInclude(NON_NULL)`) y las excepciones `ValidacionException`, `TrazadoInvalidoException`, `PayloadDemasiadoGrandeException`, `ViajeDeOtroDispositivoException` (con `dispositivoIdDueno`) y `SimuladorNoDisponibleException` en `viajeprogramado/`; borrar `CoordenadasNoDisponiblesException.java` (research.md D-04)
- [ ] T009 Reescribir los `@ExceptionHandler` de `viajeprogramado/ViajeProgramadoController.java` para devolver `ErrorRespuesta` con `application/json` (no `ProblemDetail`) y el status/código del contrato §2.2/§3.2: `DispositivoNoSimulado`→404 `dispositivo_no_simulado` (+`dispositivoId`), `Validacion`→400 `validacion`, `HttpMessageNotReadableException`→400 `validacion`, `TrazadoInvalido`→400 `trazado_invalido`, `ViajeNoModificable`→409 `viaje_no_modificable` (+`estadoActual`), `ViajeDeOtroDispositivo`→409 `viaje_de_otro_dispositivo` (+`dispositivoId`), `PayloadDemasiadoGrande`→413 `payload_demasiado_grande`, `SimuladorNoDisponible`→502 `simulador_no_disponible`; quitar los mappings `PUT`/`DELETE` (depende de T008)
- [ ] T010 Extender `viajeprogramado/SimulacionResultado.java` a `(boolean exito, Motivo motivo, String detalle, String trazado, String velocidades, String efecto)` con `enum Motivo { TRAZADO_INVALIDO, PAYLOAD_DEMASIADO_GRANDE, NO_DISPONIBLE }` y fábricas `ok(trazado, velocidades)`, `detenido(efecto)`, `fallo(motivo, detalle)`
- [ ] T011 [P] Extender `simulador-viajes/src/db/viajeRepository.js`: `insertarViaje(pool, { camionId, rutaId, odometroActualKm, tripCode = null, finEnDestino = false })` persistiendo `trip_code`/`fin_en_destino` y devolviéndolos; actualizar `simulador-viajes/test/db/viajeRepository.test.js`
- [ ] T012 [P] Extender `simulador-viajes/src/db/flotaRepository.js`: `obtenerViajesEnCurso` lee `r.velocidades_kmh`, `v.trip_code`, `v.fin_en_destino`, `v.avance_tramo_km` y `mapRow` los expone como `ruta.velocidadesKmh`, `viaje.tripCode`, `viaje.finEnDestino`, `viaje.avanceTramoKm` (Number); `actualizarProgresoViaje` acepta `avanceTramoKm` (default 0); `finalizarYCrearVuelta` copia `trip_code`, deja `avance_tramo_km = 0` y solo inserta la vuelta si su `UPDATE … WHERE id = $1 AND estado = 'en_curso'` afectó una fila (un ciclo en vuelo no revive un viaje detenido, FR-012/SC-004); actualizar `simulador-viajes/test/db/flotaRepository.test.js`
- [ ] T013 [P] Extender `simulador-viajes/src/db/rutaRepository.js`: `insertarRuta(pool, { nombre, puntos, paradas, velocidadesKmh = null })` persiste `velocidades_kmh` (JSONB o NULL) y lo devuelve; actualizar `simulador-viajes/test/db/rutaRepository.test.js`

**Checkpoint**: el simulador lee/escribe las columnas nuevas. El lado Java queda sin compilar a propósito entre T005 y T021 (se borran tipos que `programar`/`reprogramar`/`cancelar` usan); vuelve a compilar al cerrar T021.

---

## Phase 3: User Story 1 - Arrancar la simulación en el momento en que se avisa el inicio (Priority: P1) 🎯 MVP

**Goal**: el aviso de inicio arranca la simulación en el mismo request, idempotente, con los
rechazos del contrato §2.2 (trazado propio, sin polyline todavía).

**Independent Test**: quickstart.md §2 — inicio con fecha futura → `202 ARRANCADA` y telemetría
en ≤ 1 ciclo; repetido → `200 SIN_CAMBIOS`; 404/400/409/502 según la tabla.

### Tests for User Story 1

- [ ] T014 [P] [US1] Reescribir `viajeprogramado-test/ViajeProgramadoServiceTest.java` sobre la tabla de inicio de research.md D-03 (Mockito sobre repository y client): sin fila → llama al client y queda `ARRANCADO` con `trazado PROPIO`, `efecto ARRANCADA` aunque `estimatedStartDateTime` sea futura (FR-001); `ARRANCADO` mismo dispositivo → `SIN_CAMBIOS` sin llamar al client (FR-004); `DETENIDO` → `ViajeNoModificableException("DETENIDO")` (FR-005); otro dispositivo → `ViajeDeOtroDispositivoException` sin llamar al client; `ERROR` y `CANCELADO` → reintenta y pasa a `ARRANCADO`; fallo `NO_DISPONIBLE` → fila `ERROR` con `ultimoError` y `SimuladorNoDisponibleException` (FR-018); dispositivo fuera de lista → `DispositivoNoSimuladoException`; falta origen/destino, lat/lon fuera de rango, `tripCode` vacío o > 64 → `ValidacionException` (FR-003); `nombreRuta` con forma `Viaje {tripCode} #{millis}`; `DataIntegrityViolationException` al guardar → se relee y responde `SIN_CAMBIOS`
- [ ] T015 [P] [US1] Reescribir `viajeprogramado-test/ViajeProgramadoControllerIntegrationTest.java` (`@WebMvcTest`, service mockeado) sobre el contrato §2.2: `202` con cuerpo `{tripCode, dispositivoId, estado, trazado, efecto}`; `200 SIN_CAMBIOS`; `404`/`400`/`409`×2/`502` con cuerpo `{error, detalle}` y `Content-Type: application/json` (sin `detail` de ProblemDetail); JSON malformado → `400 validacion`; campo desconocido en el body → ignorado; `PUT`/`DELETE` a `…/viajes-simulados/{tripCode}` → `404` o `405`
- [ ] T016 [P] [US1] Reescribir `viajeprogramado-test/SimuladorViajesClientTest.java` (`MockRestServiceServer`): `arrancarViaje` envía `POST /rutas` con `nombre`, `origen`, `destino`, `camion.id` y `tripCode`, y omite `polyline`/`velocidadesKmh` cuando son null (`@JsonInclude(NON_NULL)`); `201` → `ok` con `trazado`/`velocidades` leídos del cuerpo; `409`, `422`, `500` y error de red → `fallo(NO_DISPONIBLE)` con detalle
- [ ] T017 [P] [US1] Extender `simulador-viajes/test/services/routeGenerationService.test.js`: con `tripCode` + `camion` el viaje creado tiene `trip_code` y `fin_en_destino = true`; `tripCode` sin `camion` → `validacion`; sin `tripCode` → `trip_code` NULL y `fin_en_destino = false` (FR-015); extender `simulador-viajes/test/services/iniciarViajeService.test.js` para el pase de `tripCode`/`finEnDestino`

### Implementation for User Story 1

- [ ] T018 [P] [US1] Crear `viajeprogramado/IniciarViajeRequest.java` (record: `tripCode`, `LocalDateTime estimatedStartDateTime`, `PuntoDto origen`, `PuntoDto destino`, `String polyline`, `List<Integer> velocidadesKmh`) e `viajeprogramado/InicioViajeDto.java` (`tripCode`, `dispositivoId`, `estado`, `trazado`, `efecto`); borrar `ProgramarViajeRequest.java` y `ViajeProgramadoDto.java`
- [ ] T019 [US1] Reescribir `SimuladorViajesClient.arrancarViaje(ViajeProgramado, String polyline, List<Integer> velocidadesKmh)` en `viajeprogramado/SimuladorViajesClient.java`: `RutaRequest` con `nombre`, `origen`, `destino`, `camion`, `tripCode`, `polyline`, `velocidadesKmh` (`@JsonInclude(NON_NULL)`); leer `trazado`/`velocidades` del `201`; mapear errores leyendo `error` del cuerpo (`HttpStatusCodeException#getResponseBodyAs`): `400 trazado_invalido`→`TRAZADO_INVALIDO`, `413`→`PAYLOAD_DEMASIADO_GRANDE`, cualquier otro / red / timeout → `NO_DISPONIBLE` (research.md D-05); nunca propagar `RestClientException`; Javadoc actualizado (spec 014)
- [ ] T020 [US1] Implementar `ViajeProgramadoService.iniciar(String iotDeviceId, IniciarViajeRequest)` en `viajeprogramado/ViajeProgramadoService.java` según research.md D-03 (borrar `programar`/`reprogramar`/`cancelar`/`dispararAhora`): lista cerrada → validación de campos (`tripCode` 1..64, `estimatedStartDateTime`, `origen`/`destino` completos, `lat ∈ [-90,90]`, `lon ∈ [-180,180]`) → tabla de decisión → `prepararArranque` con `nombreRuta = "Viaje " + tripCode + " #" + System.currentTimeMillis()` → `save` → client → `marcarArrancado` o `marcarError` + `WARN` con `tripCode`/`iotDeviceId`/detalle y excepción según `motivo` (`NO_DISPONIBLE`→`SimuladorNoDisponibleException`); `INFO` en éxito con `trazado` y `velocidades`, y si `trazado = PROPIO` el `INFO` dice "trazado propio: puede no coincidir con el mapa" (FR-009); capturar `DataIntegrityViolationException` del `save` inicial, releer y resolver por la tabla; devuelve `InicioViajeDto` + flag de "creado" para elegir 202/200 (depende de T018, T019)
- [ ] T021 [US1] Reemplazar el handler `programar` de `viajeprogramado/ViajeProgramadoController.java` por `iniciar`: `POST /api/v1/vehiculos/{dispositivoId}/viajes-simulados` → `202` si `efecto = ARRANCADA`, `200` si `SIN_CAMBIOS`; Javadoc apuntando a `specs/014-simulacion-ruta-del-viaje/contracts/ingesta-simulacion-http.md` (depende de T020)
- [ ] T022 [P] [US1] `simulador-viajes/src/services/iniciarViajeService.js`: `iniciarViajeParaCamion(pool, { camion, rutaId, tripCode = null })` pasa `tripCode` y `finEnDestino: tripCode != null` a `insertarViaje` y los incluye en el resultado (`tripCode`, `finEnDestino`)
- [ ] T023 [US1] `simulador-viajes/src/services/routeGenerationService.js`: aceptar `tripCode` en `generarRuta` (string 1..64, requiere `camion`, si no `validacion`), pasarlo a `iniciarViajeParaCamion`; agregar `trazado: 'PROPIO'` al resultado ok del camino OSRM (depende de T022)
- [ ] T024 [US1] `simulador-viajes/src/http/rutaHttpServer.js`: incluir `trazado`/`velocidades` en el cuerpo `201`; actualizar el comentario de cabecera (014) (depende de T023)

**Checkpoint**: US1 completa — quickstart.md §2 pasa con trazado propio.

---

## Phase 4: User Story 2 - El camión recorre exactamente el trazado recibido (Priority: P1)

**Goal**: con `polyline` el simulador no usa OSRM, valida y densifica el trazado recibido, y
avanza cada tramo a su velocidad (tope 80) con el tiempo planificado; sin polyline, OSRM con la
misma regla de velocidades.

**Independent Test**: quickstart.md §3 — `trazado: RECIBIDO`, sin llamada a OSRM, posiciones a
< 30 m del trazado, ninguna trama > 80, llegada ≈ `T_plan` ± 10 %; trazado inválido → 400.

### Tests for User Story 2

- [ ] T025 [P] [US2] Crear `simulador-viajes/test/domain/polyline.test.js` (Principio VIII): completo — decodifica el ejemplo de Google (`` _p~iF~ps|U_ulLnnqC_mqNvxq`@ `` → `(38.5,-120.2)`, `(40.7,-120.95)`, `(43.252,-126.453)`) y el `P` del contrato §4 (codificado con un `encode` auxiliar del test); faltante — string vacío/`null` → error tipado; inválido — carácter fuera de rango (`'!!!'`) y secuencia truncada → error tipado; resultado en orden `{lat, lon}`
- [ ] T026 [P] [US2] Crear `simulador-viajes/test/domain/velocidadesTramo.test.js` (Principio VIII): completo — largo `n−1` en [25,80] → `RECIBIDAS` sin cambios; faltante — `undefined` → todas 40 `POR_DEFECTO`; inválido — largo distinto o no numéricas → todas 40 `DESCARTADAS`; fuera de rango — `[10, 120]` → `[25, 80]` `ACOTADAS`; desde OSRM m/s → `round(clamp(v×3.6, 25, 80))` con el ejemplo `[5.0, 30.0]` → `[25, 80]` (contrato §4)
- [ ] T027 [P] [US2] Extender `simulador-viajes/test/services/densificacionRutaService.test.js`: la nueva salida con velocidades por sub-tramo tiene largo `puntos − 1` y cada sub-tramo hereda la velocidad del tramo original; la forma vieja (solo puntos) sigue igual para los llamadores existentes
- [ ] T028 [P] [US2] Extender `simulador-viajes/test/services/routeGenerationService.test.js`: con `polyline` válida no se llama a `obtenerRutaOsrm` (stub que falla si se invoca) y se persisten `puntos` densificados + `velocidades_kmh`, `trazado: 'RECIBIDO'`; `polyline` no decodificable, < 2 puntos, extremo a > 500 m → `trazado_invalido` sin insertar nada; > 100 000 puntos → `payload_demasiado_grande`; `polyline` + `paradas` → `validacion`; sin polyline y sin paradas → `velocidades_kmh` OSRM acotadas `[25,80]`, `velocidades: 'OSRM'`; OSRM con paradas → `velocidades_kmh` NULL
- [ ] T029 [P] [US2] Extender `simulador-viajes/test/domain/avanceRuta.test.js`: ruta sin `velocidadesKmh` → resultados idénticos a los tests existentes (algoritmo legado); con velocidades — avanza `v×Δt` exacto con ruido 0 (stub de `Math.random` = 0.5), posición interpolada sobre el segmento, `avanceTramoKm` devuelto y retomado en el ciclo siguiente, velocidad reportada ≤ 80 con `v_i = 80` y ruido máximo, `sentido 'vuelta'` usa velocidades invertidas; simulación de ciclos sobre el `P` del contrato §4 escalado (≥ 10 min) llega en `T_plan ± 10 %`; posiciones a < 30 m del trazado (SC-002)
- [ ] T030 [P] [US2] Extender `viajeprogramado-test/SimuladorViajesClientTest.java` y `viajeprogramado-test/ViajeProgramadoServiceTest.java`: `polyline`/`velocidadesKmh` se reenvían byte a byte; `400 trazado_invalido` del simulador → `TrazadoInvalidoException` y fila `ERROR`; `413` → `PayloadDemasiadoGrandeException`; `velocidadesKmh` sin `polyline` → `ValidacionException`; `polyline` de 1 000 001 caracteres o `velocidadesKmh` de 100 000 elementos → `PayloadDemasiadoGrandeException` sin llamar al client; `trazado: RECIBIDO` en la respuesta; en `ViajeProgramadoControllerIntegrationTest.java` un cuerpo válido de ~2 MiB es aceptado (D-11)

### Implementation for User Story 2

- [ ] T031 [P] [US2] Crear `simulador-viajes/src/domain/polyline.js`: `decodificarPolyline(texto)` (algoritmo Google, precisión 5, devuelve `[{lat, lon}]`) que lanza `PolylineInvalidaError` ante string vacío, carácter fuera de `[63, 126]` o secuencia truncada; comentario con la referencia al contrato §2.1
- [ ] T032 [P] [US2] Crear `simulador-viajes/src/domain/velocidadesTramo.js`: `normalizarVelocidadesRecibidas(velocidades, cantidadTramos)` → `{ velocidadesKmh, diagnostico }` (`RECIBIDAS`/`ACOTADAS`/`DESCARTADAS`/`POR_DEFECTO`, research.md D-08) y `velocidadesDesdeOsrm(velocidadPorSegmentoKmh, cantidadTramos)` con `round(clamp(v, 25, 80))`, usando las constantes de `limitesVelocidad.js`
- [ ] T033 [US2] `simulador-viajes/src/services/densificacionRutaService.js`: agregar `densificarTrazadoConVelocidades(puntos, { cicloSegundos, velocidadesKmh })` → `{ puntos, velocidadesKmh }` (cada sub-tramo hereda la velocidad del tramo original, densificando con esa misma velocidad, FR-008) sin romper `densificarTrazado` (usada por `scripts/densificar-seed.js`)
- [ ] T034 [US2] `simulador-viajes/src/services/routeGenerationService.js`: rama `polyline` en `generarRuta` — validar `paradas` vacío, decodificar (error → `trazado_invalido`), `> 100 000` puntos → `payload_demasiado_grande`, `< 2` puntos → `trazado_invalido`, extremos a > 500 m de `origen`/`destino` con `distanciaHaversineMetros` → `trazado_invalido` con detalle de la distancia; normalizar velocidades (`WARN` si `DESCARTADAS`/`ACOTADAS`), densificar con T033, persistir con `velocidadesKmh`, `trazado: 'RECIBIDO'`, sin llamar a OSRM; rama OSRM sin paradas — `velocidadesDesdeOsrm` + T033 + persistir velocidades (`velocidades: 'OSRM'`, FR-008a); OSRM con paradas — comportamiento actual con `velocidades_kmh` NULL; agregar `WARN` en rechazos con `nombre`/`tripCode` (depende de T031–T033)
- [ ] T035 [US2] `simulador-viajes/src/domain/avanceRuta.js`: `avanzar` recibe `avanceTramoKm` (default 0) y despacha a `avanzarPorVelocidad` cuando `ruta.velocidadesKmh` es array, dejando el algoritmo actual intacto para el resto; `avanzarPorVelocidad` según research.md D-09 (presupuesto de tiempo `cicloSegundos`, un ruido `U(−3,3)` por ciclo, `clamp(v_i + r, 25, 80)`, interpolación lineal sobre el segmento, remanente `avanceTramoKm`, rumbo del segmento, `velocidadKmh = round(distancia/Δt)`, `sentido 'vuelta'` con puntos y velocidades invertidos, `completado` al alcanzar el último punto durante el ciclo, con `gps` en el último punto y la velocidad recorrida; si `indiceActual` ya es el último punto al empezar el ciclo devuelve `completado` con velocidad 0 e ignición apagada, igual que el algoritmo legado, para que T051 distinga "llegó" de "ya estacionado"); devuelve `avanceTramoKm` y `siguienteIndice` (índice final cuando completa)
- [ ] T036 [US2] `simulador-viajes/src/index.js`: pasar `cicloSegundos: config.cicloMs / 1000` y `avanceTramoKm: viaje.avanceTramoKm` a `avanzar`, y persistir `avanceTramoKm` en `actualizarProgresoViaje` (depende de T035, T012)
- [ ] T037 [US2] `viajeprogramado/ViajeProgramadoService.java`: validaciones de D-05 antes de llamar al client — `velocidadesKmh` sin `polyline` → `ValidacionException`; `polyline.length() > 1_000_000` o `velocidadesKmh.size() > 99_999` → `PayloadDemasiadoGrandeException`; reenviar `polyline`/`velocidadesKmh`; mapear `TRAZADO_INVALIDO` → `TrazadoInvalidoException` y `PAYLOAD_DEMASIADO_GRANDE` → `PayloadDemasiadoGrandeException`, ambos con fila `ERROR` y `WARN`; guardar `trazado` y `velocidades` devueltos (depende de T020)
- [ ] T038 [US2] `simulador-viajes/src/http/rutaHttpServer.js`: agregar `trazado_invalido: 400` y `payload_demasiado_grande: 413` a `MOTIVO_A_STATUS`; límite `LIMITE_BODY_BYTES = 4 * 1024 * 1024` en `leerBodyJson` que corta la lectura y responde `413 payload_demasiado_grande` (research.md D-11)

**Checkpoint**: US1 + US2 — quickstart.md §2 y §3 pasan.

---

## Phase 5: User Story 3 - Detener la simulación cuando el viaje termina o se cancela (Priority: P2)

**Goal**: `POST …/viajes-simulados/{tripCode}/detencion` idempotente, acotado al viaje indicado.

**Independent Test**: quickstart.md §4 — `200 DETENIDA`, luego `SIN_SIMULACION_EN_CURSO`;
reemplazado/desconocido → `SIN_SIMULACION_EN_CURSO`; tombstone bloquea inicio tardío.

### Tests for User Story 3

- [ ] T039 [P] [US3] Extender `simulador-viajes/test/db/viajeRepository.test.js`: `detenerViaje(pool, { camionId, tripCode })` solo finaliza el `en_curso` con ese par; otro `trip_code` del mismo camión y el mismo `trip_code` de otro camión quedan intactos; segunda llamada → 0 filas
- [ ] T040 [P] [US3] Crear `simulador-viajes/test/http/rutaHttpServer.test.js` (servidor en puerto efímero, repositorio/servicio stubeado o pool fake): `POST /viajes/detener` → `200 DETENIDA` / `200 SIN_SIMULACION_EN_CURSO` / `400 validacion` sin campos; cuerpo > 4 MiB en `/rutas` → `413`; path desconocido → `404`
- [ ] T041 [P] [US3] Extender `viajeprogramado-test/ViajeProgramadoServiceTest.java` con la tabla de detención de research.md D-03: `ARRANCADO` → client OK → `DETENIDO` con `motivoDetencion`/`detenidoEn` y `efecto` del simulador; `ARRANCADO` + fallo → fila sigue `ARRANCADO` con `ultimoError` y `SimuladorNoDisponibleException`; `ERROR` + fallo → `DETENIDO` `SIN_SIMULACION_EN_CURSO` + `WARN`; `DETENIDO`/`CANCELADO` → `SIN_SIMULACION_EN_CURSO` sin llamar al client; sin fila → tombstone `DETENIDO` y luego un `iniciar` → `ViajeNoModificableException`; otro dispositivo → `ViajeDeOtroDispositivoException`; `motivo` desconocido → `motivoDetencion` null, sin error
- [ ] T042 [P] [US3] Extender `viajeprogramado-test/ViajeProgramadoControllerIntegrationTest.java` y `viajeprogramado-test/SimuladorViajesClientTest.java`: `POST …/{tripCode}/detencion` con y sin cuerpo → `200 {tripCode, dispositivoId, estado: DETENIDO, efecto}`, `404`, `409`, `502`; el client envía `POST /viajes/detener {dispositivoId, tripCode}` y lee `efecto`; error → `fallo(NO_DISPONIBLE)`

### Implementation for User Story 3

- [ ] T043 [P] [US3] `simulador-viajes/src/db/viajeRepository.js`: `detenerViaje(pool, { camionId, tripCode })` con el `UPDATE … RETURNING id` de contracts/simulador-viajes-http.md §2; devuelve los ids
- [ ] T044 [US3] `simulador-viajes/src/http/rutaHttpServer.js`: despachar `POST /viajes/detener` (validar strings no vacíos → `400 validacion`), llamar a `detenerViaje`, responder `200 { efecto, viajeIds }` y loggear `INFO` con `dispositivoId`/`tripCode`/efecto; el resto de rutas sin cambios (depende de T043)
- [ ] T045 [P] [US3] Crear `viajeprogramado/DetenerViajeRequest.java` (`String motivo`) y `viajeprogramado/DetencionViajeDto.java` (`tripCode`, `dispositivoId`, `estado`, `efecto`)
- [ ] T046 [US3] `viajeprogramado/SimuladorViajesClient.java`: `detenerViaje(String iotDeviceId, String tripCode)` → `POST /viajes/detener`, `SimulacionResultado.detenido(efecto)` o `fallo(NO_DISPONIBLE, detalle)`, sin propagar `RestClientException`
- [ ] T047 [US3] `viajeprogramado/ViajeProgramadoService.java`: `detener(String iotDeviceId, String tripCode, DetenerViajeRequest)` según la tabla de detención de research.md D-03 (lista cerrada primero; `motivo` solo `CANCELADO`/`COMPLETADO`; `INFO` en éxito y `WARN` en fallo con `tripCode`/`iotDeviceId`) (depende de T045, T046)
- [ ] T048 [US3] `viajeprogramado/ViajeProgramadoController.java`: `POST /api/v1/vehiculos/{dispositivoId}/viajes-simulados/{tripCode}/detencion` con `@RequestBody(required = false) DetenerViajeRequest`, `200` + `DetencionViajeDto` (depende de T047)

**Checkpoint**: US3 — quickstart.md §4 pasa.

---

## Phase 6: User Story 4 - El camión espera en destino hasta que el viaje se cierra (Priority: P2)

**Goal**: los viajes avisados quedan estacionados en el destino emitiendo velocidad 0 (y BLE)
hasta la detención; CLI/manuales conservan la vuelta automática.

**Independent Test**: quickstart.md §5 — sin fila `vuelta`, tramas en el último punto con
velocidad 0; reinicio retoma estacionado; detención corta la emisión; CLI sigue con vuelta.

### Tests for User Story 4

- [ ] T049 [P] [US4] Crear `simulador-viajes/test/ciclo/cicloSimulacion.test.js` (subdirectorio: el script `node --test test/**/*.test.js` corre bajo `sh` sin globstar y no ve archivos en `test/` raíz) sobre la función de ciclo extraída en T050 (con `udpClient` y repositorios fake): viaje `finEnDestino` que completa → emite trama en el último punto, persiste índice final, no llama a `finalizarYCrearVuelta`; ciclo siguiente → trama con velocidad 0, ignición apagada, RPM de ralentí y BLE si `refrigerada`; viaje sin `finEnDestino` → llama a `finalizarYCrearVuelta` sin trama (FR-015); detenido (ausente de la flota) → no emite

### Implementation for User Story 4

- [ ] T050 [US4] Extraer `procesarCamion`/`ejecutarCiclo` de `simulador-viajes/src/index.js` a `simulador-viajes/src/cicloSimulacion.js` (dependencias inyectables para test; `index.js` queda con `main`, config y señales) y extraer la construcción/envío de la trama a una función `emitirTrama` reutilizable
- [ ] T051 [US4] En `simulador-viajes/src/cicloSimulacion.js`: si `resultado.completado` y `viaje.finEnDestino` → emitir trama (al llegar: con la velocidad del último tramo; ya estacionado: `gps` del destino con velocidad 0 e ignición apagada) y persistir el índice final con `avanceTramoKm = 0`, sin `finalizarYCrearVuelta`; si `completado` sin `finEnDestino` → comportamiento actual; `determinarModoBle` sigue funcionando con `siguienteIndice` final; log `INFO` una sola vez al llegar ("esperando en destino hasta la detencion") (FR-014, research.md D-10) (depende de T050, T035)

**Checkpoint**: las cuatro historias completas.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T052 [P] Agregar al inicio de `specs/013-autostart-simulacion-viaje/contracts/viajes-simulados-http-api.md` y `specs/013-autostart-simulacion-viaje/contracts/agrolink-backend-trip-hook.md` un aviso "Reemplazado por v2: specs/014-simulacion-ruta-del-viaje/contracts/ingesta-simulacion-http.md" (sin borrar el contenido histórico)
- [ ] T053 [P] Actualizar `specs/011-generar-ruta-simulada/contracts/rutas-http-api.md` con una nota "Extendido por 014" que remita a `specs/014-simulacion-ruta-del-viaje/contracts/simulador-viajes-http.md`
- [ ] T054 [P] Actualizar `simulador-viajes/README.md`: `polyline`/`velocidadesKmh`/`tripCode` en `POST /rutas`, `POST /viajes/detener`, avance por velocidad de tramo (tope 80), espera en destino y su limitación (indefinida sin detención)
- [ ] T055 [P] Verificar que ningún comentario/Javadoc de `viajeprogramado/` siga describiendo horario, poller, `PENDIENTE` o reprogramación (`grep -rn "PENDIENTE\|poller\|reprogram" src/main/java/ar/utn/agrolink/ingesta/viajeprogramado`) y corregirlos
- [ ] T056 Ejecutar `mvn test` y `(cd simulador-viajes && npm test)`; ambos en verde
- [ ] T057 Ejecutar quickstart.md §2–§6 contra el stack local y anotar en el PR los resultados (incluida la medición de SC-006 con un trazado de ≥ 10 min)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias; T001–T004 en paralelo.
- **Foundational (Phase 2)**: depende de Setup (T011–T013 necesitan las columnas de T001/T003).
  T005 → T006 → T007; T008 → T009; T010 independiente; T011–T013 en paralelo.
- **US1 (Phase 3)**: depende de Foundational.
- **US2 (Phase 4)**: depende de US1 (T037 extiende `iniciar` de T020; T034 extiende `generarRuta` de T023).
- **US3 (Phase 5)**: depende de Foundational; del lado Java usa `ViajeProgramadoService` de US1
  (mismo archivo), así que se ordena después de T020/T021. El lado Node (T039, T040, T043) puede ir en paralelo con US2; T044 edita `rutaHttpServer.js` igual que T024/T038, así que va después de T038.
- **US4 (Phase 6)**: depende de T035/T036 (US2) y de T011/T012; independiente de US3.
- **Polish (Phase 7)**: al final.

### Within Each User Story

Tests primero (deben fallar), luego modelo/DTOs, servicio, endpoint.

### Parallel Opportunities

- Setup completo; T008/T010/T011/T012/T013 en Foundational.
- Todos los tests marcados [P] de cada historia.
- Java vs Node dentro de una historia (p. ej. T018–T021 vs T022–T024; T037 vs T031–T036; T045–T048 vs T043–T044).

---

## Parallel Example: User Story 2

```bash
# Tests en paralelo:
Task: "T025 polyline.test.js"
Task: "T026 velocidadesTramo.test.js"
Task: "T029 avanceRuta.test.js (avance por velocidad)"
Task: "T030 tests Java de reenvío y mapeo"

# Módulos nuevos en paralelo:
Task: "T031 domain/polyline.js"
Task: "T032 domain/velocidadesTramo.js"
```

## Parallel Example: User Story 3

```bash
Task: "T043 detenerViaje en viajeRepository.js"     # Node
Task: "T045 DetenerViajeRequest / DetencionViajeDto"  # Java
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 (aplicar migraciones 008/009 en local).
2. Phase 3 (US1) → validar quickstart.md §2: arranque inmediato con trazado propio.
3. **No desplegar** solo el MVP frente a AgroLinkBackend 026: el backend ya envía `polyline` y
   espera la detención; desplegar US1–US4 juntos (plan.md, Riesgos).

### Incremental Delivery

1. US1 → arranque inmediato (reemplaza el modo programado).
2. US2 → trazado y velocidades del mapa.
3. US3 → detención.
4. US4 → espera en destino.
5. Polish → docs y validación end-to-end.

---

## Notes

- `agrolink-ingesta` nunca escribe en `simulador.*` (FR-011): todo cambio de viajes del simulador
  pasa por HTTP; las migraciones son despliegue, no runtime.
- Ninguna tarea toca `telemetria.*` (Principio IV).
- Commit por tarea o grupo lógico.
