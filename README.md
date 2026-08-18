# AgroLink — Ingesta y Adaptación de Telemetría

Trabajo final UTN. Ingesta de telemetría del dispositivo **Rinho Spider IoT** instalado en
un camión piloto, almacenamiento auditable en **TimescaleDB**, y un servicio de reportes de
viaje de solo lectura para AgroLink.

Feature completa: [`specs/001-ingesta-adaptacion-telemetria/`](specs/001-ingesta-adaptacion-telemetria/)
(spec, plan, contratos, tareas — desarrollado con [Spec-Kit](.specify/)).

## Arquitectura

```
Dispositivo Rinho Spider IoT
        │  UDP, reporte EQ (protocolo propietario)
        ▼
┌─────────────────────┐        ┌──────────────────┐        ┌───────────────────────┐
│   rinho-receptor     │───────▶│   TimescaleDB     │◀───────│   agrolink-ingesta     │
│  Node.js 22 · UDP     │ INSERT │  hypertable        │ SELECT │  Spring Boot 3 · HTTP  │
│  parser + ACK         │  only  │  telemetria.*      │  only  │  reportes de viaje     │
└─────────────────────┘        └──────────────────┘        └───────────────────────┘
     único puerto                  sin puerto                    sin puerto
     publicado (UDP)                publicado                     publicado
```

Tres servicios, orquestados con Docker Compose (`deploy/compose.yaml`). Solo el puerto UDP
del receptor se publica a la red externa — la base y el servicio de reportes viven en la red
interna del compose (Principio VI de la constitución del proyecto).

| Componente | Stack | Rol | Código |
|---|---|---|---|
| `rinho-receptor` | Node.js 22, `pg` | Recibe UDP, parsea el reporte EQ, valida checksum, persiste, ACK solo después de commit | [`rinho-receptor/`](rinho-receptor/) |
| `timescaledb` | TimescaleDB sobre Postgres 16 | Hypertable append-only, sin `UPDATE`/`DELETE` a nivel de rol de aplicación | [`deploy/db/`](deploy/db/) |
| `agrolink-ingesta` | Java 21, Spring Boot 3.3.4 | API HTTP de solo lectura: reporte de viaje (distancia, combustible, velocidad) | [`src/`](src/) |

Decisiones y contratos completos en
[`specs/001-ingesta-adaptacion-telemetria/`](specs/001-ingesta-adaptacion-telemetria/):
[`spec.md`](specs/001-ingesta-adaptacion-telemetria/spec.md),
[`plan.md`](specs/001-ingesta-adaptacion-telemetria/plan.md),
[`research.md`](specs/001-ingesta-adaptacion-telemetria/research.md),
[`contracts/`](specs/001-ingesta-adaptacion-telemetria/contracts/),
[`quickstart.md`](specs/001-ingesta-adaptacion-telemetria/quickstart.md) (guía de validación
end-to-end por cada user story). Principios del proyecto en
[`.specify/memory/constitution.md`](.specify/memory/constitution.md).

## Estructura del repositorio

```
.
├── src/                    # agrolink-ingesta (Spring Boot) — servicio de reportes
├── rinho-receptor/         # Receptor UDP + parser del protocolo Rinho (Node.js)
├── deploy/                 # docker compose, DDL/roles de base, runbook, script de VM
├── specs/                  # Spec-Kit: spec, plan, research, contratos, tareas
└── .specify/                # Constitución y plantillas de Spec-Kit
```

## Puesta en marcha

Guía completa (contraseñas, apertura de puerto UDP en VM/nube, creación de la base,
desarrollo local) en **[`deploy/README.md`](deploy/README.md)**.

Resumen para levantar todo localmente:

```bash
cd deploy
cp .env.example .env && $EDITOR .env   # completar contraseñas — ver deploy/README.md §2.3
docker compose up -d
docker compose ps                      # esperado: los tres servicios healthy
```

Para una VM Ubuntu ARM64 (Oracle Cloud Ampere A1, el target de despliegue de este proyecto),
usar `deploy/vm-setup.sh` — instala Docker, abre el puerto UDP en el firewall local y levanta
el stack si `deploy/.env` ya existe. Detalle paso a paso en `deploy/README.md` §2.

Validación end-to-end guiada por user story: [`specs/001-ingesta-adaptacion-telemetria/quickstart.md`](specs/001-ingesta-adaptacion-telemetria/quickstart.md).

## Tests

```bash
# rinho-receptor (Node.js) — parser, checksum, mapeo de dominio
cd rinho-receptor && npm install && npm test

# agrolink-ingesta (Java) — cálculo de métricas del reporte de viaje
mvn test
```

Ambos suites incluyen los tests de integración contra el stack real levantado con
`docker compose` (se saltan automáticamente si no hay variables de conexión a base).

## Estado

64 de 70 tareas completas (ver [`tasks.md`](specs/001-ingesta-adaptacion-telemetria/tasks.md)).
Las 6 restantes requieren el dispositivo Rinho Spider IoT físico conectado a un camión real
(captura de tramas reales, cobertura real de campos del ECU, latencia end-to-end medida,
verificación del bit de ignición) y están documentadas como pendientes, no fabricadas.
