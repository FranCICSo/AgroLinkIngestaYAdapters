<!--
COPIA de AgroLinkBackend/specs/026-simulacion-al-iniciar-viaje/contracts/ingesta-simulacion-http.md
(v2.0.0, 2026-10-21). Ese archivo es la fuente única de verdad: no editar acá sin cambiarlo
primero allá. Cómo lo implementa este repo: ../research.md D-01…D-12 y ../data-model.md.
-->

# Contract: AgroLinkBackend → agrolink-ingesta — simulación de viajes (inicio y detención)

**Status**: Normativo — **fuente única de verdad** del contrato HTTP entre AgroLinkBackend
(llamador) y `agrolink-ingesta` (receptor). El plan de
`AgroLinkIngestaAdaptacion/specs/014-simulacion-ruta-del-viaje` copia este archivo sin
reinterpretarlo; cualquier cambio se hace aquí primero y se replica allá en el mismo cambio.

**Version**: 2.0.0 (reemplaza `AgroLinkIngestaAdaptacion/specs/013-autostart-simulacion-viaje/contracts/viajes-simulados-http-api.md`, v1)

**Date**: 2026-10-21

**Specs**: llamador `AgroLinkBackend/specs/026-simulacion-al-iniciar-viaje/spec.md`
(FR-006…FR-016); receptor `AgroLinkIngestaAdaptacion/specs/014-simulacion-ruta-del-viaje/spec.md`
(FR-001…FR-019).

---

## 0. Resumen de cambios respecto de v1 (013/019)

| v1 (modo programado) | v2 (este contrato) |
|---|---|
| `POST …/viajes-simulados` al **crear** el viaje, con horario estimado futuro; la simulación esperaba ese horario | `POST …/viajes-simulados` al **iniciar** el viaje (`DESPACHADO → EN_ROUTE`); arranca de inmediato |
| `PUT …/viajes-simulados/{tripCode}` (reprogramación) | **Eliminado** — el receptor responde `404`/`405` |
| `DELETE …/viajes-simulados/{tripCode}` (cancelar planificación `PENDIENTE`) | **Eliminado** — reemplazado por `POST …/{tripCode}/detencion` |
| Solo `origen`/`destino` | + `polyline` y `velocidadesKmh` opcionales |
| — | Detención idempotente de una simulación en curso |

## 1. Transporte

- Base: `agrolink-ingesta`, puerto `vehiculo-estado.http-port` (default 8082), prefijo
  `/api/v1/vehiculos/{dispositivoId}/**`, ya permitido por `PuertoAccesoFilter`. Sin cambios de
  autenticación respecto de v1 (llamada server-to-server en la red interna).
- En AgroLinkBackend la base URL es `agrolink.telemetry.ingesta.base-url` (perfil `local`/`prod`).
- `Content-Type: application/json; charset=UTF-8` en requests con cuerpo; respuestas JSON.
- Fechas: ISO-8601 **local** sin offset (`yyyy-MM-dd'T'HH:mm:ss`), zona
  `America/Argentina/Buenos_Aires` (`TripSchedulePolicy.ZONE`), igual que v1.
- Cuerpo de error (todas las respuestas `4xx`/`5xx`):
  `{ "error": "<codigo>", "detalle": "<texto opcional>", ...campos extra por código }`.
- `{dispositivoId}` = `Vehicle.iotDeviceId`; `{tripCode}` = `Trip.tripCode` (única referencia de
  correlación, FR-016). Ambos se envían URL-encoded.

---

## 2. Aviso de inicio

`POST /api/v1/vehiculos/{dispositivoId}/viajes-simulados`

**Cuándo lo llama el backend**: una única vez por viaje, después del commit de la transición
`DESPACHADO → EN_ROUTE` de un viaje de flota propia cuyo dispositivo está en la lista cerrada de
simulados, sea iniciado por un usuario administrativo o por el chofer (FR-006). Nunca al crear,
editar, despachar, ni en `ALERTA_CRITICA → EN_ROUTE` (FR-007).

### 2.1 Request

