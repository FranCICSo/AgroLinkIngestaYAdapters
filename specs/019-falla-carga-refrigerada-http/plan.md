# Implementation Plan: Activar y cerrar a mano el desvío térmico de la carga refrigerada

**Branch**: `feature/samsara-exceso-manual` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/019-falla-carga-refrigerada-http/spec.md`

## Summary

Hoy la temperatura de la carga refrigerada solo se saca del rango del viaje con un `UPDATE` a mano
(`falla_compresor`). Además sube lento, sin tope y sin mirar los umbrales. Esta feature agrega al
servidor HTTP interno de `simulador-viajes` el recurso `/camiones/{id}/falla-carga` (`POST`, `GET`,
`DELETE`), con las mismas convenciones que `/falla-motor`:

- **Activar** guarda en el viaje una falla de carga nueva, `desvio_termico`, con sentido `arriba` o
  `abajo`. La síntesis BLE lleva la temperatura a unos grados fuera del umbral del viaje en 1 o 2
  tramas y la mantiene ahí.
- **Cerrar** vacía la falla, y el modo normal existente la devuelve al rango en 1 o 2 tramas.

Para conocer el rango, el simulador recibe los umbrales del viaje: `agrolink-ingesta` ya los guarda
y ahora también los reenvía en `/rutas`. AgroLinkBackend no cambia. Su regla actual abre la alerta
después de 20 minutos fuera del rango y la cierra al volver.

## Technical Context

**Language/Version**: Node.js 20, módulos ES (`simulador-viajes`) y Java 21 con Spring Boot 3
(`agrolink-ingesta`, solo el cliente hacia el simulador).

**Primary Dependencies**: `node:http` y `pg` en el simulador, sin framework nuevo. `RestClient` de
Spring en la ingesta.

**Storage**: PostgreSQL/TimescaleDB, esquema `simulador`. Migración `013`: columnas en
`simulador.viaje` y `simulador.camion`, y el `CHECK` de `falla_tipo` ampliado.

**Testing**: `node --test` (`simulador-viajes/test/**`) y JUnit 5 con `MockRestServiceServer` en la
ingesta.

**Target Platform**: contenedores Linux con Docker Compose (`deploy/compose.yaml`), en local y en la
VM de Azure.

**Project Type**: servicios backend, más un simulador de dispositivos con una API HTTP interna.

**Performance Goals**: ninguno nuevo. Las operaciones son de a una y a mano. La síntesis agrega una
cuenta por trama.

**Constraints**:

- Salir del rango en ≤ 3 tramas y volver en ≤ 5 (FR-004, FR-008).
- No tocar telemetría persistida (Principio IV).
- El puerto HTTP del simulador sigue sin publicarse.
- Compatibilidad: `/rutas` sin umbrales sigue funcionando igual.

**Scale/Scope**: unos pocos camiones simulados. Son tres operaciones HTTP, una migración, un modo de
síntesis y un campo nuevo en el request de la ingesta.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Evaluación | Estado |
|---|---|---|
| I. Capas de adaptación | El simulador produce tramas Rinho como un dispositivo real. El backend sigue leyendo la temperatura normalizada que expone la ingesta. No se agrega ningún atajo del simulador al backend. | ✅ |
| II. Stack backend | Sin backend Java nuevo. El cambio en `agrolink-ingesta` es Java/Spring. El simulador ya es Node.js, como excepción documentada desde la feature 009. | ✅ |
| III. Mensajería por necesidad | Solo HTTP síncrono interno. Sin broker. | ✅ |
| IV. Inmutabilidad de telemetría | Las escrituras son sobre `simulador.viaje` y `simulador.camion` (configuración mutable). Ninguna sobre `telemetria.lectura_telemetria`. | ✅ |
| V. Datos personales | Solo ids de camión y viaje, temperaturas y umbrales. Ningún dato del chofer. | ✅ |
| VI. Seguridad | Endpoint interno sin autenticación, igual que `falla-motor` y `/rutas`: el puerto no se publica fuera de la red de Docker. No invoca la excepción de TLS. Sin credenciales nuevas. | ✅ |
| VII. Conectividad intermitente | No cambia la ingesta de tramas. El simulador emite con timestamp real como siempre. | ✅ |
| VIII. Testing mínimo | Los umbrales nuevos que acepta `/rutas` (dato externo) se testean completos, con uno faltante y fuera de rango o invertidos. También la síntesis y el handler (quickstart §7). | ✅ |
| IX. Trazabilidad | Cada activación y cierre deja log `info` (FR-013). Un `/rutas` con umbrales inválidos responde `400` con motivo, sin descartarlo en silencio. | ✅ |
| Entregables académicos | Solo cambia el esquema `simulador`, que es herramienta de demo y no figura en el DER del dominio. | ✅ |

**Re-check post-diseño (Phase 1)**: sin cambios. El data-model, el contrato y la quickstart
respetan las mismas restricciones.

## Project Structure

### Documentation (this feature)

```text
specs/019-falla-carga-refrigerada-http/
├── plan.md              # Este archivo
├── research.md          # Phase 0: decisiones D-01 a D-06
├── data-model.md        # Phase 1: columnas, estados y transiciones
├── quickstart.md        # Phase 1: validación de punta a punta
├── contracts/
│   └── simulador-falla-carga-http.md   # /camiones/{id}/falla-carga y cambio en /rutas
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks; no lo crea este comando)
```

### Source Code (repository root)

```text
deploy/
├── migrations/013_add_desvio_termico_carga.sql   # nuevo
└── db/03-schema-simulador.sql                     # columnas nuevas y CHECK ampliado

simulador-viajes/
├── src/
│   ├── config.js                        # loadCargaDesvioConfig (márgenes)
│   ├── index.js                         # determinarModoBle + viajeIdBle + registro de temperatura
│   ├── domain/
│   │   ├── sintesisBle.js               # modo desvio_termico
│   │   └── registroTemperaturaCarga.js  # nuevo
│   ├── db/
│   │   ├── camionRepository.js          # umbrales en insertar/actualizarCargaCamion
│   │   ├── flotaRepository.js           # lee umbrales y columnas de la falla de carga
│   │   └── viajeRepository.js           # lecturas y escrituras de la falla de carga
│   ├── http/
│   │   ├── fallaCargaHandler.js         # nuevo
│   │   └── rutaHttpServer.js            # ruteo a fallaCargaHandler
│   └── services/
│       ├── iniciarViajeService.js       # pasa umbrales a la carga del camión
│       └── routeGenerationService.js    # valida umbrales
├── test/
│   ├── domain/sintesisBle.test.js
│   ├── http/fallaCargaHandler.test.js   # nuevo
│   └── services/{iniciarViajeService,routeGenerationService}.test.js
└── README.md                            # curl de activar, consultar y cerrar

src/main/java/ar/utn/agrolink/ingesta/viajeprogramado/
└── SimuladorViajesClient.java           # CamionRequest + umbrales
src/test/java/ar/utn/agrolink/ingesta/viajeprogramado/
└── SimuladorViajesClientTest.java
```

**Structure Decision**: Se mantiene la estructura existente. El simulador suma un handler HTTP con
la forma de `fallaMotorHandler.js`, un registro en memoria con la forma de
`registroTemperaturaMotor.js` y un modo en la síntesis BLE existente. La ingesta cambia un solo
cliente. AgroLinkBackend y el frontend no se tocan.

## Riesgos y notas para tasks

- **Orden de deploy**: el CI aplica las migraciones, después despliega la ingesta y por último el
  simulador.
  - Una ingesta nueva que manda umbrales a un simulador viejo no rompe nada: el `validarCamion`
    actual solo mira `id`, `tipoCarga`, `odometroInicialKm` y los setpoints, e ignora el resto
    (verificado el 2026-11-22).
  - Un simulador nuevo sin umbrales usa el margen fijo (FR-015).
- **`CHECK` de `falla_tipo`**: la migración reemplaza `viaje_falla_tipo_check` por nombre. Si en
  algún entorno se llamara distinto, `DROP CONSTRAINT IF EXISTS` no lo borra y el `ADD` deja dos
  checks: el viejo rechazaría `desvio_termico`. Para cubrir ese caso, la migración busca el check
  sobre `falla_tipo` en `pg_constraint` y lo borra antes de crear el nuevo.
- **Tiempos de la alerta**: dependen del backend (research.md D-06). La quickstart documenta cómo
  acortarlos para una demo.

## Complexity Tracking

No hay violaciones de la constitución que justificar.
