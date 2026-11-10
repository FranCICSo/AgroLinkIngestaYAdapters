# Research: Sobretemperatura de motor simulada y alerta de mantenimiento

**Feature**: `016-alerta-temperatura-motor` | **Fecha**: 2026-11-10

Relevamiento hecho sobre el código de los tres repos (`AgroLinkIngestaAdaptacion`,
`AgroLinkBackend`, `AgroLink`) en la rama `feature/engine-temperature-alerts`. Los umbrales por
defecto salen de la investigación documentada en spec.md § Contexto.

---

## D-01 — Modelo de temperatura del refrigerante en el simulador

**Decisión**: módulo de dominio nuevo `simulador-viajes/src/domain/sintesisTemperaturaMotor.js`,
puro (sin I/O), con una función `sintetizarTemperaturaMotor({ temperaturaAnterior, ralenti, modo,
config, rng })` y tres modos:

| Modo | Comportamiento por trama |
|---|---|
| `normal` | Se acerca al objetivo (88 °C en marcha, 84 °C en ralentí) recuperando ~30 % de la diferencia, con ruido de ±0,5 °C, acotado a [80, 95] °C. Sin dato previo, arranca en el objetivo. |
| `sobrecalentamiento` | `anterior + subidaCPorTrama` (2 °C por defecto) hasta `picoC` (115 °C). En el pico oscila ±0,5 °C. |
| `enfriamiento` | Fuera de falla pero por encima de 95 °C: baja `3 °C` por trama hasta volver a la banda normal. Después pasa a `normal`. |

El valor se redondea a entero antes de construir la trama: la ingesta lo guarda como `SMALLINT` y
lo expone como `Integer` (`CanBusDto.temperaturaRefrigeranteC`). Una precisión de 1 °C alcanza
(spec, Assumptions).

**Por qué**: es el mismo patrón que `sintesisBle.js` (modos + temperatura anterior en memoria),
así que se testea igual y sin base. El enfriamiento es más rápido que la subida para que la alerta
se resuelva sola en ~6 tramas desde el pico (115 → < 100 °C), dentro de SC-005 (< 15 min).

**Tiempos con la configuración por defecto** (ciclo de 60 s, desde ≤ 95 °C): 105 °C en ≤ 6 tramas
desde el tope de la banda y en ≤ 9 desde el objetivo de 88 °C; 110 °C en ≤ 11 tramas; pico en
≤ 14 tramas. Cumple los escenarios 3 de la Historia 2 y SC-001.

**Alternativas descartadas**: curva exponencial hacia el pico (más realista, pero hace menos obvio
el cálculo de tiempos de SC-001); meter el cálculo en `sintesisCan.js` (ese módulo no tiene estado
entre tramas y mezclaría responsabilidades).

## D-02 — Dónde vive la marca de la falla

**Decisión**: columnas nuevas en `simulador.viaje` (migración `010_add_falla_motor_viaje.sql`,
reflejada también en `deploy/db/03-schema-simulador.sql` para volúmenes nuevos). Son
independientes de `falla_tipo`/`falla_indice_disparo` (FR-004). La temperatura en sí queda en
memoria (`estadoPorCamion`, igual que la temperatura BLE y el combustible). Detalle en
data-model.md §1.

**Por qué**:
- La activación manual llega por HTTP a un proceso cuyo loop relee `simulador.viaje` en cada ciclo
  (research.md D-04 de la feature 009). Persistir la marca ahí hace que el loop la vea sin
  compartir estado en memoria entre el servidor HTTP y el ciclo, y que sobreviva a un reinicio
  (spec, Edge Cases).
- `falla_tipo` admite un solo valor con `CHECK`. Ampliarlo impediría tener falla de carga y de
  motor a la vez.

**Alternativas descartadas**: estado solo en memoria (se pierde al reiniciar y el sorteo se
repetiría); tabla aparte `simulador.falla_motor` (un join más para un dato 1:1 con el viaje).

## D-03 — Sorteo por viaje (5 %)

**Decisión**: función pura `sortearFallaMotor({ cantidadPuntos, probabilidadPct, duracionMinMin,
duracionMaxMin, rng })` en `src/domain/fallaMotor.js`. Devuelve `null` o
`{ origen: 'azar', indiceDisparo, duracionMin }`:

- `indiceDisparo` uniforme entre el 10 % y el 70 % de los puntos de la ruta. Así nunca arranca en
  el primer punto ni tan al final que el viaje termine antes de mostrar la alerta.
- `duracionMin` uniforme entera en `[duracionMinMin, duracionMaxMin]`.

Se llama en **los dos** puntos donde nace un viaje: `insertarViaje` (camino de
`iniciarViajeService`, usado por `POST /rutas` y por el autostart de la feature 013) y
`finalizarYCrearVuelta` (vuelta automática, FR-008). El repositorio recibe el resultado ya
sorteado: el `rng` se inyecta para tener tests deterministas (mismo criterio que
`test/samsara/rngSembrado.js`).

