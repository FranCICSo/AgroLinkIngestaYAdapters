# Feature Specification: Sobretemperatura de motor simulada y alerta de mantenimiento por riesgo de detención

**Feature Branch**: `feature/engine-temperature-alerts` (en los tres repos)

**Created**: 2026-11-10

**Status**: Draft

**Alcance cross-repo**: esta especificación cubre cuatro partes:

- **`simulador-viajes`** (este repo): genera una temperatura del refrigerante del motor verosímil
  en cada trama de los camiones simulados. También permite forzar, por viaje, un sobrecalentamiento
  que la lleva por encima del umbral de riesgo.
- **`rinho-receptor` / `agrolink-ingesta`** (este repo): ya decodifican, guardan y exponen el campo
  en la consulta de estado del vehículo. Solo se verifica que el valor llega de punta a punta, sin
  cambios funcionales previstos (ver Assumptions).
- **AgroLinkBackend**: evalúa la temperatura del motor de cada vehículo, genera, escala y resuelve
  la alerta de mantenimiento. Además deja de confundir la temperatura del motor con la de la carga
  (FR-012).
- **Frontend AgroLink**: muestra la nueva alerta en la sección de Mantenimiento del panel de
  alertas, con el dato que la disparó (FR-016 a FR-019).

Si se prefiere, las partes de AgroLinkBackend y de AgroLink pueden separarse en sus propios
`specs/` en la fase de plan, manteniendo estos requisitos.

**Input**: User description: "I need to add in rinho simulator, the ability to increase the value
of the field engine refrigeration temperature of simulated frames from trucks to a high temperature
that could be considered as could stop engine (investigate it in order to define a threshold in
config). And with this modification, I want to add a new maintenance alert to indicate that a truck
could stop the trip because the high temperature of its engine. Be free to work on ingesta, backend
and front"

## Contexto

### Estado actual (relevado el 2026-11-10)

- El simulador envía el campo de temperatura del refrigerante del motor del bloque CAN **siempre
  vacío** ("sin dato del ECU"). Hoy ninguna trama simulada trae ese valor.
- El receptor ya decodifica ese campo y lo guarda en la lectura de telemetría. `agrolink-ingesta`
  ya lo expone en la consulta de estado del vehículo como temperatura del refrigerante.
- AgroLinkBackend ya consulta ese estado cada minuto para cada vehículo activo con dispositivo IoT.
  Ahí aparece un **defecto latente**: para los vehículos con sensor de frío, si la lectura no trae
  temperatura BLE, el backend usa **la temperatura del refrigerante del motor como si fuera la
  temperatura de la carga**. Mientras el campo llega vacío no hace daño. Pero cuando esta feature
  haga que llegue con valores de ~90 °C, cualquier lectura sin BLE dispararía una alerta térmica de
  carga falsa. Esta feature tiene que corregirlo (FR-012).
- AgroLinkBackend ya tiene alertas de tipo Mantenimiento (mantenimiento vencido o próximo, RTO).
  Se muestran en la sección "Mantenimiento" del panel de alertas, se notifican en tiempo real y no
  se duplican mientras siguen abiertas.
- El simulador ya permite forzar fallas por viaje para demos (apertura de puerta y falla de
  compresor de la carga refrigerada). Se activan a mano sobre el viaje en curso.

### Investigación del umbral

No hay un umbral universal. SAE J1939 define el parámetro (SPN 110, temperatura del refrigerante
del motor) y sus niveles de severidad (por encima del límite de advertencia, por encima del límite
crítico de protección), pero **los valores los calibra cada fabricante de motor**. Referencias
consultadas (2026-11-10):

| Referencia | Dato |
|---|---|
| Rango normal de operación de motores diésel pesados (termostato abierto) | ~82–95 °C |
| Manual de operador de equipo con motor Cummins (edición anterior) | Reducción de potencia desde 103 °C (218 °F) |
| Manual de operador de equipo con motor Cummins (edición posterior) | Reducción de potencia desde 106 °C (222 °F), −2 % por °C, máximo −20 % a 109 °C (228 °F) |
| Procedimiento de parada por alta temperatura (manual de grupo electrógeno) | Detener el motor de inmediato con ≥ 110 °C (230 °F) |
| Documentación Detroit Diesel | El ventilador recién se activa a 105 °C (221 °F): es control térmico, no advertencia |

