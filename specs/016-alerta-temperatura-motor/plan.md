# Implementation Plan: Sobretemperatura de motor simulada y alerta de mantenimiento por riesgo de detención

**Branch**: `feature/engine-temperature-alerts` (en `AgroLinkIngestaAdaptacion`, `AgroLinkBackend` y
`AgroLink`) | **Date**: 2026-11-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/016-alerta-temperatura-motor/spec.md`

## Summary

El simulador empieza a enviar en cada trama una temperatura del refrigerante del motor verosímil
(80–95 °C). Además puede sobrecalentarla de dos formas: al azar (5 % de los viajes, en un punto y
con una duración al azar) o a mano, con `curl` contra su servidor HTTP interno. La ingesta ya
transporta el dato hasta `/estado` sin cambios.

AgroLinkBackend lo evalúa en el poll de `/estado` que ya corre cada 60 s y abre una alerta de
**Mantenimiento** de subtipo `ENGINE_OVERHEAT`:

- advertencia a ≥ 105 °C;
- escala a crítica a ≥ 110 °C;
- se resuelve sola debajo de 100 °C.

Todos los umbrales son configurables. Al mismo tiempo, el backend deja de usar esa temperatura
como reemplazo de la temperatura de carga, un defecto latente que la feature dejaría expuesto.
El frontend la muestra en la pestaña Mantenimiento con rótulo, pico y severidad propios.

## Technical Context

**Language/Version**:
- simulador-viajes: Node.js 22 (ESM).
- AgroLinkBackend: Java 21 + Spring Boot 4.1.
- AgroLink: TypeScript + Next.js 15 (React, Chakra UI).
- agrolink-ingesta / rinho-receptor: sin cambios de código.

**Primary Dependencies**:
- simulador: `node:http` y `pg`, sin dependencias nuevas.
- backend: Spring Data JPA, `@Scheduled`, SSE (`SseEmitter`), sin dependencias nuevas.
- front: sin dependencias nuevas.

**Storage**:
- PostgreSQL/TimescaleDB del repo de ingesta: schema `simulador`, migración `010`.
- PostgreSQL del backend: tabla `alerts`, columnas nuevas por `ddl-auto: update`.

**Testing**:
- simulador: `node --test`.
- backend: JUnit 5 + Mockito (más un `@SpringBootTest` existente para el poll).
- front: Vitest (`test:unit`).

**Target Platform**: Docker compose en VM Linux ARM (producción) y local.

**Project Type**: sistema multi-servicio (daemon simulador + web service backend + web app).

**Performance Goals**: alerta visible < 2 min desde la lectura (SC-002). Con el poll de 60 s y el
ciclo de 60 s del simulador, el peor caso es ~2 min sin cambiar intervalos.

**Constraints**:
- El puerto HTTP del simulador no se publica (011 D-04).
- Sin mensajería nueva (Principio III).
- Sin escrituras sobre `telemetria.*` (Principio IV).
- Retrocompatibilidad de `AlertResponse`: solo campos aditivos.

**Scale/Scope**: flota simulada de decenas de camiones; a lo sumo una alerta abierta por camión.

Sin `NEEDS CLARIFICATION`: todo se resolvió en research.md (D-01 a D-14).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Evaluación | Estado |
|---|---|---|
| I. Capas de adaptación | El backend lee la temperatura del modelo normalizado de `/estado` (`canBus.temperaturaRefrigeranteC`), nunca del campo CAN `2A`. El conocimiento del protocolo queda en el receptor y en el `frameBuilder` del simulador. | ✅ |
| II. Stack backend | Java/Spring Boot/JPA. Sin desvíos. | ✅ |
| III. Mensajería por necesidad | Se reutiliza el poll de `/estado` y el SSE existentes. Sin broker ni canal nuevo. | ✅ |
| IV. Inmutabilidad de telemetría | Ninguna escritura sobre `telemetria.lectura_telemetria`. La migración `010` solo agrega columnas a `simulador.viaje` (configuración mutable). Las alertas son entidades de negocio, no telemetría cruda. | ✅ |
| V. Datos personales | La alerta guarda patente, viaje y temperaturas. Ningún dato del chofer. | ✅ |
| VI. Seguridad | El endpoint nuevo no tiene autenticación, pero es **interno**: puerto sin publicar, alcanzable solo dentro de la red de Docker, igual que `POST /rutas` y `/samsara/viajes`. No invoca la excepción de TLS (no es tramo dispositivo→receptor). Sin credenciales nuevas. Además se **corrige** un problema de aislamiento: `maintenance-alert` hoy llega a todos los tenants (D-11). | ✅ |
| VII. Conectividad intermitente | Una lectura con `momentoEvento <= engineLastReadingAt` no cambia la alerta (D-10). Una alerta abierta no se resuelve por falta de datos. | ✅ |
| VIII. Testing mínimo | La interpretación de `temperaturaRefrigeranteC` en el backend se testea con dato completo, nulo y fuera de rango. Igual el sintetizador y el `frameBuilder` en el simulador. | ✅ |
| IX. Trazabilidad | Los valores fuera de rango no se descartan en silencio: log `WARN` con vehículo y valor. La lectura igual se guarda en ingesta. | ✅ |
| Entregables académicos | `alerts` suma atributos (`maintenance_kind`, `engine_*`) y `simulador.viaje` suma columnas de falla. Si el DER aprobado detalla atributos de `Alerta`, hay que actualizarlo (acción en tasks). La HU de alertas de mantenimiento se amplía, no se contradice. | ⚠️ seguimiento |

**Re-check post-diseño (Phase 1)**: sin cambios. El diseño de data-model.md y de los contratos
respeta las mismas restricciones. El ⚠️ no es una violación: es la actualización del DER que exige
la sección "Alineación con Entregables Académicos" antes de implementar.

## Project Structure

### Documentation (this feature)

```text
specs/016-alerta-temperatura-motor/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── simulador-falla-motor-http.md
│   └── alertas-mantenimiento-motor-http.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
AgroLinkIngestaAdaptacion/
├── deploy/
│   ├── migrations/010_add_falla_motor_viaje.sql         # NUEVO
│   ├── db/03-schema-simulador.sql                       # columnas falla_motor_*
│   ├── compose.yaml                                     # env MOTOR_* del simulador
│   └── .env.example                                     # MOTOR_*
└── simulador-viajes/
    ├── Dockerfile                                       # apk add curl
    ├── README.md                                        # sección "Forzar sobrecalentamiento de motor"
    ├── src/
    │   ├── config.js                                    # loadMotorConfig
    │   ├── index.js                                     # modo + temperaturaRefrigeranteC + transiciones
    │   ├── domain/sintesisTemperaturaMotor.js           # NUEVO (D-01)
    │   ├── domain/fallaMotor.js                         # NUEVO: sortear + estadoFallaMotor (D-03)
    │   ├── db/flotaRepository.js                        # columnas falla_motor_*, sorteo en vuelta
    │   ├── db/viajeRepository.js                        # sorteo en insertarViaje + CRUD de la falla
    │   ├── services/iniciarViajeService.js              # pasa cantidad de puntos y config al sorteo
    │   ├── http/rutaHttpServer.js                       # despacha /camiones/{id}/falla-motor
    │   └── http/fallaMotorHandler.js                    # NUEVO (contrato)
    └── test/
        ├── domain/sintesisTemperaturaMotor.test.js      # NUEVO
        ├── domain/fallaMotor.test.js                    # NUEVO (incluye 200 viajes sembrados)
        ├── http/fallaMotorHandler.test.js               # NUEVO
        ├── protocol/frameBuilder.test.js                # 2A con valor
        └── config/motor.test.js                         # NUEVO

