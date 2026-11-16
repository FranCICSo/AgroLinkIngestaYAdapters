# Implementation Plan: Migración del despliegue de producción de OCI a Azure

**Branch**: `bugfix/migrating-from-oci-to-azure` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/017-migracion-vm-azure/spec.md`

**Nota**: este plan es **retroactivo**. Por el plazo (entrega el 26/11/2026), la migración se ejecutó a la par del spec, y este documento registra lo decidido y lo hecho. Lo que falta está en [tasks.md](./tasks.md).

## Summary

La producción de la ingesta (TimescaleDB, `rinho-receptor`, `agrolink-ingesta` y `simulador-viajes`) pasó de la VM de Oracle Cloud, perdida con la suspensión de la tenancy, a una VM de Azure for Students: `agrolink-ingesta`, `Standard_B2pls_v2` ARM64, Canada Central, IP fija `20.151.0.131`.

- **Mismo stack:** se usa `deploy/compose.yaml` con las mismas imágenes de GHCR.
- **Base:** arranca vacía, con las migraciones 001 a 011 aplicadas.
- **Seguridad de red:** la hace el NSG de Azure. El 8082 solo acepta tráfico desde el backend.
- **Despliegue:** el CI despliega con secrets neutrales (`DEPLOY_*`) y publica imágenes `amd64` y `arm64`, para poder cambiar de arquitectura sin tocar el pipeline.
- **Provisión reproducible:** queda en `deploy/azure/`.

## Technical Context

| | |
|---|---|
| **Language/Version** | Java 21 (Spring Boot, ingesta), Node 22 (receptor y simulador), Bash (provisión) |
| **Primary Dependencies** | Docker Engine y Compose v2, Azure CLI (en Cloud Shell), imágenes de GHCR |
| **Storage** | TimescaleDB 2.17.2 sobre PostgreSQL 16, en un volumen Docker de la VM, sin backups (decisión del usuario, ver spec) |
| **Testing** | Verificación de punta a punta manual (FR-015) y tests existentes del CI, sin tests nuevos |
| **Target Platform** | Azure `Standard_B2pls_v2` (2 vCPU Ampere, 4 GB), Ubuntu 24.04 LTS ARM64, Canada Central |
| **Project Type** | Infraestructura y despliegue de un servicio existente |
| **Performance Goals** | Los del sistema actual (1 reporte cada 60 s por dispositivo), sin cambios |
| **Constraints** | 4 GB de RAM; 100 USD de crédito, unos 30,6 USD/mes, así que alcanza hasta fines de febrero de 2027; la policy solo permite 5 regiones; plazo 26/11/2026 |
| **Scale/Scope** | 1 dispositivo Rinho real y 1 o 2 camiones simulados |

## Decisiones

| ID | Decisión | Alternativas descartadas y motivo |
|----|----------|-----------------------------------|
| D-01 | **Azure for Students** (100 USD, sin tarjeta) | Hetzner: sin stock para clientes nuevos desde junio de 2026. Otra tenancy de OCI: el mismo riesgo y puede leerse como evasión de la suspensión. GCP e2-micro: 1 GB no alcanza. PaaS como Render o Railway: no aceptan UDP entrante. |
| D-02 | **Canada Central** | La policy solo permite `chilecentral`, `brazilsouth`, `canadacentral`, `newzealandnorth` y `southafricanorth`. Canada Central es la única cercana con VMs ARM habilitadas, y la más barata (`deploy/azure/list-available-sizes.sh`). |
| D-03 | **`Standard_B2pls_v2` ARM64** (26,9 USD/mes) | `B2als_v2` x86: no habilitada en Canada para la suscripción; en Chile cuesta 38,4. Las otras ARM cuestan 50 USD/mes o más. El portal mostró `NotAvailableForSubscription` para la B2pls_v2, pero por la CLI (sin zona fijada) se creó bien. |
| D-04 | **CI multi-arch** (`linux/amd64,linux/arm64`) | Solo arm64: impediría pasar a x86, que es el respaldo de D-03. El código no depende de la arquitectura (JVM, y Node con `pg` en JavaScript puro). |
| D-05 | **Mismas contraseñas** que la VM perdida (FR-008) | Rotarlas. El usuario decidió no hacerlo: la VM vieja está perdida y es una PoC. |
| D-06 | **Sin backups** de TimescaleDB | La plataforma solo usa el último estado. Lo demás se reconstruye: seeds para los camiones, y el backend vuelve a programar los viajes. |
| D-07 | **Sin dominio**: IP fija en el Rinho y en el backend | DNS en Cloudflare: el UDP no pasa por su proxy, y no hacía falta para el plazo. |
| D-08 | **Límites de memoria**: TimescaleDB 4g → 1536m (`TS_TUNE_MEMORY=1GB`), resto sin cambios, **swap de 2 GB** | La suma de los límites queda en unos 2,4 GB sobre 3,8 GB. Medido con el simulador corriendo: unos 870 MB usados. |
| D-09 | **El firewall lo hace solo el NSG**; iptables queda en ACCEPT | La imagen de Ubuntu en Azure no trae las reglas restrictivas de la de OCI. `vm-setup.sh` abre el UDP solo si detecta ufw o iptables restrictivos. |
| D-10 | **Usuario `ubuntu`** y la misma clave SSH (`ssh-key-2026-08-11`) | Así no cambian el `APP_DIR` del CI ni la clave cargada en los secrets. |

## Constitution Check

*Verificación inicial y posterior: el plan es retroactivo, así que se evalúa una sola vez sobre lo implementado.*

| Principio | Estado | Nota |
|-----------|--------|------|
| I. Capas de adaptación | ✅ | Sin cambios de código en la ingesta |
| II. Stack del backend | ✅ | Sin cambios |
| III. Mensajería solo por necesidad | ✅ | No se agrega mensajería |
| IV. Inmutabilidad de la telemetría | ⚠️ **Violación puntual** | Se borró a mano 1 lectura sintética de prueba. Ver Complexity Tracking. |
| V. Datos personales | ✅ | Sin cambios. La contraseña del WiFi del Rinho no se versiona (FR-009). |
| VI. Seguridad | ⚠️ **Excepción** | El 8082 sigue en HTTP sin cifrar entre servicios propios. Ver Complexity Tracking. El tramo Rinho→receptor (UDP sin TLS) mantiene su excepción vigente: solo el UDP queda abierto a cualquier origen y se validan checksum y dispositivo conocido. |
| VII. Tolerancia a desconexión | ✅ Verificado | Al reprogramarse, el Rinho mandó las tramas acumuladas del 15/11 (03:38 a 19:40 UTC) y se guardaron sin conflicto. |
| VIII. Testing mínimo | ✅ | No hay lógica de parseo nueva. El test de configuración del backend se actualizó (3 de 3 en verde). |
| IX. Trazabilidad | ✅ | Sin cambios |

## Project Structure

### Documentation (this feature)

```text
specs/017-migracion-vm-azure/
├── spec.md
├── plan.md              # este archivo
├── tasks.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
deploy/
├── azure/
│   ├── provision.sh              # crea el grupo, el NSG, la IP y la VM; valida región y tamaño antes
│   └── list-available-sizes.sh   # tamaños habilitados para la suscripción, con precio
├── vm-setup.sh                   # Docker, firewall según NSG, sin root por SSH, swap
├── compose.yaml                  # límites de memoria para 4 GB
└── README.md                     # §1 imágenes multi-arch; §7 secrets DEPLOY_*
.github/workflows/ci-cd.yml       # multi-arch y secrets DEPLOY_*

