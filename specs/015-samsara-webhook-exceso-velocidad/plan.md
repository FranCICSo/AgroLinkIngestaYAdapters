# Implementation Plan: Proveedor Samsara por webhook — exceso de velocidad severo

**Branch**: `015-samsara-webhook-exceso-velocidad` | **Date**: 2026-11-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/015-samsara-webhook-exceso-velocidad/spec.md`

## Summary

Se suma Samsara como segundo proveedor de telemetría, solo para los eventos
`SevereSpeedingStarted` y `SevereSpeedingEnded` por webhook.

- **Emisor** (`simulador-viajes`, módulo nuevo `src/samsara/`): por cada vehículo Samsara con
  viaje en curso, lleva una velocidad interna (base estable más ráfagas Poisson poco frecuentes).
  Envía el webhook solo cuando esa velocidad cruza el umbral de límite + margen (80 + 20 km/h).
- **`agrolink-ingesta`**: recibe el webhook sin autenticar y lo guarda crudo en la hypertable
  insert-only `telemetria.evento_samsara`. Expone una consulta por cursor.
- **AgroLinkBackend**:
  - consulta esa API cada 10 s;
  - adapta cada notificación a un `DrivingEvent`;
  - empareja inicio y fin en un `SpeedingEpisode` en cualquier orden de llegada;
  - abre y cierra una alerta `SPEEDING`.
- **Frontend**: agrega una pestaña y una tarjeta KPI de alertas de conducción.

El aviso de inicio y fin de viaje viaja por el camino existente backend → ingesta → simulador,
con un despacho por lista cerrada Samsara (`iotDeviceId` = id de Samsara).

## Technical Context

**Language/Version**:
- `agrolink-ingesta`: Java 21, Spring Boot 3.3.4.
- `simulador-viajes`: Node.js ≥ 22, ESM.
- AgroLinkBackend: Java 21, Spring Boot 4.1.0.
- Frontend AgroLink: Next.js 15 + TypeScript.

**Primary Dependencies**: Spring Web, Spring Data JPA y Jackson, que ya están. `fetch` nativo de
Node, sin dependencias nuevas en el simulador. Chakra UI en el frontend, que ya está.

**Storage**:
- TimescaleDB de ingesta: tabla nueva `telemetria.evento_samsara` (migración 009).
- PostgreSQL de AgroLinkBackend (Supabase, `ddl-auto=update`): tablas nuevas `speeding_episodes`
  y `provider_event_cursors`, y columna nueva `alerts.speeding_episode_id`.
- Emisor: estado en memoria.

**Testing**: JUnit 5 + Spring Boot Test en ambos servicios Java, `node --test` en el simulador,
y el runner existente del frontend (unit + integration con MSW).

**Target Platform**: contenedores Docker en las VMs OCI existentes (ingesta + simulador en una,
backend en otra), frontend en Vercel.

**Project Type**: cuatro componentes en tres repos: dos web services, un proceso de simulación y
una SPA.

**Performance Goals**: alerta visible en < 15 s desde el envío (SC-001). Volumen bajo: 2
vehículos × unos pocos eventos por hora.

**Constraints**:
- Sin broker (Principio III).
- Sin autenticación en los endpoints nuevos (decisión de POC).
- Dato crudo insert-only por grants.
- Los avisos de viaje no bloquean la transición del viaje, igual que en 026.

**Scale/Scope**: 2 vehículos Samsara simulados, 2 tipos de evento y 1 pestaña nueva.

Las incógnitas del contexto quedaron resueltas en [research.md](./research.md) D-01…D-16.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Pre-diseño | Post-diseño | Cómo se cumple |
|---|---|---|---|
| I. Capas de adaptación | ✅ | ✅ | El formato Samsara solo lo conocen el emisor (que lo produce), ingesta (que lo guarda crudo y extrae campos de consulta, sin lógica de negocio) y `SamsaraSpeedingEventAdapter` en el backend. Alertas y viajes ven `DrivingEvent` (D-15). |
| II. Stack backend | ✅ | ✅ | Java/Spring + TimescaleDB para el dato crudo. El emisor en Node extiende `simulador-viajes`, ya justificado en 009 como herramienta de demo, no backend de producto. |
| III. Mensajería por necesidad | ✅ | ✅ | Webhook HTTP → persistencia directa. Backend por consulta HTTP periódica (D-06). Sin broker. |
| IV. Inmutabilidad de datos crudos | ✅ | ✅ | `evento_samsara` es insert-only: `agrolink_ingesta` solo tiene `SELECT, INSERT`, la entidad es `@Immutable` y el repositorio no expone `save`/`delete` (data-model §1). Sin "consumido": el cursor vive en el backend (D-04). El episodio es derivado (D-13). |
| V. Datos personales | ✅ | ✅ | El evento no trae conductor y no se agrega. Solo hay vehículo y patente (FR-012). |
| VI. Seguridad como línea base | ❌ | ⚠️ justificado | Los endpoints webhook y de consulta no tienen autenticación ni firma, y el webhook no tiene TLS propio. **Desvío explícito de la POC (spec FR-002)**, ver Complexity Tracking. |
| VII. Tolerancia a conectividad | ✅ | ✅ | Emparejamiento por `(vehículo, startTime)` en cualquier orden. Horas del evento, no de llegada. El cursor sobrevive caídas (D-04, D-06, D-13). |
| VIII. Testing mínimo | ✅ | ✅ | Tres casos (completo / faltante / inválido) en la extracción de ingesta, el adaptador del backend y el payload del emisor (quickstart §4). |
| IX. Trazabilidad | ✅ | ✅ | Todo JSON legible se guarda. Los no soportados o rechazados se registran con motivo en el backend. Los envíos del emisor se registran con resultado. |
| Entregables académicos | ✅ | ✅ | Agrega un proveedor y un tipo de alerta, sin cambiar las entidades del DER aprobado. Si el DER enumera tipos de alerta, sumar `SPEEDING` con el proceso académico (ver Assumptions). |

**Gate**: pasa, con un desvío del Principio VI justificado abajo.

## Project Structure

### Documentation (this feature)

```text
specs/015-samsara-webhook-exceso-velocidad/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── samsara-webhook-http.md
│   ├── samsara-eventos-consulta-http.md
│   ├── simulacion-samsara-avisos.md
│   └── alertas-conduccion-http.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code

