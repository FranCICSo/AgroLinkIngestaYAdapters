# Feature Specification: Migración del despliegue de producción de OCI a Azure

**Feature Branch**: `017-migracion-vm-azure`

**Created**: 2026-11-15

**Status**: Draft

**Input**: User description: "Migrar el despliegue de producción de AgroLinkIngestaAdaptacion desde la VM de Oracle Cloud (tenancy suspendida, VM 137.131.255.202 inaccesible y sin backup) a una VM de Azure for Students. Destino: VM ARM64 de 4 GB con IPv4 fija en una región de EE. UU. permitida por la suscripción; mismo stack de deploy/compose.yaml con la base vacía; el Rinho y el backend apuntan a la IP nueva; restringir el acceso a la API de la ingesta; CI/CD apuntando a la VM nueva; provisión reproducible; alerta de presupuesto y backup; verificación de punta a punta. Fuera de alcance: mover backend o frontend, dominio/TLS para la ingesta, recuperar datos de OCI."

## Contexto

La tenancy de Oracle Cloud que alojaba la producción de la ingesta fue suspendida en noviembre de 2026 y su VM (`137.131.255.202`) no responde. Desde entonces:

- El dispositivo Rinho reporta a una IP muerta, así que **no se está guardando telemetría**.
- El backend (`api.agrolink.lat`, que sigue funcionando en otra VM) no puede consultar el estado de los vehículos, porque apunta a esa misma IP.
- La telemetría histórica se perdió: solo existía en esa VM y no había backup.

Esta feature restablece el servicio en un proveedor nuevo y corrige lo que hizo grave la caída: **el despliegue dependía de un único proveedor sin un procedimiento probado para rehacerlo**. La pérdida del histórico no se busca evitar: la plataforma solo consulta los últimos estados de cada vehículo y no usa el histórico de telemetría, así que no se requieren backups (ver Assumptions).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Volver a recibir telemetría del dispositivo real (Priority: P1)

Como responsable de la ingesta, quiero un servidor nuevo, con la base de telemetría creada vacía y con su esquema vigente, al que el dispositivo Rinho reporte. Así la plataforma vuelve a registrar posiciones y lecturas de los vehículos.

**Why this priority**: sin esto no se registra ningún dato y el resto del sistema no tiene qué mostrar. Es el mínimo viable de la migración.

**Independent Test**: con el dispositivo reprogramado hacia la IP nueva, encenderlo y comprobar que sus tramas aparecen en la base de telemetría del servidor nuevo, y que los chequeos de salud del receptor y de la ingesta responden OK.

**Acceptance Scenarios**:

1. **Given** el servidor nuevo levantado con la base vacía, **When** se inicializa la base, **Then** queda con el esquema base y todas las migraciones de `master` aplicadas (al 2026-11-16, 001 a 011) y registradas en el historial de migraciones.
2. **Given** el Rinho reprogramado con la IP fija nueva en el puerto UDP 5000, **When** el vehículo genera un reporte, **Then** la trama se valida, se guarda en la base y el dispositivo recibe su confirmación.
3. **Given** el dispositivo acumuló reportes sin confirmar mientras el servidor estuvo caído, **When** vuelve a tener conexión con el servidor nuevo, **Then** esos reportes con fecha atrasada se aceptan sin sobrescribir datos más recientes (Principio VII).
4. **Given** una trama con checksum inválido o de un dispositivo desconocido, **When** llega al puerto público, **Then** se descarta dejando registro (Principios VI y IX).

---

### User Story 2 - El backend vuelve a obtener el estado de los vehículos, y solo él (Priority: P2)

Como usuario de AgroLink, quiero que la web vuelva a mostrar el estado de los vehículos (odómetro y demás datos de telemetría) que el backend le pide a la ingesta. Como responsable de seguridad, quiero que esa API de la ingesta deje de estar abierta a todo internet.

**Why this priority**: es la parte visible del valor de la telemetría para el usuario final. Depende de la Historia 1, porque sin datos no hay estado que mostrar.