**Por qué**: un solo lugar de decisión, testeable estadísticamente (escenario 8 de la Historia 2:
200 viajes → entre 4 y 18 con falla).

**Fuera de alcance**: los viajes cargados a mano por SQL o por los seeds de `deploy/seed/` no se
sortean.

## D-04 — Endpoint manual

**Decisión**: tres rutas nuevas en el servidor HTTP interno existente (`rutaHttpServer.js`, se
levanta con `PUERTO_HTTP`):

- `POST   /camiones/{camionId}/falla-motor`: activa (origen `manual`).
- `DELETE /camiones/{camionId}/falla-motor`: desactiva.
- `GET    /camiones/{camionId}/falla-motor`: estado actual y última temperatura emitida (ayuda
  en la demo).

Contrato en `contracts/simulador-falla-motor-http.md`. El despacho se extrae a un módulo
`src/http/fallaMotorHandler.js` para no seguir creciendo el `if` de `crearRutaHttpServer`.

**Por qué**: es el mismo servidor y la misma postura de red que ya aceptó la feature 011 (D-04):
el puerto no se publica en `compose.yaml` y solo es alcanzable dentro de la red de Docker, sin
autenticación (spec, Clarifications). Se identifica al camión por su `dispositivoId` (`900xxx`),
que es lo que el simulador conoce.

**Idempotencia**: activar una falla ya activa responde 200 `YA_ACTIVA` sin tocar nada. Desactivar
una inactiva responde 200 `YA_INACTIVA`. Una falla al azar todavía pendiente (aún no llegó a su
índice) cuenta como inactiva: el `POST` la reemplaza por una manual inmediata y el `DELETE` la
cancela.

## D-05 — `curl` dentro del contenedor

**Decisión**: `RUN apk add --no-cache curl` en `simulador-viajes/Dockerfile`, antes de
`USER simulador`.

**Por qué**: `node:22-alpine` solo trae el `wget` de busybox, y el usuario pidió explícitamente
`curl` (FR-003b). Suma ~1 MB a la imagen.

## D-06 — Configuración del simulador

**Decisión**: `loadMotorConfig(env)` en `src/config.js`, siempre validada (a diferencia de
Samsara, que solo se valida si está habilitado), porque la temperatura normal se emite siempre:

| Variable | Default | Validación |
|---|---|---|
| `MOTOR_FALLA_PROBABILIDAD_PCT` | `5` | 0 ≤ x ≤ 100 |
| `MOTOR_FALLA_DURACION_MIN_MIN` | `20` | entero > 0 |
| `MOTOR_FALLA_DURACION_MAX_MIN` | `40` | entero ≥ mínimo |
| `MOTOR_SUBIDA_C_POR_TRAMA` | `2` | > 0 |
| `MOTOR_PICO_C` | `115` | > 105 |

Se agregan a `deploy/.env.example` y al bloque `environment:` de `simulador-viajes` en
`deploy/compose.yaml`.

**Nota**: la subida es **por trama**. Si alguien baja `SIMULADOR_CICLO_MS`, la falla sube más rápido
en tiempo de reloj. La duración, en cambio, se mide en minutos de reloj (desde
`falla_motor_activada_en`). Se documenta en el README del simulador.

## D-07 — Dónde evalúa el backend la temperatura del motor

**Decisión**: servicio nuevo `EngineOverheatAlertService` (paquete
`org.example.agrolink.alert.engine`), invocado desde `BleTemperatureTelemetrySyncService.syncVehicle`
con `canBus.temperaturaRefrigeranteC` y `dispositivo.momentoEvento` de la respuesta `/estado` que
ese servicio **ya** obtiene cada 60 s para todos los vehículos activos con dispositivo IoT.

La llamada se hace **antes** del `return false` temprano de "sin posición ni temperatura", y
dentro de su propio `try/catch`. Así una falla al evaluar el motor no cancela la sincronización de
posición y temperatura de carga, ni al revés.

**Por qué**: reutiliza el único poll que ya trae ese dato (Principio III: sin canales nuevos). Un
scheduler aparte duplicaría las llamadas a ingesta.

**Alternativa descartada**: evaluar dentro de `MaintenanceAlertScheduler` (corre cada 24 h).

## D-08 — Corrección del reemplazo de temperatura de carga (FR-012)

**Decisión**: `BleTemperatureTelemetrySyncService.resolveTemperature` devuelve solo
`canBus.bleTemperaturaC`. Se elimina el reemplazo por `temperaturaRefrigeranteC` y se corrige el
Javadoc ("the CAN-bus refrigeration field is only a fallback"), que confundía el refrigerante del
motor con la refrigeración de la carga. Se actualiza el test existente que cubría ese reemplazo.

