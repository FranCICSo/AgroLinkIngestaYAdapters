# AgroLink — Ingesta y Adaptación de Telemetría

Trabajo final UTN. Ingesta de telemetría del dispositivo **Rinho Spider IoT** instalado en
un camión piloto, almacenamiento auditable en **TimescaleDB**, y dos APIs HTTP de solo lectura
para AgroLink: reporte de viaje y estado de vehículo por dispositivo.

Desarrollado con [Spec-Kit](.specify/), feature por feature, en
[`specs/`](specs/): ingesta base (001), consulta de estado de vehículo (002), campos CAN
estructurados (003), odómetro en kilómetros (004, 005) y seed de telemetría local para
desarrollo (006).

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
     único puerto                  sin puerto                dos conectores HTTP:
     publicado (UDP)                publicado                reportes (interno) +
                                                               estado (publicado)
```

Tres servicios, orquestados con Docker Compose (`deploy/compose.yaml`). `agrolink-ingesta`
expone dos conectores HTTP en puertos distintos (`REPORTES_HTTP_PORT`, interno; y
`VEHICULO_ESTADO_HTTP_PORT`, publicado para que AgroLinkBackend consulte el estado de un
vehículo sin exponer también el reporte de viaje). El puerto UDP del receptor y el puerto de
estado son los únicos publicados a la red externa — la base y el resto del tráfico viven en la
red interna del compose (Principio VI de la constitución del proyecto).

| Componente | Stack | Rol | Código |
|---|---|---|---|
| `rinho-receptor` | Node.js 22, `pg` | Recibe UDP, parsea el reporte EQ, valida checksum, persiste, ACK solo después de commit | [`rinho-receptor/`](rinho-receptor/) |
| `timescaledb` | TimescaleDB sobre Postgres 16 | Hypertable append-only, sin `UPDATE`/`DELETE` a nivel de rol de aplicación | [`deploy/db/`](deploy/db/) |
| `agrolink-ingesta` | Java 21, Spring Boot 3.3.4 | Dos APIs HTTP de solo lectura (ver abajo) | [`src/`](src/) |

### APIs expuestas por `agrolink-ingesta`

| Endpoint | Puerto | Descripción |
|---|---|---|
| `GET /api/v1/reportes/viaje` | `REPORTES_HTTP_PORT` (interno, no publicado) | Métricas de un viaje: distancia, combustible, velocidad. |
| `GET /api/v1/vehiculos/{dispositivoId}/estado` | `VEHICULO_ESTADO_HTTP_PORT` (publicado) | Última lectura de telemetría de un dispositivo: posición, bloque CAN bus (VIN, RPM, velocidad de rueda, odómetro en km, combustible, temperatura de refrigerante, presión de aceite, tensión de batería) e indicadores del dispositivo (ignición, satélites, estado de interpretación). `404` (Problem Detail) si el dispositivo no tiene telemetría. |

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

Cada carpeta tiene `spec.md`, `plan.md`, `research.md`, `tasks.md` y (cuando aplica)
`contracts/`/`quickstart.md`. Principios del proyecto en
[`.specify/memory/constitution.md`](.specify/memory/constitution.md).

## Estructura del repositorio

```
.
├── src/                    # agrolink-ingesta (Spring Boot) — reportes + estado de vehiculo
├── rinho-receptor/         # Receptor UDP + parser del protocolo Rinho (Node.js)
├── deploy/                 # docker compose, DDL/roles de base, seed de datos, runbook, VM
└── specs/                  # Spec-Kit: spec, plan, research, contratos, tareas (001-006)
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
docker compose ps                      # esperado: los tres servicios healthy
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

# agrolink-ingesta (Java) — reporte de viaje, estado de vehiculo, filtro de puerto
mvn test
```

Ambos suites incluyen los tests de integración contra el stack real levantado con
`docker compose` (se saltan automáticamente si no hay variables de conexión a base).

## Estado

Features 001 a 006 completas (ver el `tasks.md` de cada una bajo `specs/`). La feature 001
tiene 6 tareas pendientes que requieren el dispositivo Rinho Spider IoT físico conectado a un
camión real (captura de tramas reales, cobertura real de campos del ECU, latencia end-to-end
medida, verificación del bit de ignición); están documentadas como pendientes, no fabricadas.

**Migración pendiente si ya existe un volumen de base de datos inicializado**: las features 003
y 005 cambiaron el esquema (`odometro_m` → `odometro_km`, nuevas columnas CAN). El DDL en
`deploy/db/` solo corre una vez, contra un volumen vacío — cualquier ambiente con datos previos
necesita el `ALTER TABLE` equivalente aplicado a mano antes de desplegar (ver
`specs/005-odometer-storage-km/research.md`, decisión D-04).