**Independent Test**: desde la VM del backend, consultar el estado de un vehículo en la ingesta nueva y obtener respuesta. Desde cualquier otra red, el mismo pedido debe ser rechazado o no tener respuesta.

**Acceptance Scenarios**:

1. **Given** la configuración de producción del backend actualizada con la IP nueva, **When** la web pide el estado de un vehículo con telemetría, **Then** lo muestra con los datos de la ingesta nueva.
2. **Given** el acceso a la API de la ingesta restringido a la IP de salida del backend, **When** alguien la consulta desde otra dirección, **Then** no obtiene respuesta.
3. **Given** el puerto de la base de datos, **When** se escanea el servidor desde internet, **Then** no aparece accesible.

---

### User Story 3 - Los despliegues automáticos apuntan al servidor nuevo (Priority: P3)

Como mantenedor, quiero que un merge a la rama principal pruebe, publique y despliegue la ingesta en el servidor nuevo, igual que antes en OCI. Así no hace falta entrar a mano a desplegar.

**Why this priority**: la primera puesta en marcha se puede hacer a mano (Historias 1 y 2). El pipeline evita que cada cambio posterior requiera trabajo manual hasta la entrega.

**Independent Test**: hacer un cambio trivial, mergearlo y comprobar que el pipeline aplica las migraciones pendientes, actualiza los servicios en el servidor nuevo y pasa sus chequeos de salud.

**Acceptance Scenarios**:

1. **Given** los secrets del repositorio cargados con los datos del servidor nuevo, con nombres que no mencionan a ningún proveedor, **When** se mergea a la rama principal, **Then** el pipeline despliega en el servidor nuevo y termina en verde.
2. **Given** el pipeline y la documentación de despliegue, **When** se buscan referencias a OCI, Security List o a la IP vieja, **Then** no queda ninguna vigente; solo pueden quedar menciones históricas.
3. **Given** el despliegue manual del simulador de viajes, **When** se ejecuta, **Then** funciona contra el servidor nuevo dentro del límite de memoria disponible.

---

### User Story 4 - Enterarse antes de que se termine el crédito (Priority: P4)

Como responsable del proyecto, quiero recibir un aviso con anticipación antes de que se agote el crédito. Así puedo recrear el servidor en otro lado sin que el servicio se corte por sorpresa, como pasó con OCI.

**Why this priority**: el crédito dura hasta fines de febrero de 2027, con poco margen si la entrega se extiende. No bloquea la puesta en marcha.

**Independent Test**: verificar que la alerta de presupuesto está configurada con sus umbrales y su destinatario.

**Acceptance Scenarios**:

1. **Given** el consumo del crédito, **When** cruza cada umbral configurado, **Then** el responsable recibe un aviso por correo con anticipación suficiente para recrear el servidor en otro proveedor (Historia 5).

---

### User Story 5 - Rehacer el servidor desde cero siguiendo la documentación (Priority: P5)

Como integrante del equipo, quiero un procedimiento documentado y en su mayor parte automatizado para crear el servidor (máquina, IP fija y reglas de red), prepararlo y levantar el stack. Así una nueva migración, por ejemplo cuando se termine el crédito en febrero, sea cuestión de horas y no de días.

**Why this priority**: tiene valor después de la puesta en marcha, para la entrega y para la próxima migración.

**Independent Test**: una persona que no hizo la migración sigue la documentación sobre una cuenta y región permitidas, y llega a un servidor funcionando que pasa los escenarios de la Historia 1.

**Acceptance Scenarios**:

1. **Given** una suscripción con sus regiones permitidas, **When** se ejecuta la provisión, **Then** primero verifica que la región elegida esté permitida y que el tamaño de máquina esté disponible, y si no lo está falla con un mensaje claro antes de crear nada.
2. **Given** un servidor recién creado, **When** se corre la preparación, **Then** quedan instalados los requisitos, el firewall del sistema operativo abre solo los puertos necesarios y el stack levanta si ya existe el archivo de configuración.

