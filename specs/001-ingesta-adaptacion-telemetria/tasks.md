---

description: "Task list for 001-ingesta-adaptacion-telemetria"
---

# Tasks: Ingesta y Adaptación de Telemetría

**Input**: Design documents from `/specs/001-ingesta-adaptacion-telemetria/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Los tests del **parser, el mapper y el cálculo del reporte** NO son opcionales en
esta feature: la Constitución (Principio VIII) obliga a cubrir toda lógica de parseo y
adaptación de datos externos con los 3 casos mínimos (completo / campos faltantes / dato
inválido). El resto de los tests sí es opcional y no se incluyó.

**Organization**: Tareas agrupadas por historia de usuario, para poder implementar y validar
cada una de forma independiente.

**Numeración**: 70 tareas (T001–T070). T067, T068 y T069 se agregaron después de la
numeración original y están ubicadas **físicamente en la fase que les corresponde**, no al
final: el orden de lectura del archivo es el orden de ejecución, aunque los IDs no queden
monótonos dentro de esas fases. Se prefirió eso a renumerar 66 tareas ya referenciadas
desde `plan.md` y `quickstart.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede correr en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: Historia de usuario a la que pertenece (US1…US6)
- Las descripciones incluyen la ruta exacta del archivo

## Path Conventions

Monorepo con dos raíces de código (ver "Project Structure" en [plan.md](./plan.md)):

- `rinho-receptor/` — servicio de ingesta UDP (Node.js 22)
- `src/main/java/ar/utn/agrolink/ingesta/` — servicio de reportes (Java 21 / Spring Boot)
- `deploy/` — infraestructura Docker Compose y DDL

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Esqueletos de proyecto y verificaciones que condicionan todo lo demás

- [X] T001 [P] Crear el esqueleto del receptor en `rinho-receptor/`: `package.json` (Node 22, `type: module`, script `test` con `node --test`, única dependencia de runtime `pg`) y los directorios `src/net/`, `src/protocol/`, `src/domain/`, `src/db/`, `test/`
- [X] T002 [P] Crear el esqueleto Maven/Spring Boot del servicio de reportes: `pom.xml` (Java 21, Spring Boot 3.3.x, `spring-boot-starter-web`, `spring-boot-starter-data-jpa`, `org.postgresql:postgresql`, `spring-boot-starter-test`) y `src/main/java/ar/utn/agrolink/ingesta/IngestaApplication.java`
- [X] T003 [P] Crear `deploy/.env.example` con las variables del stack (puerto UDP, credenciales de las dos roles de base, nombre de base, TTL de la caché de deduplicación), sin ningún valor real
- [X] T004 [P] Crear `.gitignore` en la raíz excluyendo `deploy/.env`, `node_modules/`, `target/` y `rinho-receptor/coverage/` (Principio VI: nunca commitear credenciales)
- [X] T005 [P] **Verificar** (sin escribir compose todavía) que las imágenes tengan manifiesto `linux/arm64`, ejecutando `docker manifest inspect` sobre `timescale/timescaledb:2.17.2-pg16`, `node:22-alpine` y `eclipse-temurin:21-jre-alpine`; registrar los tags verificados y su digest en `deploy/README.md`, que es la fuente que consume T016 al escribir el compose (decisión D-11: `timescaledb-ha` NO tiene ARM64 y rompería el despliegue)

**Checkpoint**: Ambos proyectos compilan/arrancan vacíos y las imágenes están verificadas para ARM64

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Esquema de datos y utilidades transversales del receptor

**⚠️ CRITICAL**: Ninguna historia de usuario puede empezar hasta terminar esta fase

