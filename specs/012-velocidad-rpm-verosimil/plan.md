# Implementation Plan: Velocidad y RPM verosímiles en el simulador de viajes

**Branch**: `012-velocidad-rpm-verosimil` | **Date**: 2026-10-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-velocidad-rpm-verosimil/spec.md`

## Summary

La velocidad que reporta el simulador hoy es `distancia_entre_dos_vértices_crudos / intervalo_fijo_de_ciclo`, sin ningún tope — por eso aparecen picos de 150 km/h en zona urbana cuando el trazado (de OSRM o de los datos ya sembrados `camion-1`/`camion-2`) tiene vértices espaciados de forma desigual. La corrección (decidida en `/speckit-clarify`) es **densificar el trazado una sola vez, al generarlo o cargarlo**, insertando puntos intermedios donde dos vértices originales estén más separados de lo recorrible a la velocidad máxima verosímil del tramo (60 km/h urbano / 80 km/h ruta) en un ciclo de simulación — sin tocar el esquema de `simulador.viaje`. El RPM, que ya escala linealmente con la velocidad en `sintesisCan.js`, queda acotado como efecto derivado una vez que la velocidad lo está, ajustando además el rango de ralentí/crucero a valores de motor diésel realistas.

## Technical Context

**Language/Version**: Node.js 22 (ESM, `"type": "module"`), el mismo runtime que ya usa `simulador-viajes`.

**Primary Dependencies**: `pg` (driver Postgres ya en uso); sin dependencias nuevas — la densificación es matemática pura (haversine + interpolación lineal de lat/lon), ya usada en `avanceRuta.js` y `routeGenerationService.js`.

**Storage**: PostgreSQL (`simulador.ruta.puntos` / `simulador.ruta.paradas`, columnas `jsonb` ya existentes). Sin cambios de esquema (decidido en `/speckit-clarify`, Q2).

**Testing**: `node --test` (test runner nativo de Node, ya en uso en `test/domain/` y `test/services/`), siguiendo el patrón existente de `routeGenerationService.test.js` / `avanceRuta` (sin archivo de test propio hoy — se agrega).

**Target Platform**: Linux (contenedor Docker ARM64 en la VM Oracle Cloud de la ingesta), igual que el resto de `simulador-viajes`.

**Project Type**: Servicio Node.js existente con dos entry points (CLI `crearRuta.js` y servidor HTTP `rutaHttpServer.js`) más el loop de simulación (`index.js`) — esta feature no agrega un entry point nuevo, modifica el pipeline interno de generación/carga de rutas y el cálculo de CAN sintético.

**Performance Goals**: N/A estricto — la densificación corre una sola vez por ruta (al crearla o cargar el seed), no en cada ciclo del loop de simulación; debe terminar en el orden de milisegundos para rutas de OSRM de tamaño típico (decenas a cientos de puntos).

**Constraints**: No modificar el esquema de `simulador.viaje` (Q2); no cambiar los contratos CLI/HTTP ya publicados en `specs/011-generar-ruta-simulada/contracts/` (esta feature no agrega ni cambia inputs/outputs de esas interfaces, solo lo que queda guardado en `simulador.ruta.puntos`); los datos sembrados (`deploy/seed/simulador-camion-1.sql`, `-2.sql`) son SQL estático, no hay una llamada en vivo a OSRM para ellos.

**Scale/Scope**: Dos camiones de referencia ya sembrados + las rutas que se generen a demanda vía CLI/HTTP durante el desarrollo/demo de la tesis (decenas, no miles).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Arquitectura Desacoplada por Capas de Adaptación**: N/A directo — esta feature no toca la ingesta real de telemetría del Rinho Spider IoT ni su capa de adaptación; es el simulador, una herramienta de desarrollo/demo. ✅
- **II. Stack Tecnológico del Backend**: `simulador-viajes` ya es Node.js, no Java/Spring Boot, por decisión previa de la feature 009 (herramienta de desarrollo/demo, no parte del stack de producción del backend) — esta feature no introduce esa desviación, la hereda. No aplica a datos de series temporales reales (no toca TimescaleDB de la ingesta real). ✅
- **III. Mensajería Solo por Necesidad Demostrada**: No se introduce ningún broker ni mecanismo de mensajería. ✅
- **IV. Inmutabilidad de los Datos Crudos de Telemetría**: La densificación ocurre sobre el trazado de la ruta simulada (`simulador.ruta.puntos`), no sobre lecturas de telemetría ya persistidas en `telemetria.*` — no hay edición de datos crudos reales. ✅
- **V. Minimización de PII**: Sin cambios; no se toca identidad de choferes. ✅
- **VI. Seguridad como Línea Base**: Sin cambios en comunicación cliente-servidor ni credenciales. ✅
- **VII. Tolerancia a Fallos de Conectividad**: N/A — el simulador no recibe datos de campo con retraso; genera tramas localmente. ✅
- **VIII. Testing Mínimo Esperado**: La densificación de puntos y el remapeo de `paradas` es lógica de adaptación de datos externos (geometría de OSRM / datos capturados) — **aplica**: se agregan tests que cubran (a) trazado completo sin saltos grandes (no-op), (b) trazado con un salto que requiere densificación, y (c) un caso límite/inválido (p. ej. dos puntos idénticos o una `parada` cuyo índice debe remapearse tras la densificación). ✅ (se cumple en Fase de tasks)
- **IX. Trazabilidad y No Reproceso Silencioso**: N/A directo a esta feature (no hay descarte de datos de ingesta real); se mantiene el patrón existente de logging en `routeGenerationService.js`. ✅

Sin violaciones. No se requiere Complexity Tracking.

**Re-chequeo post-diseño (tras research.md/data-model.md)**: sin cambios respecto del chequeo
inicial — el diseño final no agrega esquema nuevo, no introduce mensajería, no toca datos de
telemetría real ya persistidos, y el plan de tests (quickstart.md §1) cubre explícitamente los
tres casos mínimos del Principio VIII para la nueva lógica de adaptación (densificación de
trazado). ✅

## Project Structure

### Documentation (this feature)

```text
specs/012-velocidad-rpm-verosimil/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

