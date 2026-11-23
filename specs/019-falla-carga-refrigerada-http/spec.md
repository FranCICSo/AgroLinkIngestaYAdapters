# Feature Specification: Activar y cerrar a mano el desvío térmico de la carga refrigerada

**Feature Branch**: `feature/samsara-exceso-manual` (no se creó rama nueva: el repo no tiene
hook de creación de ramas configurado)

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "as you know, there are two thresholds for cargo temperature of a
trip. When the temperature is out of them, an alarm is activated. You gave me a mechanism to throw
that alert but with sql (in some readme it was written, search it). I need a mechanism to activate
and close that alert by a curl to simulador-viajes docker container"

## Contexto

### Estado actual (relevado el 2026-11-22)

- Un viaje con carga refrigerada tiene dos umbrales térmicos de la carga (mínimo y máximo, en °C).
  Desde la última modificación, esos umbrales llegan al simulador al iniciar el viaje. El simulador
  los usa para fijar el setpoint del camión en el centro del rango, así la temperatura normal
  simulada queda adentro.
- Hoy la única forma de sacar la temperatura de la carga fuera del rango es editar la base del
  simulador a mano, como documenta `simulador-viajes/README.md`, sección "Forzar una falla de carga
  refrigerada (para demos)":
  - Activar: `UPDATE simulador.viaje SET falla_tipo = 'falla_compresor', falla_indice_disparo =
    indice_actual WHERE camion_id = '900002' AND estado = 'en_curso';`
  - Cerrar: `UPDATE simulador.viaje SET falla_tipo = NULL, falla_indice_disparo = NULL WHERE ...;`
- Con esa falla, la temperatura sube 0,15 °C por trama, sin tope y sin mirar los umbrales del
  viaje. Con el ciclo por defecto (una trama por minuto) y un rango típico de 2 a 8 °C, tarda unos
  20 minutos solo en salir del rango.
- La sobretemperatura de motor (feature 016) ya se activa y desactiva con `curl` contra el servidor
  HTTP interno del simulador (`/camiones/{dispositivoId}/falla-motor`, métodos `POST`, `GET`,
  `DELETE`). Esta feature ofrece lo mismo para la carga refrigerada.
- AgroLinkBackend (sin cambios en esta feature):
  - Abre la alerta térmica del viaje (crítica, pasa el viaje a "alerta crítica") cuando todas las
    lecturas de los últimos 20 minutos quedan fuera del rango, por encima del máximo o por debajo
    del mínimo. Esa ventana tolera los ciclos de descongelamiento.
  - La cierra sola cuando una lectura vuelve a quedar dentro del rango.
  - Evalúa cada 10 minutos.

### Qué significa "activar" y "cerrar" la alerta

El simulador no crea ni cierra alertas: solo produce la temperatura de la carga en las tramas. La
alerta la abre y la cierra AgroLinkBackend según esa temperatura. En esta especificación:

- **Activar el desvío** = que el simulador lleve la temperatura de la carga fuera del rango del
  viaje y la mantenga ahí. Eso termina abriendo la alerta.
- **Cerrar el desvío** = que el simulador la devuelva al rango. Eso termina cerrando la alerta.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Activar el desvío térmico con un curl (Priority: P1)

Quien prepara una demo o prueba la alerta térmica tiene un viaje refrigerado en curso con un camión
simulado. Ejecuta un `curl` dentro del contenedor del simulador para ese camión, sin escribir SQL.
Desde la trama siguiente, la temperatura de la carga sale del rango del viaje y se queda afuera
hasta que alguien la cierre. Pasada la ventana de tolerancia del backend, se abre la alerta térmica
del viaje.

**Why this priority**: Es el pedido central. Sin activación por `curl` no hay feature, y reemplaza
el único mecanismo actual (SQL a mano).

**Independent Test**: Con un viaje refrigerado en curso, ejecutar el `curl` de activación. Verificar
que las tramas siguientes del camión traen temperatura de carga fuera del rango y que, pasada la
ventana del backend, el viaje tiene una alerta térmica abierta.

**Acceptance Scenarios**:

1. **Given** un camión simulado con viaje en curso de carga refrigerada (rango 2 a 8 °C) y
   temperatura normal, **When** se activa el desvío sin indicar sentido, **Then** desde la trama
   siguiente la temperatura de la carga queda por encima de 8 °C y sigue ahí en todas las tramas
   hasta que se cierre.
2. **Given** el mismo camión, **When** se activa el desvío pidiendo sentido "por debajo",
   **Then** la temperatura de la carga queda por debajo de 2 °C y se mantiene ahí.
3. **Given** el desvío activo durante más que la ventana de tolerancia del backend, **When** el
   backend evalúa el viaje, **Then** el viaje tiene una alerta térmica abierta.
4. **Given** el desvío ya activo, **When** se vuelve a activar, **Then** la respuesta indica que ya
   estaba activo y la simulación no cambia.

---

### User Story 2 - Cerrar el desvío térmico con un curl (Priority: P1)

Con el desvío activo (y quizás la alerta ya abierta), quien opera la demo ejecuta otro `curl` para
cerrarlo. La temperatura de la carga vuelve al rango del viaje y el backend cierra la alerta en su
próxima evaluación.

**Why this priority**: Es la otra mitad del pedido ("activate and close"). Sin cierre, el viaje
queda en alerta hasta que termine o hasta editar la base.

**Independent Test**: Con el desvío activo, ejecutar el `curl` de cierre. Verificar que la
temperatura vuelve al rango en pocas tramas y que, en la evaluación siguiente del backend, la
alerta térmica queda cerrada.

**Acceptance Scenarios**:

1. **Given** el desvío activo y la temperatura de la carga fuera del rango, **When** se cierra el
   desvío, **Then** la temperatura vuelve a quedar dentro del rango en las tramas siguientes y
   después se mantiene cerca del setpoint.
2. **Given** el desvío cerrado y la temperatura de nuevo en el rango, **When** el backend evalúa el
   viaje, **Then** la alerta térmica que estaba abierta queda cerrada.
3. **Given** un camión sin desvío activo, **When** se pide cerrarlo, **Then** la respuesta indica
   que no había nada activo y la simulación no cambia.

---

### User Story 3 - Consultar el estado del desvío (Priority: P2)

Antes o durante una demo, quien opera quiere saber si el camión tiene el desvío activo, en qué
sentido, desde cuándo y cuál fue la última temperatura de carga emitida. Así sabe cuánto falta para
que el backend abra la alerta, sin consultar la base.

**Why this priority**: Facilita operar la demo y diagnosticar, pero activar y cerrar funcionan sin
esto.

**Independent Test**: Consultar el estado antes de activar, después de activar y después de cerrar.
Verificar que el estado, el sentido, la hora de activación y la última temperatura reflejan cada
momento.

**Acceptance Scenarios**:

1. **Given** un camión con viaje refrigerado en curso sin desvío, **When** se consulta el estado,
   **Then** informa "inactivo", la última temperatura de carga emitida y el rango del viaje.
2. **Given** el desvío activo, **When** se consulta el estado, **Then** informa "activo", el sentido
   pedido y la hora de activación.

---

### Edge Cases

- **Camión inexistente**: se responde "camión no encontrado" y no se cambia nada.
- **Camión sin viaje en curso o inactivo**: se responde "sin viaje en curso" y no se cambia nada.
- **Camión con carga seca**: no hay temperatura de carga que desviar. Se rechaza indicando que el
  viaje no tiene carga refrigerada.
- **Identificador de camión mal formado**: se rechaza como error de validación.
- **Sentido no reconocido** (ni "por encima" ni "por debajo"): se rechaza como error de validación,
  sin activar nada.
- **Pedido de cambio de sentido con el desvío activo**: se trata como "ya activo" y no cambia el
  sentido. Para cambiarlo, primero hay que cerrar el desvío.
- **El viaje termina con el desvío activo** (completado, cancelado o vuelta automática): el desvío
  termina con el viaje. El viaje siguiente del mismo camión arranca con la temperatura normal.
- **Ya existe una falla de carga cargada por SQL** (apertura de puerta o falla de compresor
  programada): activar por `curl` la reemplaza y cerrar por `curl` también la cierra. Como mucho hay
  una falla de carga por viaje, igual que hoy.