**Valores por defecto elegidos** (configurables en AgroLinkBackend):

- **Umbral de riesgo (advertencia)**: **105 °C**. Por encima, el motor está en la zona en la que la
  electrónica de protección empieza a reducir potencia: el camión puede no sostener la marcha y el
  viaje queda en riesgo.
- **Umbral crítico (detención inminente)**: **110 °C**. Es el valor en el que se indica detener el
  motor de inmediato. Si sigue, la protección del motor lo apaga y el viaje se detiene.
- **Margen de normalización**: **5 °C**. La alerta se considera normalizada recién cuando la
  temperatura baja de 100 °C (105 − 5), para que una temperatura que oscila alrededor del umbral no
  abra y cierre alertas en cada lectura.

Estos valores son una referencia razonable para la POC, no la calibración de un motor en
particular. Por eso son configurables.

## Clarifications

### Session 2026-11-10

- Q: ¿Cómo se activa el sobrecalentamiento de motor en el simulador? → A: De dos formas, las dos
  sin consultas a la base: (1) al azar, con un 5 % de probabilidad configurable, y (2) a mano, con
  un pedido HTTP (por ejemplo, con `curl`) para activarlo y desactivarlo.
- Q: ¿A qué se aplica el 5 % de probabilidad? → A: Por viaje. Al iniciarse cada viaje (incluido el
  de vuelta automático) se sortea si tendrá sobrecalentamiento. Si sale, la falla arranca en un
  punto al azar del recorrido.
- Q: ¿Desde dónde se lanza el pedido HTTP manual? → A: Desde la red interna de Docker
  (`docker compose exec simulador-viajes curl ...`, en la VM por SSH o en local). El puerto del
  simulador sigue sin publicarse (decisión D-04 de la feature 011) y el endpoint no exige
  autenticación.
- Q: ¿Cómo termina un sobrecalentamiento que apareció al azar? → A: Mezcla de las dos opciones.
  Dura un tiempo al azar acotado y configurable (20–40 min por defecto), pero termina antes si el
  viaje termina o si se desactiva a mano con `curl`: lo que pase primero. El activado a mano no
  tiene duración: sigue hasta que se desactiva con `curl` o hasta que termina el viaje.
- Q: ¿Qué pasa cuando el motor llega al umbral crítico (≥110 °C)? → A: Solo informa. El camión
  simulado sigue la marcha (sin pérdida de potencia ni detención) y el estado del viaje no cambia.
- Ampliación pedida por el usuario: ¿se incluye el nivel de combustible? → A: Sí. El porcentaje
  del tanque que traen las tramas Rinho baja durante los viajes y vuelve a 100 % cuando queda
  debajo del 7 % (Historia 4, FR-021 a FR-024).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El encargado de mantenimiento ve que un camión puede detenerse por temperatura de motor (Priority: P1)

Un camión de la flota con dispositivo Rinho reporta una temperatura del refrigerante del motor por
encima del umbral de riesgo. El encargado de mantenimiento (o el operador de tráfico) ve en AgroLink,
en la sección de Mantenimiento del panel de alertas y en tiempo real, una alerta que dice que ese
camión puede detener el viaje por alta temperatura de motor, con la temperatura medida y el viaje
afectado. Si la temperatura sigue subiendo hasta el umbral crítico, la misma alerta pasa a crítica.
Cuando la temperatura vuelve a la normalidad, la alerta queda resuelta sola.

**Why this priority**: Es el valor de negocio de la feature: anticipar una detención en ruta (carga
perecedera, demoras, remolque) para poder actuar antes de que el motor se apague.

**Independent Test**: Sin usar el simulador, hacer que la consulta de estado de un vehículo
registrado devuelva una temperatura de refrigerante de 107 °C, luego de 112 °C y luego de 90 °C.
Verificar que primero se crea una alerta de advertencia, después pasa a crítica y al final queda
resuelta, siempre una sola alerta.

**Acceptance Scenarios**:

1. **Given** un camión registrado sin alerta de temperatura de motor abierta, **When** se recibe una
   lectura con temperatura de refrigerante mayor o igual al umbral de riesgo (105 °C por defecto) y
   menor al crítico, **Then** se crea una alerta de mantenimiento de severidad advertencia para ese
   camión. Indica que el camión puede detener el viaje por alta temperatura de motor y muestra la
   temperatura medida.
2. **Given** ese camión tiene un viaje en curso, **When** se crea la alerta, **Then** queda
   asociada a ese viaje y lo muestra. Si no hay viaje en curso, se asocia solo al camión e indica
   riesgo de detención del motor sin mencionar un viaje.
3. **Given** una alerta de advertencia abierta para el camión, **When** llega una lectura mayor o
   igual al umbral crítico (110 °C por defecto), **Then** esa misma alerta pasa a severidad crítica,
   actualiza la temperatura informada y se vuelve a notificar en tiempo real. No se crea una
   segunda alerta.
4. **Given** una alerta abierta (advertencia o crítica), **When** siguen llegando lecturas por
   encima del umbral de riesgo, **Then** no se crean alertas nuevas. La alerta abierta muestra la
   temperatura máxima registrada en el episodio.
5. **Given** una alerta abierta, **When** llega una lectura por debajo del umbral de riesgo menos el
   margen de normalización (100 °C por defecto), **Then** la alerta queda resuelta automáticamente
   con la hora de resolución.
6. **Given** una alerta abierta, **When** llegan lecturas entre 100 °C y 105 °C, **Then** la alerta
   sigue abierta: no se resuelve ni se vuelve a crear.
7. **Given** una alerta resuelta automáticamente, **When** la temperatura vuelve a superar el
   umbral de riesgo, **Then** se crea una alerta nueva (un episodio nuevo).
8. **Given** el encargado reconoce la alerta (acknowledge), **When** la temperatura sigue alta,
   **Then** no se crea otra alerta. **When** la temperatura se normaliza, **Then** la alerta
   reconocida también queda resuelta.

---

### User Story 2 - Forzar un sobrecalentamiento de motor en un camión simulado (Priority: P1)

Como no hay camiones reales con el motor recalentando, quien prepara la demo necesita poder hacer
que un camión simulado con viaje en curso empiece a reportar una temperatura de motor creciente,
hasta superar el umbral de riesgo y después el crítico, de forma verosímil y reproducible. Fuera de
esa falla, todos los camiones simulados reportan una temperatura de motor normal.

**Why this priority**: Sin esto la Historia 1 no se puede mostrar con el flujo completo
dispositivo → ingesta → backend → frontend. Las dos juntas forman el mínimo demostrable.

**Independent Test**: Con un camión simulado con viaje en curso, activar el sobrecalentamiento y
mirar las lecturas guardadas: la temperatura del refrigerante tiene que subir en cada trama, cruzar
105 °C y 110 °C en los tiempos esperados y estabilizarse en el pico. Al desactivar la falla, tiene
que bajar gradualmente hasta el rango normal.

**Acceptance Scenarios**:

1. **Given** un camión simulado con viaje en curso y sin falla de motor, **When** se emite una
   trama, **Then** trae una temperatura de refrigerante dentro del rango normal (80–95 °C). Nunca
   alcanza el umbral de riesgo, con el motor en marcha o en ralentí.
2. **Given** un camión simulado con viaje en curso, **When** quien prepara la demo activa el
   sobrecalentamiento de motor para ese viaje con un pedido HTTP al simulador, **Then** desde la
   siguiente trama la temperatura del refrigerante sube en cada trama a un ritmo configurable.
3. **Given** el sobrecalentamiento activo con la configuración por defecto (ciclo de simulación de
   1 minuto), **When** pasan 10 minutos desde la activación, **Then** la temperatura ya superó
   105 °C. **When** pasan 15 minutos, **Then** ya superó 110 °C.
4. **Given** el sobrecalentamiento activo, **When** la temperatura llega al pico configurado
   (115 °C por defecto), **Then** se mantiene alrededor de ese pico sin seguir subiendo.
