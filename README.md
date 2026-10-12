# AgroLink — Ingesta y Adaptación de Telemetría

Trabajo final UTN. Ingesta de telemetría del dispositivo **Rinho Spider IoT** instalado en
un camión piloto, almacenamiento auditable en **TimescaleDB**, y APIs HTTP de solo lectura
para AgroLink: reporte de viaje y estado de vehículo por dispositivo. Incluye además
**`simulador-viajes`**, un generador de telemetría sintética (Node.js) para los vehículos de
demo, que `agrolink-ingesta` puede arrancar automáticamente cuando AgroLinkBackend planifica un
viaje para uno de esos dispositivos.

Desarrollado con [Spec-Kit](.specify/), feature por feature, en
[`specs/`](specs/): ingesta base (001), consulta de estado de vehículo (002), campos CAN
estructurados (003), odómetro en kilómetros (004, 005), seed de telemetría local para
desarrollo (006), ingesta de sensores BLE (008), generación de rutas simuladas (011),
velocidad/RPM verosímiles en la simulación (012) y arranque automático de la simulación al
crear un viaje (013).

## Arquitectura

```
Dispositivo Rinho Spider IoT
        │  UDP, reporte EQ (protocolo propietario)
        ▼
┌─────────────────────┐        ┌──────────────────┐        ┌───────────────────────┐
│   rinho-receptor     │───────▶│   TimescaleDB     │◀───────│   agrolink-ingesta     │
│  Node.js 22 · UDP     │ INSERT │  hypertable        │ SELECT │  Spring Boot 3 · HTTP  │
│  parser + ACK         │  only  │  telemetria.*      │  only  │  reportes + estado     │
└─────────────────────┘        └──────────────────┘        └───────────────────────┘
     único puerto                  sin puerto               ▲       dos conectores HTTP:
     publicado (UDP)                publicado                │       reportes (interno) +
                                                               │       estado (publicado)
                                            POST /rutas,       │
                                      arranca/cancela viaje    │ POST/PUT/DELETE
                                                               │ .../viajes-simulados
                                                               │ (dispositivos de la lista
                                                               │  cerrada, solo flota propia)
                                                     ┌───────────────────────┐
                                                     │  simulador-viajes      │
                                                     │  Node.js 22 · UDP      │
                                                     │  genera telemetría     │
                                                     │  sintética de demo     │
                                                     └───────────────────────┘
```

Cuatro servicios, orquestados con Docker Compose (`deploy/compose.yaml`). `agrolink-ingesta`
expone dos conectores HTTP en puertos distintos (`REPORTES_HTTP_PORT`, interno; y
`VEHICULO_ESTADO_HTTP_PORT`, publicado para que AgroLinkBackend consulte el estado de un
vehículo sin exponer también el reporte de viaje), más los endpoints nuevos de
`viajes-simulados` bajo ese mismo puerto publicado (ver tabla abajo). El puerto UDP del receptor
y el puerto de estado son los únicos publicados a la red externa — la base, `simulador-viajes` y
el resto del tráfico viven en la red interna del compose (Principio VI de la constitución del
proyecto); `simulador-viajes` corre bajo el profile `simulador` y no tiene puerto publicado,
solo es alcanzable por `agrolink-ingesta` dentro de la red de Docker.

| Componente | Stack | Rol | Código |
|---|---|---|---|
| `rinho-receptor` | Node.js 22, `pg` | Recibe UDP, parsea el reporte EQ, valida checksum, persiste, ACK solo después de commit | [`rinho-receptor/`](rinho-receptor/) |
| `timescaledb` | TimescaleDB sobre Postgres 16 | Hypertable append-only, sin `UPDATE`/`DELETE` a nivel de rol de aplicación | [`deploy/db/`](deploy/db/) |
| `agrolink-ingesta` | Java 21, Spring Boot 3.3.4 | APIs HTTP de solo lectura + arranque/control de simulaciones (ver abajo) | [`src/`](src/) |
| `simulador-viajes` | Node.js 22 | Genera rutas y telemetría sintética para los vehículos de demo (flota propia), sin hardware real | [`simulador-viajes/`](simulador-viajes/) |

### APIs expuestas por `agrolink-ingesta`