- [X] T006 Escribir el DDL en `deploy/db/01-schema.sql`: schema `telemetria`, extensión `timescaledb`, tabla `lectura_telemetria` con todas las columnas de [data-model.md](./data-model.md), `CHECK` en `estado_interpretacion` y `odometro_origen`, y `create_hypertable(..., 'momento_evento')`
- [X] T007 Agregar en `deploy/db/01-schema.sql` el índice único de deduplicación `lectura_dedup_uq (dispositivo_id, momento_evento, frame_hash)` y el índice de consulta `lectura_camion_tiempo_idx (dispositivo_id, momento_evento DESC)` (D-07: el único DEBE incluir la columna de particionamiento)
- [X] T008 Escribir `deploy/db/02-roles.sql` creando los roles `rinho_receptor` (`GRANT SELECT, INSERT`) y `agrolink_ingesta` (`GRANT SELECT`), sin otorgar `UPDATE` ni `DELETE` a ninguno (Principio IV: la inmutabilidad la garantiza el motor)
- [X] T009 [P] Implementar la carga y validación de variables de entorno en `rinho-receptor/src/config.js`, abortando el arranque con mensaje explícito si falta alguna obligatoria
- [X] T010 [P] Implementar el logger JSON estructurado a stdout en `rinho-receptor/src/log.js`, sin dependencias externas (usa `console.log` con objetos serializados; campos mínimos: `ts`, `level`, `msg`, `dispositivoId`)
- [X] T011 Implementar el pool de conexiones en `rinho-receptor/src/db/pool.js` usando `pg`, aplicando `SET search_path TO telemetria` al conectar y exponiendo cierre ordenado

**Checkpoint**: El esquema está listo y el receptor tiene config, logging y acceso a base

---

## Phase 3: User Story 1 - Entorno de ingesta persistente y reproducible (Priority: P1) 🎯 MVP

**Goal**: Levantar los tres componentes con un único `docker compose up`, operativos, comunicados y resistentes a reinicio.

**Independent Test**: Desde un entorno limpio, siguiendo solo [quickstart.md](./quickstart.md) §1, los tres servicios quedan `healthy`; al reiniciar cualquiera vuelve a quedar operativo sin perder datos ya persistidos.

### Implementation for User Story 1

- [X] T012 [P] [US1] Implementar el healthcheck HTTP del receptor en `rinho-receptor/src/net/healthServer.js` con el módulo `node:http` incorporado, devolviendo `200 {"status":"UP"}` en un puerto NO publicado al host (D-12: un socket UDP no tiene noción de conexión; sin este endpoint un receptor colgado se vería "corriendo")
- [X] T013 [P] [US1] Implementar `GET /health` del servicio de reportes en `src/main/java/ar/utn/agrolink/ingesta/config/HealthController.java`, sin Spring Boot Actuator (D-12: dependencias mínimas)
- [X] T014 [P] [US1] Crear `rinho-receptor/Dockerfile` sobre `node:22-alpine`, instalando solo dependencias de producción y corriendo como usuario no-root
- [X] T015 [P] [US1] Crear el `Dockerfile` multi-stage del servicio de reportes en la raíz (build con JDK 21, runtime `eclipse-temurin:21-jre-alpine`, usuario no-root)
- [X] T016 [US1] Escribir `deploy/compose.yaml` con los tres servicios (`timescaledb`, `rinho-receptor`, `agrolink-ingesta`), **fijando los tags de imagen ARM64 verificados en T005 y documentados en `deploy/README.md`**, montando `deploy/db/*.sql` como scripts de inicialización, publicando **solo el puerto UDP** del receptor, con límites de memoria por contenedor y volumen persistente para la base
- [X] T017 [US1] Configurar los healthchecks de los tres servicios en `deploy/compose.yaml`, con `start_period: 120s` para `agrolink-ingesta` (arranque en frío de JVM con 2 OCPU compartidas) y `depends_on: service_healthy` de los servicios contra `timescaledb`
- [X] T018 [US1] Implementar el arranque y apagado ordenado en `rinho-receptor/src/index.js` (config → pool → socket UDP → health server; `SIGTERM`/`SIGINT` cierran socket y pool antes de salir, para que `docker compose restart` no pierda datagramas en vuelo)
- [X] T019 [US1] Escribir el runbook de la VM Oracle en `deploy/README.md`: creación de la VM Ampere A1, regla de ingress **UDP** en la Security List de la VCN, y advertencia explícita de que abrir solo TCP deja el stack aparentemente sano con el dispositivo mudo
- [X] T020 [US1] Validar el escenario 2 de US1 documentado en `deploy/README.md`: reiniciar cada servicio con `docker compose restart` y confirmar que vuelve a `healthy` sin pérdida de configuración ni de filas ya persistidas

**Checkpoint**: `docker compose up -d` deja tres servicios `healthy`. SC-005 medible. **MVP alcanzado.**

---

## Phase 4: User Story 2 - Recepción confiable de eventos de posición (Priority: P1)