AgroLinkBackend (otro repo, rama bugfix/migrating-ingesta-from-oci-to-azure):
src/main/resources/application-prod.yml   # URL de la ingesta → http://20.151.0.131:8082
```

**Structure Decision**: sin cambios de código. Los scripts de provisión de Azure viven en `deploy/azure/` para no mezclarlos con el `vm-setup.sh` genérico.

## Incidentes durante la ejecución

1. **Migraciones desfasadas.** La rama se creó desde un `master` local desactualizado (sin el PR #10). Se aplicaron solo la 001 a la 009, pero la imagen `latest` de GHCR, compilada desde `origin/master`, esperaba la 010 y la 011. Resultado: `column umbral_termico_max_c does not exist` en bucle en el scheduler de viajes programados. **Arreglo:** aplicar la 010 y la 011, y rebasear la rama sobre `origin/master`. **Lección:** antes de desplegar a mano, `git fetch` y desplegar `deploy/` desde `origin/master`, que es lo mismo que despliega el CI.
2. **El portal rechazaba el tamaño ARM** (`NotAvailableForSubscription`). Por la CLI se creó sin problema. Lo más probable es que fuera la zona de disponibilidad que el portal fija por defecto, pero no está confirmado.

## Complexity Tracking

| Violación | Por qué se necesitó | Alternativa más simple descartada porque |
|-----------|---------------------|------------------------------------------|
| **VI**: la API de estado de la ingesta (8082) sigue en **HTTP sin cifrar** entre servicios propios (backend en OCI → ingesta en Azure, por internet) | Igual que antes de la migración. Agregar TLS exige dominio y certificado (D-07), fuera de alcance para el 26/11. **Compensación:** la regla `allow-backend-ingesta` del NSG solo acepta `64.181.162.233`, y se verificó que otras redes no conectan. El tráfico expone solo datos de telemetría de vehículos, sin credenciales. | Caddy con TLS necesita un dominio apuntando a la VM. Queda como deuda: resolverla cuando la ingesta tenga dominio. |
| **VI (endurecimiento)**: SSH (22) abierto a cualquier origen | GitHub Actions despliega desde IPs que cambian. **Compensación:** solo autenticación por clave, sin contraseña y sin root (`/etc/ssh/sshd_config.d/60-agrolink.conf`). | Limitar SSH a rangos de GitHub: son cientos de rangos que cambian. Usar un runner self-hosted: sobredimensionado para la PoC. |
| **IV**: se **borró a mano 1 lectura** de `telemetria.lectura_telemetria` (dispositivo `2326`) el 2026-11-16 | Era una trama **sintética** (el ejemplo del fabricante), mandada para validar la cadena UDP→base, y no una lectura de un dispositivo real. Se borró a pedido del usuario para no dejar un dispositivo falso en producción. | Lo correcto según el Principio IV era no borrarla. Para las próximas verificaciones de punta a punta: usar la trama real del Rinho o un entorno que no sea producción, y no mandar tramas sintéticas a producción. **No se repite.** |
