# simulador-viajes

Proceso Node.js independiente que simula una flota de camiones (incluidos refrigerados)
recorriendo rutas reales y envía, cada 60 segundos por camión, la misma trama UDP
`>REQ...<` que enviaría un Rinho Spider IoT físico contra `rinho-receptor` — mismo
protocolo, checksum y ACK. El receptor no tiene ningún modo "simulado": desde su punto de
vista, este proceso es indistinguible de un dispositivo de campo.

Especificación completa: [`../specs/009-simulador-viajes/`](../specs/009-simulador-viajes/)
(`spec.md`, `plan.md`, `data-model.md`, `quickstart.md`).

Las rutas (`simulador.ruta`) ya no se arman a mano con un `INSERT` — ver
[`../specs/011-generar-ruta-simulada/`](../specs/011-generar-ruta-simulada/) y la sección
["Generar una ruta nueva"](#generar-una-ruta-nueva-sin-sql-a-mano) más abajo.

## Arranque rápido

```bash
make simulador          # desde la raíz del repo: aplica schema + camión 1 de referencia
                         # (si hace falta) y lo corre en esta máquina (node, en primer plano)
                         # contra el receptor, TimescaleDB e ingesta locales
make simulador-docker   # lo mismo, pero en un contenedor
# make dev (raíz) también lo corre local, en segundo plano, junto con agrolink-ingesta
```

`make simulador` toma `deploy/.env` y reemplaza los hosts de compose por `localhost` (receptor en
`UDP_PORT`, TimescaleDB en 5432, webhook Samsara en `http://localhost:${REPORTES_HTTP_PORT}`).
`make ingesta` apunta al simulador en `http://localhost:${SIMULADOR_PUERTO_HTTP}`, salvo que el
contenedor esté corriendo.

A mano, sin el Makefile (contra un `rinho-receptor`/TimescaleDB ya corriendo):

```bash
cd simulador-viajes
npm install
RECEPTOR_HOST=127.0.0.1 RECEPTOR_PORT=5000 \
DB_HOST=127.0.0.1 DB_PORT=5432 POSTGRES_DB=agrolink_telemetria \
SIMULADOR_VIAJES_DB_USER=simulador_viajes SIMULADOR_VIAJES_DB_PASSWORD=<la de deploy/.env> \
npm start
```

Ver `deploy/README.md` §2.7.2 y §7.2 para levantarlo contra el stack completo (Docker) o
desplegarlo en la VM de producción.

## Generar una ruta nueva (sin SQL a mano)

Feature [011-generar-ruta-simulada](../specs/011-generar-ruta-simulada/): dado un origen y un
destino (lat/lon, y opcionalmente paradas intermedias), traza el recorrido sobre calles reales
vía [OSRM](https://project-osrm.org/) y persiste la fila en `simulador.ruta` en una sola llamada
— reemplaza el `INSERT` manual con el array de puntos copiado a ojo.

Usa el demo server público de OSRM (`OSRM_BASE_URL`, default `https://router.project-osrm.org`),
sin contenedor propio — ver `deploy/README.md` §2.7.3.

**Por CLI** (`npm run crear-ruta --`, ver
[`contracts/crear-ruta-cli.md`](../specs/011-generar-ruta-simulada/contracts/crear-ruta-cli.md)):

```bash
cd simulador-viajes
npm run crear-ruta -- \
  --nombre "Depósito -> Cliente" \
  --origenLat -34.60 --origenLon -58.40 \
  --destinoLat -34.62 --destinoLon -58.42 \
  --paradas '[{"lat":-34.61,"lon":-58.41,"duracionMin":5}]'
```

Imprime el `id` de la fila nueva (usarlo en el paso 3 de ["Agregar un camión
nuevo"](#agregar-un-camión-nuevo) para crear el viaje que lo pone en marcha).

**Por HTTP** (`POST /rutas`, ver
[`contracts/rutas-http-api.md`](../specs/011-generar-ruta-simulada/contracts/rutas-http-api.md)):
sólo alcanzable dentro de la red de Docker compose (nunca publicado al host ni expuesto al
frontend de AgroLink); requiere arrancar el proceso con `PUERTO_HTTP` definida (ver Variables de
entorno, más abajo). Ninguna de las dos vías duplica lógica: ambas llaman al mismo
`routeGenerationService`.

Si OSRM no puede resolver un camino entre origen y destino (o no responde), la generación se
rechaza con un error claro — no hay modo de interpolación en línea recta como alternativa, ni
se persiste una fila a medias.

## Cómo administrar la flota (agregar/editar camiones)

Toda la configuración vive en el schema Postgres `simulador` (tablas `camion`, `ruta`,
`viaje`), **separado** de `telemetria` porque es mutable — se edita en caliente por
`psql`/DataGrip, sin tocar código ni reiniciar el proceso: el simulador relee la flota
completa al empezar cada ciclo de 60 s.

### Agregar un camión nuevo

La forma recomendada es un script SQL versionado en `deploy/seed/`, siguiendo el mismo
patrón que `simulador-camion-1.sql` y `simulador-camion-2.sql` (idempotentes — se pueden
re-aplicar sin duplicar nada):

```bash
cd deploy
docker compose exec -T timescaledb psql -U postgres -d agrolink_telemetria \
  -v ON_ERROR_STOP=1 -f - < seed/simulador-camion-2.sql
```

O a mano, directo por `psql` (la ruta del paso 2 es más fácil de generar con
[`npm run crear-ruta`](#generar-una-ruta-nueva-sin-sql-a-mano) en vez de escribir el array de
puntos a ojo — acá se muestra el `INSERT` manual sólo como alternativa de referencia):

```sql
-- 1. El camión. El id DEBE caer en 900001-900999 (nunca puede coincidir con un IMEI real).
INSERT INTO simulador.camion (id, nombre, tipo_carga, odometro_inicial_km, activo)
VALUES ('900004', 'Camion 4', 'seca', 12000, true);

-- Si es carga refrigerada, los dos setpoints son obligatorios (si faltan, el simulador
-- lo excluye del ciclo con un log explicando el motivo, en vez de fallar el proceso):
-- INSERT INTO simulador.camion (id, nombre, tipo_carga, setpoint_temp_c, setpoint_humedad_pct, odometro_inicial_km, activo)
-- VALUES ('900004', 'Camion 4 - refrigerado', 'refrigerada', 2.5, 87, 12000, true);

-- 2. Su ruta: array ordenado de puntos GPS + índices marcados como parada de entrega.
-- Preferir `npm run crear-ruta -- --nombre "Deposito -> Cliente" --origenLat ... --destinoLat ...`
-- (traza sobre calles reales vía OSRM); este INSERT manual queda como alternativa si no hay
-- OSRM disponible o se quiere una ruta con puntos exactos elegidos a mano.
INSERT INTO simulador.ruta (nombre, puntos, paradas)
VALUES (
  'Depósito -> Cliente',
  '[{"lat":-34.60,"lon":-58.40},{"lat":-34.61,"lon":-58.41},{"lat":-34.62,"lon":-58.42}]'::jsonb,
  '[{"indice":1,"duracionMin":5}]'::jsonb
)
RETURNING id;  -- anotar el id devuelto, ej. 5

-- 3. El viaje que lo pone en marcha (usar el id de ruta del paso anterior).
INSERT INTO simulador.viaje (camion_id, ruta_id, sentido, indice_actual, odometro_actual_km, estado)
VALUES ('900004', 5, 'ida', 0, 12000, 'en_curso');
```

Dentro del ciclo siguiente (≤60 s) el camión nuevo ya está emitiendo tramas.

### Otras operaciones

| Acción | Cómo |
|--------|------|
| Desactivar un camión (sin borrarlo) | `UPDATE simulador.camion SET activo=false WHERE id='900004';` |
| Reactivarlo | `UPDATE simulador.camion SET activo=true WHERE id='900004';` |
| Cambiar el tipo de carga en caliente | `UPDATE simulador.camion SET tipo_carga='refrigerada', setpoint_temp_c=2.5, setpoint_humedad_pct=87 WHERE id='900004';` |
| Reutilizar una ruta en varios camiones | Varios `viaje` pueden apuntar al mismo `ruta_id` — no hace falta duplicar la ruta. |
| Ver solo las lecturas simuladas | `SELECT * FROM telemetria.lectura_telemetria WHERE dispositivo_id LIKE '900%';` (rango reservado, nunca se mezcla con IDs reales) |
| Ver qué `dispositivoId` tienen un camión activo detrás (y si va a responder el endpoint de estado del backend) | `npm run listar-camiones` — ver [`../docs/handoff/dispositivos-simulados.md`](../docs/handoff/dispositivos-simulados.md) |

### Forzar una falla de carga refrigerada (para demos)

Sobre el viaje `en_curso` de un camión con `tipo_carga = 'refrigerada'`:

```sql
-- Apertura de puerta: dispara al llegar a una parada de esa ruta (el índice debe
-- coincidir con uno marcado en ruta.paradas) — pico de temperatura y recuperación después.
UPDATE simulador.viaje
SET falla_tipo = 'apertura_puerta', falla_indice_disparo = 5
WHERE camion_id = '900002' AND estado = 'en_curso';

-- Falla de compresor: sube sostenido sin recuperación desde ese índice en adelante, hasta
-- cruzar el umbral de alerta (7°C, temperatura típica límite para carne fresca).
UPDATE simulador.viaje
SET falla_tipo = 'falla_compresor', falla_indice_disparo = indice_actual
WHERE camion_id = '900002' AND estado = 'en_curso';

-- Volver a operación normal:
UPDATE simulador.viaje SET falla_tipo = NULL, falla_indice_disparo = NULL
WHERE camion_id = '900002' AND estado = 'en_curso';
```

Como mucho una falla activa por viaje (ver `spec.md`, Edge Cases).

### Sobrecalentamiento de motor (feature 016)

Cada trama lleva la temperatura del refrigerante del motor (campo CAN `2A`). En operación normal
queda entre 80 y 95 °C. Un sobrecalentamiento la sube 2 °C por trama hasta 115 °C. Al terminar,
baja 3 °C por trama hasta volver a la banda normal. AgroLinkBackend alerta a partir de 105 °C
(riesgo de detención) y de 110 °C (detención inminente). Es independiente de las fallas de carga
de arriba: un viaje puede tener las dos a la vez.

**Al azar**: cada viaje nuevo (incluida la vuelta automática) sortea una falla con
`MOTOR_FALLA_PROBABILIDAD_PCT` (5 % por defecto; 0 la apaga). Si sale, arranca en un punto al azar
entre el 10 % y el 70 % de la ruta y dura entre `MOTOR_FALLA_DURACION_MIN_MIN` y
`MOTOR_FALLA_DURACION_MAX_MIN` minutos (20–40). Termina antes si el viaje termina o si se desactiva a
mano.

**A mano, sin queries**: el servidor HTTP interno (`PUERTO_HTTP`, sin publicar fuera de la red
de Docker) expone `/camiones/{dispositivoId}/falla-motor`. La falla manual no tiene duración:
sigue hasta que se desactiva o termina el viaje.

```sh
cd deploy
docker compose exec simulador-viajes curl -s -X POST   localhost:8090/camiones/900002/falla-motor  # activar
docker compose exec simulador-viajes curl -s           localhost:8090/camiones/900002/falla-motor  # estado y última temperatura
docker compose exec simulador-viajes curl -s -X DELETE localhost:8090/camiones/900002/falla-motor  # desactivar
```

Con el simulador local (`make simulador`), el mismo `curl` va directo a
`localhost:$SIMULADOR_PUERTO_HTTP`. Respuestas y errores en
`specs/016-alerta-temperatura-motor/contracts/simulador-falla-motor-http.md`.

Variables: `MOTOR_FALLA_PROBABILIDAD_PCT`, `MOTOR_FALLA_DURACION_MIN_MIN`,
`MOTOR_FALLA_DURACION_MAX_MIN`, `MOTOR_SUBIDA_C_POR_TRAMA` y `MOTOR_PICO_C` (debe superar 105). La
subida es por trama, así que con un `SIMULADOR_CICLO_MS` menor sube más rápido. La duración se mide
en minutos de reloj.

### Nivel de combustible y recargas (feature 016)

Cada trama informa el nivel del tanque (CAN `15`, en %). Baja `COMBUSTIBLE_PCT_POR_KM` por km
recorrido (default 0,05) y no se mueve con el camión detenido. Cuando una trama informa menos de
`COMBUSTIBLE_RECARGA_DEBAJO_PCT` (default 7 %), la siguiente ya viene con el tanque al 100 %: el
camión cargó combustible entre las dos. Cada camión arranca con un nivel al azar entre ese umbral y
100 %, así que la flota no baja pareja. El nivel vive en memoria: si el proceso se reinicia, se
vuelve a sortear. El consumo acumulado en litros (CAN `14`) no se reinicia con la carga.

Para ver una recarga rápido en una demo, subir `COMBUSTIBLE_PCT_POR_KM` (por ejemplo `0.5`). En
los logs aparece así:

```json
{"msg":"Camion simulado cargo combustible: tanque al 100 %","camionId":"900001","nivelAnteriorPct":6.98}
```

### Qué pasa al llegar al final de una ruta

El simulador genera automáticamente el viaje de vuelta sobre la misma ruta, en sentido
inverso (mismas paradas), y sigue emitiendo sin intervención manual — alternando ida/vuelta
indefinidamente. Se ve en los logs como:

```json
{"msg":"Viaje completado: generado el viaje de vuelta automatico","camionId":"900001","nuevoSentido":"vuelta"}
```

## Variables de entorno

Ver `deploy/.env.example`. Las relevantes para este proceso:

| Variable | Default | Uso |
|----------|---------|-----|
| `RECEPTOR_HOST` / `RECEPTOR_PORT` | `rinho-receptor` / `5000` | Destino UDP de las tramas |
| `APUNTAR_A_PRODUCCION` | `false` | Debe ponerse `true` **junto con** `RECEPTOR_HOST` apuntando explícitamente a un host de producción — nunca por defecto |
| `DB_HOST` / `DB_PORT` / `POSTGRES_DB` | — | Conexión a la misma TimescaleDB que usa el receptor |
| `SIMULADOR_VIAJES_DB_USER` / `SIMULADOR_VIAJES_DB_PASSWORD` | — | Rol con acceso solo al schema `simulador` (sin permisos sobre `telemetria`) |
| `SIMULADOR_CICLO_MS` | `60000` | Cadencia de emisión — bajarlo (ej. `5000`) es útil para probar más rápido en desarrollo |
| `OSRM_BASE_URL` | `https://router.project-osrm.org` (demo server público) | Servidor OSRM usado por `crear-ruta`/`POST /rutas` para trazar sobre calles reales (feature 011) |
| `PUERTO_HTTP` | _(sin definir)_ | Opcional: si se define, levanta el endpoint `POST /rutas` en ese puerto. Sin ella, sólo queda disponible el CLI. **Nunca** publicar este puerto en `deploy/compose.yaml` (research.md D-04 de la feature 011) |
| `SAMSARA_*` | ver abajo | Emisor de webhooks Samsara simulado (feature 015) |
| `MOTOR_*` | ver arriba | Temperatura de motor y sobrecalentamiento (feature 016) |
| `COMBUSTIBLE_PCT_POR_KM` / `COMBUSTIBLE_RECARGA_DEBAJO_PCT` | `0.05` / `7` | Consumo del tanque por km y umbral de recarga a 100 % (feature 016) |

## Emisor de webhooks Samsara (feature 015)

Ver [`../specs/015-samsara-webhook-exceso-velocidad/`](../specs/015-samsara-webhook-exceso-velocidad/).
Simula a Samsara como **segundo proveedor de telemetría**, solo para los eventos
`SevereSpeedingStarted` y `SevereSpeedingEnded`, sobre una lista cerrada de vehículos
(`src/samsara/vehiculosSamsara.js`: `AGL007`/`AGL008`). Esos vehículos nunca son camiones
Rinho: no tienen ruta ni tramas UDP.

- Solo simula un vehículo **mientras tiene un viaje en curso** en AgroLink. AgroLinkBackend
  avisa el inicio y el fin por `agrolink-ingesta`, que los reenvía a `POST /samsara/viajes` y
  `POST /samsara/viajes/{tripCode}/detencion` de este proceso. Por eso necesita `PUERTO_HTTP`.
- Para cada vehículo lleva una **velocidad interna**, que nunca se envía, alrededor de 72 km/h.
  De vez en cuando aparece una ráfaga de exceso. El webhook sale **solo** cuando esa velocidad
  cruza el umbral (`SAMSARA_LIMITE_KMH + SAMSARA_MARGEN_KMH`, por defecto 100 km/h) hacia
  arriba (Started) o hacia abajo (Ended, como mínimo 20 s después). Al terminar el viaje, un
  exceso abierto se cierra de inmediato.
- Envía a `SAMSARA_WEBHOOK_URL` (`agrolink-ingesta`, red interna) y registra cada envío con su
  resultado. Un fallo no detiene el emisor.
- El estado vive en memoria: si el proceso se reinicia, los viajes en curso se pierden hasta el
  próximo aviso de inicio.

| Variable | Default | Uso |
|----------|---------|-----|
| `SAMSARA_EMISOR_HABILITADO` | `false` | `true` para activarlo, independiente de la simulación Rinho |
| `SAMSARA_WEBHOOK_URL` | compose: `http://agrolink-ingesta:${REPORTES_HTTP_PORT}/api/v1/proveedores/samsara/webhook` | Obligatoria si está habilitado |
| `SAMSARA_LIMITE_KMH` / `SAMSARA_MARGEN_KMH` | `80` / `20` | Umbral de exceso severo = límite + margen (ambos > 0) |
| `SAMSARA_EXCESOS_POR_HORA` | `0.3125` | Ráfagas por hora de viaje (≈ 2,5 cada 8 h). **Para una demo corta, `6`** (~1 cada 10 min) |
| `SAMSARA_CICLO_MS` | `5000` | Paso del modelo de velocidad (≥ 1000) |

## Tests

```bash
npm test
```

Cobertura: avance de ruta y paradas (`test/domain/avanceRuta.test.js`), síntesis CAN
(`test/domain/sintesisCan.test.js`), síntesis BLE — normal, apertura de puerta, falla de
compresor (`test/domain/sintesisBle.test.js`), construcción de trama y checksum
(`test/protocol/frameBuilder.test.js`), reintentos ante falta de ACK
(`test/net/udpClient.test.js`), validación del rango de `id` reservado
(`test/db/flotaRepository.test.js`), generación de rutas vía OSRM — éxito, distancia trivial,
OSRM sin ruta/caído (`test/services/routeGenerationService.test.js`), y persistencia/nombre
duplicado (`test/db/rutaRepository.test.js`).

## Diseño interno (por qué está armado así)

- **Reutiliza `rinho-receptor/test/tools/buildFrame.js`** por import relativo entre
  proyectos (`src/protocol/frameBuilder.js`) en vez de reimplementar la construcción de
  tramas: es el punto de mayor riesgo de que una trama simulada no calce con lo que el
  receptor real espera. Ver `research.md` D-01.
- **No escribe nunca en `telemetria.lectura_telemetria`** directo: solo envía UDP al
  receptor real, que es quien persiste — el mismo camino que seguiría un dispositivo físico.
- **RPM/combustible/presión de aceite se sintetizan** (`src/domain/sintesisCan.js`) porque
  el equipo real usado para capturar la ruta de referencia del camión 1 no los reportaba de
  forma confiable (confirmado decodificando tramas de campo byte a byte).
- **`crear-ruta` (CLI) y `POST /rutas` (HTTP) son wrappers delgados sobre el mismo
  `routeGenerationService`** (`src/services/routeGenerationService.js`): ninguno de los dos
  duplica la lógica de validar, llamar a OSRM y persistir — ver
  `specs/011-generar-ruta-simulada/research.md` D-05. El endpoint HTTP nunca se publica al
  host (D-04): sólo lo llaman procesos dentro de la misma red de Docker compose.