**Goal**: Recibir tramas por UDP, persistirlas y recién entonces responder el ACK de protocolo.

**Independent Test**: Enviar una trama simulada por UDP y verificar que el receptor responde el ACK correspondiente; con la base caída, verificar que **no** responde nada.

### Tests for User Story 2 (obligatorios — Principio VIII)

> Escribir estos tests ANTES de la implementación y verificar que fallan.

- [X] T021 [P] [US2] Tests del envelope en `rinho-receptor/test/frame.test.js`: checksum XOR correcto contra el ejemplo oficial de [`contracts/rinho-eq-frame.md`](./contracts/rinho-eq-frame.md) §5, trama con checksum inválido (rechazo), trama sin `;ID=` (rechazo), trama con y sin `;#msgNum`, y datagrama con múltiples tramas concatenadas
- [X] T022 [P] [US2] Tests de construcción del ACK en `rinho-receptor/test/ack.test.js`: formato `>ACK;#<msgNum>;ID=<id>;*<cs><` con checksum válido, y que no se construya ACK cuando falta `msgNum`

### Implementation for User Story 2

- [X] T023 [US2] Implementar el parseo del envelope en `rinho-receptor/src/protocol/frame.js`: extracción de cuerpo, `msgNum` opcional, `ID`, checksum, verificación XOR e iteración sobre múltiples tramas por datagrama
- [X] T024 [P] [US2] Implementar la construcción del frame ACK en `rinho-receptor/src/net/ack.js`, reutilizando el cálculo de checksum de `frame.js`
- [X] T025 [US2] Implementar el `INSERT ... ON CONFLICT DO NOTHING` en `rinho-receptor/src/db/lecturaRepository.js`, devolviendo si insertó fila nueva o si ya existía (ambos casos son éxito de persistencia a efectos del ACK)
- [X] T026 [US2] Implementar la caché en memoria de deduplicación por `(dispositivo_id, frame_hash)` con TTL configurable en `rinho-receptor/src/db/lecturaRepository.js` (D-07: segunda barrera, necesaria porque el índice único no atrapa reintentos de tramas sin fix de hora GPS)
- [X] T027 [US2] Implementar el servidor UDP en `rinho-receptor/src/net/udpServer.js` orquestando el flujo: recibir datagrama → parsear tramas → persistir → **recién entonces** enviar ACK al `address:port` de origen del datagrama (D-06: nunca a una dirección configurada, porque el equipo está detrás del NAT del operador celular)
- [X] T028 [US2] Implementar en `rinho-receptor/src/net/udpServer.js` el camino de fallo: si la persistencia falla, **no** enviar ACK y registrar el error con la trama cruda (US2 escenario 2: el silencio es la señal de reintento para el dispositivo)
- [X] T029 [US2] Registrar en `rinho-receptor/src/net/udpServer.js` el rechazo explícito de tramas sin `dispositivo_id` válido o con checksum inválido, logueando la trama cruda completa (FR-013 + Principio IX: nunca descartar en silencio)

**Checkpoint**: El receptor acepta tramas, deduplica reintentos y el ACK solo sale después del commit

---

## Phase 5: User Story 3 - Registro auditable de cada lectura (Priority: P1)

**Goal**: Decodificar la trama EQ completa y persistir los ocho campos de dominio, consultables y ordenables cronológicamente.

**Independent Test**: Enviar una lectura completa por UDP y consultar la base verificando que los ocho campos quedaron correctamente interpretados y que la secuencia por camión se reconstruye en orden.

### Tests for User Story 3 (obligatorios — Principio VIII)

> Los 3 casos mínimos del Principio VIII se cubren entre T030 y T032.

