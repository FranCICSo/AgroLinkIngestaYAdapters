# Quickstart: validar la sobretemperatura de motor de punta a punta

**Feature**: `016-alerta-temperatura-motor`

Guía de validación, no de implementación. Contratos en
[`contracts/simulador-falla-motor-http.md`](contracts/simulador-falla-motor-http.md) y
[`contracts/alertas-mantenimiento-motor-http.md`](contracts/alertas-mantenimiento-motor-http.md).
Estados y umbrales en [`data-model.md`](data-model.md).

## 0. Prerrequisitos

- `deploy/.env` con `SIMULADOR_PUERTO_HTTP=8090` (ya está en `.env.example`).
- Para que la alerta se dispare pronto, dejar la probabilidad al azar en 0 y usar solo la
  activación manual: `MOTOR_FALLA_PROBABILIDAD_PCT=0`.
- Un camión de AgroLink con `iotDeviceId` = `dispositivoId` de un camión simulado (por ejemplo,
  `900002`) y un viaje `EN_ROUTE`. Es el mismo setup de la feature 013 (iniciar el viaje en AgroLink
  arranca la simulación).

## 1. Tests automatizados

```sh
# simulador-viajes: síntesis de temperatura, sorteo, estado de falla, handler HTTP, config
cd AgroLinkIngestaAdaptacion/simulador-viajes && npm test

# AgroLinkBackend: evaluación de la alerta, corrección de la temperatura de carga, config
cd AgroLinkBackend && mvn test -Dtest='EngineOverheat*,BleTemperatureTelemetrySync*,EngineTemperatureAlertProperties*'

# AgroLink (frontend): render de la fila ENGINE_OVERHEAT
cd AgroLink && npm run test:unit
```

Esperado: todo en verde. Ver "Cobertura mínima" en plan.md.

## 2. Levantar el stack

```sh
cd AgroLinkIngestaAdaptacion
make migrate            # aplica 010_add_falla_motor_viaje.sql
make simulador-docker   # simulador en Docker (--build: incluye curl)
make ingesta            # agrolink-ingesta local

cd ../AgroLinkBackend && make backend   # y en otra terminal: make frontend
```

## 3. Temperatura normal (Historia 2, escenario 1)

Con el viaje en curso, esperar 3 tramas (~3 min):

```sh
docker compose -f deploy/compose.yaml exec timescaledb psql -U postgres -d "$POSTGRES_DB" -c \
  "SELECT momento_evento, temperatura_refrigerante_c FROM telemetria.lectura_telemetria
    WHERE dispositivo_id = '900002' ORDER BY momento_evento DESC LIMIT 5;"
curl -s localhost:8082/api/v1/vehiculos/900002/estado | jq .canBus.temperaturaRefrigeranteC
```

Esperado: valores entre 80 y 95, y el mismo valor en `/estado` que en la última fila (FR-009).
Ninguna alerta nueva en AgroLink.

*(El `psql` es solo para verificar. Para operar la falla no hacen falta queries.)*

## 4. Activar el sobrecalentamiento (Historia 2, escenarios 2–4; Historia 1, escenarios 1–3)

```sh
docker compose -f deploy/compose.yaml exec simulador-viajes \
  curl -s -X POST localhost:8090/camiones/900002/falla-motor
# → {"camionId":"900002","viajeId":..,"efecto":"ACTIVADA","origen":"manual"}

# seguir la evolución
docker compose -f deploy/compose.yaml exec simulador-viajes \
  curl -s localhost:8090/camiones/900002/falla-motor
```

Con el simulador local (`make simulador`), el mismo `curl` va directo a `localhost:8090`, sin
`docker compose exec`.

Esperado:

| Tiempo desde la activación | Simulador (`ultimaTemperaturaC`) | AgroLink → Alertas → Mantenimiento |
|---|---|---|
| ≤ 10 min | ≥ 105 | Fila "Sobretemperatura de motor", "Riesgo de detención", patente, viaje, pico |
| ≤ 15 min | ≥ 110 | La **misma** fila pasa a "Detención inminente" sin recargar |
| ≤ 17 min | ~115 estable | Sin filas nuevas. El pico se ve actualizado al recargar |

Repetir el `POST`: responde `YA_ACTIVA` y no cambia nada.

## 5. Reconocer y desactivar (Historia 1, escenarios 5, 6 y 8; SC-005)

1. Reconocer la alerta desde la UI.
2. Desactivar:

   ```sh
   docker compose -f deploy/compose.yaml exec simulador-viajes \
     curl -s -X DELETE localhost:8090/camiones/900002/falla-motor
   ```

Esperado: la temperatura baja en cada trama. Al quedar por debajo de 100 °C (~6 min), la alerta
pasa a "Resuelta" sola, con hora de resolución, sin recargar la página. Repetir el `DELETE`:
responde `YA_INACTIVA`.

## 6. La temperatura de carga no se contamina (Historia 3)

Con un camión con sensor de frío y viaje refrigerado, quitar temporalmente el segmento BLE de sus
tramas (camión simulado con `tipo_carga = 'seca'` pero `hasBleSensor = true` en AgroLink).

Esperado: ninguna alerta térmica de carga. Las lecturas normalizadas no registran 80–95 °C como
temperatura de carga.

## 7. Aparición al azar (Historia 2, escenarios 8–10)

- Estadística: lo cubre el test del sorteo con `rng` sembrado (200 viajes → 4 a 18 con falla).
- Manual: con `MOTOR_FALLA_PROBABILIDAD_PCT=100`, iniciar un viaje y consultar `GET .../falla-motor`.
  Debería estar `pendiente`, con `indiceDisparo` entre el 10 % y el 70 % de la ruta y
  `duracionMin` entre 20 y 40. Pasa a `activa` al llegar al índice y a `terminada` al cumplirse la
  duración.

## 8. Errores

```sh
docker compose -f deploy/compose.yaml exec simulador-viajes curl -s -X POST localhost:8090/camiones/999999/falla-motor
# → 404 camion_no_encontrado
# camión existente sin viaje en curso → 409 sin_viaje_en_curso
```

Configuración inválida: arrancar el simulador con `MOTOR_PICO_C=100`, o el backend con
`AGROLINK_ALERT_ENGINE_TEMP_CRITICAL_C=100`. Esperado: no arranca y el log explica el motivo.

## 9. Combustible que baja y se recarga (Historia 4)

Con `COMBUSTIBLE_PCT_POR_KM=0.5` (y `SIMULADOR_CICLO_MS=5000` para ir más rápido), levantar el
simulador y seguir los logs:

```sh
docker compose -f deploy/compose.yaml logs -f simulador-viajes | grep "cargo combustible"
```

Esperado: cada camión arranca con un nivel distinto, entre 7 % y 100 % (mapa de flota, campo
combustible). El nivel baja trama a trama mientras el camión avanza. Cuando una trama informa
menos de 7 %, aparece el log `Camion simulado cargo combustible: tanque al 100 %` y la trama
siguiente informa cerca de 100 %. El reporte de viaje de ingesta para un rango que incluya la
recarga da un consumo positivo (suma de bajadas), nunca negativo.