5. **Given** el sobrecalentamiento activo, **When** quien prepara la demo lo desactiva, **Then** la
   temperatura baja gradualmente en las tramas siguientes hasta volver al rango normal.
6. **Given** un camión con carga refrigerada, **When** tiene activa una falla de carga (apertura de
   puerta o falla de compresor) y también el sobrecalentamiento de motor, **Then** las dos fallas se
   simulan a la vez y de forma independiente: una no altera la otra.
7. **Given** el sobrecalentamiento activo, **When** el viaje termina, **Then** el viaje de vuelta
   generado automáticamente arranca con temperatura normal y sin heredar la falla. Solo la tiene si
   sale en su propio sorteo.
8. **Given** la probabilidad por defecto (5 %), **When** se inician 200 viajes simulados, **Then**
   entre 4 y 18 de ellos tienen un sobrecalentamiento al azar, y en cada uno la falla arranca en un
   punto del recorrido que no es siempre el mismo.
9. **Given** la probabilidad configurada en 0 %, **When** se inicia cualquier viaje, **Then** nunca
   aparece un sobrecalentamiento al azar, pero la activación manual sigue funcionando.
10. **Given** un sobrecalentamiento sorteado al azar con la configuración por defecto, **When** pasan
    entre 20 y 40 minutos desde que se activó, **Then** se desactiva solo y la temperatura empieza a
    bajar. **When** el viaje termina o se desactiva a mano antes de ese plazo, **Then** termina en
    ese momento.
11. **Given** un sobrecalentamiento activado a mano, **When** pasa cualquier cantidad de tiempo,
    **Then** sigue activo hasta que se desactiva a mano o termina el viaje.

---

### User Story 3 - La temperatura del motor nunca se confunde con la de la carga (Priority: P1)

Hoy el backend toma la temperatura del refrigerante del motor como temperatura de la carga cuando
falta el dato del sensor BLE. En cuanto el simulador empiece a mandar la temperatura del motor, eso
generaría alertas térmicas de carga falsas (90 °C en una carga que debería estar a 4 °C). La
temperatura de la carga tiene que salir solo del sensor de frío.

**Why this priority**: Sin esta corrección, la Historia 2 rompe la demo de cadena de frío que ya
existe. No se puede entregar una sin la otra.

**Independent Test**: Con un camión con sensor de frío y un viaje refrigerado en curso, hacer que el
estado devuelva temperatura de refrigerante de motor de 90 °C y temperatura BLE vacía. Verificar
que no se crea ninguna alerta térmica de carga y que la temperatura de la carga no se registra como
90 °C.

**Acceptance Scenarios**:

1. **Given** un viaje refrigerado en curso, **When** una lectura trae temperatura de motor pero no
   trae temperatura BLE, **Then** no se evalúa ninguna alerta térmica de carga en ese ciclo y la
   lectura no registra una temperatura de carga.
2. **Given** una lectura con temperatura BLE y temperatura de motor, **When** se procesa, **Then**
   la temperatura de la carga es la del sensor BLE y la temperatura del motor se evalúa solo para
   la alerta de motor.
3. **Given** un camión sin sensor de frío, **When** reporta temperatura de motor, **Then** la
   alerta de motor se evalúa igual: no depende de tener sensor de frío ni carga refrigerada.

---

### User Story 4 - El nivel de combustible baja en los viajes y se recarga (Priority: P2)

Quien mira la flota en AgroLink ve que el porcentaje del tanque de combustible de cada camión
simulado baja a medida que recorre kilómetros. Cuando queda por debajo del 7 %, el camión carga y
la lectura siguiente informa el tanque lleno (100 %). Hoy el valor arranca en 85 % para todos,
baja muy despacio, se clava en 5 % y nunca sube.

**Why this priority**: hace verosímil un dato que ya se muestra (mapa de flota) y que usa el
reporte de viaje. No bloquea la alerta de motor.

**Independent Test**: con un consumo alto configurado (por ejemplo 0,5 % por km), el nivel de un
camión baja trama a trama, informa un valor debajo de 7 % y la trama siguiente informa cerca de
100 %.

**Acceptance Scenarios**:

1. **Given** un camión en marcha, **When** recorre distancia entre dos tramas, **Then** el nivel
   informado baja en proporción a esa distancia. Detenido, no cambia.
2. **Given** una trama que informó menos del 7 %, **When** se emite la siguiente, **Then** el
   nivel parte de 100 % (menos lo recorrido en ese tramo).
3. **Given** el simulador recién arrancado, **When** emite la primera trama de cada camión,
   **Then** cada uno informa un nivel inicial distinto, entre el umbral de recarga y 100 %.
4. **Given** un reporte de viaje cuyo rango incluye una recarga, **When** se calcula el consumo,
   **Then** la recarga no resta: el consumo es la suma de las bajadas.

---

### Edge Cases

- **Lectura sin temperatura de motor** (campo vacío, valor no numérico o vehículo de otro
  proveedor que no la informa): no abre, no escala y no resuelve alertas. El estado de la alerta
  abierta queda como estaba.
- **Sin lecturas nuevas** (dispositivo sin reportar o consulta a ingesta que falla): la alerta
  abierta no se resuelve por falta de datos. Se resuelve solo con una lectura normalizada.
- **Misma lectura vista dos veces** (el backend consulta el estado cada minuto y puede volver a
  leer la última lectura si el dispositivo no reportó): no produce alertas duplicadas ni escalados
  repetidos.
- **Lectura que entra directo por encima del umbral crítico** sin pasar por advertencia: se crea la
  alerta directamente con severidad crítica.
- **Valores fuera de rango físico** (por ejemplo, negativos extremos o por encima de 150 °C): se
  tratan como dato inválido de sensor. No disparan la alerta y quedan registrados en el log con el
  valor recibido (Principio IX).
- **Configuración inválida en el backend** (umbral crítico menor o igual al de riesgo, margen
  negativo o mayor a la distancia entre la normalidad y el umbral): el servicio no arranca con esa
  configuración e informa el motivo, en vez de generar alertas absurdas.
- **Configuración inválida en el simulador** (pico menor o igual al umbral de riesgo por defecto,
  ritmo de subida no positivo): el simulador no arranca e informa el motivo.
- **Pedido manual sobre un camión inexistente o sin viaje en curso**: se rechaza con un mensaje
  que explica el motivo y no cambia nada.
- **Pedido manual de activación sobre un viaje que ya tiene la falla activa** (por sorteo o a
  mano): no la reinicia ni cambia la temperatura. Responde que ya estaba activa.
- **Simulador reiniciado con el sobrecalentamiento activo**: la temperatura acumulada en memoria se
  pierde. La falla sigue marcada en el viaje, así que el simulador vuelve a subir desde el rango
  normal. Es el mismo alcance que ya tienen la temperatura BLE y el combustible.
- **Camión dado de baja o sin dispositivo IoT con una alerta abierta**: la alerta queda abierta
  hasta que alguien la resuelva a mano. No se resuelve sola sin una lectura normalizada.
- **Viaje que termina con la alerta abierta**: la alerta sigue abierta asociada al viaje en el que
  ocurrió. Se resuelve cuando llega una lectura normalizada, aunque ya no haya viaje.

- **Nivel de combustible exactamente en el umbral** (7 %): todavía no recarga; recarga cuando
  queda por debajo.
- **Simulador reiniciado**: el nivel vive en memoria y se vuelve a sortear entre el umbral y
  100 %. El reporte de viaje puede ver esa subida como una recarga, y no la cuenta como consumo.

## Requirements *(mandatory)*

### Functional Requirements

**Simulador (`simulador-viajes`)**

- **FR-001**: El simulador MUST incluir en cada trama de un camión simulado una temperatura del
  refrigerante del motor en °C, en el campo del bloque CAN que el protocolo Rinho define para ese
  dato. Deja de enviarlo vacío.
- **FR-002**: En operación normal, la temperatura MUST mantenerse dentro de 80–95 °C, con
  variaciones pequeñas entre tramas consecutivas (no más de 2 °C), y MUST no alcanzar nunca el
  umbral de riesgo por defecto (105 °C).