- [X] T030 [P] [US3] Tests de la sección GPS en `rinho-receptor/test/eqParser.test.js`: **caso completo** decodificando las **dos** tramas de referencia —la del fabricante ([`contracts/rinho-eq-frame.md`](./contracts/rinho-eq-frame.md) §5) y la de CAN poblado (§5-bis)— y comparando los 19 campos contra sus tablas. Incluir tres aserciones que atrapan errores de encuadre: (a) la sección GPS mide **exactamente 66 chars y el layout cierra sin sobrante**, (b) la velocidad se lee **en km/h sin conversión**, (c) el checksum recalculado coincide con el declarado en ambas
- [X] T031 [P] [US3] Tests de la sección CAN OBD-II en `rinho-receptor/test/canObd.test.js`: **caso de campos vacíos** (`1=,2=,...,2C=`, el ejemplo canónico del fabricante), **caso con valores poblados** usando la sección CAN real de §5-bis (`15=75`, `B=66010`, `2A=90`…), IDs de 1 y 2 caracteres hex, y que el VIN (`1`) se descarte. Incluir la aserción de que los valores se leen como **strings opacos, no como números**: el VIN real es `1M8GDM9A_KP042788` (alfanumérico con guion bajo) y coercionarlo daría `NaN`, enmascarando el descarte que exige el Principio V
- [X] T032 [P] [US3] Tests del mapper en `rinho-receptor/test/lecturaMapper.test.js`: **caso de dato inválido** (latitud fuera de rango, velocidad negativa, combustible > 100 → campo a `NULL` + `PARCIAL` + registrado en `campos_faltantes`), fallback de odómetro ECU→GPS con su normalización de unidades, y fecha/hora en ceros → `momento_evento` de recepción + `PARCIAL`
- [X] T033 [P] [US3] Test de regresión en `rinho-receptor/test/lecturaMapper.test.js` que falle si alguien reintroduce la conversión de nudos (`× 1.852`) sobre la velocidad (trampa histórica documentada en `contracts/rinho-eq-frame.md` §3)

### Implementation for User Story 3

- [X] T034 [US3] Implementar el parser de la sección GPS de ancho fijo (**66 chars**, 19 campos) en `rinho-receptor/src/protocol/eqParser.js` según la tabla de offsets de `contracts/rinho-eq-frame.md` §3. Derivar los offsets de la tabla de anchos en vez de hardcodear índices, y **fallar explícitamente si la sección no mide 66** (una sección de largo distinto es una trama de otro formato, no una a parsear a medias)
- [X] T035 [US3] Implementar en `rinho-receptor/src/protocol/eqParser.js` la detección de fecha/hora en ceros (sin fix de hora GPS), **antes** de construir cualquier objeto de fecha (D-08: alimentar un constructor de fecha con ceros produce 1999-11-30 y rompería el particionamiento temporal de la hypertable)
- [X] T036 [P] [US3] Implementar el parser de la sección CAN OBD-II en `rinho-receptor/src/protocol/canObd.js`: pares `ID=VALOR` separados por coma, IDs hex de 1–2 caracteres, y `ID=` sin valor tratado como campo ausente normal (NO reutilizar `canJsonTransform` de `rinho-udp-server`: asume IDs J1939 de 4 dígitos, ver D-02)
- [X] T037 [US3] Implementar el mapper crudo→dominio en `rinho-receptor/src/domain/lecturaMapper.js`: latitud/longitud ÷ 100000, velocidad en km/h sin conversión, ignición = bit 7 de `HH`, tensión ÷ 10, satélites
- [X] T038 [US3] Implementar en `rinho-receptor/src/domain/lecturaMapper.js` la resolución del odómetro: CAN `B` (km) × 1000 con `odometro_origen = 'ECU'`, o campo GPS (hex, ya en metros) con `origen = 'GPS'` (D-05; normalizar siempre a metros o la distancia sale 1000× equivocada)
- [X] T039 [US3] Implementar en `rinho-receptor/src/domain/lecturaMapper.js` el mapeo de combustible desde CAN `15` y el descarte explícito del VIN (CAN `1`) sin persistirlo en ninguna columna ni en `datos_can` (Principio V)
- [X] T040 [US3] Implementar en `rinho-receptor/src/domain/lecturaMapper.js` las validaciones de rango de [data-model.md](./data-model.md) y la construcción de `estado_interpretacion` + `campos_faltantes` (Principio IX)
- [X] T041 [US3] Extender el `INSERT` de `rinho-receptor/src/db/lecturaRepository.js` con todas las columnas de dominio y cablear el flujo completo parse → map → persist en `rinho-receptor/src/net/udpServer.js`
- [X] T067 [US3] **Test de llegada tardía (FR-012 / Principio VII)** en `rinho-receptor/test/lecturaTardia.test.js`: persistir una lectura del mismo `dispositivo_id` cuyo `momento_evento` (hora del dispositivo, la que viene en la trama) sea **anterior** al de filas ya almacenadas, y afirmar que (a) se persiste sin error, (b) las filas más recientes quedan **byte a byte intactas** —comparar un snapshot completo previo y posterior, no solo contar filas—, y (c) un `SELECT ... ORDER BY momento_evento` la devuelve intercalada en su posición cronológica real, no al final por orden de inserción. El escenario a cubrir es el real: el camión pierde cobertura, bufferea, y al reconectar descarga tramas viejas mezcladas con nuevas
- [X] T069 [P] [US3] Crear el generador de tramas de prueba `rinho-receptor/test/tools/buildFrame.js`: CLI que emite una trama EQ válida para un `deviceId` dado, con checksum XOR **recalculado** sobre el contenido final (reutiliza `calculateChecksum` de `src/protocol/frame.js`, T023) y campos GPS/CAN sobrescribibles por flags. Lo consumen T061 (validación de concurrencia de SC-004) y [quickstart.md](./quickstart.md) §7, que hoy lo invocan sin que exista