---

### Edge Cases

- **La región preferida no está permitida** por la policy de la suscripción de estudiante, o el tamaño de VM no tiene capacidad en esa región: la provisión lo detecta antes de crear recursos y se elige otra región permitida que sí lo tenga.
- **La IP de salida del backend no es fija o se desconoce**: el backend está detrás de Cloudflare, pero su IP de salida es la de su propia VM. Antes de restringir el acceso hay que averiguarla y confirmarla. Si cambia, el backend pierde acceso a la ingesta, lo que se detecta por el fallo de los pedidos de estado, y la regla se actualiza.
- **El dispositivo reporta desde IPs variables** (red celular o WiFi): el puerto UDP del receptor queda abierto a cualquier origen. La protección es la validación de cada trama (Principio VI).
- **El canal GPRS secundario del Rinho apunta hoy a una IP privada** (`192.168.1.44`) que no se puede alcanzar desde la red celular. Al reprogramar el equipo, ese canal también tiene que apuntar a la IP pública nueva o desactivarse.
- **Se acumulan reportes del período de caída**: cuando el dispositivo vuelve a tener conexión puede mandar una ráfaga de tramas atrasadas. Se aceptan sin duplicados (deduplicación del receptor) y sin perder las nuevas.
- **Falta memoria**: con 4 GB para la base, la JVM, dos servicios Node y el sistema operativo, un servicio que supere su límite se reinicia solo. Los límites deben dejar margen para el sistema operativo.
- **Se termina el crédito o se suspende la suscripción**: el servidor se detiene y su base se pierde. Se recrea en otro lado con la provisión documentada (Historia 5), arrancando con la base vacía igual que en esta migración. Se pierden la telemetría histórica (no se usa) y los viajes programados pendientes, que hay que volver a programar desde el backend.
- **El pipeline necesita SSH desde GitHub Actions**, cuyos orígenes no son fijos: SSH no se puede limitar a una sola IP. Se compensa permitiendo solo autenticación por clave y deshabilitando contraseñas y el login de root.
- **La VM de OCI vuelve tras la apelación**: no se toca. Se puede usar para intentar recuperar datos viejos, pero eso queda fuera de esta feature.

## Requirements *(mandatory)*

### Functional Requirements

**Provisión y preparación del servidor**

- **FR-001**: Debe existir un procedimiento reproducible, versionado en el repositorio, que cree el servidor de producción: máquina de 2 vCPU y 4 GB (ARM64 o x86_64), IPv4 pública estática, disco de al menos 64 GB y reglas de red. Debe estar parametrizado por región y nombre de recursos.
- **FR-002**: Antes de crear recursos, la provisión debe verificar que la región esté permitida para la suscripción y que el tamaño de máquina esté disponible en ella. Si alguna de las dos falla, aborta sin crear nada y explica el motivo.
- **FR-003**: El script de preparación de la VM debe instalar los requisitos, abrir en el firewall del sistema operativo solo los puertos del stack y dejar de mencionar la Security List de OCI, reemplazándola por el equivalente del proveedor nuevo.
- **FR-004**: Las reglas de red del proveedor deben permitir:
  - UDP 5000 desde cualquier origen (dispositivos);
  - la API de estado de la ingesta (TCP 8082) solo desde la IP de salida del backend;
  - SSH con autenticación por clave únicamente.

  Todo lo demás entrante queda denegado, y la base de datos nunca queda expuesta.

**Stack y datos**