No se genera `contracts/`: esta feature no agrega ni modifica interfaces externas (el CLI y el HTTP de creación de rutas, documentados en `specs/011-generar-ruta-simulada/contracts/`, mantienen la misma firma de entrada/salida — lo único que cambia es qué queda guardado en `simulador.ruta.puntos`).

### Source Code (repository root)

```text
simulador-viajes/
├── src/
│   ├── domain/
│   │   ├── avanceRuta.js         # Sin cambios de contrato; consume puntos ya densificados
│   │   └── sintesisCan.js        # MODIFICA: rango de RPM realista (ralentí/crucero)
│   ├── services/
│   │   ├── routeGenerationService.js   # MODIFICA: densifica `puntos` antes de insertarRuta()
│   │   └── densificacionRutaService.js # NUEVO: resampler compartido (OSRM y seed)
│   ├── net/
│   │   └── osrmClient.js         # MODIFICA: solicita annotations=speed,distance,duration
│   ├── db/
│   │   └── rutaRepository.js     # Sin cambios (sigue recibiendo puntos/paradas ya resueltos)
│   ├── cli/crearRuta.js          # Sin cambios de contrato
│   └── http/rutaHttpServer.js    # Sin cambios de contrato
└── test/
    ├── domain/sintesisCan.test.js        # AMPLIA el existente (4 tests hoy) con casos de rango de crucero en ruta
    └── services/densificacionRutaService.test.js  # NUEVO

deploy/seed/
├── simulador-camion-1.sql   # REGENERA: puntos densificados + paradas reindexadas
└── simulador-camion-2.sql   # REGENERA: puntos densificados + paradas reindexadas
```

**Structure Decision**: Un único módulo nuevo (`densificacionRutaService.js`) encapsula la lógica de resampleo y la reutilizan tanto `routeGenerationService.js` (rutas nuevas vía OSRM) como el script/proceso que regenera los dos `.sql` de seed — evita duplicar la lógica entre el camino "en vivo" (OSRM) y el camino "offline" (seed estático), consistente con FR-005 (misma garantía para ambos orígenes de ruta).
