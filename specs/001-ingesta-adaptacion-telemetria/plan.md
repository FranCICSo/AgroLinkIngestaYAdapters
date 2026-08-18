# Implementation Plan: Ingesta y Adaptación de Telemetría

**Branch**: `001-ingesta-adaptacion-telemetria` | **Date**: 2026-08-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-ingesta-adaptacion-telemetria/spec.md`

## Summary

Walking skeleton que lleva la telemetría de un dispositivo Rinho Spider IoT real,
instalado en el camión piloto, de punta a punta hasta almacenamiento propio de AgroLink,
sin intervención manual.

El dispositivo se configura con el comando **`GEQ`** para emitir **reportes extendidos EQ**
(trama `>REQ…<`: sección GPS base + sección CAN OBD-II) por **UDP** contra un
**servicio receptor/parser propio** (`rinho-receptor`, Node.js) desplegado en una VM Oracle
Cloud Always Free (Ampere A1, ARM64). Ese servicio decodifica la trama ASCII, la normaliza
a un modelo de dominio propio de AgroLink, la persiste en una **TimescaleDB** del stack y
recién entonces responde al dispositivo con el **ACK a nivel de protocolo Rinho**.

Sobre esas mismas lecturas, el servicio **AgroLinkIngestaYAdaptacion** (Spring Boot, solo
lectura) expone un reporte de actividad por camión y rango de fechas: distancia,
combustible consumido, tasa promedio de consumo, velocidad promedio y velocidad máxima.

Todo el entorno (receptor + TimescaleDB + servicio de reportes) se levanta con un único
`docker compose up` en la VM.

> **Cambio de arquitectura respecto de la revisión anterior de este plan**: Traccar queda
> **eliminado** del stack. La decodificación del protocolo pasa a ser un componente propio
> (ver [research.md](./research.md) D-01). Esto elimina también dos contenedores (Traccar y
> su Postgres) y el salto HTTP intermedio.

## Technical Context

**Language/Version**:
- Receptor/parser: **Node.js 22 LTS** (runtime ARM64 oficial).
- Servicio de reportes: **Java 21 (LTS), Spring Boot 3.3.x**.

**Primary Dependencies**:
- `rinho-receptor`: **`pg`** (driver PostgreSQL) como única dependencia de runtime. Tests
  con el runner incorporado `node:test`; logging JSON a stdout con un helper propio; sin
  framework HTTP (el healthcheck usa el módulo `node:http` incorporado).
- `agrolink-ingesta`: `spring-boot-starter-web`, `spring-boot-starter-data-jpa`,
  `org.postgresql:postgresql`. Test scope: `spring-boot-starter-test`.

**Storage**: PostgreSQL 16 + extensión TimescaleDB, schema `telemetria`, tabla
`lectura_telemetria` como hypertable particionada por `momento_evento`. Dos roles
separados: `rinho_receptor` (`SELECT, INSERT`) y `agrolink_ingesta` (`SELECT`).

**Testing**:
- Parser EQ: `node:test` + `node:assert`. Foco obligatorio en la decodificación de la trama
  (Constitución, Principio VIII): completa, campos faltantes/nulos, dato inválido.
- Reportes: JUnit 5 + AssertJ sobre el cálculo de las cinco métricas y el caso "sin datos".

**Target Platform**: VM Oracle Cloud Always Free, Ampere A1, **linux/arm64**, Docker +
Docker Compose. Todas las imágenes deben ser multi-arch con soporte ARM64.

**Project Type**: Dos servicios backend (uno de ingesta UDP, uno de consulta HTTP) +
infraestructura Docker Compose.

**Performance Goals**: Absorber el caudal de un piloto de pocos camiones reportando cada
~10–30 s. Latencia de ingesta (datagrama recibido → fila persistida → ACK emitido) < 1 s en
p95, holgadamente dentro del SC-001 de 2 minutos punta a punta.

**Constraints**:
- 12 GB de RAM y 2 OCPU compartidos entre las 3 piezas del stack; límites de memoria por
  contenedor obligatorios (ahora con más holgura: se eliminaron Traccar y su base).
- El ACK **debe** emitirse después del commit en base, nunca antes (US2, escenario 2).
- UDP no tiene entrega garantizada ni sesión: no hay backpressure ni retransmisión que el
  servidor controle; la única palanca es el ACK.
- Sin broker de mensajería (Constitución, Principio III).
- El puerto UDP del receptor debe publicarse **en UDP** en la Security List de la VCN;
  abrir solo TCP deja al dispositivo mudo con el stack aparentemente sano.

**Scale/Scope**: Piloto: 1 camión real, diseño validado para al menos 5 camiones
concurrentes (SC-004). Un único puerto de ingesta y un único endpoint de reporte.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Gate | Estado |
|-----------|------|--------|
| I. Arquitectura desacoplada por capas de adaptación | La trama Rinho no toca el dominio: `protocol/eqParser.js` produce una estructura cruda y `domain/lecturaMapper.js` la normaliza al modelo AgroLink. El resto del sistema (y todo el servicio de reportes) solo conoce el modelo normalizado. Otro fabricante = otro parser + otro mapper contra el mismo esquema. | ✅ PASS |
| II. Stack backend Java/Spring Boot + PostgreSQL/TimescaleDB + Spring Data JPA | El servicio de reportes cumple exactamente. El receptor UDP es **Node.js**: desvío explícito permitido por el propio Principio II ("salvo justificación explícita en contrario documentada en el plan"). | ⚠️ PASS con justificación documentada (ver Complexity Tracking) |
| III. Sin mensajería sin justificación de escala | Ingesta directa: datagrama UDP → parse → insert → ACK. Sin MQTT/Kafka/RabbitMQ. | ✅ PASS |
| IV. Inmutabilidad de datos crudos | Rol `rinho_receptor` con `GRANT SELECT, INSERT` únicamente; rol de reportes solo `SELECT`. Ningún `UPDATE`/`DELETE` en ningún camino de código. | ✅ PASS |
| V. Minimización de datos personales | Solo se persiste el `ID` de dispositivo de la trama. Ningún nombre, DNI ni CUIL. El campo CAN `1` (VIN) se descarta del modelo normalizado (ver D-07). | ✅ PASS |
| VI. Seguridad como línea base | Credenciales por variables de entorno inyectadas por compose; nada hardcodeado ni commiteado. El tramo dispositivo→receptor es UDP en claro: encuadra en el **carve-out del Principio VI (v1.1.0)** para enlaces de telemetría cuyo hardware no soporta TLS, y cumple sus dos controles compensatorios obligatorios — aislamiento de red (solo el puerto UDP del receptor se publica; base y reportes quedan internos) y validación de integridad y origen de cada trama (checksum + `ID` conocido, FR-013). | ✅ PASS condicionado (controles compensatorios detallados en Complexity Tracking) |
| VII. Tolerancia a fallos de conectividad | `momento_evento` (del dispositivo) separado de `momento_recepcion` (del servidor). Insert-only: una lectura atrasada nunca sobrescribe una más reciente. Trama sin fix GPS (fecha/hora en ceros) se marca explícitamente en vez de producir una fecha basura. | ✅ PASS |
| VIII. Testing mínimo esperado | Tests del parser EQ en los 3 casos obligatorios: trama completa, trama con campos CAN vacíos, trama corrupta/checksum inválido. | ✅ PASS |
| IX. Trazabilidad y no reproceso silencioso | `estado_interpretacion` (COMPLETA/PARCIAL) + `campos_faltantes` en cada fila, más log estructurado JSON. Las tramas rechazadas (sin `ID`, checksum inválido) se loguean con la trama cruda; nada se descarta en silencio. | ✅ PASS |

**Alineación con entregables académicos**: esta feature no contradice WBS/DER/Historias de
Usuario ya aprobados; agrega un schema `telemetria` propio sin modificar el modelo del
AgroLinkBackend. Ver decisiones D-03 y D-04 en [research.md](./research.md).

> **Enmienda a la Constitución aplicada (1.0.0 → 1.1.0, 2026-08-15)**: este plan motivó dos
> cambios, ya incorporados en `.specify/memory/constitution.md`:
>
> 1. **Principio VI** — se agregó un carve-out acotado para enlaces de telemetría
>    dispositivo→servidor cuyo hardware no soporte TLS, condicionado a controles
>    compensatorios obligatorios (aislamiento de red + validación de integridad y origen) y
>    a documentarlos en el Complexity Tracking del plan. Antes el principio exigía TLS sin
>    excepción posible, lo que convertía el tramo UDP en un conflicto de constitución
>    irresoluble por documentación (hallazgo D1 de `/speckit-analyze`).
> 2. **Principio I** — el paréntesis ilustrativo "(actualmente: Traccar decodificando el
>    protocolo Rinho)" quedó obsoleto con este plan y se reemplazó por "(actualmente: un
>    receptor propio que decodifica el protocolo Rinho)". El principio en sí —que la capa de
>    adaptación es el único punto de contacto con el formato del proveedor— se mantiene
>    intacto y este diseño lo respeta.

### Post-Design Re-check (después de Phase 1)

Re-evaluado tras generar `data-model.md`, `contracts/` y `quickstart.md`: **sin violaciones
nuevas**. Queda un único ⚠️ (Principio II, receptor en Node.js), justificado en Complexity
Tracking bajo la cláusula de desvío que el propio principio contempla. El Principio VI pasó
de ⚠️ a ✅ condicionado con la enmienda 1.1.0: la excepción dejó de ser una violación
tolerada para ser un caso previsto, con controles compensatorios exigibles y verificables.
El diseño de datos no introdujo ninguna violación nueva: la tabla
es insert-only, sin columnas de datos personales, y la deduplicación se resuelve con un
índice único (no con `UPDATE`).

## Project Structure

### Documentation (this feature)

```text
specs/001-ingesta-adaptacion-telemetria/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── rinho-eq-frame.md          # Contrato del protocolo de entrada (trama EQ)
│   └── agrolink-reportes-api.yaml # Contrato HTTP de salida (reporte de viaje)
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
rinho-receptor/                        # Servicio de ingesta UDP (Node.js)
├── src/
│   ├── index.js                       # Bootstrap: config → db → udp → health → señales
│   ├── config.js                      # Lectura y validación de variables de entorno
│   ├── log.js                         # Logger JSON a stdout (sin dependencias)
│   ├── net/
│   │   ├── udpServer.js               # Socket UDP, orquesta parse → persist → ack
│   │   ├── ack.js                     # Construcción del frame ACK + checksum XOR
│   │   └── healthServer.js            # GET /health con node:http (para compose)
│   ├── protocol/
│   │   ├── frame.js                   # Envelope >…;#msgNum;ID=…;*CS< + checksum
│   │   ├── eqParser.js                # Trama REQ: sección GPS base
│   │   └── canObd.js                  # Sección CAN OBD-II (IDs 1,2,3,B,14,15,2A,2C)
│   ├── domain/
│   │   └── lecturaMapper.js           # Crudo → Lectura de Telemetría normalizada
│   └── db/
│       ├── pool.js                    # Pool pg + search_path
│       └── lecturaRepository.js       # INSERT … ON CONFLICT DO NOTHING
├── test/
│   ├── eqParser.test.js               # 3 casos obligatorios (Principio VIII)
│   ├── canObd.test.js
│   ├── frame.test.js                  # checksum, envelope, trama corrupta
│   └── lecturaMapper.test.js          # fallback de odómetro, estado_interpretacion
├── package.json
└── Dockerfile