```jsonc
{
  "tripCode": "VIAJE-AB12CD34",
  "estimatedStartDateTime": "2026-10-21T09:14:05",   // = hora REAL de inicio (Trip.actualStartDateTime)
  "origen":  { "lat": -34.64671, "lon": -58.48941 },
  "destino": { "lat": -34.60372, "lon": -58.38159 },
  "polyline": "~ps~Ed|leJ...",                        // opcional
  "velocidadesKmh": [42, 42, 57, 80, 80, 31],        // opcional; solo junto con polyline
  "odometroInicialKm": 184400                         // opcional; odómetro anclado al iniciar
}
```

| Campo | Tipo | Req. | Regla |
|---|---|---|---|
| `tripCode` | string 1..64 | sí | Código del viaje. |
| `estimatedStartDateTime` | string fecha-hora local | sí | Hora real de inicio. El nombre se conserva de v1 por compatibilidad; el receptor **no** programa con este valor: arranca de inmediato (receptor FR-001) y lo guarda solo para diagnóstico. |
| `origen`, `destino` | `{lat, lon}` | sí | `lat` ∈ [-90, 90], `lon` ∈ [-180, 180], números finitos. **Si viene `polyline`**: son exactamente el primer y el último punto de la polyline decodificada. **Si no**: las coordenadas resueltas del viaje. |
| `polyline` | string | no | Polyline codificada formato Google, **precisión 5** (1e-5 grados), orden `lat,lon`; es **byte a byte el mismo string** que `GET /api/v1/trips/{id}/route` devuelve en `polyline` al mapa. Ver límites §5. |
| `velocidadesKmh` | array de enteros | no | Presente solo si `polyline` está presente. Largo **exactamente** `nPuntos − 1` (un valor por tramo `p_i → p_{i+1}`), cada valor entero en **[25, 80]**. Ver §4. |
| `odometroInicialKm` | entero ≥ 0 (km) | no | Odómetro de partida que el backend ancló al iniciar (`Trip.odometerStartKm`). Si viene, la simulación arranca con ese valor y suma la distancia recorrida sobre él (manda sobre el último odómetro que el simulador tuviera para el camión). Si no viene, el simulador sigue desde su último odómetro. |

Campos ausentes se **omiten** (el backend no envía `null`). El receptor ignora campos
desconocidos.

### 2.2 Responses

| Status | `error` / cuerpo | Cuándo | Efecto en el receptor |
|---|---|---|---|
| `202 Accepted` | `{ "tripCode", "dispositivoId", "estado": "ARRANCADO", "trazado": "RECIBIDO" \| "PROPIO", "efecto": "ARRANCADA" }` | Inicio válido de un viaje nuevo para el dispositivo. `trazado = RECIBIDO` si usó la `polyline`; `PROPIO` si no vino `polyline` y trazó con su OSRM. | Arranca de inmediato; si el dispositivo tenía otra simulación en curso de **otro** `tripCode`, la reemplaza (nunca dos simultáneas). |
| `200 OK` | mismo cuerpo, `"efecto": "SIN_CAMBIOS"` | Inicio repetido del mismo `tripCode` + `dispositivoId` que ya está `ARRANCADO`. | Ninguno: no reinicia ni duplica (idempotente ante reintento de red). |
| `400 Bad Request` | `validacion` | Falta `tripCode`/`estimatedStartDateTime`/`origen`/`destino`, coordenadas fuera de rango, `velocidadesKmh` sin `polyline`. | Nada arranca. |
| `400 Bad Request` | `trazado_invalido` | `polyline` no decodificable, < 2 puntos, o su primer/último punto a > 500 m de `origen`/`destino`. | Nada arranca. |
| `404 Not Found` | `dispositivo_no_simulado` (+ `"dispositivoId"`) | `{dispositivoId}` fuera de la lista cerrada. | Nada. |
| `409 Conflict` | `viaje_no_modificable` (+ `"estadoActual": "DETENIDO"`) | El `tripCode` ya fue detenido (p. ej. la detención llegó antes que el inicio). | Nada: no revive un viaje cerrado. |
| `409 Conflict` | `viaje_de_otro_dispositivo` (+ `"dispositivoId"` dueño) | El `tripCode` ya está asociado a otro dispositivo. | Nada: la simulación del otro dispositivo no se toca. |
| `413 Payload Too Large` | `payload_demasiado_grande` | Se exceden los límites de §5. | Nada arranca. |
| `502 Bad Gateway` | `simulador_no_disponible` | `simulador-viajes` no respondió o falló al arrancar. | Registro del viaje en `ERROR` con detalle; sin reintento automático. Un nuevo inicio del mismo `tripCode` en `ERROR` se procesa como nuevo. |

