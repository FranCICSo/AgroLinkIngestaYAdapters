# Research: Activar y cerrar a mano el desvío térmico de la carga refrigerada

**Feature**: `019-falla-carga-refrigerada-http` | **Date**: 2026-11-22

El Technical Context del plan no dejó incógnitas abiertas. Las decisiones de abajo resuelven las
cuestiones que la spec deja para el plan (ruta, forma del pedido, fórmula de temperatura y dónde
guardar el estado) y fijan los patrones a reusar.

## D-01: Dónde guardar el desvío

**Decision**: Reusar la columna existente `simulador.viaje.falla_tipo` con un valor nuevo,
`desvio_termico`, y agregar al viaje tres columnas: `falla_carga_sentido` (`arriba` | `abajo`),
`falla_carga_activada_en` y `falla_carga_desactivada_en` (migración `013`). El `CHECK` de
`falla_tipo` (`viaje_falla_tipo_check`) se reemplaza para admitir el valor nuevo.

**Rationale**:

- `falla_tipo` ya es "la falla de carga del viaje" y tiene un solo valor. Ponerla ahí cumple
  FR-018 (una falla de carga por viaje) sin lógica extra: activar por HTTP pisa la que haya cargado
  un SQL, y cerrar la vacía.
- Al estar en `simulador.viaje`, sobrevive a un reinicio (FR-017). El viaje de vuelta no la hereda,
  porque `finalizarYCrearVuelta` e `insertarViaje` no copian `falla_tipo` (FR-016).
- Las horas de activación y de cierre son para la consulta (FR-010), con el mismo criterio que
  `falla_motor_activada_en`/`falla_motor_desactivada_en` (feature 016).

**Alternatives considered**:

- **Columnas propias, independientes de `falla_tipo`**, como hizo la feature 016 con el motor.
  Rechazada: el motor debía convivir con la falla de carga, pero acá la spec pide lo contrario
  (como mucho una falla de carga por viaje). Dos columnas obligarían a sincronizarlas.
- **Reusar `falla_compresor`**. Rechazada: es una rampa lenta sin tope y sin sentido. Cambiarle el
  comportamiento rompería lo que documenta el README para quien la usa por SQL.
- **Estado solo en memoria**. Rechazada: no sobrevive a un reinicio (FR-017).

## D-02: Cómo llega el rango del viaje al simulador

**Decision**: Agregar `umbral_min_c` y `umbral_max_c` (`NUMERIC(4,1)`, nulos) a `simulador.camion`.
`/rutas` los acepta en el bloque `camion` como `umbralTermicoMinC`/`umbralTermicoMaxC`, y se
guardan junto con el setpoint en `insertarCamion`/`actualizarCargaCamion`. `agrolink-ingesta` ya
guarda los umbrales en `viaje_programado` y ahora también los manda en `CamionRequest` cuando la
carga es refrigerada.

**Rationale**:

- El setpoint ya vive en el camión y se pisa en cada viaje (feature de carga refrigerada,
  `actualizarCargaCamion`). Los umbrales tienen el mismo ciclo de vida, así que van al mismo lugar
  y por el mismo camino.
- Del lado de ingesta es un cambio mínimo: los datos ya están en la entidad.
- Carga seca: ambos quedan en `NULL`, igual que el setpoint.

**Alternatives considered**:

- **Pasar el rango en el `curl`**. Rechazada: obliga a quien opera a conocer los umbrales del viaje
  y puede contradecir los que usa el backend.
- **Ponerlos en `simulador.viaje`**. Rechazada: el alta del viaje (`insertarViaje`) no recibe la
  carga, y el viaje de vuelta tendría que copiarlos.

**Validación**: en `/rutas` (`validarCamion`), si viene uno de los dos umbrales tiene que venir el
otro, ambos dentro de ±50 °C y con mínimo ≤ máximo. Si no, `400 validacion`.

## D-03: Temperatura con el desvío activo y al cerrarlo

**Decision**: Un modo nuevo de `sintetizarBle`, `desvio_termico`, con un objetivo fuera del rango:

- Sentido `arriba`: `objetivo = umbral_max + MARGEN`. Sentido `abajo`: `objetivo = umbral_min -
  MARGEN`.
- Sin umbrales conocidos (FR-015): `objetivo = setpoint ± MARGEN_SIN_UMBRALES`.
- Cada trama se acerca al objetivo: `t = anterior + (objetivo - anterior) × 0,6 + ruido(±0,3)`.

Valores por defecto: `MARGEN = 4 °C` (`CARGA_DESVIO_MARGEN_C`) y `MARGEN_SIN_UMBRALES = 8 °C`
(`CARGA_DESVIO_SIN_UMBRALES_C`). Al cerrar no hace falta un modo nuevo: vuelve el modo `normal`,
que ya recupera el 63 % de la diferencia con el setpoint por trama (`FACTOR_RECUPERACION = 0,37`).

**Rationale**, con el caso de referencia (rango 2 a 8 °C, setpoint 5 °C, objetivo 12 °C):