- **FR-003**: Quien prepara la demo MUST poder activar y desactivar el sobrecalentamiento de motor
  sobre el viaje en curso de un camión simulado con un pedido HTTP al simulador (por ejemplo, con
  `curl`), sin ejecutar consultas a la base de datos. El efecto MUST verse desde la trama
  siguiente, sin reiniciar el simulador.
- **FR-003b**: El pedido manual MUST hacerse desde dentro de la red interna del despliegue
  (ejecutando `curl` dentro del contenedor del simulador). El puerto HTTP del simulador MUST seguir
  sin publicarse fuera de esa red. Por eso el endpoint no exige autenticación, igual que los
  endpoints internos que ya tiene. El contenedor del simulador MUST incluir `curl`, porque hoy su
  imagen base no lo trae.
- **FR-003c**: El pedido manual MUST identificar el camión con el mismo identificador de
  dispositivo que ya usa el simulador. MUST responder con un error claro, sin efecto, si el camión
  no existe o no tiene un viaje en curso. Activar una falla ya activa (o desactivar una inactiva)
  MUST responder con éxito sin cambiar nada.
- **FR-003a**: Además, al iniciarse cada viaje simulado (incluido el viaje de vuelta automático),
  el simulador MUST sortear si ese viaje tendrá sobrecalentamiento, con una probabilidad
  configurable (5 % por defecto). Si sale sorteado, la falla MUST activarse en un punto elegido al
  azar del recorrido, no siempre al inicio. Una probabilidad de 0 % desactiva la aparición al azar
  sin afectar la activación manual.
- **FR-003d**: Un sobrecalentamiento sorteado al azar MUST durar un tiempo elegido al azar dentro
  de un rango configurable (20–40 min por defecto) y desactivarse solo al cumplirlo. MUST terminar
  antes si el viaje termina o si se desactiva a mano, lo que ocurra primero. Un sobrecalentamiento
  activado a mano MUST no tener duración: sigue activo hasta que se desactiva a mano o termina el
  viaje.
- **FR-004**: La falla de sobrecalentamiento de motor MUST ser independiente de las fallas de carga.
  Un viaje MUST poder tener las dos activas a la vez.
- **FR-005**: Con el sobrecalentamiento activo, la temperatura MUST subir en cada trama al ritmo
  configurado (por defecto 2 °C por trama) hasta el pico configurado (por defecto 115 °C) y
  mantenerse alrededor de él mientras la falla siga activa.
- **FR-006**: Al desactivar el sobrecalentamiento, la temperatura MUST bajar gradualmente en las
  tramas siguientes hasta volver al rango normal. No vuelve al rango normal en una sola trama.
- **FR-007**: El ritmo de subida, el pico, la probabilidad por viaje y el rango de duración del
  sobrecalentamiento al azar MUST ser configurables sin cambiar el código. El simulador MUST
  rechazar al arrancar una configuración sin sentido: ritmo no positivo, pico menor o igual a
  105 °C (no permitiría demostrar la alerta), probabilidad fuera de 0–100 %, o rango de duración
  con mínimo no positivo o mínimo mayor que el máximo.
- **FR-008**: El viaje de vuelta generado automáticamente al completar un viaje MUST no heredar la
  falla de motor del viaje anterior. Arranca con temperatura normal y tiene su propio sorteo
  (FR-003a).

**Ingesta (`rinho-receptor` / `agrolink-ingesta`)**

- **FR-009**: La temperatura del refrigerante enviada por el simulador MUST quedar guardada en la
  lectura de telemetría y MUST aparecer, con el mismo valor, en la consulta de estado del vehículo.
  Ya se cumple hoy para tramas reales. Esta feature lo verifica con tramas simuladas.

**Backend (AgroLinkBackend)**

- **FR-010**: El backend MUST evaluar la temperatura del refrigerante del motor de cada vehículo
  activo con dispositivo IoT en cada lectura de estado que ya obtiene periódicamente. La evaluación
  no depende de que el vehículo tenga sensor de frío, carga refrigerada ni viaje en curso.
- **FR-011**: El umbral de riesgo (105 °C por defecto), el umbral crítico (110 °C por defecto) y el
  margen de normalización (5 °C por defecto) MUST ser configurables sin cambiar el código. El
  servicio MUST rechazar al arrancar una configuración incoherente (ver Edge Cases).