**Impacto**: un vehículo con sensor de frío cuya lectura no trae BLE ya no evalúa alerta térmica
en ese ciclo (Historia 3). Con posición válida, la lectura normalizada se sigue guardando con
`temperature = 0.0`, igual que hoy para vehículos sin sensor.

## D-09 — Modelo de la alerta

**Decisión**: se reutiliza `Alert` con `type = MAINTENANCE`, más:

- `maintenanceKind` (enum nuevo `MaintenanceAlertKind`, nullable): solo `ENGINE_OVERHEAT` en esta
  feature. `null` = alertas de mantenimiento existentes (work item o RTO), sin migrar datos.
- `assetType = TRUCK`, `assetId = vehicle.id`, `maintenanceWorkItemId = null`.
- Columnas nuevas `engine_vehicle_plate`, `engine_peak_temp_c`, `engine_last_temp_c`, `engine_last_reading_at`.

Esquema por `ddl-auto: update` (las columnas nuevas son nullable). El `CHECK` de `alerts.type` no
cambia (`MAINTENANCE` ya existe). Detalle en data-model.md §2.

**Por qué no la convención de ids negativos del RTO** (`maintenanceWorkItemId = -vehicleId`):
colisiona con el RTO del mismo camión, y la deduplicación de `triggerMaintenanceAlert` resolvería
o bloquearía la alerta equivocada. Un discriminador explícito es más claro y no toca el flujo
existente.

**Por qué no un `AlertType` nuevo**: el usuario pidió una alerta **de mantenimiento**, y así la
nueva alerta entra sola en `/alerts/maintenance/active`, en el SSE `maintenance-alert`, en la
pestaña Mantenimiento y en las métricas del panel.

## D-10 — Máquina de estados y tolerancia a re-lecturas

**Decisión**: evaluación idempotente por lectura (detalle en data-model.md §3):

1. Valor `null` o fuera de `[valid-min-c, valid-max-c]` (−40 / 150 por defecto): log `WARN` con
   vehículo y valor (Principio IX) y no cambia nada.
2. Si hay alerta abierta y `momentoEvento <= engine_last_reading_at`: se ignora. Es la misma
   lectura vista de nuevo (el poll relee la última lectura si el dispositivo no reportó) o una
   tardía (Principio VII).
3. Sin alerta abierta y `t >= warning`: crea con severidad `WARNING`, o `CRITICAL` si
   `t >= critical`.
4. Con alerta abierta: actualiza `engine_last_*` y `engine_peak = max(...)`. Si `t >= critical` y
   está en `WARNING`, escala a `CRITICAL` (nunca baja de severidad). Si `t < warning − margin`,
   resuelve.

"Abierta" = `ACTIVE` o `ACKNOWLEDGED` (Historia 1, escenario 8). La búsqueda es por
`(tenant, MAINTENANCE, ENGINE_OVERHEAT, TRUCK, vehicleId, status ∈ {ACTIVE, ACKNOWLEDGED})`.

**Concurrencia**: el poll es un único `@Scheduled` (`fixedRate` sin solapamiento por defecto) y
procesa los vehículos en secuencia, así que no hay dos evaluaciones del mismo vehículo a la vez.
No hace falta un lock.

## D-11 — Notificación en tiempo real y aislamiento por empresa

**Hallazgo**: `SseAlertPublisher.publishMaintenance` hoy hace `broadcastEventToAll`: manda las
alertas de mantenimiento a **todas** las empresas conectadas. Eso contradice FR-016 (cada empresa
ve solo sus vehículos).

**Decisión**: `publishMaintenance(Long tenantId, AlertResponse)` usa `broadcastEvent` con el
tenant. Con `tenantId == null` (RTO de acoplados, que no tienen tenant) mantiene el broadcast
global de hoy. Se actualizan los dos llamadores existentes (`triggerMaintenanceAlert` y la nueva
alerta).

Se publica `maintenance-alert` en: creación, escalado a crítica y resolución automática. Las
actualizaciones de pico **no** se publican: el hook del front reproduce sonido con cada evento
`ACTIVE`, y publicar cada minuto sería ruido. La push (`notifyPush`) solo sale en creación y en
escalado.

## D-12 — Configuración del backend

**Decisión**: `@ConfigurationProperties("agrolink.alert.engine-temperature")` validado al arrancar
(el contexto falla si no cumple):