src/main/java/ar/utn/agrolink/ingesta/  # Servicio de reportes (Spring Boot, solo lectura)
├── IngestaApplication.java
├── config/
│   └── HealthController.java          # GET /health (sin actuator, deps mínimas)
├── telemetry/
│   ├── LecturaTelemetria.java         # @Entity, @Immutable, solo lectura
│   ├── LecturaTelemetriaRepository.java
│   ├── EstadoInterpretacion.java      # COMPLETA | PARCIAL
│   └── OrigenOdometro.java            # ECU | GPS
└── report/
    ├── ReporteViajeController.java    # GET /api/v1/reportes/viaje
    ├── ReporteViajeService.java       # Cálculo de las 5 métricas
    ├── ReporteViajeDto.java
    └── SinDatosException.java         # → 404 application/problem+json (FR-006)

src/main/resources/
└── application.yaml                   # Solo placeholders ${ENV_VAR}

src/test/java/ar/utn/agrolink/ingesta/
└── report/
    └── ReporteViajeServiceTest.java   # 5 métricas, sin datos, distancia cero

deploy/
├── compose.yaml                       # timescaledb + rinho-receptor + agrolink-ingesta
├── .env.example                       # Plantilla de secretos (el .env real no se commitea)
├── db/
│   ├── 01-schema.sql                  # schema, hypertable, índices
│   └── 02-roles.sql                   # roles y GRANTs (Principio IV)
└── README.md                          # Runbook de la VM Oracle (VCN, Security List)

