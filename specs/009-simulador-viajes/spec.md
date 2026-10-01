# Feature Specification: Simulador de Viajes con Dispositivos Ficticios

**Feature Branch**: `009-simulador-viajes`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "Simulador de viajes con dispositivos ficticios: proceso Node.js
separado del receptor, que simula camiones (incluidos refrigerados) recorriendo rutas reales y
envía tramas UDP reales al rinho-receptor (mismo protocolo REQ/EQ, checksum, ACK). No hay modo
"dummy" dentro de rinho-receptor. Config mutable (camiones, rutas, viajes) vive en un nuevo
schema Postgres `simulador` en la misma base Timescale, separado de `telemetria` (que es
insert-only/inmutable). Editable en caliente vía psql/DataGrip ya usados en la VM, sin redeploy.
Cadencia: una trama cada 60s por camión, igual que el Spider IoT real. Escala inicial: 5
camiones, 1-3 paradas por viaje. Rutas armadas manualmente (con ayuda de Google Maps), no vía
OSRM en runtime. Apunta a local/staging por defecto; a la VM de OCI solo por elección explícita.
Primer camión definido con datos reales de campo (device 860693084873877, VIN
LGWEEUA55TL612021): ruta de 88 puntos GPS reales capturados en producción, odómetro inicial
150200 km acumulando con la distancia recorrida (el GPS real no traía este dato bien), y datos
CAN a sintetizar (RPM según velocidad, combustible % bajando desde ~85%, combustible consumido L
acumulado, presión de aceite estable en marcha con caída en paradas, ignición apagada solo en
paradas de entrega) porque el equipo físico de prueba no los reportaba de forma confiable.
Alcance restante: modelo de temperatura de carga refrigerada vía segmento BLE opcional
(bloqueado por la feature 008-ble-sensor-ingestion, en curso en paralelo — no se implementa acá,
solo se deja el enganche preparado); reintentos si no llega ACK; escenarios reproducibles para
demos."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generar telemetría realista sin hardware físico (Priority: P1)

Un integrante del equipo que necesita probar o dar una demo del sistema de ingesta (parseo,
persistencia, reportes de estado de vehículo) enciende el simulador con al menos un camión
configurado y, sin conectar ningún equipo Rinho físico, ve aparecer lecturas nuevas en la base
de telemetría cada 60 segundos — por el mismo camino de UDP, checksum y ACK que usaría un
dispositivo real.

**Why this priority**: Es la razón de ser de la feature. Sin esto no hay manera de ejercitar el
sistema de ingesta de punta a punta (receptor, persistencia, dashboards) sin depender de
hardware Rinho físico disponible y en movimiento.

**Independent Test**: Levantar el simulador apuntando a una instancia local del receptor con un
camión activo configurado, y verificar que aparecen lecturas nuevas y consistentes con su ruta
en la tabla de telemetría, sin ninguna otra fuente de datos activa.

**Acceptance Scenarios**:

1. **Given** un camión simulado activo con ruta y viaje configurados, **When** el simulador está
   corriendo, **Then** cada 60 segundos se envía una trama UDP válida al receptor y aparece una
   nueva lectura de telemetría para ese dispositivo.
2. **Given** el camión avanza por los puntos de su ruta, **When** se consultan lecturas
   consecutivas, **Then** posición, velocidad, rumbo y odómetro reflejan el avance real sobre la
   ruta configurada (no se repite el mismo punto de forma indefinida fuera de una parada).
3. **Given** el camión llega a una parada de entrega de su ruta, **When** permanece en esa
   parada, **Then** la velocidad reportada es 0 y la ignición se marca apagada mientras dura la
   parada, retomando el movimiento y la ignición encendida después.
4. **Given** el camión completa su ruta hasta el destino, **When** llega al final, **Then** el
   simulador genera automáticamente el viaje de vuelta sobre la misma ruta (sentido inverso, con
   las mismas paradas) y el camión sigue emitiendo telemetría sin intervención manual.

---

### User Story 2 - Simular temperatura de carga refrigerada para medias reses (Priority: P2)

Un integrante del equipo configura un camión simulado con carga refrigerada (medias reses de
carne vacuna) y ve llegar, junto con cada lectura de posición, una temperatura y humedad de
sensor BLE realistas para ese tipo de carga: estables alrededor del setpoint en operación normal,
con un pico y recuperación cuando el camión abre la puerta en una entrega, y con una subida
sostenida que cruza el umbral de alerta cuando el escenario simula una falla de compresor.

**Why this priority**: Es el motivo original por el que el simulador quedó parcialmente
bloqueado (dependía de que el receptor supiera aceptar el segmento BLE, feature
008-ble-sensor-ingestion) — con esa dependencia ya resuelta, es el siguiente valor más alto: sin
esto no se puede hacer una demo creíble del caso de uso principal de AgroLink (cadena de frío de
carga refrigerada).