**Checkpoint**: Los ocho campos del spec se persisten correctamente interpretados y son consultables

---

## Phase 6: User Story 4 - Conservación del payload crudo (Priority: P2)

**Goal**: Guardar la trama original íntegra y los datos CAN no promovidos, junto a los campos interpretados.

**Independent Test**: Enviar una lectura y verificar que `payload_crudo` es byte por byte la trama enviada y que `datos_can` conserva los pares CAN que no tienen columna propia.

> **Nota de alcance**: `payload_crudo` y `frame_hash` ya se persisten desde US2, porque la
> deduplicación los necesita. Lo que agrega esta historia es `datos_can` y la verificación
> explícita de integridad/reprocesabilidad que exige FR-003.

### Implementation for User Story 4

- [X] T042 [US4] Persistir en `datos_can` (JSONB) todos los pares CAN crudos no promovidos a columnas —`2` (RPM), `3` (velocidad de rueda), `14` (combustible consumido), `2A` (temperatura), `2C` (presión de aceite)— desde `rinho-receptor/src/domain/lecturaMapper.js` (D-04)
- [X] T043 [P] [US4] Test en `rinho-receptor/test/lecturaMapper.test.js` que verifique que `payload_crudo` es idéntico byte a byte a la trama de entrada (sin trim, sin normalización) y que `frame_hash` es su SHA-256
- [X] T044 [P] [US4] Test en `rinho-receptor/test/canObd.test.js` que verifique que un ID CAN desconocido (no listado en D-04) igual se conserva en `datos_can` en vez de descartarse, salvo el VIN

**Checkpoint**: Nada de lo recibido se pierde; el histórico es reprocesable si el layout resulta distinto

---

## Phase 7: User Story 5 - Reporte de viaje por camión y rango (Priority: P2)

**Goal**: Exponer las cinco métricas del reporte de actividad, con semántica explícita de "sin datos" y de "no calculable".

**Independent Test**: Con lecturas conocidas persistidas, pedir el reporte y verificar las cinco métricas contra el cálculo manual; pedir un camión sin lecturas y verificar el 404 explícito.

### Tests for User Story 5 (obligatorios — Principio VIII)

- [X] T045 [P] [US5] Tests del cálculo en `src/test/java/ar/utn/agrolink/ingesta/report/ReporteViajeServiceTest.java`: las cinco métricas sobre un conjunto conocido de lecturas (SC-006), verificando que la distancia sale en metros
- [X] T046 [P] [US5] Tests de casos borde en `src/test/java/ar/utn/agrolink/ingesta/report/ReporteViajeServiceTest.java`: sin lecturas (excepción → 404), una sola lectura, `distanciaM = 0` (`tasaConsumoPromedio` null + flag), ninguna lectura con combustible, y combustible consumido negativo devuelto tal cual sin recortar a cero
- [X] T047 [P] [US5] Test en `src/test/java/ar/utn/agrolink/ingesta/report/ReporteViajeServiceTest.java` que verifique `odometroOrigenMixto = true` cuando el rango combina lecturas con origen `ECU` y `GPS` (D-05)

### Implementation for User Story 5