- **FR-005**: El stack desplegado debe ser el mismo de `deploy/compose.yaml`: base de telemetría, receptor UDP, servicio de ingesta y, opcionalmente, simulador de viajes. Las imágenes propias se publican para `linux/amd64` (además de `linux/arm64`) desde el pipeline.
- **FR-006**: Los límites de memoria de cada servicio deben ajustarse para que la suma de todos, con el simulador encendido, quede por debajo de la memoria de la máquina con margen para el sistema operativo. Esto incluye bajar el límite actual de 4 GB de la base de telemetría y acotar la memoria de la JVM.
- **FR-007**: La base de telemetría debe iniciarse vacía, con el esquema base y todas las migraciones de `master` aplicadas (al 2026-11-16, 001 a 011) y registradas en el historial de migraciones, de modo que el pipeline no las vuelva a aplicar.
- **FR-008**: Se reutilizan los secretos del servidor perdido (contraseñas de base de datos y demás valores de `deploy/.env`), por decisión del usuario: la VM vieja está perdida y es una prueba de concepto. Se cargan en el servidor nuevo desde la copia local de `deploy/.env` y siguen sin versionarse.

**Integraciones**

- **FR-009**: Debe documentarse la reprogramación del dispositivo Rinho hacia la IP nueva en el puerto UDP 5000, para el canal principal (SIP0) y para el canal celular (SIP4), sin incluir credenciales de WiFi en archivos versionados.
- **FR-010**: Debe indicarse el cambio de `INGESTA_BASE_URL` a la IP nueva en la configuración de producción del backend. Se aplica en el repositorio AgroLinkBackend y queda coordinado con su responsable.

**CI/CD**

- **FR-011**: Los jobs de despliegue del pipeline deben apuntar al servidor nuevo usando secrets con nombres neutrales respecto del proveedor (por ejemplo, `DEPLOY_HOST`, `DEPLOY_USER` y `DEPLOY_SSH_KEY`), y la documentación debe listar qué secrets hay que cargar.
- **FR-012**: La documentación de despliegue (`deploy/README.md`) debe describir el proveedor nuevo, sin instrucciones vigentes que dependan de OCI.

**Resiliencia y costo**

- **FR-013**: Debe configurarse una alerta de presupuesto en la suscripción, con avisos por correo al menos al 50 %, 75 % y 90 % del crédito.
- **FR-014**: Debe documentarse un procedimiento de salida para cuando se agote el crédito (estimado para fines de febrero de 2027): recrear el servidor en otro proveedor, reapuntar el dispositivo y el backend, y volver a programar los viajes pendientes. No incluye backup de datos.

**Verificación**

- **FR-015**: Debe existir una lista de verificación de punta a punta, ejecutada y registrada al terminar la migración. Cubre:
  - salud del receptor y de la ingesta;
  - llegada de una trama real del Rinho a la base;
  - consulta de estado de un vehículo desde el backend;
  - rechazo de la API de la ingesta desde otra IP;
  - base de datos no accesible desde internet.

### Key Entities

- **Servidor de producción**: máquina en el proveedor nuevo, con IP fija, región, tamaño y reglas de red. Es lo que reemplaza a la VM de OCI.
- **Reglas de acceso de red**: qué puertos acepta el servidor y desde qué orígenes (dispositivos, backend, pipeline de despliegue).
- **Alerta de presupuesto**: umbrales de consumo del crédito y destinatario del aviso.
- **Configuración de destino del dispositivo**: IP y puerto a los que reporta el Rinho, por canal.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: La plataforma vuelve a registrar telemetría real del vehículo antes del **26/11/2026**, con la primera trama en la base a menos de 5 minutos de reprogramar el dispositivo.
- **SC-002**: Durante una prueba de 24 h con el dispositivo encendido, todos los reportes que confirma el receptor quedan en la base, sin huecos mayores al intervalo de reporte salvo que el dispositivo haya estado sin cobertura.
- **SC-003**: La web vuelve a mostrar el estado de un vehículo con telemetría, y las consultas de estado del backend a la ingesta responden bien en el 100 % de los intentos durante la verificación.
- **SC-004**: Un escaneo desde fuera del servidor solo encuentra accesibles el puerto del receptor y SSH. La API de la ingesta responde únicamente desde la IP del backend.
- **SC-005**: Durante 72 h de funcionamiento, ningún servicio se reinicia por falta de memoria.
- **SC-006**: Una persona que no participó de la migración puede recrear el servidor desde cero siguiendo la documentación en menos de 90 minutos, sin contar la reprogramación del dispositivo.
- **SC-007**: El costo se mantiene dentro del crédito disponible hasta al menos el 15/02/2027, y la primera alerta de presupuesto llega antes de consumir la mitad del crédito. Como el margen es de días, el procedimiento de salida (FR-014) tiene que estar listo antes de esa fecha.