**Independent Test**: Configurar un camión simulado con carga "medias reses" y verificar que sus
lecturas incluyen temperatura y humedad BLE coherentes con el setpoint, y que un escenario de
falla de compresor hace que la temperatura cruce el umbral de alerta dentro de la ventana
esperada del viaje.

**Acceptance Scenarios**:

1. **Given** un camión simulado con carga "medias reses" en operación normal, **When** se
   generan sus lecturas, **Then** la temperatura y humedad BLE quedan estables alrededor del
   setpoint configurado, con una variación menor (ruido) entre lecturas sucesivas.
2. **Given** el camión llega a una parada de entrega, **When** se simula la apertura de la
   puerta de carga, **Then** la temperatura BLE sube por encima del setpoint y vuelve a
   estabilizarse progresivamente después de retomar el viaje.
3. **Given** un viaje configurado con una falla de compresor planificada, **When** se alcanza el
   punto del viaje donde la falla dispara, **Then** la temperatura BLE sube de forma sostenida
   (no vuelve sola al setpoint) hasta cruzar el umbral de alerta de la carga.
4. **Given** un camión simulado sin carga refrigerada (o con el sensor BLE fuera de rango en el
   escenario), **When** se generan sus lecturas, **Then** los campos de temperatura y humedad BLE
   quedan vacíos (`NULL`), igual que un dispositivo real sin ese segmento.

---

### User Story 3 - Administrar la flota simulada sin reiniciar el proceso (Priority: P3)

Un integrante del equipo agrega un camión nuevo, o edita la ruta o los parámetros de uno
existente, directamente en la configuración de la flota simulada, y el simulador empieza a
usarlo sin necesidad de recompilar ni redeployar el proceso.

**Why this priority**: Iterar rápido sobre escenarios de demo (agregar camiones, ajustar rutas)
es el segundo objetivo declarado del PoC; sin esto cada ajuste requeriría un ciclo de
build/deploy que frena las demos.

**Independent Test**: Con el simulador corriendo, agregar un segundo camión activo a la
configuración y verificar que empieza a emitir tramas dentro de un ciclo de sondeo, sin reiniciar
el proceso manualmente.

**Acceptance Scenarios**:

1. **Given** el simulador corriendo con N camiones activos, **When** se agrega un camión nuevo
   activo a la configuración, **Then** el simulador lo detecta y empieza a enviar sus tramas sin
   reinicio manual del proceso.
2. **Given** un camión simulado existente, **When** se lo marca inactivo en la configuración,
   **Then** deja de emitir tramas nuevas sin afectar el envío de los demás camiones activos.

---

### User Story 4 - Reintentar cuando el receptor no confirma recepción (Priority: P4)

Cuando el receptor no confirma la recepción de una trama (como puede pasarle a un dispositivo
real por cobertura celular intermitente), el camión simulado la reintenta en vez de darla por
perdida silenciosamente.

**Why this priority**: Valida también el camino de tolerancia a fallos del sistema, no solo el
camino feliz — parte del valor de simular es poder ejercitar ese escenario a demanda, algo que
no se puede forzar fácilmente con hardware real.

**Independent Test**: Detener temporalmente el receptor mientras el simulador sigue enviando, y
verificar que reintenta la trama pendiente al restablecerse el receptor, sin generar duplicados
en destino.

**Acceptance Scenarios**:

1. **Given** el receptor no confirma una trama dentro del tiempo esperado, **When** el camión
   simulado detecta la falta de confirmación, **Then** reintenta el envío de esa misma trama.
2. **Given** el receptor vuelve a estar disponible después de varios reintentos, **When** recibe
   la trama reintentada, **Then** la lectura queda persistida una sola vez.

---

### User Story 5 - Distinguir dispositivos simulados de reales (Priority: P5)

Cualquier persona que consulte lecturas de telemetría puede identificar sin ambigüedad si un
dispositivo corresponde a un camión simulado o a un equipo Rinho real, para no confundir datos
de demo con datos de producción ni arriesgar que un identificador ficticio choque con un IMEI
real.

**Why this priority**: Es una salvaguarda, no una capacidad nueva en sí misma — protege la
integridad de los reportes y alertas que ya existen sobre datos reales.

**Independent Test**: Consultar lecturas de un camión simulado y confirmar que su identificador
de dispositivo cae en un rango reservado, verificable sin cruzar ninguna otra fuente de datos.

**Acceptance Scenarios**:

1. **Given** un camión simulado, **When** se le asigna su identificador de dispositivo, **Then**
   ese identificador cae dentro de un rango reservado que nunca puede coincidir con un IMEI real.