| Endpoint | Puerto | Descripción |
|---|---|---|
| `GET /api/v1/reportes/viaje` | `REPORTES_HTTP_PORT` (interno, no publicado) | Métricas de un viaje: distancia, combustible, velocidad. |
| `GET /api/v1/vehiculos/{dispositivoId}/estado` | `VEHICULO_ESTADO_HTTP_PORT` (publicado) | Última lectura de telemetría de un dispositivo: posición, bloque CAN bus (VIN, RPM, velocidad de rueda, odómetro en km, combustible, temperatura de refrigerante, presión de aceite, tensión de batería y temperatura de un sensor BLE de carga) e indicadores del dispositivo (ignición, satélites, estado de interpretación). `404` (Problem Detail) si el dispositivo no tiene telemetría. |
| `POST /api/v1/vehiculos/{dispositivoId}/viajes-simulados` | `VEHICULO_ESTADO_HTTP_PORT` (publicado) | Programa el arranque de la simulación de telemetría de un viaje (llamado por AgroLinkBackend al crear un viaje). Solo tiene efecto si `dispositivoId` es uno de los 5 dispositivos simulados conocidos; dispara de inmediato si el horario ya pasó, o espera al horario programado. `404` si el dispositivo no está en la lista cerrada. |
| `PUT /api/v1/vehiculos/{dispositivoId}/viajes-simulados/{tripCode}` | `VEHICULO_ESTADO_HTTP_PORT` (publicado) | Reprograma el horario de una simulación aún `PENDIENTE`. `404`/`409` si no existe o ya se disparó/canceló. |
| `DELETE /api/v1/vehiculos/{dispositivoId}/viajes-simulados/{tripCode}` | `VEHICULO_ESTADO_HTTP_PORT` (publicado) | Cancela una simulación aún `PENDIENTE`. `404`/`409` si no existe o ya se disparó/canceló. |

Decisiones y contratos completos, feature por feature, bajo [`specs/`](specs/):

- [`001-ingesta-adaptacion-telemetria/`](specs/001-ingesta-adaptacion-telemetria/) — ingesta UDP,
  esquema base, reporte de viaje.
- [`002-vehicle-status-by-domain/`](specs/002-vehicle-status-by-domain/) — endpoint de estado de
  vehículo y su puerto propio.
- [`003-can-fields-expansion/`](specs/003-can-fields-expansion/) — columnas CAN estructuradas
  (VIN, RPM, temperatura de refrigerante, presión de aceite, combustible consumido).
- [`004-odometer-kilometers/`](specs/004-odometer-kilometers/) y
  [`005-odometer-storage-km/`](specs/005-odometer-storage-km/) — odómetro en kilómetros de punta
  a punta (el dispositivo reporta en km, no en metros).
- [`006-seed-lectura-telemetria/`](specs/006-seed-lectura-telemetria/) — `make seed-telemetry`
  para poblar telemetría de ejemplo en un ambiente local.
- [`008-ble-sensor-ingestion/`](specs/008-ble-sensor-ingestion/) — segmento BLE opcional en la
  trama (temperatura, humedad y batería del sensor del slot 0) persistido en columnas
  `ble_*`. Aún sin verificar con un sensor físico: guía de puesta en marcha en
  [`docs/guias/configuracion-sensor-ble.md`](docs/guias/configuracion-sensor-ble.md).
- [`010-estado-temperatura-ble/`](specs/010-estado-temperatura-ble/) — expone la temperatura
  del sensor BLE (ingestada por la 008) en `canBus.bleTemperaturaC` de la consulta de
  estado. Cambio aditivo; humedad y batería del sensor no se exponen todavía.
- [`011-generar-ruta-simulada/`](specs/011-generar-ruta-simulada/) — `simulador-viajes`: genera
  una ruta (vía OSRM) y la telemetría sintética asociada para un vehículo de demo, por CLI o
  por `POST /rutas`.
- [`012-velocidad-rpm-verosimil/`](specs/012-velocidad-rpm-verosimil/) — velocidad y RPM
  coherentes entre tramas consecutivas de la simulación (sin saltos irreales).
- [`013-autostart-simulacion-viaje/`](specs/013-autostart-simulacion-viaje/) — `agrolink-ingesta`
  recibe la planificación de un viaje de AgroLinkBackend y arranca/reprograma/cancela la
  simulación en `simulador-viajes` en el horario correcto, sin que AgroLinkBackend llame
  directamente al simulador.