**Velocidades inconsistentes no rechazan el aviso**: si `velocidadesKmh` tiene un largo distinto
de `nPuntos − 1` o algún valor fuera de [25, 80], el receptor arranca igual con el trazado,
descarta o acota las velocidades según su spec (receptor FR-008, tope 80 como resguardo) y lo
registra. El backend, por su parte, MUST NOT enviar velocidades inválidas (§4).

---

## 3. Aviso de detención

`POST /api/v1/vehiculos/{dispositivoId}/viajes-simulados/{tripCode}/detencion`

**Cuándo lo llama el backend**: después del commit de la transición de un viaje de flota propia con
dispositivo simulado que **había iniciado** (`EN_ROUTE`, `WAITING_DISCHARGE` o `ALERTA_CRITICA`)
hacia `CANCELLED`, o de `EN_ROUTE`/`WAITING_DISCHARGE` hacia `COMPLETED` (al finalizar el remito)
(FR-010). Nunca para viajes que no iniciaron, incluidos los cancelados o eliminados en `CREATED`/
`DESPACHADO` (FR-011).

### 3.1 Request

```jsonc
{ "motivo": "CANCELADO" }   // o "COMPLETADO"; cuerpo opcional
```

| Campo | Tipo | Req. | Regla |
|---|---|---|---|
| `motivo` | `"CANCELADO"` \| `"COMPLETADO"` | no | Solo diagnóstico (registro del receptor, FR-019). Un valor desconocido se ignora, no se rechaza. |

### 3.2 Responses

| Status | Cuerpo | Cuándo | Efecto |
|---|---|---|---|
| `200 OK` | `{ "tripCode", "dispositivoId", "estado": "DETENIDO", "efecto": "DETENIDA" }` | Había una simulación en curso (en movimiento o esperando en destino) de **ese** `tripCode` en **ese** dispositivo. | Deja de avanzar y de emitir lecturas de ese viaje dentro del siguiente ciclo (≤ 2 min). |
| `200 OK` | mismo cuerpo, `"efecto": "SIN_SIMULACION_EN_CURSO"` | No hay simulación en curso de ese viaje: ya se detuvo, nunca arrancó, falló al arrancar, fue reemplazada por un viaje más nuevo del dispositivo, o el `tripCode` es desconocido. | Ninguno sobre simulaciones. El receptor deja el `tripCode` registrado como `DETENIDO` para rechazar un inicio tardío (§2.2 `409`). |
| `404 Not Found` | `dispositivo_no_simulado` | `{dispositivoId}` fuera de la lista cerrada. | Nada. |
| `409 Conflict` | `viaje_de_otro_dispositivo` | El `tripCode` está asociado a otro dispositivo. | Nada: la simulación del otro dispositivo no se toca. |
| `502 Bad Gateway` | `simulador_no_disponible` | Había simulación en curso pero `simulador-viajes` no pudo detenerla. | Registro con detalle; sin reintento automático. |

**Idempotencia**: scoped por (`dispositivoId`, `tripCode`). Repetir la detención MUST devolver
`200` (`SIN_SIMULACION_EN_CURSO` a partir de la segunda) y MUST NOT afectar la simulación de un
viaje más nuevo del mismo dispositivo ni la de otro dispositivo.

---

## 4. Semántica de la ruta y de las velocidades (regla compartida)

Esta sección es la regla única mapa/simulador (spec 026 FR-001a/FR-001b, Clarifications; receptor
FR-007/FR-008). Si cambia, cambia en ambos repos a la vez.

Sea `P = [p_0 … p_{n-1}]` la polyline decodificada (precisión 5) y `osrmSpeed_i` la velocidad
OSRM del tramo `i` (`annotations=speed`, m/s):

```
v_i       = round( clamp( osrmSpeed_i × 3.6 , 25 , 80 ) )        // entero km/h  → velocidadesKmh[i]
d_i       = haversine(p_i, p_{i+1}) con R = 6371 km               // km
T_plan    = Σ_{i=0}^{n-2} d_i / v_i   (horas)                      // duración planificada
```

