# Runbook: AgroLink Ingesta y Adaptación de Telemetría

Stack: `timescaledb` + `rinho-receptor` (Node.js, UDP) + `agrolink-ingesta` (Spring Boot,
HTTP solo lectura), en una VM Oracle Cloud Always Free (Ampere A1, ARM64).

## 1. Imágenes verificadas para ARM64 (T005)

Verificado con `docker manifest inspect` el 2026-08-15. Los tres tienen manifiesto
`linux/arm64/v8`, condición necesaria para correr en la VM Ampere A1 (decisión D-11:
`timescale/timescaledb-ha` NO es multi-arch y hubiera roto el despliegue).

| Imagen | Tag fijado | Digest `linux/arm64` |
|--------|-----------|----------------------|
| TimescaleDB | `timescale/timescaledb:2.17.2-pg16` | `sha256:e610e266d36172ffe755b67d7fc9673fa674b479bbad5039757f3e5230f95e33` |
| Node.js (receptor) | `node:22-alpine` | `sha256:1ef15d33d74602021f35ec64a4e72f4a21e2cfa68ebecd125fbe0c44af8f604a` |
| JRE (reportes) | `eclipse-temurin:21-jre-alpine` | `sha256:98d19c48d65577f7a09316b88f1cbf3fa8c6f7fad44c44587554977e3b5c1721` |

Estos son los tags que `deploy/compose.yaml` fija (T016). Si se actualiza alguno, repetir
esta verificación antes de subir el tag — no asumir que un tag "latest" o una versión mayor
sigue publicando ARM64.

## 2. Puesta en marcha (VM Oracle Ampere A1)

### 2.1 Crear la VM

Shape `VM.Standard.A1.Flex`, Always Free (hasta 4 OCPU / 24 GB, este stack usa
2 OCPU / 12 GB), imagen **Ubuntu ARM64** (`aarch64`). No hace falta instalar Docker a mano:
el script `deploy/vm-setup.sh` (§2.4) lo hace.

### 2.2 Abrir el puerto UDP — dos capas, hacen falta las dos

**a) Security List (o NSG) de la VCN**, en la consola de Oracle Cloud:

1. **Networking → Virtual Cloud Networks →** la VCN de la VM **→ Security Lists** (o
   **Network Security Groups** si la VM usa NSG en vez de Security List clásica).
2. **Add Ingress Rules**.
3. Completar:
   - **Source CIDR**: `0.0.0.0/0` (o el rango del operador celular del dispositivo, si se
     conoce — ver la nota de escalado en §5).
   - **IP Protocol**: **UDP** (no TCP).
   - **Destination Port Range**: `5000` (o el valor de `UDP_PORT` en `.env`).
4. Guardar.

**b) Firewall del sistema operativo dentro de la VM.** Las imágenes Ubuntu de Oracle Cloud
traen reglas `iptables` que bloquean todo lo que no sea SSH, **además** de la Security
List — abrir solo la (a) no alcanza. `vm-setup.sh` abre esta capa automáticamente
(`iptables -I INPUT -p udp --dport 5000 -j ACCEPT`, persistido con
`netfilter-persistent` si está disponible).

> ⚠️ **Trampa**: si se abre el puerto en TCP en cualquiera de las dos capas, o se abre UDP
> en una sola de las dos, el stack queda arriba y aparentemente sano (los tres contenedores
> `healthy`), pero el dispositivo real nunca logra reportar y no hay ningún error visible en
> los logs. Si al final de la guía no llega ninguna trama, revisar esto primero — con:
> ```bash
> sudo iptables -L INPUT -n | grep 5000
> ```

### 2.2b Abrir el puerto de la consulta de estado de vehículo (feature 002)

`agrolink-ingesta` publica un segundo puerto, dedicado exclusivamente a
`GET /api/v1/vehiculos/{dispositivoId}/estado` (`VEHICULO_ESTADO_HTTP_PORT`, research.md
D-01 de la feature 002). El puerto de reportes (`REPORTES_HTTP_PORT`) sigue **sin**
publicarse — esta regla es solo para el puerto nuevo.

Mismas dos capas que en §2.2, pero en **TCP**:

**a) Security List (o NSG) de la VCN**: **Add Ingress Rules** con **Source CIDR**
`0.0.0.0/0` (o el rango de red de AgroLinkBackend, si se conoce), **IP Protocol** **TCP**,
**Destination Port Range** `8082` (o el valor de `VEHICULO_ESTADO_HTTP_PORT` en `.env`).

**b) Firewall del sistema operativo dentro de la VM**:

```bash
sudo iptables -I INPUT -p tcp --dport 8082 -j ACCEPT
sudo netfilter-persistent save   # si está disponible
```

Verificar con `docker compose ps`: `agrolink-ingesta` debe listar **ese** puerto en
`PORTS`, y ningún puerto correspondiente a `REPORTES_HTTP_PORT`.

### 2.3 Contraseñas — de dónde salen

**No salen de ningún lado: las generás vos**, antes del primer `docker compose up`. No hay
valores por defecto ni se recuperan de un repositorio de secretos externo — son tres
contraseñas locales al stack, consumidas una sola vez durante la inicialización de
TimescaleDB:

- `POSTGRES_SUPERUSER_PASSWORD` — superusuario `postgres` del motor.
- `RINHO_RECEPTOR_DB_PASSWORD` — rol `rinho_receptor` (lo usa el receptor UDP para
  conectarse; ver `deploy/db/02-roles.sql`).
- `AGROLINK_INGESTA_DB_PASSWORD` — rol `agrolink_ingesta` (lo usa el servicio de reportes).

Generarlas y completarlas en `deploy/.env` (nunca en `.env.example`, que sí se commitea):

```bash
cd deploy
cp .env.example .env
for var in POSTGRES_SUPERUSER_PASSWORD RINHO_RECEPTOR_DB_PASSWORD AGROLINK_INGESTA_DB_PASSWORD; do
  echo "$var=$(openssl rand -base64 24)"
done
# pegar los tres valores generados en .env, reemplazando cada "VAR="
$EDITOR .env
```

> ⚠️ **Importante**: estas contraseñas solo se aplican la **primera vez** que
> `timescaledb` arranca sobre un volumen vacío (los scripts de `deploy/db/` corren una sola
> vez, vía `docker-entrypoint-initdb.d`). Si se pierde `.env` después de ese primer arranque,
> no se puede "recuperar" la contraseña real desde ningún lado — hay que resetearla a mano
> con `ALTER ROLE ... PASSWORD '...'` conectado como `postgres`, y actualizar `.env` para que
> coincida. Guardar `.env` en un gestor de contraseñas, no solo en la VM.

`deploy/.env` **nunca se commitea** (Principio VI) — está en `.gitignore`. Solo se versiona
`deploy/.env.example`, sin valores.

### 2.4 Preparar la VM y levantar el stack

```bash
git clone <url-del-repo>
cd AgroLinkIngestaAdaptacion/deploy
cp .env.example .env && $EDITOR .env   # completar contraseñas, ver §2.3
./vm-setup.sh
```

`vm-setup.sh` (idempotente — se puede correr de nuevo sin romper nada):

1. Instala Docker Engine + Compose plugin si no están.
2. Agrega el usuario actual al grupo `docker`.
3. Abre `UDP_PORT` en el firewall local de la VM (§2.2b).
4. Si `deploy/.env` ya existe, corre `docker compose up -d` y muestra `docker compose ps`.
   Si no existe, avisa y no levanta nada.

Si se agregó el usuario al grupo `docker` recién ahora, hace falta cerrar la sesión SSH y
volver a entrar antes de que el script pueda correr `docker compose` sin `sudo` (el propio
script lo indica).

### 2.5 Creación de la base de datos

**No es un paso manual aparte.** `deploy/db/01-schema.sql` y `deploy/db/02-roles.sql` están
montados como `docker-entrypoint-initdb.d` (ver `compose.yaml`, servicio `timescaledb`): la
imagen oficial de Postgres los ejecuta **automáticamente, una sola vez**, la primera vez que
`timescaledb` arranca sobre un volumen de datos vacío — crean el esquema `telemetria`, la
hypertable y los roles `rinho_receptor`/`agrolink_ingesta` usando las contraseñas de `.env`.

Si hace falta recrear la base desde cero (por ejemplo, para repetir la inicialización con
otras contraseñas), hay que **borrar el volumen**, no solo reiniciar el contenedor:

```bash
docker compose down
docker volume rm deploy_timescaledb-data   # ⚠️ destruye todos los datos persistidos
docker compose up -d
```

> **Migración manual (feature 005, `odometro_m` → `odometro_km`)**: si el volumen ya
> estaba inicializado antes de esta feature, `01-schema.sql` no se vuelve a correr (solo
> aplica a volúmenes vacíos), así que hay que aplicar el cambio a mano, conectado como
> `postgres` o como `agrolink_ingesta`:
>
> ```sql
> ALTER TABLE telemetria.lectura_telemetria
>     RENAME COLUMN odometro_m TO odometro_km;
> ALTER TABLE telemetria.lectura_telemetria
>     ALTER COLUMN odometro_km TYPE DOUBLE PRECISION USING odometro_km / 1000.0;
> ```
>
> Ver `specs/005-odometer-storage-km/research.md` (D-04) para el detalle de por qué no
> hay un mecanismo de migración automático (el proyecto no usa Flyway/Liquibase).

### 2.6 Verificar

```bash
docker compose ps   # los tres servicios: running y healthy
```

`agrolink-ingesta` puede tardar hasta ~2 minutos en pasar a `healthy` (arranque en frío de
la JVM con 2 OCPU compartidas). Ver también `quickstart.md` §1.5 para verificar el esquema.

## 2.7 Levantar el stack localmente (para desarrollo, sin VM)

Es exactamente el mismo procedimiento, sin las secciones específicas de VCN/VM:

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
puerto UDP por rango de IP/APN del operador celular en la Security List de la VCN, para que
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
`test` (mvn) → `build-and-push` (imágenes `linux/arm64` de `agrolink-ingesta` **y**
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
| `OCI_HOST` | Hostname/IP pública de la VM. |
| `OCI_USERNAME` | Usuario SSH en la VM. |
| `OCI_SSH_KEY` | Clave privada SSH de ese usuario (sin passphrase — `appleboy/ssh-action` no soporta desbloqueo interactivo). |

`GITHUB_TOKEN` (implícito, sin configuración) autentica el `push` a `ghcr.io` desde el
job `build-and-push` — no hace falta crearlo como secret.