AgroLinkBackend/src/
├── main/java/org/example/agrolink/
│   ├── alert/Alert.java                                 # maintenanceKind + engine_*
│   ├── alert/MaintenanceAlertKind.java                  # NUEVO
│   ├── alert/AlertDto.java                              # maintenanceKind + EngineOverheatInfo
│   ├── alert/AlertRepository.java                       # consulta de alerta abierta por vehículo
│   ├── alert/SseAlertPublisher.java                     # publishMaintenance(tenantId, …)
│   ├── alert/AlertService.java                          # llamador de publishMaintenance actualizado
│   ├── alert/engine/EngineOverheatAlertService.java     # NUEVO (D-07, D-10)
│   ├── alert/engine/EngineTemperatureAlertProperties.java  # NUEVO (D-12)
│   ├── notification/push/AlertPushNotifier.java         # títulos ENGINE_OVERHEAT
│   └── telemetry/ble/BleTemperatureTelemetrySyncService.java  # FR-012 + invoca evaluación
├── main/resources/application.yml                       # agrolink.alert.engine-temperature.*
└── test/java/org/example/agrolink/
    ├── alert/engine/EngineOverheatAlertServiceTest.java        # NUEVO
    ├── alert/engine/EngineTemperatureAlertPropertiesTest.java  # NUEVO
    ├── notification/push/AlertPushNotifierTest.java            # títulos ENGINE_OVERHEAT
    └── telemetry/ble/BleTemperatureTelemetrySyncServiceTest.java  # FR-012 + invocación

AgroLink/
├── src/services/thermalAlertService.ts                  # tipos maintenanceKind / engine + helpers + patente en extractAssetRef
├── src/components/alertas/ThermalAlertTable.tsx         # fila ENGINE_OVERHEAT
└── tests/unit/services/engineOverheatAlert.unit.test.ts # NUEVO: rótulos, formato y búsqueda por patente
```

**Structure Decision**: se tocan los tres repos existentes, sin proyectos nuevos. La lógica de
decisión vive en módulos puros testeables: `sintesisTemperaturaMotor`, `fallaMotor` y
`EngineOverheatAlertService` (con repositorio mockeado). Las integraciones (HTTP, poll y SSE)
quedan como adaptadores finos.

### Cobertura mínima

- **Simulador**:
  - síntesis normal: nunca sale de [80, 95] en 1000 tramas;
  - sobrecalentamiento: llega a ≥105 en ≤ 9 tramas desde 88 y se estabiliza en el pico;
  - enfriamiento: de 115 a < 100 en ≤ 7 tramas;
  - sorteo: 200 viajes con `rng` sembrado dan 4 a 18; 0 % nunca sortea; los índices caen en
    [10 %, 70 %];
  - transiciones de `estadoFallaMotor`;
  - handler: `ACTIVADA`, `YA_ACTIVA`, `DESACTIVADA`, `YA_INACTIVA`, 404, 409, 400, 405;
  - config inválida;
  - `frameBuilder` con `2A` lleno.
- **Backend**:
  - creación `WARNING` y creación directa `CRITICAL`;
  - escalado sin duplicar;
  - pico sin publicar SSE;
  - zona de histéresis sin resolver; resolución bajo 100 °C;
  - `ACKNOWLEDGED` sigue el ciclo;
  - `null`, fuera de rango y re-lectura (mismo `momentoEvento`) sin efecto;
  - alerta con y sin viaje;
  - aislamiento por tenant del SSE;
  - FR-012 (sin BLE → sin evaluación térmica de carga);
  - properties inválidas que hacen fallar el arranque.
- **Front**: rótulo y severidad de `ENGINE_OVERHEAT`; las filas de mantenimiento existentes no
  cambian.

## Complexity Tracking

Sin violaciones de la constitución que justificar.