- **Sobretemperatura de motor activa al mismo tiempo**: es independiente. Activar o cerrar el desvío
  de carga no la toca, y al revés.
- **Rango del viaje desconocido para el simulador** (por ejemplo, un camión dado de alta a mano con
  setpoint pero sin umbrales): el desvío se calcula respecto del setpoint con un margen fijo, lo
  bastante grande para salir de un rango típico de carga refrigerada.
- **Reinicio del simulador con el desvío activo**: el desvío sigue activo después del reinicio,
  porque es parte del estado persistido del viaje.

## Requirements *(mandatory)*

### Functional Requirements

**Activación**

- **FR-001**: El simulador MUST permitir activar el desvío térmico de la carga de un camión
  simulado con una sola llamada HTTP, ejecutable con `curl` desde adentro de su contenedor, igual
  que la falla de motor existente.
- **FR-002**: La activación MUST aceptar un sentido opcional: por encima del máximo (por defecto) o
  por debajo del mínimo.
- **FR-003**: Con el desvío activo, la temperatura de la carga de cada trama MUST quedar fuera del
  rango del viaje, del lado pedido, con un margen de al menos 2 °C respecto del umbral. Así las
  pequeñas variaciones simuladas no la devuelven al rango.
- **FR-004**: La temperatura MUST salir del rango en a lo sumo 3 tramas desde la activación (con el
  ciclo por defecto, en no más de 3 minutos). No puede tardar decenas de minutos como la falla
  actual por SQL.
- **FR-005**: La temperatura MUST mantenerse fuera del rango mientras el desvío siga activo, con una
  variación pequeña entre tramas que la haga verosímil, y sin pasar de un valor plausible para un
  equipo de frío averiado.
- **FR-006**: Activar con el desvío ya activo MUST responder que ya estaba activo, sin reiniciar ni
  cambiar la simulación.

**Cierre**

- **FR-007**: El simulador MUST permitir cerrar el desvío de un camión con una sola llamada HTTP del
  mismo estilo que la activación.
- **FR-008**: Al cerrarse, la temperatura MUST volver al rango del viaje en a lo sumo 5 tramas y
  después mantenerse cerca del setpoint, como en operación normal.
- **FR-009**: Cerrar sin desvío activo MUST responder que no había nada activo, sin cambiar la
  simulación.

**Consulta**

- **FR-010**: El simulador MUST permitir consultar con una llamada HTTP el estado del desvío de un
  camión: activo o inactivo, sentido, hora de activación, hora de cierre (si se cerró en este
  viaje), última temperatura de carga emitida y rango del viaje que conoce el simulador.

**Validaciones y respuestas**

- **FR-011**: Las tres operaciones MUST rechazar, sin cambiar nada y con un motivo distinguible:
  identificador de camión inválido, camión inexistente, camión sin viaje en curso o inactivo, viaje
  sin carga refrigerada y sentido no reconocido.
- **FR-012**: Las respuestas MUST seguir las mismas convenciones de códigos y forma que la falla de
  motor existente (`/camiones/{dispositivoId}/falla-motor`), para que quien ya usa una use la otra
  sin aprender nada nuevo.
- **FR-013**: Cada activación y cada cierre MUST dejar un registro en el log del simulador con el
  camión, el viaje, el sentido y el efecto.

**Rango del viaje**

- **FR-014**: El simulador MUST conocer los umbrales mínimo y máximo del viaje refrigerado para
  ubicar la temperatura desviada respecto de ellos. Hoy solo recibe el setpoint. Los umbrales ya
  viajan del backend a `agrolink-ingesta`, que los guarda. Falta reenviarlos al simulador junto con
  el setpoint.
- **FR-015**: Si el simulador no conoce los umbrales del viaje, MUST desviar la temperatura
  respecto del setpoint con un margen fijo configurable, que por defecto saque la temperatura de un
  rango típico de carga refrigerada (por ejemplo, de 2 a 8 °C).

**Ciclo de vida y convivencia**

- **FR-016**: El desvío MUST pertenecer al viaje en curso: termina con el viaje y no pasa al viaje
  siguiente del camión, incluida la vuelta automática.
