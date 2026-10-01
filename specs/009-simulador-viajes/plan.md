# Implementation Plan: Simulador de Viajes con Dispositivos Ficticios

**Branch**: `009-simulador-viajes` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-simulador-viajes/spec.md`

## Summary

Proceso Node.js independiente (`simulador-viajes`) que simula una flota de camiones —
incluidos refrigerados — recorriendo rutas reales y emite, cada 60 segundos por camión, la
misma trama UDP `>REQ...<` que enviaría un Rinho Spider IoT físico contra el `rinho-receptor`
real: mismo protocolo, checksum y mecanismo de ACK. No se agrega ningún modo "dummy" dentro del
receptor; el simulador es indistinguible, desde el punto de vista del receptor, de un dispositivo
de campo.

La configuración mutable de la flota (camiones, rutas, viajes) vive en un schema Postgres nuevo,
`simulador`, en la misma instancia TimescaleDB que ya usa el receptor — separado del schema
`telemetria` (insert-only, Principio IV) porque esta configuración sí necesita edición en
caliente. Un integrante del equipo la edita directo con `psql`/DataGrip, igual que ya administra
la base hoy, sin tocar código ni redeployar.

El primer camión de la flota reutiliza una ruta de 88 puntos GPS reales capturados en producción
(dispositivo `860693084873877`), con odómetro inicial en 150 200 km. Los valores de RPM,
combustible y presión de aceite se sintetizan porque el equipo real usado para capturar esa ruta
no los reportaba de forma confiable (confirmado decodificando tramas de campo byte a byte).

Los camiones con carga refrigerada (caso de referencia: medias reses) emiten además el segmento
BLE opcional del protocolo (`T0`/`H0`/`B0`), ya soportado por el receptor desde la feature
008-ble-sensor-ingestion (implementada y commiteada en esta misma rama): temperatura y humedad
estables alrededor del setpoint en operación normal, con dos fallas planificadas configurables
por viaje — apertura de puerta en una parada (pico y recuperación) y falla de compresor (subida
sostenida que cruza el umbral de alerta de la carga).

## Technical Context

**Language/Version**: Node.js 22 LTS — mismo runtime que `rinho-receptor`, ya validado en la VM
ARM64 de OCI.

**Primary Dependencies**:
- `pg` (driver PostgreSQL) para leer/escribir `simulador.*` — misma dependencia que ya usa
  `rinho-receptor`.
- `node:dgram` (built-in) para el cliente UDP saliente — sin dependencias externas nuevas.
- Reutilización de la lógica de construcción de tramas de `rinho-receptor/test/tools/buildFrame.js`
  (arma GPS + CAN + checksum válidos). Cómo se comparte ese código entre los dos proyectos
  Node.js (import relativo, extraerlo a un módulo compartido, o portarlo) se resuelve en
  `research.md` — hoy vive bajo `test/`, pensado como helper de tests, no como librería
  publicada.

**Storage**: PostgreSQL 16 + TimescaleDB, mismo clúster que `telemetria`. Schema nuevo
`simulador` (tablas regulares, NO hypertables): `camion` (incluye `setpoint_temp_c` y
`setpoint_humedad_pct` cuando la carga es refrigerada), `ruta`, `viaje` (incluye la falla
planificada opcional: tipo `apertura_puerta` | `falla_compresor`, y el punto del viaje en que
dispara). Rol Postgres nuevo
(`simulador_viajes`) con `SELECT/INSERT/UPDATE` acotado a `simulador.*` — **sin ningún permiso
sobre `telemetria`**: el simulador nunca escribe telemetría directo, solo la envía por UDP al
receptor real, que es quien la persiste (mismo camino que un dispositivo real).

**Testing**: `node:test` + `node:assert`, igual que `rinho-receptor`. Cobertura mínima
(Principio VIII) sobre la lógica de síntesis CAN, de avance de ruta y de síntesis BLE: (a) camión
en movimiento con todos los campos poblados (CAN + BLE si tiene carga refrigerada), (b) camión
detenido en una parada (velocidad 0, ignición apagada, presión de aceite en ralentí, pico de
temperatura BLE si aplica apertura de puerta), (c) caso fuera de rango (ruta vacía, config de
camión inválida, o falla de compresor cruzando el umbral de alerta).

**Target Platform**: Igual que el resto del stack — por defecto contra un receptor local o de
staging (docker compose en la máquina de desarrollo); contra la VM de OCI solo con una variable
de entorno/flag explícito (FR-012), nunca por defecto.

**Project Type**: Nuevo servicio backend Node.js (proceso batch/daemon de larga duración) +
tablas de configuración Postgres. Sin API HTTP propia expuesta (no lo necesita: FR-004 se
satisface editando las tablas `simulador.*` directamente).

**Performance Goals**: Sostener 5 camiones activos emitiendo cada 60 s sin que el temporizador de
uno bloquee o retrase a los demás (SC-002); drift acumulado por camión menor a 5 s por hora de
simulación continua.

**Constraints**:
- Debe construir exactamente la misma trama (ancho fijo, checksum XOR, y el segmento BLE
  opcional en la posición 2 tras GPS/CAN) que ya valida `rinho-receptor`/`eqParser.js` +
  `bleSection.js` — cualquier divergencia rompería el parseo del lado receptor. Solo el slot 0
  (`T0`/`H0`/`B0`) tiene efecto: los demás slots quedan fuera de alcance porque el receptor los
  ignora (contrato `specs/008-ble-sensor-ingestion/contracts/rinho-ble-segment.md`).
- Reintentos ante falta de ACK con límite acotado (FR-011): no puede reintentar indefinidamente
  si el receptor queda caído por un período largo.
- El schema `simulador` no puede tener ningún camino de código que escriba en
  `telemetria.lectura_telemetria` — eso violaría el límite de responsabilidad de esta feature y
  el Principio I (el único punto de contacto con el modelo de dominio sigue siendo el receptor).

**Scale/Scope**: 5 camiones iniciales (uno ya con datos de referencia reales), 1–3 paradas por
viaje, ampliable editando `simulador.*` sin límite de diseño fijado en código.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Gate | Estado |
|-----------|------|--------|
| I. Arquitectura desacoplada por capas de adaptación | El simulador no toca ni reemplaza la capa de adaptación existente (`eqParser.js`/`lecturaMapper.js`): la ejercita desde afuera, como un dispositivo más, por UDP. Nunca escribe `telemetria.lectura_telemetria` directo (ver Constraints). | ✅ PASS |
| II. Stack backend Java/Spring Boot + PostgreSQL/TimescaleDB + Spring Data JPA | Desvío: Node.js. Mismo carve-out ya precedentado por `rinho-receptor` en 001-ingesta-adaptacion-telemetria — reutiliza la construcción de tramas/checksum ya validada contra el protocolo real. | ⚠️ PASS con justificación (ver Complexity Tracking) |
| III. Mensajería solo por necesidad demostrada | UDP directo al receptor, sin broker. | ✅ PASS |
| IV. Inmutabilidad de datos crudos de telemetría | El simulador no inserta en `telemetria.*`; el schema `simulador.*` es config mutable de la herramienta de simulación, no telemetría — fuera del alcance de este principio por diseño (rol Postgres dedicado sin acceso a `telemetria`, ver Storage). | ✅ PASS |
| V. Minimización de datos personales | Camiones simulados llevan solo patente/nombre de vehículo ficticio; ningún dato de chofer. | ✅ PASS |
| VI. Seguridad como línea base | El tramo simulador→receptor reutiliza el mismo carve-out UDP en claro ya amparado por la enmienda 1.1.0 (mismo protocolo, mismo receptor, mismos controles compensatorios). El simulador no expone ningún puerto entrante; credenciales de Postgres por variable de entorno. | ✅ PASS |
| VII. Tolerancia a fallos de conectividad | FR-011 (reintentos acotados ante falta de ACK) ejercita este principio desde el lado del dispositivo simulado — algo que no se puede forzar a demanda con hardware real. | ✅ PASS |
| VIII. Testing mínimo esperado | Síntesis CAN y avance de ruta cubiertos en los 3 casos mínimos (ver Testing). | ✅ PASS |
| IX. Trazabilidad y no reproceso silencioso | Si se agotan los reintentos de una trama, el simulador lo loguea explícito (dispositivo, viaje, motivo) en vez de descartarla en silencio. | ✅ PASS |

**Alineación con entregables académicos**: esta feature no modifica el modelo de dominio ni los
entregables ya aprobados (WBS, DER, Historias de Usuario) — agrega un schema interno de
herramienta de desarrollo/demo, sin relación con el dominio de negocio de AgroLink.

### Post-Design Re-check (después de Phase 1)

Re-evaluado tras generar `data-model.md`, `contracts/` y `quickstart.md`: **sin violaciones
nuevas**. Se confirma que `simulador.*` es config mutable de tooling y nunca telemetría (data-model.md
§0), que el simulador solo reutiliza los contratos BLE/EQ ya normativos de 001 y 008 sin
redefinirlos (contracts/simulador-frame-emission.md), y que la síntesis de temperatura BLE
(research.md D-06) no requiere ningún dato personal ni cambia el schema de `telemetria`. Queda
un único ⚠️ (Principio II, simulador en Node.js), con la misma justificación ya aceptada para
`rinho-receptor` en 001 (Complexity Tracking).

## Project Structure

### Documentation (this feature)

```text
specs/009-simulador-viajes/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/            # Phase 1 output
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
simulador-viajes/                  # nuevo proyecto Node.js, sibling de rinho-receptor/
├── package.json                   # engines: node >=22, dependencia: pg
├── src/
│   ├── config.js                  # env vars: destino UDP, DB, flag "apuntar a produccion"
│   ├── db/
│   │   ├── pool.js                 # pool pg dedicado, rol simulador_viajes
│   │   └── flotaRepository.js      # lee/actualiza simulador.camion / ruta / viaje
│   ├── domain/
│   │   ├── avanceRuta.js           # posición/velocidad/rumbo/odómetro según progreso del viaje
│   │   ├── sintesisCan.js          # RPM, combustible %, combustible consumido, presión de aceite
│   │   └── sintesisBle.js          # temperatura/humedad de carga refrigerada + fallas planificadas
│   │                                # (apertura de puerta, falla de compresor)
│   ├── protocol/
│   │   └── frameBuilder.js         # arma la trama REQ/EQ [+BLE opcional] + checksum (ver research.md)
│   ├── net/
│   │   └── udpClient.js            # envío UDP + espera de ACK + reintentos acotados (FR-011)
│   └── index.js                    # loop principal: un timer por camión activo
└── test/
    ├── domain/
    │   ├── avanceRuta.test.js
    │   ├── sintesisCan.test.js
    │   └── sintesisBle.test.js
    └── protocol/
        └── frameBuilder.test.js

