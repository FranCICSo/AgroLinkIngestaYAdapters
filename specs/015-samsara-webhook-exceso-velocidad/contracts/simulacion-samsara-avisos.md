# Contract: avisos de viaje para vehículos Samsara simulados

**Feature**: `015-samsara-webhook-exceso-velocidad` | **Date**: 2026-11-04

Camino: AgroLinkBackend → `agrolink-ingesta` → `simulador-viajes` (emisor Samsara). Es el mismo
camino que Rinho (spec FR-021a). Este documento tiene tres partes:

1. **Delta v2.1** del contrato normativo
   `AgroLinkBackend/specs/026-simulacion-al-iniciar-viaje/contracts/ingesta-simulacion-http.md`.
   Esa sigue siendo la fuente única de verdad: el delta se aplica allá primero y se replica en la
   copia de `specs/014-simulacion-ruta-del-viaje/contracts/` en el mismo cambio.
2. El comportamiento de `agrolink-ingesta` para dispositivos Samsara.
3. El contrato interno `agrolink-ingesta` → `simulador-viajes` para Samsara (dueño: este repo).

---

## 1. Delta v2.1 sobre el contrato 026 (retrocompatible)

| Punto | v2.0.0 | v2.1.0 |
|---|---|---|
| Lista cerrada | Dispositivos Rinho simulados | + lista cerrada **disjunta** de vehículos Samsara simulados (ids de Samsara, research D-12). Ningún id puede estar en ambas. |
| §2.1 `origen`, `destino` | Obligatorios | Obligatorios para Rinho. **Se omiten** para Samsara. El receptor los ignora si vienen. |
| §2.1 `polyline`, `velocidadesKmh`, `odometroInicialKm` | Opcionales | Nunca se envían para Samsara. Se ignoran si vienen. |
| §2.2 respuestas | — | Para Samsara: `202 { tripCode, dispositivoId, estado: "ARRANCADO", efecto: "ARRANCADA" }`, `200 … "SIN_CAMBIOS"`, `502 simulador_no_disponible`. No aplican `trazado_invalido` ni `413`. |
| §3 detención | — | Para Samsara: `200 { …, estado: "DETENIDO", efecto: "DETENIDA" \| "SIN_SIMULACION_EN_CURSO" }`, `502 simulador_no_disponible`. |

Request de inicio para Samsara:

```jsonc
{ "tripCode": "VIAJE-AB12CD34", "estimatedStartDateTime": "2026-11-04T09:40:00" }
```

Del lado del llamador (§6) no cambia nada: es asíncrono, sin reintentos y con los mismos logs.

## 2. `agrolink-ingesta` — comportamiento para dispositivos Samsara

`ViajeProgramadoController` despacha antes de su lógica actual (research D-10):

| Request | `{dispositivoId}` Samsara | Cualquier otro |
|---|---|---|
| `POST /api/v1/vehiculos/{d}/viajes-simulados` | Valida que vengan `tripCode` (1..64) y `estimatedStartDateTime` (si no, `400 validacion`). Reenvía según §3.1 y traduce la respuesta. **No** persiste en `ingesta.viaje_programado`. | Sin cambios. |
| `POST /api/v1/vehiculos/{d}/viajes-simulados/{tripCode}/detencion` (**mapeo nuevo**) | Reenvía según §3.2 y traduce la respuesta. | `404 dispositivo_no_simulado`, lo mismo que el backend recibe hoy. Lo reemplaza la feature 014 al implementarse. |

`estimatedStartDateTime` es una hora local en `America/Argentina/Buenos_Aires`. Ingesta la
convierte a ISO-8601 con offset antes de reenviarla, porque el emisor la usa como `tripStartTime`
en RFC 3339.

Traducción de respuestas del simulador: `2xx` se copia, y cualquier otra respuesta, timeout o
error de red se traduce a `502 { "error": "simulador_no_disponible", "detalle": … }`.

## 3. `agrolink-ingesta` → `simulador-viajes` (interno, Samsara)

Mismo servidor HTTP que `POST /rutas` (`PUERTO_HTTP`, sin `ports:` publicados). JSON.

### 3.1 `POST /samsara/viajes`

```jsonc
{ "vehiculoId": "281474977000101", "tripCode": "VIAJE-AB12CD34", "inicioViaje": "2026-11-04T09:40:00-03:00" }
```

| Status | Cuerpo | Cuándo |
|---|---|---|
| `202` | `{ "vehiculoId", "tripCode", "efecto": "ARRANCADA" }` | Viaje nuevo para el vehículo. Si tenía otro `tripCode` en curso, cierra su exceso abierto (envía Ended) y lo reemplaza. |
| `200` | `{ …, "efecto": "SIN_CAMBIOS" }` | Mismo `tripCode` ya en curso. |
| `400` | `{ "error": "validacion" }` | Falta un campo o la fecha es inválida. |
| `404` | `{ "error": "vehiculo_no_samsara" }` | `vehiculoId` fuera de `vehiculosSamsara.js`. |
| `503` | `{ "error": "emisor_deshabilitado" }` | `SAMSARA_EMISOR_HABILITADO != true`. |

### 3.2 `POST /samsara/viajes/{tripCode}/detencion`

```jsonc
{ "vehiculoId": "281474977000101", "motivo": "COMPLETADO" }   // motivo opcional, solo log
```

| Status | Cuerpo | Cuándo |
|---|---|---|
| `200` | `{ "vehiculoId", "tripCode", "efecto": "DETENIDA" }` | Era el viaje en curso. Si había exceso abierto, se envía su Ended de inmediato (FR-021b), sin la mínima de 20 s. |
| `200` | `{ …, "efecto": "SIN_SIMULACION_EN_CURSO" }` | El vehículo no tenía ese `tripCode` en curso. |
| `404` | `{ "error": "vehiculo_no_samsara" }` | Vehículo fuera de la lista. |

Si el emisor está deshabilitado, la detención responde `200 SIN_SIMULACION_EN_CURSO`, porque no
puede haber nada en curso.
