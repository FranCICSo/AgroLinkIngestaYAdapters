# Runbook: AgroLink Ingesta y Adaptación de Telemetría

Stack: `timescaledb` + `rinho-receptor` (Node.js, UDP) + `agrolink-ingesta` (Spring Boot,
HTTP solo lectura), en una VM de Azure (Standard_B2pls_v2, ARM64; ver feature 017-migracion-vm-azure).
Hasta noviembre de 2026 corrió en una VM Oracle Cloud Ampere A1 (ARM64), hoy perdida.

## 1. Imágenes verificadas para amd64 y arm64

Verificado con `docker manifest inspect` el 2026-11-15 (la verificación original, T005 del
2026-08-15, cubría solo arm64). Todas publican `linux/amd64` y `linux/arm64`, así que el
stack corre en VMs x86_64 (producción actual en Azure) y ARM64. Decisión D-11 sigue vigente:
`timescale/timescaledb-ha` NO es multi-arch y no se usa.

| Imagen | Tag | Digest `linux/amd64` | Digest `linux/arm64` |
|--------|-----|----------------------|----------------------|
| TimescaleDB | `timescale/timescaledb:2.17.2-pg16` | `sha256:d592c3111392bf8f6ea82651cc581c5dc650ecb543eef6637c2bf19eeb7e37a2` | `sha256:e610e266d36172ffe755b67d7fc9673fa674b479bbad5039757f3e5230f95e33` |
| Node.js (receptor, simulador) | `node:22-alpine` | `sha256:12f54cafa58d0e96554ae05871e29663ff7241836377dc9a7916449b8adb062c` | `sha256:286344ef340c151df65af44a8c8cf2996c1783073d49b88fabcf90a56ea82023` |
| JRE (ingesta) | `eclipse-temurin:21-jre-alpine` | `sha256:b6ea71e690a72ba240b3d1b5c477410014862f9ea2cc73ab40e41ff21b03ba1c` | `sha256:23853301373ae9089be2f2d59113c749c7d1ebd140609dec30f1d9bd34d89a32` |
| Maven (build) | `maven:3.9-eclipse-temurin-21` | `sha256:80034909d9a9f0b89d3d2c583f07f3b7650309bc4e6b886ad5b860b9e1bfa439` | `sha256:71a6832f657180ea206901ffc548c0e73a257cb09b4912619177586d0268d59c` |

`node:22-alpine` y `eclipse-temurin:21-jre-alpine` son tags flotantes (sus digests cambian
con cada release; los de arriba son los del día de la verificación). Las imágenes propias de
GHCR (`agrolink-ingesta`, `rinho-receptor`, `simulador-viajes`) se publican para las dos
arquitecturas desde el CI (§7). Si se cambia algún tag base, verificar que siga publicando
`linux/amd64` antes de subirlo.

## 2. Puesta en marcha (VM Azure)

Producción actual: VM `agrolink-ingesta` en el grupo `agrolink-rg`, Azure for Students,
**Canada Central**, `Standard_B2pls_v2` (2 vCPU Ampere ARM64, 4 GB), Ubuntu 24.04 LTS,
IPv4 estática **`20.151.0.131`**, usuario `ubuntu`. Decisiones y motivos en
`specs/017-migracion-vm-azure/plan.md`. Hasta noviembre de 2026 corría en una VM Oracle Cloud
Ampere A1 (`137.131.255.202`), perdida al suspenderse la tenancy.

Todos los comandos de Azure se corren en **Azure Cloud Shell** (portal → ícono `>_` → Bash),
donde `az` ya está autenticado. Los scripts se suben con **Manage files → Upload**.

### 2.1 Elegir región y tamaño