2. **Given** una lectura de un camión simulado ya persistida, **When** se la compara con una
   lectura de un dispositivo real, **Then** es identificable como simulada sin ambigüedad.

---

### Edge Cases

- Un camión activo sin ruta o sin viaje asignado no debe hacer fallar el proceso del simulador
  completo: simplemente no emite tramas hasta que se le asigne una ruta y un viaje.
- Varios camiones simulados enviando en paralelo cada 60 segundos no deben interferir entre sí ni
  degradar la cadencia de los demás.
- Si el proceso del simulador se reinicia a mitad de un viaje, debe continuar desde el último
  estado conocido del camión (posición y odómetro acumulado), no reiniciar desde cero.
- Un camión simulado con carga refrigerada cuyo escenario no define una falla vigente opera en
  modo normal (temperatura estable alrededor del setpoint) por defecto.
- Una falla de compresor y una apertura de puerta no se superponen dentro de un mismo viaje
  simulado en esta primera versión: cada viaje dispara a lo sumo una falla planificada.
- Un camión simulado sin carga refrigerada (o sin sensor BLE emparejado en el escenario) no
  emite el segmento BLE en absoluto, igual que un dispositivo real sin sensores BLE conectados —
  no envía claves vacías de más.
- Los reintentos por falta de ACK no pueden extenderse indefinidamente si el receptor queda caído
  por un período largo: tienen que tener un límite acotado en vez de acumular reintentos sin fin.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE simular camiones que envían tramas de telemetría por UDP al
  receptor real, usando el mismo protocolo, checksum y mecanismo de confirmación (ACK) que un
  dispositivo Rinho Spider IoT físico.
- **FR-002**: El sistema DEBE ejecutarse como un proceso independiente del receptor de
  telemetría, sin introducir ningún modo "simulado" dentro del receptor mismo.
- **FR-003**: El sistema DEBE emitir una trama por cada camión simulado activo cada 60 segundos,
  igual que la cadencia del hardware real.
- **FR-004**: El sistema DEBE permitir agregar y editar camiones simulados (incluida su ruta,
  tipo de carga y estado activo/inactivo) sin requerir reinicio, recompilación ni redeploy del
  proceso simulador.
- **FR-005**: Cada camión simulado DEBE tener asignada una ruta compuesta por una secuencia de
  posiciones geográficas reales, con al menos una parada de entrega.
- **FR-006**: El sistema DEBE avanzar la posición, velocidad, rumbo y odómetro del camión
  simulado de forma consistente con el recorrido de su ruta y el tiempo transcurrido entre
  tramas.
- **FR-007**: El sistema DEBE reportar velocidad 0 e ignición apagada mientras el camión
  simulado permanece en una parada de entrega, y retomar movimiento e ignición encendida al
  finalizar la parada.
- **FR-008**: El sistema DEBE sintetizar, para cada camión simulado: RPM de motor en función de
  la velocidad, nivel de combustible decreciente y combustible consumido acumulado en función de
  la distancia recorrida, y presión de aceite estable en marcha con caída durante ralentí o
  parada.
- **FR-009**: El sistema DEBE permitir configurar el odómetro inicial de cada camión simulado y
  acumular sobre ese valor la distancia recorrida a medida que avanza su ruta.
- **FR-010**: El identificador de dispositivo de cada camión simulado DEBE estar dentro de un
  rango reservado que nunca pueda coincidir con un IMEI real, de forma que sea identificable sin
  ambigüedad como simulado en cualquier consulta de telemetría.
- **FR-011**: El sistema DEBE reintentar el envío de una trama cuando el receptor no confirma su
  recepción dentro del tiempo esperado, con un límite acotado de reintentos.
- **FR-012**: El sistema DEBE apuntar por defecto a un receptor local o de staging, y requerir
  una acción explícita para enviar tramas hacia el receptor de producción.
- **FR-013**: Para cada camión simulado con carga refrigerada, el sistema DEBE emitir el
  segmento BLE (temperatura y humedad) junto con cada trama, sintetizando valores estables
  alrededor del setpoint de la carga configurada en operación normal.
- **FR-014**: Al completar su ruta, el camión simulado DEBE generar automáticamente el viaje de
  vuelta sobre la misma ruta (recorriéndola en sentido inverso, con las mismas paradas), de modo
  que cada viaje tenga un inicio y un fin reales y el camión siga emitiendo telemetría sin
  intervención manual.
- **FR-015**: El sistema DEBE permitir configurar, por viaje, una falla planificada de "apertura
  de puerta en entrega": al pasar por una parada, la temperatura BLE sube por encima del setpoint
  y se recupera progresivamente después de retomar el viaje.
- **FR-016**: El sistema DEBE permitir configurar, por viaje, una falla planificada de "falla de
  compresor": a partir del punto configurado del viaje, la temperatura BLE sube de forma
  sostenida (sin recuperación espontánea) hasta cruzar el umbral de alerta de la carga
  configurada.
