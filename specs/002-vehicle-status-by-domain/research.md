# Phase 0 — Research: Consulta de Estado de Vehículo por Identificador de Dispositivo IoT

**Feature**: `002-vehicle-status-by-domain` | **Date**: 2026-09-09

Todas las ambigüedades de alcance se resolvieron interactivamente durante `/speckit-specify`
y `/speckit-clarify` (ver [spec.md](./spec.md) > Clarifications). No quedan
`NEEDS CLARIFICATION` en el Technical Context. Este documento cubre las decisiones técnicas
necesarias para pasar de spec a diseño.

---

## D-01: Cómo exponer la nueva consulta en un puerto propio sin exponer `/api/v1/reportes/viaje`

**Contexto**: FR-011 exige que la nueva consulta sea alcanzable desde fuera del entorno de
despliegue, en un puerto distinto de 8080 y distinguible del de otros servicios. La spec
(Assumptions) además fija que esto **no** debe cambiar la accesibilidad actual de
`/api/v1/reportes/viaje`, que hoy es intencionalmente interna (Principio VI: superficie
mínima expuesta). Ambas consultas viven en el mismo proceso Spring Boot
(`agrolink-ingesta`), así que "puerto distinto" no puede resolverse solo con una variable de
entorno de puerto único: hay que decidir cómo un solo proceso sirve una ruta en un puerto
público y otra ruta en un puerto que permanece privado.

**Decision**: El servicio `agrolink-ingesta` registra un **segundo conector HTTP embebido**
(Tomcat) además del existente, usando un `WebServerFactoryCustomizer` estándar de Spring
Boot. El puerto original (`REPORTES_HTTP_PORT`, hoy 8080 por defecto) sigue **sin
publicarse** al host — solo red interna de compose, sin cambios respecto de hoy. El nuevo
puerto (`VEHICULO_ESTADO_HTTP_PORT`) se agrega como conector adicional y es el **único** que
Docker Compose publica al host. Un filtro servlet mínimo (`OncePerRequestFilter`) inspecciona
`request.getLocalPort()` y rechaza con 404 cualquier ruta que no sea
`/api/v1/vehiculos/**` cuando la petición entró por el puerto nuevo; el puerto original sigue
sirviendo exactamente lo que sirve hoy (reportes + `/health`), sin restricción adicional.

Esto mantiene un solo proceso, un solo `Dockerfile`, un solo servicio en `compose.yaml` —
sin introducir un segundo microservicio ni un proxy reverso — y dispersa la responsabilidad
de "qué se expone por dónde" en ~30 líneas de configuración explícita, verificable con un
test de integración que golpea ambos puertos.

**Rationale**: Cumple FR-011 (puerto propio, externo) y la restricción de no-regresión sobre
`/api/v1/reportes/viaje` (Assumptions) con la menor complejidad nueva posible (Principio
III), evitando tanto un segundo servicio (duplicaría Dockerfile, healthcheck, límites de
memoria) como un reverse proxy (Nginx/Traefik) que no está justificado por ninguna necesidad
de escala demostrada.

**Alternatives considered**:
- **Publicar el mismo puerto/servicio completo al host bajo un número distinto** (ej.
  `ports: - "8082:${REPORTES_HTTP_PORT}"`): más simple de configurar, pero expone
  `/api/v1/reportes/viaje` al público como efecto secundario — contradice la Assumption de
  la spec y reabre una superficie que el diseño de la feature 001 cerró deliberadamente.
- **Segundo servicio Spring Boot independiente** (`agrolink-vehiculo-estado`), con su propio
  `Dockerfile` y rol de base de datos: aísla completamente el riesgo, pero duplica
  infraestructura (imagen, healthcheck, límite de memoria, arranque en frío de una segunda
  JVM) para una sola consulta de lectura sobre la misma tabla — desproporcionado para el
  alcance actual y sin necesidad de escalado independiente demostrada.
