# Phase 1 — Quickstart & Validación: Simulador de Viajes con Dispositivos Ficticios

**Feature**: `009-simulador-viajes` | **Date**: 2026-09-28

Guía de validación de punta a punta contra un stack local. Requiere el entorno de la feature
[001](../001-ingesta-adaptacion-telemetria/quickstart.md) (`deploy/compose.yaml`) y el schema
BLE de la feature [008](../008-ble-sensor-ingestion/quickstart.md) ya aplicado.

---

## 1. Tests unitarios (Principio VIII)

```bash
cd simulador-viajes && npm test
```

**Esperado**:

| Test | Casos |
|------|-------|
| `avanceRuta.test.js` | avanza entre dos puntos consecutivos; llega a una parada (velocidad 0, ignición apagada); completa la ruta → genera el viaje de vuelta invertido |
| `sintesisCan.test.js` | camión en marcha (RPM/combustible/presión coherentes con la velocidad); camión detenido (ralentí); ruta vacía/config inválida → error explícito, no un valor inventado |
| `sintesisBle.test.js` | operación normal (temperatura estable ± ruido); apertura de puerta (pico y recuperación); falla de compresor (sube sostenido y cruza 7 °C); camión sin carga refrigerada → sin segmento BLE |
| `frameBuilder.test.js` | trama con CAN y sin BLE tiene BLE ausente (no un segmento vacío de más); trama con BLE queda en la posición 2 tras el CAN; el checksum coincide con `calculateChecksum` de `rinho-receptor` |

## 2. Levantar el stack local

```bash
cd deploy && docker compose up -d timescaledb rinho-receptor
```

Aplicar el schema del simulador (una sola vez):

```bash
docker compose exec -T timescaledb psql -U postgres -d agrolink_telemetria \
  -f /docker-entrypoint-initdb.d/03-schema-simulador.sql
```

**Esperado**: `\dn` lista el schema `simulador`; `\dt simulador.*` lista `camion`, `ruta`,
`viaje`.

## 3. Cargar el camión 1 de referencia

```bash
docker compose exec -T timescaledb psql -U postgres -d agrolink_telemetria \
  -f /docker-entrypoint-initdb.d/../seed/simulador-camion-1.sql
```

**Esperado**: una fila en `simulador.camion` (`id = '900001'`, `odometro_inicial_km = 150200`),
una fila en `simulador.ruta` con 88 puntos, y un viaje `en_curso` (`sentido = 'ida'`,
`indice_actual = 0`).

## 4. Correr el simulador apuntando al stack local

```bash
cd simulador-viajes
RECEPTOR_HOST=127.0.0.1 RECEPTOR_PORT=<UDP_PORT del .env local> \
  DB_HOST=127.0.0.1 DB_PORT=5432 npm start
```

**Esperado** (SC-001, en menos de 2 minutos):

```bash
docker compose exec -T timescaledb psql -U agrolink_ingesta -d agrolink_telemetria \
  -c "SELECT dispositivo_id, momento_evento, latitud, longitud, velocidad_kmh, odometro_km
      FROM telemetria.lectura_telemetria
      WHERE dispositivo_id = '900001'
      ORDER BY momento_evento DESC LIMIT 3;"
```

Filas nuevas cada ~60 s, con `odometro_km` subiendo desde `150200` y posición avanzando sobre la
ruta cargada.

## 5. Validar el segmento BLE (US2)

Editar el camión 1 a carga refrigerada sin reiniciar el simulador:

```sql
UPDATE simulador.camion
SET tipo_carga = 'refrigerada', setpoint_temp_c = 2.5, setpoint_humedad_pct = 87
WHERE id = '900001';
```

**Esperado**: dentro del siguiente ciclo de 60 s, las lecturas nuevas de `900001` traen
`ble_temperatura_c` alrededor de `2.5` y `ble_humedad_pct` alrededor de `87`, sin haber
reiniciado el proceso (research.md D-04).

Para forzar una falla de compresor y validar SC-006:

```sql
UPDATE simulador.viaje
SET falla_tipo = 'falla_compresor', falla_indice_disparo = indice_actual + 2
WHERE camion_id = '900001' AND estado = 'en_curso';
```

**Esperado**: unos minutos después, `ble_temperatura_c` cruza `7` y sigue subiendo sin volver
sola al setpoint, mientras el resto de los campos (posición, velocidad) sigue avanzando con
normalidad.

## 6. Validar reintentos (US4)

```bash
docker compose stop rinho-receptor
# esperar ~20s (más de los 3 reintentos con backoff de 5s, research.md D-03)
docker compose logs simulador-viajes 2>&1 | grep -i "reintent\|descart"
docker compose start rinho-receptor
```

**Esperado**: logs de reintento y, tras agotarlos, un log `warn` de trama descartada con
`camion.id`, `viaje.id` y `msgNum` — el simulador sigue con el ciclo siguiente sin quedar
trabado. Al reiniciar el receptor, el próximo ciclo (nueva trama, nuevo `msgNum`) persiste con
normalidad.