- **FR-017**: Cuando un camión simulado no tiene carga refrigerada, o el escenario simula el
  sensor BLE fuera de rango o sin lectura, el sistema DEBE dejar los campos de temperatura y
  humedad BLE vacíos (`NULL`) en la trama, en vez de inventar un valor.

### Key Entities *(include if feature involves data)*

- **Camión simulado**: vehículo ficticio con identificador en el rango reservado, nombre o
  patente, tipo de carga (incluye refrigerada — p. ej. medias reses), setpoint de temperatura y
  humedad de esa carga cuando aplica, y estado activo/inactivo.
- **Ruta**: secuencia ordenada de posiciones geográficas reales que un camión simulado recorre,
  con una o más paradas de entrega marcadas.
- **Viaje**: instancia de recorrido de un camión simulado sobre una ruta, con su progreso actual
  y, opcionalmente, una falla planificada para el escenario de demo (apertura de puerta o falla
  de compresor, con el punto del viaje en que dispara).
- **Lectura de telemetría emitida**: el registro que resulta de la simulación en el sistema de
  ingesta, con el mismo formato que una lectura de un dispositivo real (incluido el segmento BLE
  cuando corresponde) salvo por el identificador de dispositivo, que la marca como simulada.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un desarrollador puede levantar el simulador y ver la primera lectura nueva de un
  camión simulado en la base de telemetría en menos de 2 minutos desde que arranca el proceso.
- **SC-002**: El simulador sostiene 5 camiones activos enviando en paralelo sin que ninguno deje
  de emitir su trama dentro de la ventana de 60 segundos esperada.
- **SC-003**: Agregar un camión nuevo a la flota simulada y verlo emitiendo telemetría no requiere
  ninguna acción de despliegue (reinicio de proceso, rebuild o redeploy).
- **SC-004**: El 100% de las lecturas generadas por camiones simulados son identificables sin
  ambigüedad como simuladas al consultarlas, sin necesidad de cruzar con ningún sistema externo.
- **SC-005**: Cuando el receptor deja de responder temporalmente, el 100% de las tramas no
  confirmadas se reintentan y terminan persistidas exactamente una vez al restablecerse la
  conexión.
- **SC-006**: Un escenario de falla de compresor configurado en un camión con carga refrigerada
  hace que la temperatura reportada cruce el umbral de alerta de esa carga dentro de la ventana
  de tiempo definida por el escenario, de forma reproducible en cada corrida.

## Assumptions

- El simulador corre como proceso separado del receptor, sin modo "dummy" embebido en él (ya
  decidido con el equipo).
- Apunta por defecto a un receptor local o de staging; enviar tramas hacia el receptor de
  producción (VM de OCI) requiere una elección explícita, para evitar contaminar datos reales por
  descuido.
- La configuración de la flota simulada (camiones, rutas, viajes) es editable en caliente por
  cualquier integrante del equipo con acceso a la base de datos, sin necesidad de una interfaz de
  administración dedicada en esta primera versión.
- El modelo de temperatura de carga refrigerada usa el segmento BLE ya soportado por el receptor
  (feature 008-ble-sensor-ingestion, ya implementada: columnas `ble_temperatura_c`,
  `ble_humedad_pct`, `ble_bateria`) — solo el slot 0 (`T0`/`H0`/`B0`) del contrato BLE, que es el
  único que el receptor mapea a columnas propias.
- El caso de referencia de carga refrigerada es "medias reses" (carne vacuna enfriada, no
  congelada): setpoint de temperatura ~1–4 °C y humedad relativa alta (~85–90%), a diferencia del
  caso congelado (−18 °C) mencionado como alternativa futura en el handoff original. El umbral de
  alerta de esta carga (para la falla de compresor, FR-016) se fija en 7 °C, el límite superior
  habitual de cadena de frío para carne fresca.
- Los datos CAN sintéticos (RPM, combustible, presión de aceite) se generan porque el equipo real
  usado para capturar la ruta de referencia no los reportaba de forma confiable (confirmado
  decodificando tramas de campo); el simulador sigue siendo útil para escenarios de demo
  controlados independientemente de esa limitación del hardware de prueba.
- El rango de identificadores reservado para camiones simulados se define en la fase de diseño
  técnico, de forma que nunca coincida con un IMEI real de 15 dígitos.
- Las rutas se arman de antemano con asistencia externa (referencia de mapas), no se calculan en
  tiempo de ejecución contra un servicio de ruteo.
- El primer camión simulado usa como referencia una ruta de 88 puntos GPS reales capturados en
  producción para el dispositivo 860693084873877, con odómetro inicial configurado en 150200 km.
