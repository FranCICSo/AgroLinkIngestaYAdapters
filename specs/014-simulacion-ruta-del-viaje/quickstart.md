# Quickstart — Validación de 014-simulacion-ruta-del-viaje

Guía de verificación, no de implementación. Formatos y códigos: [contracts/ingesta-simulacion-http.md](./contracts/ingesta-simulacion-http.md)
(externo) y [contracts/simulador-viajes-http.md](./contracts/simulador-viajes-http.md) (interno).
Estados y columnas: [data-model.md](./data-model.md).

## 0. Prerrequisitos

```bash
make simulador          # timescaledb + receptor + osrm + simulador-viajes (aplica 03-schema-simulador.sql)
make migrate            # aplica 008 y 009 (o el pipeline de CI/CD)
make ingesta            # agrolink-ingesta; puerto de vehiculo-estado 8082
```

`SIMULADOR_PUERTO_HTTP` definido en `deploy/.env` (el servidor HTTP del simulador es opcional).
Para acortar la verificación se puede usar `SIMULADOR_CICLO_MS=10000`; el avance por tiempo
escala con el ciclo (research.md D-09).

Atajos usados abajo:

```bash
ING=http://localhost:8082/api/v1/vehiculos
PSQL='docker compose -f deploy/compose.yaml exec -T timescaledb psql -U postgres -d agrolink_telemetria -c'
```

## 1. Tests automáticos

```bash
mvn test                                      # agrolink-ingesta
(cd simulador-viajes && npm test)             # simulador-viajes
```

Esperado: verde. Cubren, entre otros: tabla de decisión de inicio/detención (research.md D-03),
mapeo de errores del simulador, decodificador de polyline (completo / vacío-truncado / fuera de
rango, Principio VIII), normalización de velocidades, avance por velocidad con remanente,
espera en destino y que las rutas sin velocidades conserven el algoritmo actual.

## 2. US1 — Arranque inmediato, idempotencia y rechazos

```bash
curl -i -X POST $ING/tra-demo-004/viajes-simulados -H 'Content-Type: application/json' -d '{
  "tripCode":"QS-1","estimatedStartDateTime":"2030-01-01T09:00:00",
  "origen":{"lat":-34.64671,"lon":-58.48941},"destino":{"lat":-34.60372,"lon":-58.38159}}'
```

| Paso | Esperado |
|---|---|
| El POST de arriba (fecha **futura** a propósito) | `202`, `estado: ARRANCADO`, `trazado: PROPIO`, `efecto: ARRANCADA` — no espera la fecha (FR-001) |
| Repetirlo igual | `200`, `efecto: SIN_CAMBIOS`; en `simulador.viaje` sigue un solo `en_curso` para `tra-demo-004` con `trip_code = 'QS-1'` |
| Mismo body contra `/12345/…` | `404 dispositivo_no_simulado` |
| Sin `destino` | `400 validacion` |
| `tripCode: "QS-1"` contra `/900001/…` | `409 viaje_de_otro_dispositivo`, `dispositivoId: "tra-demo-004"` |
| `tripCode: "QS-2"` contra `/tra-demo-004/…` | `202`; el viaje `QS-1` del simulador queda `finalizado` (FR-006) |
| Con `simulador-viajes` parado (`docker compose stop simulador-viajes`), `tripCode: "QS-3"` | `502 simulador_no_disponible`; fila `QS-3` en `ERROR` con `ultimo_error`; `WARN` con tripCode + dispositivo |
| `PUT` o `DELETE` a `$ING/tra-demo-004/viajes-simulados/QS-1` | `404`/`405` (FR-016) |

Dentro de ≤ 1 ciclo aparece telemetría fresca de `tra-demo-004` (SC-001):

```bash
curl -s http://localhost:8082/api/v1/vehiculos/tra-demo-004/estado
```

## 3. US2 — Recorrer el trazado recibido

Polyline de prueba = ejemplo verificable del contrato §4 (`P = [(-34.6,-58.4), (-34.6,-58.39),
(-34.59,-58.39)]`, `velocidadesKmh = [25, 80]`). Codificarla con cualquier encoder de polyline
precisión 5 (el módulo de producción `domain/polyline.js` solo decodifica; el test T025 trae un `encode` auxiliar reutilizable).