- **FR-017**: El desvío MUST sobrevivir a un reinicio del simulador mientras el viaje siga en curso.
- **FR-018**: Activar o cerrar el desvío por HTTP MUST reemplazar o cerrar cualquier falla de carga
  que se haya cargado antes por SQL en el mismo viaje. Como mucho hay una falla de carga activa por
  viaje.
- **FR-019**: El desvío de carga y la sobretemperatura de motor MUST ser independientes. Ninguna
  operación de uno cambia el otro.

**Documentación**

- **FR-020**: `simulador-viajes/README.md` MUST documentar los comandos `curl` para activar,
  consultar y cerrar el desvío, junto a los de la falla de motor. Además MUST indicar cuánto tarda el
  backend en abrir y en cerrar la alerta. Los comandos SQL actuales pueden quedar como alternativa.

### Key Entities

- **Desvío térmico de carga (por viaje)**: falla manual de la carga refrigerada del viaje en curso.
  Atributos: sentido (por encima o por debajo), activo o inactivo, hora de activación, hora de
  cierre. Pertenece a un único viaje. Comparte con las fallas de carga existentes la regla de una
  por viaje.
- **Rango térmico del viaje**: umbrales mínimo y máximo de temperatura de la carga que define el
  viaje refrigerado. Los fija AgroLinkBackend y el simulador los usa para ubicar la temperatura
  normal (en el centro) y la desviada (fuera, del lado pedido).
- **Camión simulado**: el destinatario de las operaciones, identificado por su identificador de
  dispositivo. Solo los camiones con viaje refrigerado en curso admiten el desvío.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Quien opera una demo activa y cierra el desvío térmico con un único comando cada vez,
  sin escribir SQL ni conocer la estructura de la base del simulador.
- **SC-002**: Con el ciclo por defecto, la temperatura de la carga sale del rango del viaje en no
  más de 3 minutos desde la activación (hoy tarda unos 20 minutos en un rango de 2 a 8 °C).
- **SC-003**: Con la configuración actual del backend, la alerta térmica del viaje se abre en no más
  de 35 minutos desde la activación: la salida del rango, más la ventana de tolerancia de
  20 minutos, más una evaluación cada 10 minutos.
- **SC-004**: Después del cierre, la temperatura vuelve al rango en no más de 5 minutos y la alerta
  se cierra en no más de 15 minutos: la vuelta al rango más una evaluación cada 10 minutos.
- **SC-005**: El 100 % de las tramas emitidas con el desvío activo trae la temperatura de carga
  fuera del rango del viaje, del lado pedido.
- **SC-006**: Activar o cerrar el desvío no altera la sobretemperatura de motor ni ningún otro dato
  de las tramas.

## Assumptions

- **Alcance**: la feature vive en `simulador-viajes`, más el reenvío de umbrales de
  `agrolink-ingesta` al simulador (FR-014). AgroLinkBackend no cambia: sus reglas actuales abren y
  cierran la alerta a partir de la temperatura simulada.
- **Tiempos del backend**: la ventana de tolerancia de 20 minutos y la evaluación cada 10 minutos
  son configuración del backend y quedan fuera de alcance. Para una demo más corta se pueden bajar
  ahí. Esta feature solo hace que el simulador salga del rango y vuelva enseguida.
- **Acceso**: igual que la falla de motor, las operaciones van por el servidor HTTP interno del
  simulador, que no se publica fuera de la red de Docker. Por eso no llevan autenticación propia.
- **Sentido por defecto**: por encima del máximo, porque es el caso típico (falla del equipo de frío)
  y el que ya simulaba la falla de compresor.
- **Valor desviado**: la temperatura se ubica unos grados fuera del umbral, con una variación
  pequeña entre tramas, y no se dispara a valores irreales. El valor exacto queda para el plan.
- **Apertura de puerta**: la falla de apertura de puerta por SQL queda como está. Es un pico breve
  que no se sostiene durante la ventana del backend, así que no abre la alerta, y el simulador no
  emite un sensor de puerta.
- **Camiones con viaje refrigerado**: la feature asume el flujo actual, en el que el tipo de carga y
  el setpoint del camión llegan al iniciar el viaje desde AgroLinkBackend.