- [X] T048 [P] [US5] Crear los enums `EstadoInterpretacion.java` y `OrigenOdometro.java` en `src/main/java/ar/utn/agrolink/ingesta/telemetry/`
- [X] T049 [US5] Crear la entidad `src/main/java/ar/utn/agrolink/ingesta/telemetry/LecturaTelemetria.java` mapeando `telemetria.lectura_telemetria`, anotada `@Immutable` y sin setters (Principio IV expresado también en el ORM)
- [X] T050 [US5] Crear `src/main/java/ar/utn/agrolink/ingesta/telemetry/LecturaTelemetriaRepository.java` **sin ningún método de escritura**, con la consulta por `dispositivo_id` y rango de `momento_evento`
- [X] T068 [US5] **Test de orden cronológico en la consulta (FR-012, segunda mitad de T067)**: verificar que el repositorio de T050, dado un rango que abarca una lectura llegada tarde (insertada después pero con `momento_evento` anterior), la devuelve **ordenada por `momento_evento`** y contabilizada en el reporte de viaje, no relegada al final ni omitida. Complementa a T067, que cubre la persistencia a nivel de motor; esta mitad vive en US5 porque depende de T050
- [X] T051 [P] [US5] Crear el DTO de respuesta `src/main/java/ar/utn/agrolink/ingesta/report/ReporteViajeDto.java` con los 11 campos del schema `ReporteViaje` de [`contracts/agrolink-reportes-api.yaml`](./contracts/agrolink-reportes-api.yaml)
- [X] T052 [US5] Implementar el cálculo de las cinco métricas en `src/main/java/ar/utn/agrolink/ingesta/report/ReporteViajeService.java` según las fórmulas de [data-model.md](./data-model.md), guardando la división por cero de la tasa de consumo (FR-005)
- [X] T053 [P] [US5] Crear `src/main/java/ar/utn/agrolink/ingesta/report/SinDatosException.java` y su `@ExceptionHandler` devolviendo **404** `application/problem+json` con mensaje explícito (FR-006 / D-13: nunca un 200 con ceros, que sería indistinguible de un camión detenido)
- [X] T054 [US5] Implementar `GET /api/v1/reportes/viaje` en `src/main/java/ar/utn/agrolink/ingesta/report/ReporteViajeController.java` con los parámetros `camionId`, `desde` y `hasta`, validando que `hasta` sea posterior a `desde` (→ 400)
- [X] T055 [US5] Configurar `src/main/resources/application.yaml` con solo placeholders `${ENV_VAR}` para la conexión de base (usuario `agrolink_ingesta`, solo lectura) y `ddl-auto: none` (Principio VI + evitar que el ORM toque el DDL)

**Checkpoint**: El reporte devuelve las cinco métricas y distingue "sin datos" de "no calculable"

---

## Phase 8: User Story 6 - Validación end-to-end con dispositivo real (Priority: P1)

**Goal**: Confirmar que una lectura del hardware real recorre todo el camino sin intervención manual y queda correctamente interpretada.

**Independent Test**: Encender el dispositivo en el camión piloto, esperar un reporte y verificar la fila resultante en TimescaleDB.

> **⚠️ Esta fase es la que valida los supuestos del diseño contra la realidad.** T056 debe
> ejecutarse **antes** de dar por buena ninguna fila producida por el equipo real.

### Implementation for User Story 6

- [ ] T056 [US6] **Verificar el layout real de la trama (riesgo R-1)**: capturar tramas crudas del dispositivo desde los logs y decodificarlas a mano contra `contracts/rinho-eq-frame.md` §3, guardando al menos 3 tramas reales como fixtures en `rinho-receptor/test/fixtures/tramas-reales.md` con su decodificación esperada
- [ ] T057 [US6] Agregar las tramas reales capturadas como casos de regresión en `rinho-receptor/test/eqParser.test.js`, verificando coordenadas plausibles, velocidad en km/h y odómetro monótono creciente entre lecturas sucesivas
- [ ] T058 [US6] **Confirmar qué publica el ECU del camión piloto**: ejecutar la consulta de cobertura de campos de [quickstart.md](./quickstart.md) §6.2 y registrar el resultado en `research.md`. El riesgo R-2 ya está **cerrado** a nivel de protocolo (la trama de §5-bis prueba que el ECU publica `15` y `B`), así que esta tarea dejó de ser un punto de decisión sobre el alcance de SC-006: ahora solo confirma la cobertura efectiva en **este** vehículo
- [ ] T070 [US6] **Verificar el bit de ignición (riesgo R-7)**: capturar `HH` con el motor **encendido** y **apagado**, y contrastar con `2` (rpm) del CAN en la misma trama. En la trama de referencia §5-bis `HH=7F` indica ignición apagada conviviendo con 2200 rpm, lo que es imposible. Registrar la interpretación correcta en `contracts/rinho-eq-frame.md` §3 y corregir el mapper si el bit no es el 7 o está invertido
- [ ] T059 [US6] Verificar si el dispositivo emite `;#msgNum` (riesgo R-4) y, si no lo hace, revisar los parámetros del comando `GEQ` en el portal de configuración del equipo; documentar el hallazgo en `deploy/README.md`
- [ ] T060 [US6] Medir la latencia end-to-end con la consulta de [quickstart.md](./quickstart.md) §6.3 y confirmar SC-001 (< 2 minutos), documentando el resultado en `deploy/README.md`
- [X] T061 [US6] Validar la concurrencia multi-camión (SC-004 / FR-007) enviando tramas simuladas con cinco `ID` distintos en paralelo según [quickstart.md](./quickstart.md) §7, generándolas con `test/tools/buildFrame.js` (T069) para que el checksum se recalcule por trama, y verificar que ninguna lectura queda asociada al camión equivocado