Cada carpeta tiene `spec.md`, `plan.md`, `research.md`, `tasks.md` y (cuando aplica)
`contracts/`/`quickstart.md`. Principios del proyecto en
[`.specify/memory/constitution.md`](.specify/memory/constitution.md).

## Estructura del repositorio

```
.
├── src/                    # agrolink-ingesta (Spring Boot) — reportes, estado y viajes simulados
├── rinho-receptor/         # Receptor UDP + parser del protocolo Rinho (Node.js)
├── simulador-viajes/       # Generador de rutas y telemetria sintetica de demo (Node.js)
├── deploy/                 # docker compose, DDL/roles de base, seed de datos, runbook, VM
└── specs/                  # Spec-Kit: spec, plan, research, contratos, tareas
```

(`.specify/` contiene la constitución y plantillas de Spec-Kit; no es parte del runtime.)

## Puesta en marcha

Guía completa (contraseñas, apertura de puertos en VM/nube, creación de la base, desarrollo
local) en **[`deploy/README.md`](deploy/README.md)**.

Resumen para levantar todo localmente:

```bash
cd deploy
cp .env.example .env && $EDITOR .env   # completar contraseñas — ver deploy/README.md §2.3
docker compose up -d
docker compose ps                      # esperado: los servicios healthy
```

`simulador-viajes` está bajo el profile `simulador` (no se levanta por defecto, no tiene puerto
publicado). Para incluirlo:

```bash
docker compose --profile simulador up -d
```

O con el `Makefile` de la raíz (`make help` para ver todos los comandos):

```bash
make dev              # TimescaleDB + receptor en Docker, agrolink-ingesta local (Spring Boot)
make seed-telemetry   # opcional: precarga telemetria real de ejemplo para probar sin hardware
```

Para una VM Ubuntu ARM64 (Oracle Cloud Ampere A1, el target de despliegue de este proyecto),
usar `deploy/vm-setup.sh` — instala Docker, abre los puertos necesarios en el firewall local y
levanta el stack si `deploy/.env` ya existe. Detalle paso a paso en `deploy/README.md` §2.

Validación end-to-end guiada por user story: la de cada feature en
`specs/<feature>/quickstart.md` (por ejemplo,
[`specs/001-ingesta-adaptacion-telemetria/quickstart.md`](specs/001-ingesta-adaptacion-telemetria/quickstart.md)
para el flujo de ingesta completo).

## Tests

```bash
# rinho-receptor (Node.js) — parser, checksum, mapeo de dominio
cd rinho-receptor && npm install && npm test

# simulador-viajes (Node.js) — generación de rutas, repositorios, servicios de simulación
cd simulador-viajes && npm install && npm test

# agrolink-ingesta (Java) — reporte de viaje, estado de vehiculo, filtro de puerto, viajes simulados
mvn test
```

Las tres suites incluyen los tests de integración contra el stack real levantado con
`docker compose` (se saltan automáticamente si no hay variables de conexión a base).

## Estado

Features 001 a 006, 008, 010 a 013 completas (ver el `tasks.md` de cada una bajo `specs/`). La
feature 001 tiene 6 tareas pendientes que requieren el dispositivo Rinho Spider IoT físico
conectado a un camión real (captura de tramas reales, cobertura real de campos del ECU,
latencia end-to-end medida, verificación del bit de ignición); están documentadas como
pendientes, no fabricadas.

La feature 013 (arranque automático de simulación) depende de un hook en `TripService.java` del
lado de **AgroLinkBackend** (repo separado) todavía no implementado — documentado en
[`specs/013-autostart-simulacion-viaje/contracts/agrolink-backend-trip-hook.md`](specs/013-autostart-simulacion-viaje/contracts/agrolink-backend-trip-hook.md).
Sin ese hook, los endpoints de `viajes-simulados` ya funcionan pero nada los llama todavía
automáticamente al crear un viaje.

**Migración pendiente si ya existe un volumen de base de datos inicializado**: las features 003
y 005 cambiaron el esquema (`odometro_m` → `odometro_km`, nuevas columnas CAN). El DDL en
`deploy/db/` solo corre una vez, contra un volumen vacío — cualquier ambiente con datos previos
necesita el `ALTER TABLE` equivalente aplicado a mano antes de desplegar (ver
`specs/005-odometer-storage-km/research.md`, decisión D-04).