- **Reverse proxy (Nginx) delante de ambos puertos**: agrega una pieza de infraestructura
  nueva al stack (imagen, configuración, otro punto de fallo) para resolver un enrutamiento
  que Spring Boot ya resuelve nativamente con un filtro de ~30 líneas.

---

## D-02: Qué columnas de `lectura_telemetria` necesita esta feature que hoy no mapea la entidad JPA

**Contexto**: `LecturaTelemetria.java` (feature 001) mapea deliberadamente solo las columnas
que el reporte de viaje necesita (`dispositivo_id`, `momento_evento`, `velocidad_kmh`,
`odometro_m`, `odometro_origen`, `combustible_pct`). El resto (`latitud`, `longitud`,
`rumbo_grados`, `ignicion`, `tension_bateria_v`, `satelites`, `momento_recepcion`,
`estado_interpretacion`, `campos_faltantes`, `datos_can`) está fuera de esa entidad con la
justificación explícita "no tiene consumidor en este servicio". Esta feature es ese primer
consumidor para posición, indicadores de dispositivo y CAN bus.

**Decision**: Se amplía `LecturaTelemetria` para mapear también `latitud`, `longitud`,
`rumbo_grados`, `ignicion`, `tension_bateria_v`, `satelites`, `momento_recepcion`,
`estado_interpretacion`, `campos_faltantes` y `datos_can`. Se mantiene `@Immutable`, sin
setters, y **sin** mapear `payload_crudo` ni `frame_hash` (siguen sin tener consumidor:
son responsabilidad exclusiva del receptor/auditoría, FR-005 no los pide). El comentario de
la clase se actualiza para reflejar que ya no es una proyección mínima del reporte de viaje,
sino la proyección de lectura completa que ambos consumidores (reporte y estado) necesitan.

**Rationale**: Una sola entidad de solo-lectura para toda la fila sigue el patrón que la
constitución fija para JPA (`Repository` marcador, sin `save/delete`, Principio IV) y evita
mantener dos entidades JPA distintas sobre la misma tabla física, que divergirían en cómo
mapean tipos (`datos_can` como `JSONB`, `campos_faltantes` como `TEXT[]`) sin ningún
beneficio de aislamiento real — ambas son de solo lectura sobre la misma hypertable.

**Alternatives considered**:
- **Entidad JPA nueva y separada** (`LecturaTelemetriaCompleta`) solo para esta feature:
  descartado — dos entidades `@Immutable` sobre la misma tabla es una fuente de confusión
  (¿cuál usar en código nuevo?) sin ninguna ventaja, ya que ninguna de las dos escribe.
- **Proyección JPA (interface-based projection)** limitada a los campos de esta feature:
  viable, pero forzaría duplicar el mapeo de `datos_can`/`campos_faltantes` (tipos no
  triviales) en dos lugares si el reporte de viaje alguna vez los necesita.

---

## D-03: Formato del identificador de dispositivo en la ruta

**Contexto**: FR-009 exige validar el identificador antes de buscar. El reporte de viaje ya
valida esto implícitamente (columna `VARCHAR(20)` `NOT NULL`, sin regla de formato adicional
en código — cualquier string no vacío es válido).

**Decision**: Mismo criterio que `camionId` en el reporte de viaje: el identificador de
dispositivo es un `String` no vacío, sin más restricción de formato en esta capa (la
columna de base ya acota a 20 caracteres). Se rechaza con `400` un valor vacío o compuesto
solo de espacios; no se valida un patrón específico porque el formato real lo define cada
fabricante de hardware (Principio I) y esta feature no debe acoplarse a él.

**Rationale**: Mantiene el mismo criterio ya validado en producción por la feature 001, sin
inventar una regla nueva que después haya que revertir cuando entre un segundo fabricante.

**Alternatives considered**: Validar contra un patrón alfanumérico fijo — descartado, no hay
ninguna garantía de formato documentada del lado de AgroLinkBackend ni de los fabricantes de
hardware soportados.