| Propiedad | Env | Default | Regla |
|---|---|---|---|
| `warning-c` | `AGROLINK_ALERT_ENGINE_TEMP_WARNING_C` | 105 | > `valid-min-c` |
| `critical-c` | `AGROLINK_ALERT_ENGINE_TEMP_CRITICAL_C` | 110 | > `warning-c` |
| `recovery-margin-c` | `AGROLINK_ALERT_ENGINE_TEMP_RECOVERY_MARGIN_C` | 5 | 0 ≤ x ≤ 20 |
| `valid-min-c` | `AGROLINK_ALERT_ENGINE_TEMP_VALID_MIN_C` | −40 | < `warning-c` |
| `valid-max-c` | `AGROLINK_ALERT_ENGINE_TEMP_VALID_MAX_C` | 150 | > `critical-c` |
| `enabled` | `AGROLINK_ALERT_ENGINE_TEMP_ENABLED` | true | — |

El tope de 20 °C del margen implementa el edge case "margen mayor a la distancia entre la
normalidad y el umbral": con 105 °C y 20 °C, la alerta se resuelve recién debajo de 85 °C, en
plena banda normal.

## D-13 — Frontend

**Decisión**: sin pantallas nuevas. Se extiende lo existente:

- `services/thermalAlertService.ts`: `ThermalAlert` suma `maintenanceKind?: 'ENGINE_OVERHEAT' |
  null` y `engine?: EngineOverheatInfo | null`.
- `components/alertas/ThermalAlertTable.tsx`, filas con `maintenanceKind === 'ENGINE_OVERHEAT'`:
  - rótulo "Sobretemperatura de motor";
  - columna "Activo / Ref": patente y link al viaje;
  - pico en °C;
  - severidad con rótulos propios ("Riesgo de detención" / "Detención inminente");
  - hora de resolución si viene `RESOLVED`.
- El buscador de la pestaña Mantenimiento también filtra por la patente de `engine`.
- `hooks/useMaintenanceAlerts.ts` ya reemplaza por `id` al recibir un evento: el escalado se ve sin
  recargar (FR-019). No necesita cambios funcionales.
- "Ir a Cola de Mantenimiento" es un link de sección, no de fila. Ninguna acción por fila apunta a
  un work item, así que FR-020 se cumple sin tocarlo. Se verifica que la fila nueva no agregue ese
  link.

**Limitación existente que se mantiene**: `/alerts/maintenance/active` devuelve solo `ACTIVE`. Una
alerta reconocida o resuelta se ve en su pestaña durante la sesión (por SSE), pero desaparece al
recargar. Pasa lo mismo con el resto de las alertas de mantenimiento. Cambiarlo queda fuera de
alcance.

## D-14 — Ingesta y receptor

**Decisión**: sin cambios de código. El receptor mapea el campo CAN `2A` a
`temperatura_refrigerante_c` (`lecturaMapper.resolveTemperaturaRefrigerante`, con tests de campo
faltante e inválido) y `agrolink-ingesta` lo expone en `canBus.temperaturaRefrigeranteC`. FR-009
se cubre con un test del `frameBuilder` del simulador (el valor viaja en `2A`) y con la
verificación de punta a punta del quickstart.

## D-15 — Nivel de combustible y recargas (ampliación)

**Decisión**: en `sintesisCan.js`, el nivel baja `COMBUSTIBLE_PCT_POR_KM` (0,05) por km. Si la
trama anterior quedó debajo de `COMBUSTIBLE_RECARGA_DEBAJO_PCT` (7), la actual parte de 100 %. Sin
nivel anterior, se sortea uno uniforme entre el umbral y 100 %. Se quita el piso fijo de 5 %. El
nivel sigue en memoria (`estadoPorCamion`), sin columnas nuevas.

**Rationale**: 0,05 %/km con 0,35 l/km equivale a un tanque de unos 700 l (dos tanques de camión
pesado), así que el ritmo por defecto se mantiene. La trama que cruza el umbral informa el valor
bajo (por ejemplo 6,98) para que el dato se vea en la serie; la recarga ocurre "entre tramas". El
nivel inicial al azar evita que toda la flota baje pareja y hace que algunos camiones recarguen en
los primeros viajes. Para una demo se sube el ritmo por variable de entorno.

**Ingesta**: el reporte de viaje calculaba `primera − última`, que con una recarga en el rango da
negativo (spec 001 lo aceptaba porque no había recargas). Pasa a ser la suma de bajadas entre
lecturas consecutivas. Sin recargas, el resultado es idéntico. Se actualizó
`specs/001-ingesta-adaptacion-telemetria/data-model.md`. Esto corrige D-14: la ingesta sí cambia,
aunque solo por el combustible.

**Alternativas descartadas**: ruido de lectura (oleaje del tanque), porque haría que la suma de
bajadas cuente consumo de más; persistir el nivel en `simulador.viaje`, porque el combustible es
del camión, no del viaje, y el alcance en memoria ya estaba aceptado; consumo en ralentí, porque con
tramas de 60 s es menor a la resolución del dato (0,01 %).
