# Data Model: Activar y cerrar a mano el desvío térmico de la carga refrigerada

**Feature**: `019-falla-carga-refrigerada-http` | **Date**: 2026-11-22

Todos los cambios son de configuración mutable del simulador (esquema `simulador`). Ninguno toca
`telemetria.lectura_telemetria` (Principio IV). Van en la migración
`deploy/migrations/013_add_desvio_termico_carga.sql`. El esquema base `deploy/db/03-schema-simulador.sql`
se actualiza igual, como hizo la migración `010`.

## 1. `simulador.viaje`: desvío térmico de la carga

| Columna | Tipo | Nulo | Cambio | Descripción |
|---|---|---|---|---|
| `falla_tipo` | `VARCHAR(20)` | sí | `CHECK` ampliado | `apertura_puerta` \| `falla_compresor` \| **`desvio_termico`**. La falla de carga vigente, como mucho una por viaje |
| `falla_indice_disparo` | `INTEGER` | sí | sin cambio | `NULL` para `desvio_termico`: es inmediato, no espera un índice |
| `falla_carga_sentido` | `VARCHAR(6)` | sí | **nueva** | `arriba` \| `abajo` (`CHECK`). Solo con `falla_tipo = 'desvio_termico'` |
| `falla_carga_activada_en` | `TIMESTAMPTZ` | sí | **nueva** | Cuándo se activó el desvío por HTTP |
| `falla_carga_desactivada_en` | `TIMESTAMPTZ` | sí | **nueva** | Cuándo se cerró por HTTP, sea un desvío o una falla cargada por SQL |

El `CHECK` existente se llama `viaje_falla_tipo_check`. La migración lo borra (`DROP CONSTRAINT IF
EXISTS`) y lo vuelve a crear con los tres valores.

### Estados (derivados, no se persisten como columna)

| Estado público | Condición |
|---|---|
| `activo` | `falla_tipo = 'desvio_termico'` |
| `otra_falla` | `falla_tipo IN ('falla_compresor', 'apertura_puerta')`: hay una falla cargada por SQL |
| `inactivo` | `falla_tipo IS NULL` |

### Transiciones

| Desde | Acción | Hacia | Escritura |
|---|---|---|---|
| `inactivo` u `otra_falla` | `POST` (activar) | `activo` | `falla_tipo = 'desvio_termico'`, `falla_indice_disparo = NULL`, `falla_carga_sentido = <sentido>`, `falla_carga_activada_en = now`, `falla_carga_desactivada_en = NULL` |
| `activo` | `POST` | `activo` | ninguna (`YA_ACTIVA`) |
| `activo` u `otra_falla` | `DELETE` (cerrar) | `inactivo` | `falla_tipo = NULL`, `falla_indice_disparo = NULL`, `falla_carga_desactivada_en = now`. `falla_carga_sentido` y `falla_carga_activada_en` se conservan para la consulta |
| `inactivo` | `DELETE` | `inactivo` | ninguna (`YA_INACTIVA`) |
| cualquiera | el viaje termina (finaliza, se detiene o pasa a la vuelta) | — | El viaje nuevo nace con todas estas columnas en `NULL` (`insertarViaje` y `finalizarYCrearVuelta` no las copian) |

Las escrituras van con `WHERE id = $1 AND estado = 'en_curso'`. Si el viaje terminó entre la lectura
y la escritura, no se revive nada.

## 2. `simulador.camion`: rango térmico de la carga

| Columna | Tipo | Nulo | Cambio | Descripción |
|---|---|---|---|---|
| `setpoint_temp_c` | `NUMERIC(4,1)` | sí | sin cambio | Centro del rango, viene de `agrolink-ingesta` |
| `umbral_min_c` | `NUMERIC(4,1)` | sí | **nueva** | Umbral térmico mínimo del viaje refrigerado en curso |
| `umbral_max_c` | `NUMERIC(4,1)` | sí | **nueva** | Umbral térmico máximo |

Ciclo de vida: igual que el setpoint. Se escriben al dar de alta el camión (`insertarCamion`) o al
iniciar un viaje que informa `tipoCarga` (`actualizarCargaCamion`). Con carga seca, o refrigerada
sin umbrales, quedan en `NULL`.

Reglas de validación en `/rutas` (`validarCamion`):

- `umbralTermicoMinC` y `umbralTermicoMaxC` van juntos o no van.
- Cada uno es un número dentro de ±50 °C.
- Mínimo ≤ máximo.
- Solo se aceptan con `tipoCarga = 'refrigerada'`. Con carga seca se ignoran y se guardan en
  `NULL`.

`flotaRepository.validarCamion` (lectura en cada ciclo) no cambia: los umbrales son opcionales. Sin
umbrales, el desvío usa el margen fijo (research.md D-03).

## 3. Estado en memoria del ciclo (`estadoPorCamion`, `src/index.js`)

| Campo | Cambio | Descripción |
|---|---|---|
| `temperaturaBleC` | sin cambio | Última temperatura de carga emitida |
| `viajeIdBle` | **nuevo** | Viaje al que pertenece `temperaturaBleC`. Si no coincide con el viaje actual, la temperatura anterior se toma como `null` y el viaje arranca desde el setpoint (research.md D-04) |

Registro aparte `registroTemperaturaCarga.js`: es la última temperatura BLE emitida por camión, para
el `GET`, igual que `registroTemperaturaMotor.js`. Se pierde al reiniciar el proceso, y entonces el
`GET` la devuelve en `null`.

## 4. Modo de síntesis BLE (`src/domain/sintesisBle.js`)

`sintetizarBle` recibe además `umbralMinC`, `umbralMaxC` y `sentido`, y admite un modo nuevo,
`desvio_termico` (fórmula en research.md D-03). `determinarModoBle` (en `src/index.js`) devuelve
`desvio_termico` si `viaje.fallaTipo === 'desvio_termico'`. `falla_compresor` y `apertura_puerta`
no cambian.

| Parámetro de configuración | Variable de entorno | Default | Validación |
|---|---|---|---|
| Margen fuera del umbral | `CARGA_DESVIO_MARGEN_C` | `4` | número ≥ 2,5 (FR-003 exige ≥ 2 °C fuera del umbral, y el ruido es de ±0,3 °C) |
| Margen respecto del setpoint sin umbrales | `CARGA_DESVIO_SIN_UMBRALES_C` | `8` | número > 0 |

## 5. `agrolink-ingesta` (sin cambios de esquema)

`ingesta.viaje_programado` ya tiene `umbral_termico_min_c` y `umbral_termico_max_c` (migración
`011`). Solo cambia el request hacia el simulador: `SimuladorViajesClient.CamionRequest` suma
`umbralTermicoMinC` y `umbralTermicoMaxC` cuando la carga es refrigerada. En otro caso se omiten
(`NON_NULL`).