- **FR-012**: La temperatura de la carga MUST salir solo del sensor de frío (BLE). El backend MUST
  dejar de usar la temperatura del refrigerante del motor como reemplazo de la temperatura de la
  carga.
- **FR-013**: Cuando la temperatura alcance el umbral de riesgo y no haya una alerta de temperatura
  de motor abierta (activa o reconocida) para ese vehículo, el backend MUST crear una alerta de
  **tipo Mantenimiento**, subtipo **sobretemperatura de motor**. La alerta MUST tener:
  severidad advertencia (o crítica si la lectura ya alcanza el umbral crítico), el camión, el viaje
  en curso si lo hay, la temperatura medida, la hora de la lectura y una descripción que indique
  que el camión puede detener el viaje por alta temperatura de motor.
- **FR-014**: Mientras haya una alerta abierta, el backend MUST no crear otra para el mismo vehículo.
  MUST actualizar la temperatura máxima del episodio y MUST pasar la alerta de advertencia a
  crítica, con una nueva notificación en tiempo real, cuando una lectura alcance el umbral crítico.
  Una alerta crítica no vuelve a advertencia aunque la temperatura baje un poco.
- **FR-015**: El backend MUST resolver automáticamente la alerta abierta (activa o reconocida)
  cuando llegue una lectura por debajo del umbral de riesgo menos el margen de normalización. Las
  lecturas sin temperatura de motor o con valores fuera de rango físico MUST no abrir, escalar ni
  resolver alertas.
- **FR-016**: La nueva alerta MUST aparecer en los mismos canales que las demás alertas de
  mantenimiento: listado de alertas de mantenimiento activas, notificación en tiempo real y
  notificación push. MUST respetar el aislamiento por empresa (cada empresa ve solo las alertas de
  sus vehículos).

**Frontend (AgroLink)**

- **FR-017**: El panel de alertas MUST mostrar la alerta de sobretemperatura de motor en la sección
  de Mantenimiento, distinguible a simple vista de las de mantenimiento vencido o RTO (rótulo propio
  "Sobretemperatura de motor" o equivalente).
- **FR-018**: Cada alerta MUST mostrar la patente del camión, el viaje afectado (si lo hay), la
  temperatura máxima registrada en el episodio, la severidad (riesgo o detención inminente) y, si
  quedó resuelta, la hora de resolución.
- **FR-019**: La alerta MUST aparecer y actualizar su severidad en pantalla sin recargar la página,
  cuando el backend la crea o la escala.
- **FR-020**: La alerta de sobretemperatura de motor MUST no mostrar la acción "Ir a Cola de
  Mantenimiento" como si viniera de un trabajo de mantenimiento programado, porque no tiene uno
  asociado. MUST permitir reconocerla y resolverla igual que el resto de las alertas.

**Combustible (ampliación)**

- **FR-021**: El nivel de combustible (%) que informa el simulador en cada trama MUST bajar en
  proporción a la distancia recorrida desde la trama anterior, a un ritmo configurable (0,05 % por
  km por defecto), y no cambiar con el camión detenido.
- **FR-022**: Cuando una trama informe un nivel menor al umbral de recarga (7 % por defecto,
  configurable), la siguiente MUST partir del tanque lleno (100 %). El consumo acumulado en litros
  no se reinicia.
- **FR-023**: Cada camión simulado MUST arrancar con un nivel al azar entre el umbral de recarga y
  100 %. Con configuración inválida (ritmo no positivo, umbral fuera de 0–100) el simulador no
  arranca e informa el motivo.
- **FR-024**: El combustible consumido del reporte de viaje de ingesta MUST ser la suma de las
  bajadas entre lecturas consecutivas: una recarga en el rango no resta consumo.

### Key Entities

- **Lectura de temperatura del motor**: valor en °C de la temperatura del refrigerante del motor
  que viaja en cada trama del dispositivo y queda en la lectura de telemetría. Es independiente de
  la temperatura de la carga.
