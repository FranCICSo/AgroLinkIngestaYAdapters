# Implementation Plan: Generación de Rutas Simuladas desde Origen/Destino

**Branch**: `011-generar-ruta-simulada` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-generar-ruta-simulada/spec.md`

## Summary

Reemplaza el `INSERT INTO simulador.ruta` manual por un servicio de generación de rutas
(`RouteGenerationService`) dentro del proceso Node.js ya existente `simulador-viajes`
(feature 009): dado un origen, un destino y opcionalmente paradas intermedias (lat/lon), traza el
recorrido sobre calles reales contra un servicio OSRM gratuito y persiste la fila resultante en
`simulador.ruta` en una única llamada — sin interpolación en línea recta, sin paso de
previsualización/confirmación, y sin exponer el endpoint al frontend de AgroLink. Se expone por
dos vías equivalentes, ambas delgadas sobre el mismo servicio: un endpoint HTTP interno
(`POST /rutas`, no publicado al host) y un comando CLI (`npm run crear-ruta`). El servicio OSRM
del que depende también se incorpora al proceso de deploy del repo (research.md D-08): un
servicio más en `deploy/compose.yaml` levantado por un target idempotente de `Makefile`
(`make osrm`), en vez de asumirlo como infraestructura externa ya operada por otro equipo.

## Technical Context

**Language/Version**: Node.js 22 LTS — mismo runtime que el resto de `simulador-viajes` y
`rinho-receptor`, ya validado en la VM ARM64 de OCI.

**Primary Dependencies**:
- `pg` (ya es dependencia de `simulador-viajes`) para `simulador.ruta`.
- `fetch` global de Node 22 (sin dependencia nueva) para llamar a la API HTTP de OSRM
  (research.md D-01).
- `node:http` (built-in) para el endpoint — mismo patrón ya usado por el puerto de health check
  de `rinho-receptor`, sin incorporar un framework (Express/Fastify) que el repo no usa en
  ningún otro lado.

**Storage**: PostgreSQL 16 + TimescaleDB, schema `simulador` ya existente (feature 009). Sin
tablas nuevas; se agrega una restricción `UNIQUE` sobre `simulador.ruta.nombre`
(`deploy/migrations/005_add_ruta_nombre_unique.sql`, research.md D-03, `data-model.md` §1).
Además, `deploy/osrm-data/` (gitignored, igual que `deploy/.env`) guarda el extracto OSM
descargado y los archivos `.osrm` preprocesados que consume el servicio `osrm` (research.md
D-08) — no es almacenamiento de la aplicación, es el dataset del servicio de ruteo.

**Testing**: `node:test` + `node:assert`, igual que el resto de `simulador-viajes`. Cobertura
mínima (Principio VIII) sobre la lógica de generación/adaptación (`routeGenerationService.js`):
(a) origen/destino válidos con respuesta OSRM completa, (b) distancia trivial entre origen y
destino (rechazo antes de llamar a OSRM), (c) OSRM responde sin ruta o no responde (timeout) —
ver `quickstart.md` §3.

**Target Platform**: Igual que `simulador-viajes` — local/staging por defecto; sólo la VM de OCI
con flag explícito. El endpoint HTTP no se publica al host en ningún entorno (research.md D-04).

**Project Type**: Extensión del proyecto Node.js existente `simulador-viajes` (no un servicio
nuevo): agrega módulos a su `src/` y tests a su `test/`, reutilizando su pool de Postgres y sus
convenciones (ver Project Structure).

**Performance Goals**: Sin requisitos de throughput — uso interno del equipo, una generación a la
vez. Timeout de 5 s por llamada a OSRM (research.md D-06) para no dejar el comando/endpoint
colgado indefinidamente.

**Constraints**:
- Ninguna fila parcial se persiste en ningún camino de rechazo (validación, nombre duplicado, u
  OSRM sin ruta) — FR-004, FR-003, FR-008.
- El endpoint HTTP nunca se publica a una red donde el frontend de AgroLink pueda alcanzarlo
  directamente (FR-006, research.md D-04).
- Sin modo de interpolación en línea recta como alternativa cuando OSRM falla (FR-002/FR-003).
- Todo rechazo por fallo de OSRM se loguea con el detalle concreto (coordenadas, nombre de ruta,
  motivo) — Principio IX, nunca un descarte silencioso.

**Scale/Scope**: Puñado de rutas de demo/simulación (mismo orden de magnitud que la flota de la
feature 009, no tráfico de producción). El dataset de OSRM (extracto de Argentina completo,
research.md D-08) es la única pieza de escala distinta: cientos de MB de descarga y varios
minutos de preprocesado la primera vez, idempotente después.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Gate | Estado |
|-----------|------|--------|
| I. Arquitectura desacoplada por capas de adaptación | `routeGenerationService.js` adapta la respuesta de OSRM (un proveedor externo) al shape propio de `simulador.ruta` (`puntos`/`paradas`); ningún otro componente habla con OSRM directo. No toca la capa de adaptación de telemetría real (`eqParser.js`). | ✅ PASS |
| II. Stack backend Java/Spring Boot + PostgreSQL/TimescaleDB + Spring Data JPA | Desvío: se implementa en Node.js, dentro del proyecto `simulador-viajes` ya existente. Mismo carve-out ya precedentado por esa feature (009) y por `rinho-receptor` (001). | ⚠️ PASS con justificación (ver Complexity Tracking) |
| III. Mensajería solo por necesidad demostrada | Llamada HTTP síncrona directa a OSRM, sin broker. Sin autenticación nueva para el endpoint interno (research.md D-04) por la misma lógica de no agregar complejidad sin necesidad demostrada. | ✅ PASS |
| IV. Inmutabilidad de datos crudos de telemetría | `simulador.ruta` es config mutable de tooling (ya exceptuada por 009), nunca telemetría; esta feature no agrega ni modifica ningún camino de escritura a `telemetria.*`. | ✅ PASS |
| V. Minimización de datos personales | Sin datos de choferes ni personas — sólo coordenadas geográficas y nombres de ruta. | ✅ PASS |
| VI. Seguridad como línea base | El endpoint no se publica al host (aislamiento de red, mismo control compensatorio que ya usa el proyecto para `timescaledb`/el health port de `rinho-receptor`) — research.md D-04. Sin credenciales nuevas que gestionar; el acceso a OSRM es anónimo (API pública/self-hosted sin auth). | ✅ PASS |
| VII. Tolerancia a fallos de conectividad | No aplica al mismo sentido que telemetría de campo: esta es una llamada síncrona iniciada por una persona, no ingesta de dispositivo. El timeout + rechazo claro (sin reintento automático, research.md D-06) es la postura correcta para este caso de uso, documentada explícitamente. | ✅ PASS |
| VIII. Testing mínimo esperado | `routeGenerationService.js` (adapta datos de un proveedor externo, OSRM) cubre los 3 casos mínimos: completo, sin ruta/fallo del proveedor, y caso inválido (distancia trivial) — ver Technical Context > Testing. | ✅ PASS |
| IX. Trazabilidad y no reproceso silencioso | Todo rechazo (validación, nombre duplicado, fallo de OSRM) se loguea con detalle antes de responder el error — ningún camino descarta en silencio. | ✅ PASS |

**Alineación con entregables académicos**: esta feature no modifica el modelo de dominio de
negocio de AgroLink ni los entregables ya aprobados — extiende la misma herramienta de
desarrollo/demo (`simulador-viajes`) ya alcanzada por 009.

### Post-Design Re-check (después de Phase 1)

Re-evaluado tras generar `research.md`, `data-model.md`, `contracts/` y `quickstart.md`: **sin
violaciones nuevas**. La única restricción de schema nueva (`ruta_nombre_unique`) es aditiva y
no afecta ninguna tabla de `telemetria`; el contrato HTTP (`contracts/rutas-http-api.md`)
confirma que ningún camino de error persiste una fila parcial (Principio IX); el contrato CLI
confirma la equivalencia exigida por FR-007 (research.md D-05) sin lógica duplicada. Queda un
único ⚠️ (Principio II, Node.js), con la misma justificación ya aceptada para `simulador-viajes`
en 009 y `rinho-receptor` en 001.

## Project Structure

### Documentation (this feature)

```text
specs/011-generar-ruta-simulada/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/            # Phase 1 output
│   ├── rutas-http-api.md
│   └── crear-ruta-cli.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
simulador-viajes/                  # proyecto Node.js existente (feature 009), se extiende acá
├── package.json                   # + script "crear-ruta": "node src/cli/crearRuta.js"
├── src/
│   ├── services/
│   │   └── routeGenerationService.js   # valida, llama a OSRM, arma puntos/paradas, persiste
│   ├── net/
│   │   ├── udpClient.js                 # existente (009)
│   │   └── osrmClient.js                # nuevo: llama a OSRM, normaliza fallos (research.md D-06)
│   ├── db/
│   │   ├── flotaRepository.js           # existente (009)
│   │   └── rutaRepository.js            # nuevo: INSERT en simulador.ruta, traduce 23505 → nombre_duplicado
│   ├── http/
│   │   └── rutaHttpServer.js            # nuevo: POST /rutas, no publicado al host (research.md D-04)
│   └── cli/
│       └── crearRuta.js                 # nuevo: parsea argv, llama a routeGenerationService
└── test/
    ├── services/
    │   └── routeGenerationService.test.js
    └── db/
        └── rutaRepository.test.js