La suscripción de estudiante solo permite 5 regiones (policy "Allowed resource deployment
regions") y no todos los tamaños de VM. **No elegir a ciegas**: el portal puede ofrecer un
tamaño que después se rechaza con `NotAvailableForSubscription`.

```bash
bash list-available-sizes.sh     # deploy/azure/: tamaños de 4-8 GB habilitados, con precio/mes
```

Solo lee: no crea nada ni consume crédito. Tarda de 1 a 3 minutos por región. Las regiones y el
rango se cambian con `REGIONS="..." MIN_GB=4 MAX_GB=8`. Elegir la más barata que tenga
**4 GB o más**. El stack corre en ARM64 y en x86_64: las imágenes son multi-arch (§1).

### 2.2 Crear la VM y las reglas de red

Subir `deploy/azure/provision.sh` y la clave pública SSH como `ssh-key.pub` en la misma carpeta.
Hoy es `ssh-key-2026-08-11.key.pub`, cuya privada está en los secrets del CI.

```bash
bash provision.sh                                         # defaults: canadacentral, B2pls_v2
VM_SIZE=Standard_B2als_v2 LOCATION=chilecentral bash provision.sh   # otra región o tamaño
BACKEND_IP=64.181.162.233 bash provision.sh               # además abre 8082 solo al backend
```

El script:

1. Verifica que la región esté permitida y que el tamaño esté habilitado para la suscripción.
   Si alguna de las dos cosas falla, aborta sin crear nada.
2. Crea el grupo de recursos, el NSG, la IPv4 estática Standard y la VM. La imagen Ubuntu 24.04
   se elige sola según la arquitectura del tamaño.
3. Imprime la IP pública.

Es **re-ejecutable**: si la VM ya existe, no la recrea (la IP se conserva). Se vuelve a correr
para agregar la regla del backend. Si `az vm create` falla por *security type* o *Trusted
Launch*, reintentar con `SECURITY_TYPE=Standard`.

Reglas de entrada del NSG (todo lo demás entrante queda denegado):

| Regla | Protocolo/puerto | Origen | Por qué |
|-------|------------------|--------|---------|
| `allow-ssh` | TCP 22 | cualquiera | GitHub Actions despliega desde IPs no fijas. Solo clave, sin root ni contraseña (§2.4). |
| `allow-rinho-udp` | **UDP** 5000 | cualquiera | Los equipos reportan desde IPs celulares variables. Protección: checksum y dispositivo conocido. |
| `allow-backend-ingesta` | TCP 8082 | solo `BACKEND_IP` | Consulta de estado de vehículo (feature 002). Sigue en HTTP sin cifrar (ver Complexity Tracking del plan 017). |

PostgreSQL (5432) y los puertos internos (8081 del receptor y 8083 de reportes) **nunca** se
exponen.

> ⚠️ **Trampa**: la regla del receptor tiene que ser **UDP**. Con TCP, el stack queda
> `healthy` pero el dispositivo nunca logra reportar, y no aparece ningún error en los logs.
>
> En Azure, a diferencia de OCI, **no hay una segunda capa de firewall en el SO**: la imagen
> Ubuntu trae `iptables` con política ACCEPT, y el filtrado lo hace solo el NSG.
>
> Si cambia la IP de salida del backend, el estado de vehículo deja de responder (timeout).
> Se corrige volviendo a correr `provision.sh` con la `BACKEND_IP` nueva.

### 2.3 Contraseñas — de dónde salen

Son locales al stack y se aplican una sola vez, cuando `timescaledb` arranca sobre un volumen
vacío (los scripts de `deploy/db/` corren vía `docker-entrypoint-initdb.d`):

- `POSTGRES_SUPERUSER_PASSWORD`: superusuario `postgres`.
- `RINHO_RECEPTOR_DB_PASSWORD`: rol `rinho_receptor` (receptor UDP; ver `deploy/db/02-roles.sql`).
- `AGROLINK_INGESTA_DB_PASSWORD`: rol `agrolink_ingesta`.
- `SIMULADOR_VIAJES_DB_PASSWORD`: rol del simulador.

En la VM de Azure se reutilizaron las de la VM de OCI (decisión D-05 del plan 017), tomadas de
la copia local de `deploy/.env`. Para una instalación nueva, generarlas:

```bash
cd deploy
cp .env.example .env
for var in POSTGRES_SUPERUSER_PASSWORD RINHO_RECEPTOR_DB_PASSWORD AGROLINK_INGESTA_DB_PASSWORD SIMULADOR_VIAJES_DB_PASSWORD; do
  echo "$var=$(openssl rand -base64 24)"
done
$EDITOR .env   # pegar los valores generados
```

> ⚠️ Si se pierde `.env` después del primer arranque, la contraseña no se puede recuperar:
> hay que resetearla con `ALTER ROLE ... PASSWORD '...'` como `postgres`. Guardar `.env` en un
> gestor de contraseñas, no solo en la VM.

`deploy/.env` **nunca se commitea** (Principio VI): está en `.gitignore`.

### 2.4 Preparar la VM y levantar el stack

Desde la máquina de desarrollo, con la clave privada SSH. **Copiar `deploy/` desde
`origin/master` actualizado**, que es lo mismo que despliega el CI: si la copia local está
atrasada, se aplican menos migraciones de las que espera la imagen `latest` de GHCR (incidente 1
del plan 017).

```bash
IP=20.151.0.131; KEY=ssh-key-2026-08-11.key
git fetch origin && git switch --detach origin/master    # o un worktree de origin/master
ssh -i $KEY ubuntu@$IP 'mkdir -p ~/AgroLinkIngestaYAdapters'
rsync -az --exclude 'azure/' -e "ssh -i $KEY" deploy ubuntu@$IP:AgroLinkIngestaYAdapters/
ssh -i $KEY ubuntu@$IP 'cd ~/AgroLinkIngestaYAdapters/deploy && ./vm-setup.sh'
```

`vm-setup.sh` es idempotente:

1. Instala Docker Engine y el plugin de Compose.
2. Agrega `ubuntu` al grupo `docker`.
3. Deja el filtrado al NSG (abre el UDP en el SO solo si detecta ufw o iptables restrictivos).
4. Desactiva el login SSH de root y por contraseña (`/etc/ssh/sshd_config.d/60-agrolink.conf`).
5. Crea un swap de 2 GB.
6. Si existe `deploy/.env`, hace `docker compose up -d`.

**Abrir una sesión SSH nueva** después del primer `vm-setup.sh`. La sesión anterior no tiene el
grupo `docker`, y `docker ps` da `permission denied ... docker.sock` (o usar `newgrp docker`).

Levantar en orden (sesión nueva, en `~/AgroLinkIngestaYAdapters`):

```bash
set -a; . deploy/.env; set +a
docker compose -f deploy/compose.yaml pull timescaledb rinho-receptor agrolink-ingesta
docker compose -f deploy/compose.yaml up -d --wait timescaledb
deploy/scripts/apply-migrations.sh deploy/compose.yaml deploy/migrations POSTGRES_DB
docker compose -f deploy/compose.yaml up -d --wait rinho-receptor agrolink-ingesta
# Opcional: simulador (mismos pasos que el job deploy-simulador del CI, §7.2)
docker compose -f deploy/compose.yaml exec -T timescaledb psql -U postgres -d "$POSTGRES_DB" \
  -v ON_ERROR_STOP=1 -q -f - < deploy/seed/simulador-camion-1.sql
docker compose -f deploy/compose.yaml --profile simulador up -d --no-deps simulador-viajes
```

Las imágenes de GHCR son públicas: no hace falta `docker login` para el `pull`.

Memoria (VM de 4 GB): los límites de `compose.yaml` suman unos 2,4 GB (TimescaleDB 1536m con
`TS_TUNE_MEMORY=1GB`, ingesta 512m, receptor 256m, simulador 128m). Con todo corriendo se miden
unos 870 MB usados.

### 2.5 Creación de la base de datos

**No es un paso manual aparte.** `deploy/db/01-schema.sql`, `02-roles.sql` y
`03-schema-simulador.sql` se montan como `docker-entrypoint-initdb.d` y corren **una sola vez**,
la primera vez que `timescaledb` arranca sobre un volumen vacío. Después,
`apply-migrations.sh` aplica en orden las migraciones de `deploy/migrations/` que falten, y las
registra en `public.schema_migrations`. Es el mismo script que corre el CI en cada deploy.

Para recrear la base desde cero hay que **borrar el volumen**:

```bash
docker compose -f deploy/compose.yaml down
docker volume rm deploy_timescaledb-data   # ⚠️ destruye todos los datos persistidos
```

No hay backups (decisión D-06 del plan 017): la plataforma solo usa el último estado de cada
vehículo.

### 2.6 Verificar

```bash
docker compose -f deploy/compose.yaml ps   # todos running y healthy
docker logs -f --since 5m rinho-receptor   # tramas llegando en vivo
docker exec deploy-timescaledb-1 sh -c 'psql -U postgres -d "$POSTGRES_DB" -c "select momento_evento, momento_recepcion, latitud, longitud, velocidad_kmh, ignicion, odometro_km, estado_interpretacion from telemetria.lectura_telemetria where dispositivo_id = 860693084873877::text order by momento_evento desc limit 10;"'
curl -s http://127.0.0.1:8082/api/v1/vehiculos/860693084873877/estado
```

`agrolink-ingesta` puede tardar hasta unos 2 minutos en pasar a `healthy` (arranque en frío de
la JVM). Si el scheduler de viajes programados loguea `column ... does not exist`, faltan
migraciones: volver a copiar `deploy/` desde `origin/master` y correr `apply-migrations.sh`.

> ⚠️ **No mandar tramas sintéticas a producción** para probar. Quedan como lecturas, y el
> Principio IV prohíbe borrarlas. Verificar con el dispositivo real, o con el stack local
> (§2.7).

### 2.6b Reprogramar el dispositivo Rinho a una IP nueva

Cada vez que cambia la IP del servidor, el equipo tiene que reprogramarse: el destino está
grabado en el dispositivo, no se resuelve por DNS. Enviar por el medio de configuración que
se use con el equipo:

```text
>SIP020.151.0.131/5000<     canal principal
>SIP420.151.0.131/5000<     canal celular (GPRS)
```

- Antes de la migración, el canal `SIP4` apuntaba a `192.168.1.44/5000`, una IP **privada**
  que no se alcanza desde la red celular. Por eso tiene que apuntar a la IP pública, igual que
  `SIP0`.
- El resto de la configuración del equipo (protocolo, APN, WiFi, timers y reglas de reporte)
  no cambia. La contraseña del WiFi **no se versiona** (Principio V).
- Al conectarse, el equipo manda primero las tramas que acumuló sin confirmar. Llegan con
  `momento_evento` atrasado y se guardan sin conflicto (Principio VII). Es normal ver durante
  unos minutos lecturas de horas atrás.
- Confirmación: la consulta de §2.6 muestra lecturas con `momento_recepcion` reciente.

## 2.7 Levantar el stack localmente (para desarrollo, sin VM)

Es el mismo stack, sin las secciones específicas de Azure (§2.1, §2.2):

```bash
cd deploy
cp .env.example .env && $EDITOR .env   # mismas contraseñas locales, ver §2.3
docker compose up -d
docker compose ps
```

Diferencias con la VM:

- No hace falta `vm-setup.sh` ni abrir ningún puerto en un firewall de nube — solo el que
  eventualmente tenga el propio SO local (usualmente ya abierto en un entorno de desarrollo).
- Para enviar tramas de prueba, usar `127.0.0.1` en vez de la IP pública de la VM en los
  comandos `nc -u` de `quickstart.md` §3 y §7.
- El dispositivo real, al estar en otra red, no puede alcanzar un stack corriendo solo en
  `localhost` — para probar contra hardware real hace falta la VM (o un túnel).

### 2.7.1 Datos de telemetría de ejemplo (`make seed-telemetry`)

Para no tener que enviar tramas UDP reales solo para ejercitar los endpoints de lectura,
`make seed-telemetry` inserta dos lecturas reales ya observadas del dispositivo
`860693084873877` directamente en `lectura_telemetria` (ver
`specs/006-seed-lectura-telemetria/`). Es idempotente (se puede correr varias veces sin
duplicar filas) y usa el rol `rinho_receptor` — el script vive en `deploy/seed/`, nunca en
`deploy/db/`, así que nunca se ejecuta automáticamente ni en el stack local ni en la VM de
producción; hay que invocarlo a mano.

### 2.7.2 Simulador de viajes con camiones ficticios (`simulador-viajes`)

A diferencia del seed anterior, `simulador-viajes` sí envía tramas UDP reales contra
`rinho-receptor` — ejercita el camino completo (parseo, checksum, ACK, persistencia) sin
depender de hardware Rinho físico. Ver la especificación completa en
`specs/009-simulador-viajes/` y la guía paso a paso en
`specs/009-simulador-viajes/quickstart.md`. Para el día a día (agregar/editar camiones,
forzar una falla de carga refrigerada, variables de entorno), ver
[`../simulador-viajes/README.md`](../simulador-viajes/README.md).

Vive en `profiles: ["simulador"]` del `compose.yaml`: nunca arranca con un `docker compose
up` normal, hay que pedirlo explícitamente:

```bash
cd deploy
# 1. Una sola vez: aplicar el schema `simulador` (no viaja en 01-schema.sql para no
#    mezclar la config mutable de esta herramienta con el schema insert-only de telemetría)
docker compose exec -T timescaledb psql -U postgres -d "$POSTGRES_DB" \
  -f /docker-entrypoint-initdb.d/03-schema-simulador.sql   # o vía docker cp si el volumen ya existía

# 2. Cargar el camión 1 de referencia (ruta real de 88 puntos, odómetro inicial 150200 km)
docker cp seed/simulador-camion-1.sql deploy-timescaledb-1:/tmp/
docker compose exec -T timescaledb psql -U postgres -d "$POSTGRES_DB" -f /tmp/simulador-camion-1.sql

# 3. Levantarlo (apunta a local por defecto — nunca a la VM de producción sin
#    APUNTAR_A_PRODUCCION=true explícito en .env, ver FR-012)
docker compose --profile simulador up simulador-viajes
```

Administrar la flota (agregar/editar camiones, forzar una falla de carga refrigerada, etc.)
es directo por `psql`/DataGrip sobre el schema `simulador`, sin reiniciar el proceso — el
simulador relee la configuración en cada ciclo de 60s.

### 2.7.3 Generación de rutas simuladas y OSRM (feature 011)

En vez de armar `simulador.ruta` a mano (INSERT con el array de puntos copiado a ojo), ver
`specs/011-generar-ruta-simulada/quickstart.md`: un comando (`npm run crear-ruta --`) o un
endpoint HTTP interno (`POST /rutas`, no publicado al host) generan y persisten la ruta
trazando sobre calles reales. Esa generación usa el demo server público de OSRM
(`OSRM_BASE_URL`, default `https://router.project-osrm.org`), no un contenedor propio: la imagen
`osrm/osrm-backend` no corre en la VM de producción (ARM). El demo server tiene rate limiting
(~1 req/s) y no garantiza disponibilidad; si no responde, la generación de la ruta falla con
`trazado_no_disponible` sin persistir nada.

## 3. Reinicio sin pérdida de datos (T020) — ✅ verificado

`docker compose restart <servicio>` deja cada contenedor `healthy` de nuevo sin perder
configuración ni filas ya persistidas (el volumen de `timescaledb` es persistente).
Verificado con `timescaledb` y `rinho-receptor`: 4 filas antes del restart, 4 después;
ambos servicios volvieron a `healthy` en menos de 15 segundos.

## 4. Verificación de inmutabilidad a nivel de motor (T062) — ✅ verificado

Ejecutado contra el stack real (`deploy compose up`) con el rol `rinho_receptor`:

```
$ docker compose exec -T timescaledb psql -U rinho_receptor -d agrolink_telemetria \
    -c "SET search_path TO telemetria; UPDATE lectura_telemetria SET velocidad_kmh = 999 WHERE dispositivo_id = '037883';"
ERROR:  permission denied for table lectura_telemetria

$ docker compose exec -T timescaledb psql -U rinho_receptor -d agrolink_telemetria \
    -c "SET search_path TO telemetria; DELETE FROM lectura_telemetria WHERE dispositivo_id = '037883';"
ERROR:  permission denied for table lectura_telemetria
```

Ambos rechazados por el motor, tal como exige el Principio IV — la inmutabilidad no
depende de que ningún camino de código "se olvide" de emitir un `UPDATE`/`DELETE`.

## 5. Mejora de seguridad pendiente antes de operar flota real (T064)

El tramo dispositivo→receptor viaja en UDP sin cifrar (carve-out del Principio VI v1.1.0,
ver Complexity Tracking de `plan.md`). Los controles compensatorios ya activos son
aislamiento de red (solo el puerto UDP se publica) y validación de checksum + `ID` conocido.

**Antes de operar más de un vehículo piloto**, agregar un tercer control: filtrado del
puerto UDP por rango de IP/APN del operador celular en la regla `allow-rinho-udp` del NSG de
Azure (§2.2), para que
solo tráfico del operador de la flota pueda alcanzar el receptor. No implementado todavía
porque el piloto de un solo camión no lo requiere con urgencia, pero queda registrado como
condición de escalado, no como mejora opcional.

## 6. Hallazgos de la validación end-to-end con dispositivo real (US6)

_Esta sección se completa durante T056–T061, con el dispositivo real conectado. No se debe
dar por buena ninguna fila producida por el equipo hasta completarla:_

- **Layout real vs. documentado (R-1)**: ✅ verificado el 2026-08-17 contra el equipo piloto
  (`860693084873877`, entorno local) — la sección GPS de 66 caracteres decodifica bien tanto
  para tramas `RCQ` (backlog con la config anterior del equipo) como `REQ`.
- **Bit de ignición (R-7)**: _pendiente — ver T070. Las tramas capturadas hasta ahora son
  todas con motor apagado; falta una captura con el motor encendido para contrastar._
- **`;#msgNum` presente en tramas reales (R-4)**: ✅ verificado — el equipo emite `#msgNum`
  y el receptor confirma el ACK correctamente (T059).
- **Hora local en vez de UTC (D-14, hallazgo nuevo)**: el equipo piloto reportó la hora de
  la trama en hora local de Argentina (UTC-3) en vez de UTC como documenta el fabricante —
  causa raíz: se corrigió el reloj del equipo a mano en local, sin fix GPS de hora. Se agregó
  `DEVICE_HORA_UTC_OFFSET_HOURS` (ver `.env.example` y `research.md` D-14) como parche de
  despliegue. **2026-08-17, hallazgo adicional**: el modo hora del equipo no sobrevive a un
  reinicio — tras reiniciarse a mitad de una sesión de prueba, el equipo volvió solo al
  default de fábrica (UTC), y el parche estático `+3` quedó sumando de más sobre esas tramas
  (verificado comparando `payload_crudo` contra `momento_recepcion` en TimescaleDB: sin el
  offset, las tramas post-reinicio calzan con la recepción; con el offset, quedan hasta 3h en
  el futuro). Se reconfiguró el reloj del equipo en UTC de forma persistente y se volvió
  `DEVICE_HORA_UTC_OFFSET_HOURS` a `0` en `deploy/.env`. Si el equipo vuelve a mostrar hora
  local tras un reinicio, no reintroducir el offset estático sin antes confirmar que el modo
  persiste entre reinicios — de lo contrario el parche corrige unas tramas y rompe otras.
- **Latencia end-to-end medida (SC-001)**: _pendiente — ver T060_
- **Concurrencia multi-camión (SC-004 / FR-007, T061)** — ✅ verificado con tramas
  simuladas: 5 `ID` distintos enviados en paralelo con `test/tools/buildFrame.js`, cada
  uno con exactamente 1 fila propia en la base, sin cruces. Reproducible con
  `quickstart.md` §7.

## 7. CI/CD Automatizado

`.github/workflows/ci-cd.yml` hace en cada push a `master` (o `workflow_dispatch` manual):
`test` (mvn) → `build-and-push` (imágenes `linux/amd64` + `linux/arm64` de `agrolink-ingesta` **y**
`rinho-receptor` a `ghcr.io`, cada una con su propio tag) → `migrate-and-deploy` (aplica
migraciones de esquema pendientes, luego reinicia `agrolink-ingesta` y `rinho-receptor`
—`timescaledb` queda intacto— y verifica el healthcheck de cada uno). Contrato completo:
`specs/007-cicd-deploy-ghcr/contracts/ci-cd-workflow.md`.

> ⚠️ Reiniciar `rinho-receptor` en cada deploy interrumpe por unos segundos la recepción
> UDP de cualquier equipo de campo que esté reportando justo en ese momento. Es un
> trade-off aceptado a propósito (antes, ese servicio no se redesplegaba nunca y podía
> quedar corriendo código desactualizado sin que nadie lo notara).

### Secrets requeridos en el repo (Settings → Secrets and variables → Actions)

| Secret | Uso |
|--------|-----|
| `CR_PAT` | GitHub PAT (`write:packages`/`read:packages`) — lo usa la VM para `docker login ghcr.io` y hacer `pull` de la imagen nueva. |
| `DEPLOY_HOST` | IP pública de la VM de producción (hoy `20.151.0.131`, Azure). |
| `DEPLOY_USER` | Usuario SSH en la VM (`ubuntu`). |
| `DEPLOY_SSH_KEY` | Clave privada SSH de ese usuario (sin passphrase — `appleboy/ssh-action` no soporta desbloqueo interactivo). |

`GITHUB_TOKEN` (implícito, sin configuración) autentica el `push` a `ghcr.io` desde el
job `build-and-push` — no hace falta crearlo como secret.

### 7.1 Schema del simulador (`simulador-viajes`) en el `migrate-and-deploy` normal

El job `migrate-and-deploy` de cada push a `master` ya aplica
`deploy/migrations/004_add_simulador_schema.sql` (mismo mecanismo que las demás
migraciones): crea el schema `simulador` y su rol dedicado en la VM aunque el simulador
todavía no se haya desplegado ahí — deja la base lista de antemano.

> ⚠️ **Precondición manual, una sola vez**: esa migración hace `\getenv
> SIMULADOR_VIAJES_DB_PASSWORD` para crear el rol. Como `timescaledb` **no se reinicia** en
> cada deploy (§7, arriba), hay que agregar `SIMULADOR_VIAJES_DB_USER` y
> `SIMULADOR_VIAJES_DB_PASSWORD` al `deploy/.env` de la VM (mismo formato que
> `.env.example`) **antes** de que corra este pipeline por primera vez con esta feature —
> `apply-migrations.sh` reenvía esa variable al `exec` explícitamente (ver comentario en el
> script) precisamente para no depender de si `timescaledb` ya la tiene "horneada" en su
> entorno o no, pero igual necesita que exista en el `.env` que lee la sesión SSH del job.

### 7.2 Desplegar el simulador en la VM (manual, `workflow_dispatch`)

El simulador es una herramienta de demo/dev, no parte del stack de producción: no se
construye ni se publica en `build-and-push`, y `migrate-and-deploy` nunca lo levanta. Para
correrlo en la VM hay que disparar el workflow a mano desde la pestaña *Actions* → **Run
workflow**, tildando el input **"Desplegar simulador-viajes"**. Eso agrega dos jobs:

- `build-and-push-simulador`: build+push de `ghcr.io/.../...-simulador-viajes` (`linux/amd64` + `linux/arm64`).
- `deploy-simulador`: en la VM, aplica el camión 1 de referencia
  (`deploy/seed/simulador-camion-1.sql`, idempotente) y levanta el contenedor con
  `docker compose --profile simulador up -d --no-deps simulador-viajes` — apunta al
  `rinho-receptor` de esa misma VM por nombre de servicio (no hace falta
  `APUNTAR_A_PRODUCCION`: al correr *en* la VM, "local" ya es esa VM).

Bajarlo de nuevo es manual: `ssh` a la VM y `docker compose --profile simulador stop
simulador-viajes` (el pipeline no lo detiene solo).

> **Requisito para la feature 013-autostart-simulacion-viaje**: el `deploy/.env` de la VM
> necesita `SIMULADOR_PUERTO_HTTP=8090` (no se puede fijar desde el repo — ese archivo nunca
> se commitea, Principio VI). Sin esa variable, el servidor HTTP de `simulador-viajes`
> (`POST /rutas`) no levanta, y `agrolink-ingesta` (que por default apunta a
> `http://simulador-viajes:8090`) no va a poder arrancar ninguna simulación aunque el
> contenedor esté corriendo — cada intento queda en `ERROR`, logueado, sin romper el alta
> del viaje. Confirmar este valor en el `.env` de la VM **antes** de disparar
> `deploy_simulador`.

## 8. Salida: cuando se termine el crédito de Azure

El crédito de Azure for Students (100 USD) alcanza, a unos 30,6 USD/mes (VM más IPv4), más o
menos hasta **fines de febrero de 2027**. Cuando se agota, Azure **apaga** los recursos: no
cobra, pero el servicio se corta y la base se pierde. Ejecutar este procedimiento **antes del
15/02/2027**, o antes si llega la alerta del 90 % del presupuesto.

No hay datos que salvar (sin backups, decisión D-06 del plan 017). Mudarse es recrear el
servidor:

1. **Servidor nuevo.** En otra suscripción u otro proveedor, crear una VM Ubuntu 24.04 de 4 GB
   o más (ARM64 o x86_64; las imágenes son multi-arch, §1) con IPv4 fija.
   - Reglas de entrada: UDP 5000 abierto, TCP 8082 solo desde la IP del backend, SSH solo por
     clave.
   - En Azure: §2.1 y §2.2. En otro proveedor, replicar esas mismas reglas en su firewall de red.
2. **Stack.** Seguir §2.4: copiar `deploy/` desde `origin/master` y `deploy/.env`,
   `vm-setup.sh`, migraciones, servicios y, si hace falta, el simulador. Verificar con §2.6.
3. **CI.** Actualizar el secret `DEPLOY_HOST` con la IP nueva (y `DEPLOY_USER` o
   `DEPLOY_SSH_KEY` si cambian).
4. **Backend.** En la VM del backend, poner `AGROLINK_INGESTA_BASE_URL=http://<IP nueva>:8082`
   en `.env.production` y recrear el contenedor
   (`docker compose -f docker-compose.prod.yml up -d --no-deps backend`). Actualizar también el
   valor por defecto en `AgroLinkBackend/src/main/resources/application-prod.yml` y su test
   (`TelemetryProfileConfigTest`).
5. **Dispositivo.** Reprogramar el Rinho a la IP nueva (§2.6b), en `SIP0` y `SIP4`.
6. **Viajes programados.** Los pendientes vivían en la base vieja
   (`ingesta.viaje_programado`): volver a programarlos desde el backend.
7. **Apagar Azure.** Cuando el servidor nuevo reciba tramas del Rinho, borrar el grupo de
   recursos para no dejar nada consumiendo crédito:
   ```bash
   az group delete --name agrolink-rg --yes   # borra VM, disco, IP y NSG
   ```
