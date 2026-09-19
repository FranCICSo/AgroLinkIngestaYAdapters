# Implementation Plan: Almacenar el odómetro en kilómetros

**Branch**: `005-odometer-storage-km` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-odometer-storage-km/spec.md`

## Summary

`lectura_telemetria.odometro_m` (`BIGINT`, metros) se reemplaza por `odometro_km`
(`DOUBLE PRECISION`, kilómetros). El receptor Rinho (`rinho-receptor`) deja de convertir
el odómetro de ECU (CAN id `B`, ya en km según el fabricante) a metros, y en cambio
convierte a km el odómetro de GPS (nativamente en metros). Java (`LecturaTelemetria`,
`EstadoVehiculoService`, `ReporteViajeService`) se actualiza para leer/calcular
directamente en kilómetros, eliminando la conversión que la feature 004 hacía solo en
la respuesta de `/estado`. El reporte de viaje pasa a exponer `distanciaKm` en vez de
`distanciaM` (cambio de contrato, igual de deliberado que el de la feature 004).

## Technical Context

**Language/Version**: Java 21 (Spring Boot) + Node.js (`rinho-receptor`), sin cambios de
versión.

**Primary Dependencies**: Spring Data JPA, PostgreSQL/TimescaleDB driver (Java); driver
`pg` en `rinho-receptor` (Node). Sin dependencias nuevas.

**Storage**: PostgreSQL/TimescaleDB. Cambia el tipo y nombre de una columna existente
(`odometro_m BIGINT` → `odometro_km DOUBLE PRECISION`) en
`telemetria.lectura_telemetria`. El proyecto no usa Flyway/Liquibase: el esquema vive en
`deploy/db/01-schema.sql`, montado como `docker-entrypoint-initdb.d` y ejecutado por
Postgres **solo la primera vez** que el volumen está vacío (ver `deploy/README.md`,
§2.5). Por eso este cambio requiere dos artefactos distintos: el `01-schema.sql`
actualizado (para instalaciones nuevas) y una sentencia `ALTER TABLE` documentada para
quien ya tenga un volumen inicializado (research.md D-04).

**Testing**: JUnit 5 + AssertJ (Java: `EstadoVehiculoServiceTest`,
`ReporteViajeServiceTest`, `LecturaTelemetriaRepositoryIntegrationTest`); `node:test`
(rinho-receptor: `lecturaMapper.test.js`, `lecturaTardia.test.js`).

**Target Platform**: Linux server (contenedores Docker), sin cambios.

**Project Type**: Servicio web único (backend Spring Boot) + receptor Node.js
independiente (`rinho-receptor`) — ambos ya existentes, sin nuevos componentes.

**Performance Goals**: N/A — sigue siendo aritmética simple sobre valores ya en memoria
o ya persistidos; `DOUBLE PRECISION` no cambia el patrón de acceso de la hypertable.

**Constraints**: Cambio de contrato deliberado y acotado en dos superficies:
1. `telemetria.lectura_telemetria.odometro_km` reemplaza a `odometro_m` (no coexisten).
2. `ReporteViajeDto.distanciaKm` reemplaza a `distanciaM` en el contrato de
   `/api/v1/reportes/viaje` (no coexisten). `CanBusDto.odometroKm` (feature 004) no
   cambia de nombre ni de tipo — solo deja de necesitar la conversión intermedia.

**Scale/Scope**: Alcanza `rinho-receptor` (mapeo de ingesta), el esquema de base de
datos, `LecturaTelemetria`, `EstadoVehiculoService`/`CanBusDto` (simplificación, sin
cambio de contrato externo) y `ReporteViajeService`/`ReporteViajeDto` (cambio de
contrato externo). No alcanza al parseo de la trama cruda (`eqParser.js`): el campo GPS
ya se parsea correctamente como metros nativos (`odometroGpsM`), eso no cambia.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Arquitectura Desacoplada por Capas de Adaptación**: ✅ Cumple. El único punto que
  traduce el formato del proveedor (Rinho) al dominio propio (`resolveOdometro` en
  `lecturaMapper.js`) es exactamente donde cambia la conversión. El dominio interno de
  Java no interpreta ninguna trama cruda.
- **II. Stack Tecnológico del Backend**: ✅ Cumple. Sin cambio de stack; el cambio de
  tipo de columna (`BIGINT` → `DOUBLE PRECISION`) es una migración de esquema ordinaria
  sobre PostgreSQL/TimescaleDB ya en uso.
- **III. Mensajería Solo por Necesidad Demostrada**: ✅ No aplica.
- **IV. Inmutabilidad de los Datos Crudos de Telemetría**: ✅ Cumple con matiz
  explícito: la migración **reinterpreta** el valor ya persistido de `odometro_m` a la
  misma magnitud en `odometro_km` (dividir por 1000) — no es una corrección de negocio
  sobre un dato mal recibido, es una reexpresión de unidad de una columna completa,
  igual para todas las filas, sin alterar qué distancia real representa cada lectura.
  `payload_crudo` (la trama original) no se toca, así que el dato fuente para
  auditoría/reproceso sigue intacto.
- **V. Minimización de Datos Personales Identificables**: ✅ No aplica.
- **VI. Seguridad como Línea Base**: ✅ No aplica.
- **VII. Tolerancia a Fallos de Conectividad**: ✅ No aplica — no cambia el pipeline de
  llegada tardía, solo la unidad de un valor ya manejado por ese pipeline.
- **VIII. Testing Mínimo Esperado**: ✅ Cumple (ver tasks): se actualizan los tests de
  `resolveOdometro` (ECU y GPS), `EstadoVehiculoServiceTest`, `ReporteViajeServiceTest` y
  el test de integración del repositorio, cubriendo dato completo, campo faltante y
  valor at the boundary (odómetro cero).
- **IX. Trazabilidad y No Reproceso Silencioso**: ✅ No aplica — no cambia el manejo de
  datos no interpretables.

**Resultado**: Sin violaciones. La única particularidad (migración de esquema sin
framework de migraciones) se documenta en Complexity Tracking, no porque viole un
principio sino porque es una limitación operativa real del proyecto que el plan debe
dejar explícita.

## Project Structure

### Documentation (this feature)

```text
specs/005-odometer-storage-km/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
deploy/db/01-schema.sql                                # odometro_m BIGINT -> odometro_km DOUBLE PRECISION