deploy/
├── db/
│   └── 03-schema-simulador.sql    # `ruta.nombre` pasa a VARCHAR(100) UNIQUE NOT NULL
├── migrations/
│   └── 005_add_ruta_nombre_unique.sql   # idempotente, para volúmenes ya existentes (mismo patrón que 001-004)
├── osrm-data/                      # nuevo, gitignored: extracto OSM + archivos .osrm preprocesados (research.md D-08)
└── compose.yaml                    # + servicio `osrm` (profile "simulador", sin ports:)

Makefile                            # + target `osrm` (descarga/preprocesa/levanta), `simulador` pasa a depender de él
```

**Structure Decision**: Se extiende `simulador-viajes/` en vez de crear un proyecto/servicio
nuevo — reutiliza su `package.json`, su pool de Postgres (`db/pool.js`) y sus convenciones de
test ya establecidas por la feature 009, y evita un segundo proceso Node.js sólo para una
funcionalidad de administración de datos de ese mismo dominio. El endpoint HTTP corre dentro del
mismo proceso (`index.js` arranca tanto el loop de simulación como, opcionalmente, el servidor
HTTP). OSRM sí es un `docker-compose` service nuevo (research.md D-08): a diferencia del
endpoint HTTP, no es código de este repo sino una imagen de terceros con su propio dataset, así
que vive como contenedor aparte (mismo `profile: ["simulador"]`, sin `ports:`), orquestado por un
target de `Makefile` en vez de vivir dentro del proceso Node.js.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| **Principio II**: esta feature se implementa en Node.js, no en Java/Spring Boot | Extiende `simulador-viajes` (feature 009), ya exceptuado por el mismo motivo: comparte su pool de Postgres, su acceso a `simulador.*`, y su runtime ya validado en la VM ARM64 de OCI. Escribirlo en Java obligaría a un segundo servicio sólo para esta funcionalidad, duplicando configuración de despliegue y acceso a datos que `simulador-viajes` ya tiene resuelto. | *Escribirlo en Java/Spring Boot como parte del backend principal*: exigiría exponer `simulador.*` (schema de tooling interno, no de dominio de negocio) a un servicio que hoy no tiene ningún motivo para conocerlo, y mantener dos implementaciones del acceso a esa misma tabla (una en Java, otra ya existente en Node.js para `simulador-viajes`). |