- **Falla de sobrecalentamiento de motor (simulada)**: marca sobre un viaje simulado en curso que
  hace subir la temperatura del motor del camión. Se activa de dos formas: al azar por sorteo al
  inicio del viaje (con un punto de disparo y una duración al azar), o a mano por pedido HTTP (sin
  duración). Termina al cumplirse la duración (solo la sorteada), al terminar el viaje o al
  desactivarla a mano. Registra su origen (al azar o manual). Es independiente de las fallas de
  carga del mismo viaje.
- **Nivel de combustible (simulado)**: porcentaje del tanque de cada camión, en memoria del
  simulador. Baja con la distancia y vuelve a 100 % al quedar debajo del umbral de recarga.
- **Umbrales de temperatura de motor**: umbral de riesgo, umbral crítico y margen de normalización.
  Son configuración del backend, iguales para toda la flota.
- **Alerta de sobretemperatura de motor**: alerta de tipo Mantenimiento asociada a un camión y,
  opcionalmente, al viaje en curso. Registra la temperatura máxima del episodio y tiene un ciclo de
  vida advertencia → crítica (opcional) → resuelta. Como máximo hay una abierta por vehículo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En una demo con la configuración por defecto, la alerta de riesgo aparece en el panel
  como mucho 12 minutos después de activar el sobrecalentamiento, y la crítica como mucho 17 minutos
  después.
- **SC-002**: Desde que llega a AgroLink una lectura por encima de un umbral, la alerta (nueva o
  escalada) se ve en pantalla en menos de 2 minutos, sin recargar la página.
- **SC-003**: Durante 8 horas de simulación de toda la flota sin sobrecalentamiento activo
  (probabilidad al azar en 0 % y sin activación manual), no se
  genera ninguna alerta de sobretemperatura de motor ni ninguna alerta térmica de carga causada por
  la temperatura del motor (0 falsos positivos).
- **SC-004**: Cada episodio de sobrecalentamiento produce exactamente una alerta, aunque el
  vehículo envíe decenas de lecturas por encima del umbral.
- **SC-005**: Después de desactivar el sobrecalentamiento, la alerta queda resuelta sola en menos
  de 15 minutos, sin intervención del usuario.
- **SC-007**: En una simulación con consumo alto, cada camión que cruza el 7 % informa el tanque
  lleno en la trama siguiente, y el reporte de viaje de ese rango nunca da consumo negativo.
- **SC-006**: Cambiar cualquiera de los umbrales lleva solo un cambio de configuración y un
  reinicio, sin modificar ni desplegar código.

## Assumptions

- **El camión simulado no se detiene** (confirmado en Clarifications): el simulador sigue avanzando
  el viaje aunque la temperatura supere el umbral crítico. La feature solo anticipa el riesgo de
  detención; simular la parada del motor o la pérdida de potencia (velocidad y RPM) queda fuera de
  alcance.
- **El estado del viaje no cambia** (confirmado en Clarifications): la alerta de motor no pasa el
  viaje a "alerta crítica" (ese estado hoy lo gobiernan las alertas térmicas de carga). La alerta
  solo informa.
- **Umbrales únicos para toda la flota**: no hay umbrales por modelo de motor ni por vehículo en
  esta feature.
- **Sin cambios funcionales en ingesta**: el receptor ya decodifica el campo y la consulta de estado
  ya lo expone (verificado en el código el 2026-11-10). Si el plan encuentra que falta algo (por
  ejemplo, decimales que el almacenamiento entero redondea), se resuelve ahí. Una precisión de 1 °C
  alcanza para esta alerta.
- **Fuente del dato en el backend**: se reutiliza la consulta de estado que el backend ya hace cada
  minuto. No se agrega un canal nuevo ni mensajería (Principio III).
- **Vehículos de otros proveedores** (por ejemplo, Samsara por webhook) no informan esta
  temperatura. Para ellos la alerta simplemente no se evalúa.
- **Sin historial de temperatura de motor** en el frontend: solo se ve en la alerta. Mostrar la
  temperatura del motor en la ficha del vehículo o en un gráfico queda fuera de alcance.
- **Los umbrales por defecto** salen de la investigación de la sección Contexto y son una
  referencia para la POC, no la calibración de un motor real.