**Checkpoint**: Telemetría de hardware real, no simulada, llegando de punta a punta. Objetivo del walking skeleton cumplido.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Cierre de deudas transversales detectadas durante el diseño

- [X] T062 [P] Verificar la inmutabilidad a nivel de motor ejecutando el `UPDATE` de [quickstart.md](./quickstart.md) §4 con el rol `rinho_receptor` y confirmando que falla con `permission denied` (FR-011 / Principio IV); documentar la evidencia en `deploy/README.md`
- [X] T063 [P] ~~Enmendar `.specify/memory/constitution.md`~~ **HECHO (2026-08-15, bump MINOR 1.0.0 → 1.1.0)**. Dos enmiendas: (a) **Principio VI** — carve-out acotado para enlaces de telemetría dispositivo→servidor cuyo hardware no soporte TLS, condicionado a controles compensatorios obligatorios (aislamiento de red + validación de integridad y origen) y a documentarlos en el Complexity Tracking del plan; resuelve el hallazgo D1 (CRITICAL) de `/speckit-analyze`, que era un conflicto de constitución no subsanable por documentación en el plan. (b) **Principio I** — se reemplazó el paréntesis obsoleto "(actualmente: Traccar decodificando el protocolo Rinho)" por "(actualmente: un receptor propio que decodifica el protocolo Rinho)". Sync Impact Report del encabezado actualizado; `plan.md` propagado (Constitution Check Principio VI de ⚠️ a ✅ condicionado, Complexity Tracking reformulado como controles compensatorios exigibles)
- [X] T064 [P] Documentar en `deploy/README.md` la mejora de seguridad pendiente antes de operar flota real: filtrado del puerto UDP por rango de IP del operador celular (Principio VI, excepción registrada en Complexity Tracking de `plan.md`)
- [X] T065 [P] Agregar a `rinho-receptor/README.md` la relación con el proyecto de referencia `rinho-udp-server`: qué se reutilizó (envelope, checksum, guarda de fecha en ceros) y qué NO (parser CAN J1939, downlink de comandos, `parserCQ`/`parserER`)
- [X] T066 Ejecutar la validación completa de [quickstart.md](./quickstart.md) de punta a punta desde un entorno limpio, cronometrando para confirmar SC-005 (< 30 minutos por alguien que no participó del despliegue) y corrigiendo en `quickstart.md` cualquier paso que haya requerido conocimiento no documentado

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias — puede empezar de inmediato
- **Foundational (Phase 2)**: depende de Setup — **BLOQUEA todas las historias**
- **US1 (Phase 3)**: depende de Foundational. Es el MVP y habilita validar todo lo demás
- **US2 (Phase 4)**: depende de Foundational. En la práctica conviene tener US1 arriba para probar contra el stack real
- **US3 (Phase 5)**: depende de US2 (necesita el flujo UDP → persist ya cableado en T027/T041)
- **US4 (Phase 6)**: depende de US3 (`datos_can` sale del parser CAN de T036)
- **US5 (Phase 7)**: depende de Foundational (esquema). **Independiente del receptor**: se puede desarrollar y testear en paralelo insertando filas a mano
- **US6 (Phase 8)**: depende de US1 + US2 + US3 (necesita el camino completo desplegado)
- **Polish (Phase 9)**: depende de las historias que se decidan entregar

