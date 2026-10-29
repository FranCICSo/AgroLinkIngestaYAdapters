# Contract: agrolink-ingesta → simulador-viajes (interno)

**Feature**: `014-simulacion-ruta-del-viaje` | **Date**: 2026-10-21 | **Dueño**: este repo

Extiende [`specs/011-generar-ruta-simulada/contracts/rutas-http-api.md`](../../011-generar-ruta-simulada/contracts/rutas-http-api.md)
(retrocompatible) y agrega la detención. Endpoints alcanzables solo dentro de la red de Docker
compose (`simulador-viajes` sin `ports:`, sin cambios). El llamador es
`SimuladorViajesClient` de `agrolink-ingesta`; AgroLinkBackend nunca lo llama directo. Cómo se
traduce cada respuesta al contrato externo: research.md D-03/D-05.

Cuerpos JSON, `Content-Type: application/json`. Cuerpo máximo aceptado: **4 MiB**; más →
`413 { "error": "payload_demasiado_grande" }` (research.md D-11).

---

## 1. `POST /rutas` (extendido)

### Request — campos nuevos

```jsonc
{
  "nombre": "Viaje VIAJE-AB12CD34 #1761048845123",   // único por intento (research.md D-06)
  "origen":  { "lat": -34.64671, "lon": -58.48941 },
  "destino": { "lat": -34.60372, "lon": -58.38159 },
  "camion":  { "id": "tra-demo-004", "odometroInicialKm": 184400 },   // odometro opcional
  "tripCode": "VIAJE-AB12CD34",                       // NUEVO, opcional; requiere camion
  "polyline": "~ps~Ed|leJ...",                        // NUEVO, opcional; reenviado sin tocar
  "velocidadesKmh": [42, 42, 57, 80, 80, 31]          // NUEVO, opcional; reenviado sin tocar
}
```

| Campo | Regla |
|---|---|
| `camion.odometroInicialKm` | Opcional, número ≥ 0 (si no, `400 validacion`). Si viene, el viaje arranca con ese odómetro en vez del último del camión. |
| `tripCode` | string 1..64. Si viene: el viaje creado guarda `trip_code` y `fin_en_destino = true` (espera en destino, sin vuelta). Sin `camion` → `400 validacion`. |
| `polyline` | Google encoded polyline, precisión 5, `lat,lon`. Si viene: **no** se consulta OSRM; `paradas` debe estar vacío (si no, `400 validacion`); se decodifica, valida y densifica. |
| `velocidadesKmh` | Un entero por tramo de la polyline decodificada (`n − 1`). Normalización: data-model.md §5 / research.md D-08. Ignorado si no hay `polyline`. |

Validación de la polyline:

| Condición | Respuesta |
|---|---|
| no decodificable (caracteres fuera de rango, secuencia truncada) | `400 { "error": "trazado_invalido", "detalle": "polyline no decodificable" }` |
| < 2 puntos | `400 trazado_invalido` |
| primer punto a > 500 m de `origen` o último a > 500 m de `destino` (haversine, R = 6 371 km) | `400 trazado_invalido` (detalle con la distancia) |
| > 100 000 puntos | `413 payload_demasiado_grande` |

Ningún camino de error persiste ruta ni viaje (mismo criterio que 011).

### Responses

Iguales a 011 (`201`, `400 validacion`, `409 nombre_duplicado`, `422 trazado_no_disponible`) más
`400 trazado_invalido` y `413 payload_demasiado_grande`. El `201` agrega:

```jsonc
{
  "id": 7, "nombre": "...", "puntos": [...], "paradas": [],
  "velocidadesKmh": [...],                 // o null
  "trazado": "RECIBIDO",                   // "RECIBIDO" si usó polyline, "PROPIO" si OSRM
  "velocidades": "RECIBIDAS",              // RECIBIDAS | ACOTADAS | DESCARTADAS | POR_DEFECTO | OSRM | null
  "viaje": { "dispositivoId": "tra-demo-004", "viajeId": 42, "rutaId": 7,
             "estado": "en_curso", "tripCode": "VIAJE-AB12CD34", "finEnDestino": true }
}
```

`agrolink-ingesta` solo lee `trazado` y `velocidades` (y el status); no necesita `puntos`.

---

## 2. `POST /viajes/detener` (nuevo)

```jsonc
{ "dispositivoId": "tra-demo-004", "tripCode": "VIAJE-AB12CD34" }
```

Efecto: `UPDATE simulador.viaje SET estado = 'finalizado' WHERE camion_id = :dispositivoId AND
trip_code = :tripCode AND estado = 'en_curso'`. Nunca toca otro `trip_code` ni otro camión
(FR-013). Idempotente.

| Status | Cuerpo | Cuándo |
|---|---|---|
| `200` | `{ "efecto": "DETENIDA", "viajeIds": [42] }` | Había un viaje `en_curso` (moviéndose o estacionado en destino) con ese `trip_code` en ese camión. |
| `200` | `{ "efecto": "SIN_SIMULACION_EN_CURSO" }` | No había ninguno (ya detenido, reemplazado por otro viaje del camión, nunca creado). |
| `400` | `{ "error": "validacion", "detalle": "..." }` | Falta `dispositivoId` o `tripCode`, o no son strings. |
| `5xx` | `{ "error": "...", "detalle": "..." }` | Error de base; `agrolink-ingesta` lo traduce a `502 simulador_no_disponible`. |

El daemon deja de emitir para ese viaje a partir del ciclo siguiente (≤ `SIMULADOR_CICLO_MS`,
60 s por defecto).

---

## 3. Otros paths/métodos

Cualquier otro método/path → `404 { "error": "no_encontrado" }` (sin cambios).