| Trama | Temperatura | ¿Fuera del rango? |
|---|---|---|
| 0 (antes) | 5,0 | no |
| 1 | 9,2 | sí, +1,2 |
| 2 | 10,9 | sí, +2,9 |
| 3 | 11,5 | sí, +3,5 |

- Sale en la trama 1 y supera el margen de 2 °C en la 2, dentro de las 3 tramas de FR-004.
- Una vez en el objetivo, el ruido de ±0,3 °C la deja entre 11,7 y 12,3 °C. Nunca vuelve a menos de
  3,7 °C del umbral (FR-003) y no crece sin tope (FR-005).
- Al cerrar desde 12 °C: 7,6 °C en la primera trama (ya dentro del rango) y 5,9 °C en la segunda.
  Cumple FR-008 (5 tramas) con margen.
- Para el sentido `abajo` el cálculo es simétrico: objetivo -2 °C, sale del rango en la trama 1.
- Sin umbrales, un setpoint de 2,5 °C lleva a 10,5 °C o a -5,5 °C: fuera de un rango típico de
  carne fresca.

**Alternatives considered**:

- **Salto inmediato al objetivo**. Rechazada: un escalón de 7 °C en un minuto no es verosímil.
- **Rampa fija por trama, como `falla_compresor`**. Rechazada: para salir del rango en 3 tramas
  necesitaría ~2 °C por trama y además un tope aparte. El acercamiento proporcional resuelve las
  dos cosas.

## D-04: Temperatura anterior por viaje

**Decision**: Guardar en `estadoPorCamion` el id del viaje de la última temperatura BLE
(`viajeIdBle`), como ya se hace con `viajeIdMotor`. Si el viaje cambió, la temperatura anterior se
descarta y el viaje arranca desde el setpoint.

**Rationale**: Hoy `temperaturaBleC` pasa de un viaje al siguiente. Si un viaje termina con el
desvío activo, la vuelta arrancaría desde 12 °C. El modo normal la bajaría rápido, pero la primera
trama de la vuelta ya saldría del rango. Así se cumple FR-016 desde la primera trama.

## D-05: Interfaz HTTP

**Decision**: `POST | GET | DELETE /camiones/{camionId}/falla-carga`, con un handler nuevo
(`fallaCargaHandler.js`) armado igual que `fallaMotorHandler.js`. El sentido va en la query
(`?sentido=arriba|abajo`, por defecto `arriba`) y no hay body. Efectos y errores siguen el mismo
esquema que `falla-motor` (`ACTIVADA` / `YA_ACTIVA` / `DESACTIVADA` / `YA_INACTIVA`, 400, 404, 405,
409). Se suma un 409 `sin_carga_refrigerada`. Contrato: `contracts/simulador-falla-carga-http.md`.

**Rationale**:

- FR-012 pide las mismas convenciones que el endpoint del motor, y el ruteo del servidor
  (`rutaHttpServer.js`) ya despacha por regex a handlers inyectables.
- La query alcanza para un solo parámetro opcional y evita armar un JSON en el `curl`:
  `curl -X POST localhost:8090/camiones/900002/falla-carga?sentido=abajo`.
- `falla-carga` es simétrico con `falla-motor` y describe qué se rompe, como ya lo hace el endpoint
  del motor.

**Detalles**:

- Con una falla de carga por SQL vigente (`falla_compresor` o `apertura_puerta`), `POST` la
  reemplaza y devuelve `ACTIVADA` con `reemplaza: "<tipo anterior>"`. `DELETE` la cierra y devuelve
  `DESACTIVADA` con `tipoCerrado: "<tipo>"` (FR-018).
- `YA_ACTIVA` solo aplica si ya hay un `desvio_termico`. Un sentido distinto no lo cambia (Edge
  Cases) e informa el sentido vigente.
- La última temperatura BLE emitida se expone desde un registro en memoria, igual que
  `registroTemperaturaMotor.js`.

**Alternatives considered**:

- **Sentido en un body JSON**. Rechazada: el `curl` se vuelve más largo sin aportar nada.
- **Dos rutas por sentido** (`/desvio-arriba`, `/desvio-abajo`). Rechazada: duplica los métodos y
  se aleja del contrato del motor.

## D-06: Tiempos del backend

**Decision**: No se tocan. El README y la quickstart dicen cuánto tarda la alerta y qué propiedades
del backend la acortan para una demo (`agrolink.alert.thermal.check-interval-ms`, 600000 por defecto,
y `agrolink.alert.thermal.tolerance-minutes`, 20 por defecto).

**Rationale**: La spec deja esos tiempos fuera de alcance. El simulador cumple su parte saliendo del
rango en 1 o 2 tramas y volviendo en 1. El resto es la ventana de tolerancia (20 min) y la
evaluación periódica (10 min) de AgroLinkBackend, `ThermalAlertScheduler` y
`AlertService.evaluateThermalThresholds`.