## Assumptions

- **Proveedor y tamaño**: Azure for Students, con 100 USD de crédito y sin tarjeta. **VM creada el 2026-11-15**: `agrolink-ingesta` en el grupo `agrolink-rg`, tamaño `Standard_B2pls_v2` (ARM64 Ampere, 2 vCPU y 4 GB), Ubuntu 24.04.5 LTS ARM64, disco Premium de 64 GB, IPv4 estática Standard **20.151.0.131**, usuario `ubuntu`, creada con `deploy/azure/provision.sh`. Costo, según la API pública de Azure Retail Prices: unos 26,9 USD/mes de VM más unos 3,7 USD/mes de IP, es decir **unos 30,6 USD/mes**. El crédito alcanza más o menos hasta fines de febrero de 2027. Respaldo si el tamaño ARM dejara de estar disponible: `Standard_B2als_v2` x86 en chilecentral, a unos 42 USD/mes con la IP (`deploy/azure/list-available-sizes.sh` lista lo habilitado para la suscripción).
- **Región**: **Canada Central** (`canadacentral`). La policy de la suscripción solo permite `chilecentral`, `newzealandnorth`, `brazilsouth`, `canadacentral` y `southafricanorth`, y Canada Central es la única cercana con VMs ARM habilitadas para esta suscripción. La latencia desde Argentina (unos 150 a 200 ms) no afecta reportes que llegan cada 60 s.
- **Arquitectura**: la producción sigue en ARM64. Como se evaluó usar x86, el pipeline ahora publica las imágenes propias para `linux/amd64` y `linux/arm64`. El código no depende de la arquitectura: la ingesta es Java 21 sobre la JVM, el receptor y el simulador son Node 22 con `pg` en JavaScript puro, y las imágenes base son multi-arch. Así se puede pasar a una VM x86 sin cambios.
- **Datos**: no hay datos a recuperar. La base arranca vacía y los datos de ejemplo (seeds) nunca se cargan en producción.
- **Dominio**: no se usa. El dispositivo y el backend apuntan a la IP fija. Agregar dominio o TLS a la ingesta queda fuera de alcance.
- **Dispositivo**: el usuario puede reprogramar el Rinho, y el protocolo en uso es el propio de Rinho por UDP 5000 hacia nuestro receptor.
- **Backend y frontend**: el backend se queda en su VM actual y el frontend en Vercel. El único cambio es `INGESTA_BASE_URL`, en otro repositorio.
- **Sin backups**: la plataforma solo consulta los últimos estados de cada vehículo y no usa el histórico de telemetría (decisión del usuario, 2026-11-15). El resto de lo que guarda la base se puede reconstruir: los camiones del simulador salen de los seeds, y las rutas y los viajes programados se vuelven a generar al programar viajes desde el backend. Si en el futuro el histórico pasa a usarse, habrá que agregar backups en una feature aparte.
- **Excepción de TLS**: el tramo dispositivo→receptor sigue sin TLS bajo la excepción del Principio VI, con sus controles compensatorios. La API de la ingesta sigue en HTTP plano entre servidores propios, lo que el Principio VI no permite. Para esta feature se compensa restringiendo el acceso a la IP del backend, y queda registrado en el Complexity Tracking del plan como deuda a resolver al agregar dominio y TLS.
- **Fuera de alcance**: mover el backend o el frontend, recuperar datos de OCI e intervenir la cuenta de OCI (que sigue en apelación).