| Paso | Esperado |
|---|---|
| Inicio con `polyline` + `velocidadesKmh` y `origen`/`destino` = extremos | `202`, `trazado: RECIBIDO`; logs del simulador sin llamada a OSRM; `simulador.ruta.velocidades_kmh` no nulo y de largo `puntos − 1` |
| Todas las posiciones emitidas a < 30 m del trazado (SC-002) | consultar `telemetria.lectura_telemetria` del dispositivo y medir distancia al segmento más cercano |
| Ninguna trama > 80 km/h (SC-006) | `SELECT max(velocidad_kmh) …` ≤ 80 |
| Tiempo hasta llegar ≈ `T_plan` (contrato §4) ± 10 % | usar un trazado de ≥ 10 min de `T_plan` (research.md D-09: resolución de un ciclo) |
| Inicio con `polyline` sin `velocidadesKmh` | `202`; `velocidades = 'POR_DEFECTO'` (40 km/h) |
| `velocidadesKmh` con un elemento de más | `202`; `velocidades = 'DESCARTADAS'` + `WARN` (no rechaza) |
| `polyline: "!!!"` | `400 trazado_invalido`; nada persistido en `simulador.ruta` |
| `destino` corrido 1 km del último punto | `400 trazado_invalido` |
| `velocidadesKmh` sin `polyline` | `400 validacion` |
| Cuerpo de ~2 MiB válido (polyline larga ≤ 100 000 puntos) | aceptado (`202`) |
| `polyline` de 1 000 001 caracteres | `413 payload_demasiado_grande` |

## 4. US3 — Detención

```bash
curl -i -X POST $ING/tra-demo-004/viajes-simulados/QS-2/detencion \
  -H 'Content-Type: application/json' -d '{"motivo":"CANCELADO"}'
```

| Paso | Esperado |
|---|---|
| Detener `QS-2` en curso | `200 efecto: DETENIDA`; `simulador.viaje` de `QS-2` → `finalizado`; sin tramas nuevas de ese viaje tras ≤ 1 ciclo (SC-004) |
| Repetir | `200 SIN_SIMULACION_EN_CURSO` |
| Detener `QS-1` (reemplazado antes por `QS-2`) | `200 SIN_SIMULACION_EN_CURSO`; no afecta ningún otro viaje (FR-013) |
| Detener `QS-9` desconocido, luego iniciarlo | detención `200 SIN_SIMULACION_EN_CURSO`; inicio `409 viaje_no_modificable`, `estadoActual: DETENIDO` |
| Detener `QS-2` contra `/900001/…` | `409 viaje_de_otro_dispositivo` |
| Detener `QS-3` (en `ERROR`) con simulador caído | `200 SIN_SIMULACION_EN_CURSO` + `WARN` |

## 5. US4 — Espera en destino

| Paso | Esperado |
|---|---|
| Inicio avisado con trazado corto; esperar la llegada | sin viaje de vuelta (`simulador.viaje` no gana fila `vuelta`); tramas siguen llegando en el último punto con velocidad 0 e ignición apagada; si el camión es `refrigerada`, sigue la temperatura BLE (SC-005) |
| `docker compose restart simulador-viajes` mientras espera | retoma estacionado en el destino |
| Detención | deja de emitir |
| `npm run crear-ruta` (CLI) y esperar llegada | conserva la vuelta automática (FR-015) |

## 6. FR-017 — Planificaciones pendientes del modo anterior

Antes de aplicar `009`, insertar una fila `PENDIENTE` y una `DISPARADO` en
`ingesta.viaje_programado` (con su viaje `en_curso` y ruta `Viaje {tripCode}` en el simulador
para la segunda). Tras `008` + `009`:

- la `PENDIENTE` queda `CANCELADO` con `ultimo_error` = "Cancelada al desplegar 014…", el
  `NOTICE` del runner informa la cantidad, y nunca se dispara (SC-003);
- la `DISPARADO` queda `ARRANCADO` y su viaje del simulador tiene `trip_code` backfilleado:
  detenerla devuelve `200 DETENIDA`.
