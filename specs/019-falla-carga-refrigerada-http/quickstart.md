# Quickstart: validar el desvío térmico manual de la carga refrigerada

**Feature**: `019-falla-carga-refrigerada-http` | **Date**: 2026-11-22

Guía para comprobar la feature de punta a punta. Respuestas y errores en
[contracts/simulador-falla-carga-http.md](contracts/simulador-falla-carga-http.md). Columnas y
estados en [data-model.md](data-model.md).

## 0. Prerrequisitos

- La migración `013` está aplicada (`make migrate`) y `simulador-viajes` y `agrolink-ingesta`
  corren con esta feature.
- AgroLinkBackend corre con un vehículo con sensor de frío (BLE) asociado a un dispositivo simulado,
  por ejemplo `900002`.
- **Para una demo corta**, con alerta en minutos y no en media hora, levantar el backend con:

  ```sh
  AGROLINK_ALERT_THERMAL_CHECKINTERVALMS=60000 \
  AGROLINK_ALERT_THERMAL_TOLERANCEMINUTES=2 \
  ```

  Son las propiedades `agrolink.alert.thermal.check-interval-ms` y
  `agrolink.alert.thermal.tolerance-minutes`. Sin eso, valen los tiempos por defecto (SC-003,
  SC-004).

Atajo para los comandos de abajo:

```sh
cd deploy
sim() { docker compose exec simulador-viajes curl -s "$@"; }
```

Con el simulador local (`make simulador`), usar `curl -s` directo contra
`localhost:$SIMULADOR_PUERTO_HTTP`.

## 1. Viaje refrigerado en curso

En AgroLink, crear un viaje con carga refrigerada (por ejemplo, umbrales de 2 a 8 °C) para el
vehículo de `900002` y pasarlo a "en ruta".

```sh
sim localhost:8090/camiones/900002/falla-carga
```

**Esperado**: `estado: "inactivo"`, `umbralMinC: 2`, `umbralMaxC: 8`, `setpointTempC: 5`, y
`ultimaTemperaturaC` entre 2 y 8 desde la primera trama (FR-010, FR-014).

## 2. Activar por encima del máximo (US1)

```sh
sim -X POST localhost:8090/camiones/900002/falla-carga
```

**Esperado**:

- Responde `efecto: "ACTIVADA"`, `sentido: "arriba"`, `objetivoC: 12`.
- Con `GET` cada minuto, `ultimaTemperaturaC` pasa de 8 en la primera o segunda trama y se queda
  cerca de 12 (FR-003, FR-004, FR-005, SC-002).
- En la base, las tramas nuevas de `telemetria.lectura_telemetria` para `900002` traen la
  temperatura BLE por encima de 8 (SC-005).
- Pasados la tolerancia y el intervalo del backend, el viaje tiene una alerta térmica crítica
  abierta y queda en "alerta crítica" (US1 escenario 3, SC-003).

Repetir el `POST`, incluso con `?sentido=abajo`: responde `YA_ACTIVA` con `sentido: "arriba"` y la
temperatura no cambia (FR-006).

## 3. Cerrar (US2)

```sh
sim -X DELETE localhost:8090/camiones/900002/falla-carga
```

**Esperado**:

- Responde `efecto: "DESACTIVADA"`, `tipoCerrado: "desvio_termico"`.
- `ultimaTemperaturaC` vuelve a estar entre 2 y 8 en la primera o segunda trama y después se queda
  cerca de 5 (FR-008).
- En la siguiente evaluación del backend, la alerta térmica queda resuelta (SC-004).
- Un segundo `DELETE` responde `YA_INACTIVA` (FR-009).

## 4. Activar por debajo del mínimo

```sh
sim -X POST 'localhost:8090/camiones/900002/falla-carga?sentido=abajo'
```

**Esperado**: `objetivoC: -2`. Las tramas siguientes quedan por debajo de 2 °C y la alerta se abre
igual que en el paso 2. Cerrar con `DELETE` antes de seguir.

## 5. Errores y bordes

| Pedido | Esperado |
|---|---|
| `sim -X POST 'localhost:8090/camiones/900002/falla-carga?sentido=costado'` | 400 `validacion` |
| `sim -X POST localhost:8090/camiones/900777/falla-carga` (no existe) | 404 `camion_no_encontrado` |
| Camión con carga seca (`900001`) | 409 `sin_carga_refrigerada` |
| Camión sin viaje en curso (después de completar el viaje en AgroLink) | 409 `sin_viaje_en_curso` |
| `sim -X PUT localhost:8090/camiones/900002/falla-carga` | 405 `metodo_no_permitido` |

## 6. Convivencia y ciclo de vida

- **Falla por SQL previa**: cargar `falla_compresor` con el `UPDATE` del README y después hacer
  `POST`. Responde `reemplaza: "falla_compresor"`. Un `DELETE` posterior la deja en `inactivo`
  (FR-018).
- **Motor**: activar `falla-motor` y `falla-carga` juntas, y cerrar una. La otra sigue activa y la
  temperatura del refrigerante del motor no cambia por la de carga (FR-019, SC-006).
- **Reinicio**: con el desvío activo, `docker compose restart simulador-viajes`. El `GET` sigue en
  `activo` y las tramas siguen fuera del rango. `ultimaTemperaturaC` arranca en `null` hasta la
  primera trama (FR-017).
- **Fin del viaje**: con el desvío activo, completar o cancelar el viaje en AgroLink y empezar
  otro con el mismo camión. El viaje nuevo arranca en `inactivo`, con la temperatura dentro del
  rango desde la primera trama (FR-016).
- **Sin umbrales**: un camión refrigerado dado de alta a mano, con setpoint y sin umbrales, responde
  al `POST` con `objetivoC = setpoint + 8` (FR-015).

## 7. Tests automáticos

```sh
cd simulador-viajes && npm test
cd .. && JAVA_HOME=<jdk21> mvn test -Dtest='SimuladorViajesClientTest'
```

Cubren, como mínimo:

- Síntesis BLE: sale del rango en ≤ 3 tramas, se mantiene fuera, vuelve al rango en ≤ 5 tramas,
  sentido `abajo`, y margen fijo sin umbrales.
- Handler: cada fila de las tablas del contrato.
- Validación de umbrales en `/rutas`: completos, uno faltante, fuera de rango y mínimo mayor que
  máximo (Principio VIII).
- Reenvío de umbrales desde ingesta.