Dockerfile                             # Servicio Java: multi-stage, base ARM64-compatible
```

**Structure Decision**: Dos raíces de código en un mismo repositorio (monorepo simple):
`rinho-receptor/` (Node.js) y `src/main/java` (Maven/Spring Boot estándar), más `deploy/`
con toda la infraestructura dockerizada. Se eligen dos servicios —en vez de uno— porque el
Principio I ya obliga a aislar la capa que habla el formato del proveedor, y porque los dos
tienen perfiles operativos opuestos: el receptor debe responder un ACK en milisegundos y no
puede permitirse una pausa de GC larga de JVM en el camino crítico, mientras que el de
reportes es una consulta agregada esporádica. No hay frontend propio (fuera de alcance por
spec).

## Complexity Tracking

> Llenar SOLO si el Constitution Check tiene violaciones que justificar

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| **Principio II**: el receptor UDP se implementa en Node.js, no en Java/Spring Boot | Existe un decodificador del protocolo Rinho ya probado contra el hardware real en el proyecto hermano `rinho-udp-server` (Node.js). Reusar esa lógica de parsing —el punto de mayor riesgo de corrupción silenciosa según el Principio VIII— elimina la clase de error más cara de esta feature: traducir a mano expresiones regulares de campos de ancho fijo y una aritmética de checksum ya validadas contra tramas reales. Además, un proceso Node de ~40 MB en el camino crítico del ACK evita pausas de GC de JVM donde el presupuesto es de milisegundos, en una VM de 2 OCPU compartidas. | *Reescribir el parser en Java*: es la opción "constitucionalmente pura", pero reimplementa desde cero, sin hardware disponible para validar cada iteración, la lógica más delicada del sistema — con el agravante de que el reporte EQ **no** está cubierto por el código de referencia (ver D-02) y ya exige parsing nuevo. Hacerlo además en un lenguaje distinto al de la referencia duplica el riesgo. Se mantiene como refactor futuro razonable una vez que el formato EQ esté validado contra el dispositivo real y exista un corpus de tramas de regresión. |
| **Principio VI** (carve-out v1.1.0, no violación): el tramo dispositivo → receptor viaja en UDP en claro, sin autenticación ni TLS | El protocolo Rinho sobre UDP no ofrece cifrado ni autenticación: es una restricción del hardware, no una elección de diseño. El spec lo declara explícitamente fuera de alcance para esta fase. Encuadra en la excepción que el Principio VI habilita desde la v1.1.0; esta fila es la documentación de controles compensatorios que esa excepción exige. | *Exigir TLS o un secreto compartido*: el dispositivo no puede hablarlo; la alternativa real sería un gateway VPN por camión, desproporcionado para un piloto de un vehículo. **Controles compensatorios adoptados** — (a) *aislamiento de red*: solo el puerto UDP del receptor se publica en la VCN; los puertos de reportes y de la base **no** se exponen; (b) *validación de integridad y origen*: toda trama con checksum inválido o sin `ID` de dispositivo conocido se descarta con registro explícito (FR-013). Mejora obligatoria antes de operar flota real: filtrado por IP/APN del operador celular (T064). |