- **Tope 80 km/h**: único, sin clasificar urbano/ruta. Ningún valor enviado supera 80.
- **Piso 25 km/h**: igual al piso de velocidad objetivo del simulador; garantiza que el simulador
  pueda reproducir `T_plan` (un tramo planificado por debajo de 25 sería recorrido más rápido).
- `T_plan × 60` (redondeado a 0.1) es el `durationMinutes` que el backend muestra en el mapa.
- **Obligación del receptor** (para SC-007 / receptor SC-006): recorrer cada tramo `i` a una
  velocidad media de `v_i` (la variación verosímil de 012 debe ser de media cero dentro de
  [25, 80]) y no perder el remanente de distancia entre ciclos, de modo que el tiempo desde el
  inicio hasta la llegada a destino difiera de `T_plan` en menos del 10%. Al llegar, el camión
  queda detenido en `p_{n-1}` emitiendo velocidad 0 hasta la detención, sin viaje de vuelta.
- **Sin `polyline`**: el receptor traza con su OSRM y aplica la misma regla con sus propias
  velocidades (receptor FR-008a); la coincidencia con el mapa no está garantizada.

### Ejemplo verificable

`P = [(-34.60000,-58.40000), (-34.60000,-58.39000), (-34.59000,-58.39000)]`,
`osrmSpeed = [5.0, 30.0]` m/s → `velocidadesKmh = [25, 80]` (18 → 25 por piso; 108 → 80 por tope).
`d_0 ≈ 0.9153 km`, `d_1 ≈ 1.1119 km` → `T_plan ≈ 0.9153/25 + 1.1119/80 = 0.05051 h` → `durationMinutes = 3.0`.

---

## 5. Límites de tamaño

| Límite | Valor | Lado que lo garantiza |
|---|---|---|
| Puntos de la polyline decodificada | 2 ≤ n ≤ **100 000** | Backend no envía más; receptor responde `413` si se excede. |
| Largo de `polyline` | ≤ **1 000 000** caracteres | Ídem. |
| Largo de `velocidadesKmh` | `n − 1` (≤ 99 999) | Ídem. |
| Cuerpo HTTP | El receptor MUST aceptar cuerpos de hasta **2 MiB** (incluido el reenvío `agrolink-ingesta → simulador-viajes`). | Receptor. |

Si la ruta planificada excede los límites, el backend la conserva para el mapa pero envía el
inicio **sin** `polyline`/`velocidadesKmh` (solo coordenadas) y registra una advertencia. El
backend no simplifica la geometría (dejaría de ser la del mapa).

Referencia de tamaño: Buenos Aires → Mendoza (~1 050 km) ≈ 15–25 k puntos ≈ 150 KB de polyline +
~80 KB de velocidades.

---

## 6. Garantías y manejo del lado del llamador (AgroLinkBackend)

- Ambas llamadas salen de un listener `@Async` posterior al commit: nunca bloquean, demoran ni
  revierten la transición (FR-014). Timeouts: 3 s conexión, 5 s lectura.
- Sin reintentos automáticos ni cola (FR-015). Un timeout de lectura se registra como "resultado
  desconocido" (el receptor pudo haber arrancado/detenido).
- Registro por resultado (siempre con `tripCode` + `iotDeviceId`):

| Resultado | Nivel de log |
|---|---|
| `202` / `200 SIN_CAMBIOS` en inicio | `INFO` (incluye `trazado`) |
| `200 DETENIDA` / `200 SIN_SIMULACION_EN_CURSO` en detención | `INFO` — `SIN_SIMULACION_EN_CURSO` es resultado válido, **no** error (FR-012) |
| Cualquier `4xx`/`5xx` | `WARN` con status y `error` del cuerpo |
| Error de red / timeout | `WARN` |

- El receptor puede recibir inicio y detención del mismo viaje en cualquier orden (salen fuera de
  la transacción); el llamador no los reordena.

## 7. Despliegue

Desplegar primero `agrolink-ingesta`/`simulador-viajes` con v2 y luego AgroLinkBackend. Mientras
convivan versiones distintas, las respuestas `404`/`405` solo se registran; ningún viaje se ve
afectado.