```text
AgroLinkIngestaAdaptacion/                          # este repo
├── deploy/migrations/009_add_evento_samsara.sql    # hypertable + índices + grants
├── deploy/.env.example                             # + SAMSARA_* del emisor
├── deploy/compose.yaml                             # + env SAMSARA_* en simulador-viajes
├── src/main/java/ar/utn/agrolink/ingesta/
│   ├── config/PuertoAccesoFilter.java              # + prefijo /api/v1/proveedores/samsara/
│   ├── samsara/                                    # NUEVO
│   │   ├── EventoSamsara.java                      # @Immutable
│   │   ├── EventoSamsaraRepository.java            # insert ON CONFLICT + consulta por cursor
│   │   ├── ExtractorEventoSamsara.java             # JSON → campos de consulta (Principio VIII)
│   │   ├── SamsaraWebhookController.java           # POST /webhook, GET /eventos
│   │   ├── SamsaraEventoService.java
│   │   └── EventoSamsaraDto.java
│   └── viajeprogramado/
│       ├── ViajeProgramadoController.java          # despacho Samsara + mapeo /detencion
│       ├── VehiculosSamsaraSimulados.java          # NUEVO: lista cerrada
│       ├── AvisoViajeSamsaraService.java           # NUEVO
│       └── SimuladorSamsaraClient.java             # NUEVO
├── src/test/java/…                                 # tests de lo anterior
└── simulador-viajes/
    ├── src/samsara/                                # NUEVO
    │   ├── vehiculosSamsara.js
    │   ├── modeloVelocidad.js                      # puro, rng inyectable (D-07)
    │   ├── detectorExceso.js                       # puro (D-08)
    │   ├── payloadSamsara.js                       # puro
    │   ├── webhookClient.js                        # fetch + timeout
    │   └── emisorSamsara.js                        # estado, ciclo, avisos
    ├── src/http/rutaHttpServer.js                  # + POST /samsara/viajes[/:tripCode/detencion]
    ├── src/config.js                               # + bloque samsara validado
    ├── src/index.js                                # arranca el emisor si está habilitado
    └── test/samsara/*.test.js

AgroLinkBackend/src/main/java/org/example/agrolink/
├── telemetry/adapter/SamsaraTelemetryAdapter.java  # ELIMINADO (D-15)
├── telemetry/samsara/                              # NUEVO
│   ├── IngestaSamsaraEventosClient.java
│   ├── SamsaraEventosSyncScheduler.java
│   ├── SamsaraEventosSyncService.java
│   ├── SamsaraSpeedingEventAdapter.java
│   ├── ProviderEventCursor.java / …Repository.java
│   └── dto/EventoSamsaraResponse.java
├── drivingevent/                                   # NUEVO
│   ├── DrivingEvent.java
│   ├── SpeedingEpisode.java / SpeedingEpisodeRepository.java
│   └── SpeedingEpisodeService.java
├── alert/                                          # Alert(+SPEEDING, +speedingEpisode), AlertDto(+speeding),
│                                                   # AlertService(+open/closeSpeedingAlert), AlertController(+/driving),
│                                                   # SseAlertPublisher(+publishDriving)
├── notification/push/AlertPushNotifier.java        # + caso SPEEDING
├── common/bootstrap/AlertTypeCheckSchemaFix.java   # NUEVO (D-14)
├── common/bootstrap/LocalDataSeeder.java           # SAMSARA ACTIVE + AGL007/AGL008
├── trip/TripService.java                           # publica también para Samsara
└── trip/simulacion/                                # SimulatedDeviceRegistry(+Samsara), Listener(sin ruta p/ Samsara)

AgroLinkBackend/specs/026-simulacion-al-iniciar-viaje/contracts/ingesta-simulacion-http.md  # delta v2.1

AgroLink/src/
├── services/thermalAlertService.ts                 # + 'SPEEDING', SpeedingInfo, getDrivingAlerts
├── hooks/useDrivingAlerts.ts                       # NUEVO
├── components/alertas/ThermalAlertTable.tsx        # + category 'SPEEDING'
└── app/admin/alertas/page.tsx                      # + pestaña y KPI Conducción
```

