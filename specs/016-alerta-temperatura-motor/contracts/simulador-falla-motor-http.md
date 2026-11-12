# Contract: simulador-viajes — activación manual del sobrecalentamiento de motor

**Feature**: `016-alerta-temperatura-motor` | **Version**: 1.0.0 | **Date**: 2026-11-10 |
**Dueño**: simulador-viajes

Rutas nuevas en el servidor HTTP interno del simulador (`rutaHttpServer.js`). Solo existe si
`PUERTO_HTTP` está definida (`SIMULADOR_PUERTO_HTTP=8090` en `deploy/.env.example`).

**Alcance de red**: el puerto **no** se publica en `deploy/compose.yaml` (research.md D-04 de la
feature 011). Se llega desde dentro del contenedor o de la red de Docker. **Sin autenticación**
(spec, Clarifications).

Uso previsto:

```sh
docker compose -f deploy/compose.yaml exec simulador-viajes \
  curl -s -X POST localhost:8090/camiones/900002/falla-motor
```

`{camionId}` es el `dispositivoId` del camión simulado (`simulador.camion.id`, rango
`900001`–`900999`). Ninguna ruta espera body. Todas responden `application/json`.

## 1. `POST /camiones/{camionId}/falla-motor`: activar

Activa una falla de origen `manual`, sin duración, sobre el viaje `en_curso` del camión. La
temperatura sube desde la trama siguiente.

| Status | Body | Cuándo |
|---|---|---|
| 200 | `{ "camionId": "900002", "viajeId": 41, "efecto": "ACTIVADA", "origen": "manual" }` | No había falla activa (ninguna, pendiente al azar o terminada) |
| 200 | `{ "camionId": "900002", "viajeId": 41, "efecto": "YA_ACTIVA", "origen": "azar" }` | Ya había una activa (manual o al azar): no cambia nada. `origen` es el de la falla vigente |
| 404 | `{ "error": "camion_no_encontrado", "detalle": "..." }` | No existe `simulador.camion` con ese id |
| 409 | `{ "error": "sin_viaje_en_curso", "detalle": "..." }` | El camión existe pero no tiene viaje `en_curso` o está inactivo |

## 2. `DELETE /camiones/{camionId}/falla-motor`: desactivar

Desactiva la falla activa o cancela una sorteada que todavía no se disparó. La temperatura baja
gradualmente en las tramas siguientes (FR-006).

| Status | Body | Cuándo |
|---|---|---|
| 200 | `{ "camionId": "900002", "viajeId": 41, "efecto": "DESACTIVADA" }` | Había una activa o pendiente |
| 200 | `{ "camionId": "900002", "viajeId": 41, "efecto": "YA_INACTIVA" }` | No había ninguna o ya terminó |
| 404 / 409 | Igual que en §1 | |

## 3. `GET /camiones/{camionId}/falla-motor`: consultar

```json
{
  "camionId": "900002",
  "viajeId": 41,
  "estado": "activa",
  "origen": "azar",
  "indiceDisparo": 37,
  "duracionMin": 28,
  "activadaEn": "2026-11-10T14:02:11.000Z",
  "desactivadaEn": null,
  "terminaEn": "2026-11-10T14:30:11.000Z",
  "ultimaTemperaturaC": 109
}
```

- `estado`: `sin_falla` | `pendiente` | `activa` | `terminada` (data-model.md §1).
- `terminaEn`: solo para `azar` activada. Es `null` para `manual`.
- `ultimaTemperaturaC`: el último valor emitido en una trama, desde la memoria del proceso. Es
  `null` si este proceso todavía no emitió para el camión.
- Errores 404 / 409 igual que en §1.

## 4. Otros

- Cualquier otro método sobre `/camiones/{camionId}/falla-motor` responde 405 con
  `{ "error": "metodo_no_permitido" }`.
- Un `camionId` vacío o con caracteres fuera de `[0-9A-Za-z_-]` responde 400 con
  `{ "error": "validacion" }`.
- Las rutas existentes (`POST /rutas`, `POST /samsara/viajes[...]`) no cambian.
- Cada pedido que cambia el estado deja un log `info` con `camionId`, `viajeId`, `efecto` y
  `origen`.