rinho-receptor/src/domain/lecturaMapper.js              # resolveOdometro: sin *1000 para ECU, /1000 para GPS
rinho-receptor/src/db/lecturaRepository.js               # columna e insert: odometro_m -> odometro_km
rinho-receptor/test/lecturaMapper.test.js                # asserts actualizados
rinho-receptor/test/lecturaTardia.test.js                # fixture actualizado (odometroM -> odometroKm)

src/main/java/ar/utn/agrolink/ingesta/telemetry/LecturaTelemetria.java   # campo/columna/getter renombrados
src/main/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoService.java  # mapearCanBus: pass-through directo
src/main/java/ar/utn/agrolink/ingesta/report/ReporteViajeDto.java        # distanciaM (long) -> distanciaKm (double)
src/main/java/ar/utn/agrolink/ingesta/report/ReporteViajeService.java    # calculo en km, sin /1000.0

src/test/java/ar/utn/agrolink/ingesta/estado/EstadoVehiculoServiceTest.java
src/test/java/ar/utn/agrolink/ingesta/report/ReporteViajeServiceTest.java
src/test/java/ar/utn/agrolink/ingesta/telemetry/LecturaTelemetriaRepositoryIntegrationTest.java

specs/005-odometer-storage-km/contracts/
├── agrolink-vehiculo-estado-api.yaml   # v5.0.0: mismo shape, descripcion actualizada (sin conversion interna)
└── agrolink-reportes-api.yaml          # v2.0.0: distanciaM -> distanciaKm
```

**Structure Decision**: Sin proyectos nuevos. El cambio atraviesa las dos capas de
adaptación ya existentes en este monorepo: `rinho-receptor` (ingesta Node.js, traduce el
protocolo del fabricante) y el paquete `ar.utn.agrolink.ingesta.*` (Spring Boot, expone
`/estado` y `/reportes`). Es exactamente el patrón que la constitución (Principio I)
espera para un cambio de este tipo: se toca la capa de adaptación en ambos extremos, no
la lógica de negocio de en medio.

## Complexity Tracking

> Sin violaciones de principios. Se documenta igual una limitación operativa real.

| Punto | Por qué existe | Alternativa más simple descartada porque |
|-------|-----------------|-------------------------------------------|
| Migración de esquema manual (`ALTER TABLE`, research.md D-04), en vez de un archivo de migración versionado y auto-aplicado | El proyecto no tiene Flyway/Liquibase (decisión ya tomada en la feature 001, fuera de alcance de esta feature reabrirla); `deploy/db/*.sql` solo corre una vez, contra un volumen vacío | Introducir un framework de migraciones solo para este cambio sería una dependencia nueva no justificada por una necesidad demostrada (Principio III, por analogía) — el proyecto es un piloto académico con pocas instalaciones, y una instrucción documentada en el plan/README es suficiente y auditable |