deploy/
├── db/
│   └── 03-schema-simulador.sql    # schema `simulador` + tablas + rol simulador_viajes
└── seed/
    └── simulador-camion-1.sql     # ruta de 88 puntos + camión de referencia (odómetro 150200)
```

**Structure Decision**: Proyecto Node.js nuevo y sibling de `rinho-receptor/` (mismo patrón:
`package.json` propio, `docker compose` lo suma como servicio independiente en
`deploy/compose.yaml`), en vez de una carpeta dentro de `rinho-receptor/` — mantiene la
separación de procesos exigida por el spec (FR-002) también a nivel de repositorio/build. El
schema `simulador` se agrega como un nuevo script de init de Postgres (`03-...sql`, después del
`01-schema.sql` de telemetría y el `02-roles.sql` existente).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| **Principio II**: el simulador se implementa en Node.js, no en Java/Spring Boot | Debe producir bit a bit la misma trama que valida `rinho-receptor` (ancho fijo, checksum XOR): reutilizar la lógica ya probada de `rinho-receptor/test/tools/buildFrame.js` (y el mismo runtime que ya corre en la VM ARM64) elimina el riesgo de reimplementar esa aritmética en otro lenguaje y que diverja sutilmente del parser real. Es el mismo razonamiento ya aceptado para el propio `rinho-receptor` en 001-ingesta-adaptacion-telemetria. | *Escribirlo en Java*: obligaría a reimplementar desde cero, en un lenguaje distinto al de referencia, la construcción de una trama cuyo formato exacto (offsets, checksum) ya está resuelto y probado en Node.js — duplicando el riesgo de una divergencia que solo se detectaría cuando el receptor real rechace las tramas del simulador. |
