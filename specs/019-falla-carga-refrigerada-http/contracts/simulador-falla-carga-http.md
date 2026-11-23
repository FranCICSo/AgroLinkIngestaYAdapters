# Contract: simulador-viajes — desvío térmico manual de la carga refrigerada

**Feature**: `019-falla-carga-refrigerada-http` | **Version**: 1.0.0 | **Date**: 2026-11-22 |
**Dueño**: simulador-viajes

Rutas nuevas en el servidor HTTP interno del simulador (`rutaHttpServer.js`), con las mismas
convenciones que `/camiones/{camionId}/falla-motor`
(`specs/016-alerta-temperatura-motor/contracts/simulador-falla-motor-http.md`). Solo existe si
`PUERTO_HTTP` está definida (`SIMULADOR_PUERTO_HTTP=8090`).

**Alcance de red**: el puerto **no** se publica en `deploy/compose.yaml`. Se llega desde dentro del
contenedor o de la red de Docker. **Sin autenticación**, igual que `falla-motor`.

Uso previsto:

```sh
docker compose -f deploy/compose.yaml exec simulador-viajes \
  curl -s -X POST 'localhost:8090/camiones/900002/falla-carga?sentido=arriba'
```

`{camionId}` es el `dispositivoId` del camión simulado (`simulador.camion.id`). Ninguna ruta espera
body. Todas responden `application/json`.

## 1. `POST /camiones/{camionId}/falla-carga[?sentido=arriba|abajo]`: activar

Activa el desvío sobre el viaje `en_curso` del camión. Desde la trama siguiente, la temperatura de
la carga se va fuera del rango: por encima del máximo (`arriba`, el default) o por debajo del mínimo
(`abajo`).

| Status | Body | Cuándo |
|---|---|---|
| 200 | `{ "camionId": "900002", "viajeId": 41, "efecto": "ACTIVADA", "sentido": "arriba", "objetivoC": 12.0 }` | No había falla de carga |
| 200 | `{ ..., "efecto": "ACTIVADA", "sentido": "arriba", "objetivoC": 12.0, "reemplaza": "falla_compresor" }` | Había una falla de carga cargada por SQL: queda reemplazada |
| 200 | `{ "camionId": "900002", "viajeId": 41, "efecto": "YA_ACTIVA", "sentido": "arriba" }` | Ya había un desvío activo: no cambia nada. `sentido` es el vigente, aunque se haya pedido otro |
| 400 | `{ "error": "validacion", "detalle": "sentido debe ser arriba o abajo" }` | `sentido` con otro valor |
| 404 | `{ "error": "camion_no_encontrado", "detalle": "..." }` | No existe el camión |
| 409 | `{ "error": "sin_viaje_en_curso", "detalle": "..." }` | El camión existe pero no tiene viaje `en_curso` o está inactivo |
| 409 | `{ "error": "sin_carga_refrigerada", "detalle": "..." }` | El camión tiene `tipo_carga = 'seca'` |

`objetivoC` es la temperatura hacia la que va la carga (data-model.md §4). Se calcula con los
umbrales del camión o, si no los tiene, con el setpoint y el margen fijo.

## 2. `DELETE /camiones/{camionId}/falla-carga`: cerrar

Cierra la falla de carga del viaje. La temperatura vuelve al rango gradualmente en las tramas
siguientes (en 1 o 2 con el rango de referencia).

| Status | Body | Cuándo |
|---|---|---|
| 200 | `{ "camionId": "900002", "viajeId": 41, "efecto": "DESACTIVADA", "tipoCerrado": "desvio_termico" }` | Había una falla de carga. `tipoCerrado` puede ser también `falla_compresor` o `apertura_puerta`, si venía de un SQL |
| 200 | `{ "camionId": "900002", "viajeId": 41, "efecto": "YA_INACTIVA" }` | No había ninguna |
| 404 / 409 | Igual que en §1 | `sin_carga_refrigerada` también aplica |

## 3. `GET /camiones/{camionId}/falla-carga`: consultar

```json
{
  "camionId": "900002",
  "viajeId": 41,
  "estado": "activo",
  "fallaTipo": "desvio_termico",
  "sentido": "arriba",
  "objetivoC": 12.0,
  "activadaEn": "2026-11-22T14:02:11.000Z",
  "desactivadaEn": null,
  "umbralMinC": 2.0,
  "umbralMaxC": 8.0,
  "setpointTempC": 5.0,
  "ultimaTemperaturaC": 11.4
}
```

- `estado`: `activo` | `otra_falla` | `inactivo` (data-model.md §1).
- `fallaTipo`: el valor vigente de `falla_tipo`, o `null`.
- `sentido` y `objetivoC`: solo con `estado = activo`. En otro caso, `null`.
- `activadaEn` / `desactivadaEn`: las del último desvío o cierre de este viaje. `null` si no hubo.
- `umbralMinC` / `umbralMaxC`: los que conoce el simulador. Son `null` si no los recibió, y entonces
  se usa el margen fijo.
- `ultimaTemperaturaC`: la última temperatura de carga emitida, desde la memoria del proceso. Es
  `null` si este proceso todavía no emitió para el camión.
- Errores 404 / 409 igual que en §1, incluido `sin_carga_refrigerada`.

## 4. Otros

- Cualquier otro método responde 405 con `{ "error": "metodo_no_permitido" }`.
- Un `camionId` vacío o con caracteres fuera de `[0-9A-Za-z_-]` responde 400 con
  `{ "error": "validacion" }`.
- Cada pedido que cambia el estado deja un log `info` con `camionId`, `viajeId`, `efecto`,
  `sentido` y `tipoCerrado` o `reemplaza` si corresponde (FR-013).
- `/camiones/{camionId}/falla-motor`, `/camiones/{camionId}/detencion`, `/rutas` y `/samsara/...`
  no cambian, salvo lo de §5.

## 5. Cambio en `POST /rutas` (bloque `camion`)

Campos nuevos, opcionales, en el bloque `camion`
(`specs/011-generar-ruta-simulada/contracts/rutas-http-api.md`):

| Campo | Tipo | Regla |
|---|---|---|
| `umbralTermicoMinC` | número | Con `tipoCarga = 'refrigerada'`. Va junto con el máximo, dentro de ±50 y ≤ máximo |
| `umbralTermicoMaxC` | número | Igual que el mínimo |

Si falta uno de los dos, está fuera de rango o el mínimo supera al máximo: `400 validacion`. Con
carga seca se ignoran.

`agrolink-ingesta` (`SimuladorViajesClient`) los manda junto con `tipoCarga` y `setpointTempC`
cuando el viaje programado tiene umbrales:

```json
{
  "nombre": "Viaje VIAJE-DD8294A5",
  "origen": { "lat": -34.6467, "lon": -58.4894 },
  "destino": { "lat": -34.6037, "lon": -58.3816 },
  "camion": {
    "id": "900002",
    "tipoCarga": "refrigerada",
    "setpointTempC": 5.0,
    "umbralTermicoMinC": 2.0,
    "umbralTermicoMaxC": 8.0
  }
}
```