**Structure Decision**: la spec y el plan quedan en este repo, porque el emisor y el
almacenamiento viven acá. Los cambios de AgroLinkBackend y del frontend se implementan en sus
repos referenciando este plan. El único artefacto que se edita fuera de este repo antes de
implementar es el delta v2.1 del contrato 026, que es la fuente de verdad del aviso de viaje.

## Orden de implementación sugerido

1. **Ingesta, almacenamiento y API**: migración, webhook y consulta. Se valida solo con `curl`
   (quickstart §1–2).
2. **Backend, consumo y alertas**: adaptador, episodios, cursor, alertas y seeder. Depende de 1.
3. **Frontend**: pestaña y KPI. Depende del contrato de alertas, se puede hacer con MSW en
   paralelo a 2.
4. **Emisor y avisos de viaje**: el simulador, el despacho en ingesta y el listener del backend.
   Completa la demo (quickstart §3).

Desplegar en el orden ingesta/simulador → backend → frontend, igual que en 026 §7.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principio VI: `POST /api/v1/proveedores/samsara/webhook` y `GET …/eventos` sin autenticación ni verificación de firma, en el puerto publicado de `agrolink-ingesta`. | Decisión explícita del usuario para la POC (clarify 2026-11-03). La demo se valida solo con el emisor simulado, no con una cuenta Samsara real. | Validar la firma HMAC de Samsara fue descartado por plazo. **Controles compensatorios**: (a) el filtro de puertos expone solo los prefijos `/api/v1/vehiculos/` y `/api/v1/proveedores/samsara/`, con base de datos y demás rutas fuera de alcance; (b) el webhook solo inserta en una tabla insert-only aislada, sin poder modificar ni borrar nada; (c) en el peor caso, un payload malicioso genera una alerta falsa visible solo para el tenant dueño del vehículo emparejado; (d) la consulta expone solo eventos de exceso, sin datos personales. **Deuda**: verificar `X-Samsara-Signature` y autenticar la consulta antes de conectar una cuenta Samsara real. |
| Una segunda lista cerrada de dispositivos, replicada en los tres componentes. | Las listas deben ser disjuntas y no divergir en silencio (D-12). | Externalizar a configuración, rechazado por el mismo motivo que en 019 D6. Se agregan tests de disjunción en cada repo. |

## Assumptions de implementación

- La feature 014 (detención Rinho en ingesta) sigue sin implementar. Esta feature agrega el mapeo
  `/detencion` solo con la rama Samsara (D-10). Si 014 se implementa antes, se integra en su
  servicio en lugar de responder `404`.
- El nombre real de la restricción CHECK de `alerts.type` se confirma contra una base local antes
  de escribir D-14.
- Si el DER aprobado enumera los tipos de alerta, agregar `SPEEDING` se registra según la sección
  "Alineación con Entregables Académicos" de la constitución.