### User Story Dependencies

```text
Setup → Foundational ─┬→ US1 (MVP) ─────────────┐
                      │                          ├→ US6 (validación real)
                      ├→ US2 → US3 → US4 ────────┘
                      │
                      └→ US5  (independiente: no toca el receptor)
```

**Nota sobre la independencia de US2/US3/US4**: el spec las declara historias separadas y
cada una tiene su criterio de aceptación propio, pero comparten el mismo pipeline de
ingesta. Se encadenan en incrementos honestos: US2 persiste lo mínimo para que el ACK sea
real (identificador, tiempos, trama cruda, hash); US3 agrega la interpretación completa de
los campos de dominio; US4 agrega los datos CAN no promovidos. Cada checkpoint es
demostrable por separado.

### Parallel Opportunities

- **Phase 1**: T001–T005 son todas paralelas (archivos distintos)
- **Phase 2**: T009, T010 paralelas entre sí; T006→T007 secuencial (mismo archivo); T011 tras T009
- **US1**: T012–T015 paralelas (cuatro archivos distintos); T016→T017 secuencial (mismo archivo)
- **US2**: T021, T022 paralelas (tests); T024 paralela a T025
- **US3**: T030–T033 paralelas (tres archivos de test); T036 paralela a T034/T035; T069 paralela a todas (archivo propio, solo requiere T023); T067 va **después** de T041 (necesita el flujo de persistencia completo)
- **US5**: T045–T047 paralelas; T048, T051, T053 paralelas; T068 después de T050
- **Phase 9**: T062–T065 todas paralelas
- **Entre historias**: **US5 puede desarrollarse en paralelo a US2/US3/US4 por otra persona**, porque solo depende del esquema de base

---

## Parallel Example: User Story 3

```bash
# Los tres archivos de test del parser, en paralelo (Principio VIII):
Task: "Tests de la sección GPS en rinho-receptor/test/eqParser.test.js"
Task: "Tests de la sección CAN OBD-II en rinho-receptor/test/canObd.test.js"
Task: "Tests del mapper en rinho-receptor/test/lecturaMapper.test.js"

# Luego, parsers de secciones independientes en paralelo:
Task: "Parser de la sección GPS en rinho-receptor/src/protocol/eqParser.js"
Task: "Parser de la sección CAN OBD-II en rinho-receptor/src/protocol/canObd.js"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup
2. Phase 2: Foundational (CRÍTICO — bloquea todo)
3. Phase 3: US1
4. **PARAR Y VALIDAR**: `docker compose up -d` deja tres servicios `healthy`; medir SC-005
5. Demostrable a la cátedra como primer hito del walking skeleton

### Incremental Delivery

1. Setup + Foundational → base lista
2. **US1** → entorno reproducible → **MVP demostrable**
3. **US2** → el dato entra y se confirma al dispositivo
4. **US3** → el dato entra *interpretado* (valor de negocio central)
5. **US6** → validación con hardware real ← **el objetivo real del proyecto**
6. **US5** → reporte de viaje (puede ir en paralelo desde el paso 1)
7. **US4** → cierre de la salvaguarda de datos crudos

> **Recomendación de orden**: adelantar **US6 (T056/T058)** apenas US3 esté lista, antes de
> invertir en US4 y US5. Los dos riesgos de mayor impacto de la feature —que el layout real
> difiera (R-1) y que el ECU no publique combustible (R-2)— solo se pueden cerrar contra el
> dispositivo físico, y ambos afectan el alcance de SC-006. Descubrirlos tarde es caro.

### Parallel Team Strategy

Con dos personas, después de Foundational:

- **Persona A** (Node.js): US1 → US2 → US3 → US4
- **Persona B** (Java): US5 completa, insertando filas de prueba a mano en TimescaleDB
- **Ambas**: US6 y Polish al final

---

## Notes

- `[P]` = archivos distintos, sin dependencias pendientes
- Cada historia tiene su checkpoint demostrable por separado
- Los tests del parser/mapper/reporte son **obligatorios** (Principio VIII), no opcionales
- Commitear después de cada tarea o grupo lógico
- Ningún camino de código puede emitir `UPDATE` ni `DELETE` sobre `lectura_telemetria`
