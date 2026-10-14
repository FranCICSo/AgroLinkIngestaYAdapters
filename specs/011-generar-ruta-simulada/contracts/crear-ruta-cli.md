# Contract: `npm run crear-ruta --` (simulador-viajes)

**Feature**: `011-generar-ruta-simulada` | **Date**: 2026-10-07 | **Actualizado**: 2026-10-10
(User Story 3, FR-013/FR-014: flags `--camionId` y relacionados; 2026-10-10 (2): `--camionId`
admite ids no puramente numéricos, p. ej. `tra-demo-004`)

Comando CLI equivalente al endpoint HTTP (`POST /rutas` — research.md D-05): misma validación,
mismo resultado persistido en `simulador.ruta`, para uso directo del equipo sin pasar por HTTP
(FR-007).

## Invocación

```bash
cd simulador-viajes && npm run crear-ruta -- \
  --nombre "Mercado Central → depósito X" \
  --origenLat -34.6467 --origenLon -58.4894 \
  --destinoLat -34.6037 --destinoLon -58.3816 \
  --paradas '[{"lat":-34.620,"lon":-58.430,"duracionMin":15}]'
```

`--paradas` es opcional (JSON, mismo shape que el body HTTP); si se omite, la ruta no tiene
paradas intermedias.

### Arrancar un viaje sobre la ruta (User Story 3, opcional)

```bash
cd simulador-viajes && npm run crear-ruta -- \
  --nombre "Ruta demo A" \
  --origenLat -34.6467 --origenLon -58.4894 \
  --destinoLat -34.6037 --destinoLon -58.3816 \
  --camionId 900005 \
  --odometroInicialKm 0
```

`--camionId` es el único flag obligatorio para activar este comportamiento. Es válido si es
numérico y está en el rango reservado 900001-900999, o si contiene al menos un carácter no
numérico (p. ej. `tra-demo-004`, calcando un `iotDeviceId` real de AgroLinkBackend — FR-014,
2026-10-10): un id así tampoco puede confundirse con un IMEI real (siempre puramente numérico,
15 dígitos). Flags opcionales adicionales, todos ignorados si `--camionId` no se pasa:
`--camionNombre`, `--tipoCarga` (`seca`|`refrigerada`), `--odometroInicialKm`,
`--setpointTempC`, `--setpointHumedadPct` (estos dos últimos solo tienen efecto con
`--tipoCarga refrigerada`). Mismas reglas de alta/reutilización de camión y cierre de viaje
anterior que `contracts/rutas-http-api.md`.

```bash
cd simulador-viajes && npm run crear-ruta -- \
  --nombre "Ruta demo A" \
  --origenLat -34.6467 --origenLon -58.4894 \
  --destinoLat -34.6037 --destinoLon -58.3816 \
  --camionId tra-demo-004
```

## Salida

| Resultado | Exit code | stdout/stderr |
|-----------|-----------|----------------|
| Éxito, sin `--camionId` | `0` | Imprime la fila persistida (`id`, `nombre`, cantidad de puntos) |
| Éxito, **con** `--camionId` (FR-013) | `0` | Lo anterior + una línea `Viaje iniciado: dispositivoId=... viajeId=...` |
| Validación falla (FR-009, o FR-014 si `--camionId` es numérico fuera de rango) | `1` | `Error: <motivo de validación>` en stderr |
| Nombre duplicado (FR-008) | `1` | `Error: ya existe una ruta con ese nombre` en stderr |
| OSRM no pudo resolver un camino (FR-003) | `1` | `Error: no se pudo trazar la ruta: <detalle>` en stderr |

Ningún camino de error persiste una fila parcial (igual que el endpoint HTTP), incluida la
validación de `--camionId`.
