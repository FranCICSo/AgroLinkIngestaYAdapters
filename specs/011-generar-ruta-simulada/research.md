# Phase 0 Research: Generación de Rutas Simuladas desde Origen/Destino

Todas las preguntas abiertas de la especificación quedaron resueltas en las sesiones de
`/speckit-clarify` (ver `spec.md` § Clarifications). Las decisiones de este documento son de
diseño técnico necesarias para pasar de esa especificación a un plan implementable, no
ambigüedades de producto.

## D-01: Formato de consulta a OSRM

**Decisión**: Usar el endpoint `GET /route/v1/driving/{lon1},{lat1};...;{lonN},{latN}` de la API
HTTP de OSRM, con `overview=full&geometries=geojson&steps=false`. Las paradas intermedias (si las
hay) se pasan como coordenadas intermedias en el mismo path, en orden, para que OSRM trace la
ruta completa pasando por ellas. La respuesta trae `routes[0].geometry.coordinates` como un
array de `[lon, lat]` que se mapea 1:1 a los `puntos` (`{lat, lon}`) de `simulador.ruta`.

**Rationale**: `geometries=geojson` devuelve coordenadas en texto plano (sin decodificar
polyline), evitando agregar una dependencia nueva solo para decodificar polylines — consistente
con la filosofía de dependencias mínimas ya seguida en `simulador-viajes` (sólo `pg`). `fetch` ya
es global en Node 22 (motor usado en todo el repo), así que tampoco hace falta un cliente HTTP
adicional.

**Alternatives considered**: `geometries=polyline` (más compacto en la red, pero exige decodificar
con una librería extra — no se justifica para el volumen de datos de esta feature, un puñado de
rutas de demo/simulación, no tráfico de producción).

## D-02: Umbral de "distancia trivial" entre origen y destino

**Decisión**: Rechazar la generación (FR-009) cuando la distancia Haversine entre origen y
destino sea menor a 50 metros. Se implementa como una constante nombrada
(`DISTANCIA_MINIMA_METROS`) en `routeGenerationService.js`, no como un valor mágico inline.

**Rationale**: 50 m descarta con margen los casos de "mismo punto" o un error de tipeo en una
coordenada sin rechazar trayectos cortos legítimos (un camión que recorre unas pocas cuadras en
una zona urbana/industrial sigue siendo un escenario de simulación válido).

**Alternatives considered**: Rechazar sólo si origen y destino son exactamente iguales — se
descarta porque no cubre coordenadas casi idénticas (error de redondeo/tipeo) que igual producen
una ruta degenerada de 1-2 puntos.

## D-03: Unicidad del nombre de ruta (FR-008)

**Decisión**: Agregar una restricción `UNIQUE` sobre `simulador.ruta.nombre` vía una migración
idempotente nueva (`deploy/migrations/005_add_ruta_nombre_unique.sql`, mismo patrón que
002-004), reflejada también en `deploy/db/03-schema-simulador.sql` para volúmenes nuevos. El
repositorio (`rutaRepository.js`) captura el error de Postgres `23505 unique_violation` al
insertar y lo traduce a un resultado de conflicto explícito (sin exponer el código de error crudo
al llamador).

**Rationale**: Encontrar el conflicto a nivel de base de datos evita una condición de carrera
entre un `SELECT` de verificación y el `INSERT` posterior (TOCTOU) si dos generaciones con el
mismo nombre llegan casi al mismo tiempo; es la misma garantía que ya usa `camion.id` como
`PRIMARY KEY`.

**Alternatives considered**: Verificación a nivel de aplicación (`SELECT ... WHERE nombre = $1`
antes del `INSERT`) — se descarta por la condición de carrera mencionada, evitable sin costo
agregando la restricción en la base.

## D-04: Restricción de acceso al endpoint HTTP (FR-006)

**Decisión**: El servidor HTTP de este módulo escucha, pero el `docker-compose.yaml` **no publica
su puerto al host** (sin entrada en `ports:`) — queda alcanzable sólo dentro de la red interna de
Docker compose, igual que ya se hace con el puerto 5432 de `timescaledb` (publicado sólo en
`127.0.0.1`) y el puerto UDP del receptor (único puerto expuesto a la red externa). El frontend de
AgroLink corre fuera de esa red Docker, así que nunca puede alcanzarlo directamente — sin
necesidad de un esquema de autenticación nuevo para esta primera versión.

**Rationale**: Reutiliza un patrón de aislamiento de red que el propio proyecto ya aplica
(Principio VI, "aislamiento de red" como control compensatorio), sin construir un mecanismo de
auth nuevo para una herramienta de uso interno del equipo. Si la integración de fase 2
(AgroLinkBackend llamando a este endpoint) se implementa más adelante, ese momento es cuando
corresponde decidir si hace falta un token compartido u otro control — está fuera del alcance de
esta feature (ver spec.md § Assumptions).

**Alternatives considered**: Autenticación por token/API key desde ahora — se descarta por
prematura: no hay todavía un llamador real fuera de la red interna del equipo, y añadir un
esquema de auth sin una necesidad demostrada contradice la misma lógica de simplicidad que el
Principio III aplica a mensajería.

## D-05: Un único servicio detrás de dos entry points (HTTP + CLI)

**Decisión**: Toda la lógica (llamar a OSRM, validar, armar `puntos`/`paradas`, persistir) vive en
`src/services/routeGenerationService.js`, una función pura de I/O explícito (recibe el pool de
Postgres y un cliente OSRM inyectados). `src/http/rutaHttpServer.js` (endpoint `POST /rutas`) y
`src/cli/crearRuta.js` (comando `npm run crear-ruta --`) son wrappers delgados que parsean su
respectiva entrada (JSON body vs. argv) y llaman a esa misma función.

**Rationale**: Garantiza por construcción la equivalencia exigida por FR-007 (mismo resultado vía
HTTP o CLI) sin duplicar lógica de negocio ni arriesgar que diverjan con el tiempo.

**Alternatives considered**: Implementar la lógica de generación directamente en el handler HTTP
y que el CLI le pegue a `http://localhost` como si fuera un cliente externo — se descarta porque
obligaría a que el servidor HTTP esté corriendo para poder usar el CLI, acoplamiento innecesario
para una herramienta de línea de comandos que debe poder correrse sola.

## D-06: Semántica de fallo de OSRM (FR-003, Edge Cases)

**Decisión**: El cliente OSRM (`src/net/osrmClient.js`) trata como la misma clase de fallo
("no se pudo trazar la ruta"): (a) la llamada HTTP no responde dentro de un timeout configurable
(default 5000 ms), (b) la respuesta no es HTTP 200, y (c) la respuesta es 200 pero
`body.code !== "Ok"` (p. ej. `"NoRoute"`, `"NoSegment"`). En los tres casos,
`routeGenerationService.js` rechaza la generación sin persistir nada y loguea el motivo concreto
(coordenadas, nombre de ruta solicitado, y el código/causa de OSRM) — nunca un descarte
silencioso (Principio IX).

**Rationale**: Unificar los tres casos en un único resultado de "fallo de trazado" simplifica el
contrato hacia el llamador (HTTP/CLI) sin perder diagnóstico, porque el detalle queda en el log,
no en la respuesta de error genérica.

**Alternatives considered**: Reintentar automáticamente ante timeout/caída de OSRM — se descarta
para esta primera versión porque es una llamada síncrona iniciada por una persona (a diferencia
del reintento de ACK del Principio VII, pensado para conectividad intermitente de dispositivos de
campo); la persona puede simplemente volver a invocar el comando/endpoint.

## D-07: Forma de las paradas intermedias en la solicitud

**Decisión**: El endpoint/CLI acepta una lista ordenada opcional de paradas como
`{ lat, lon, duracionMin }`. Cada parada se inserta como coordenada intermedia en la consulta a
OSRM (D-01) para que el trazado pase por ella, y su posición en el array `puntos` resultante se
graba como `indice` en el array `paradas` de `simulador.ruta` — mismo shape
`[{ indice, duracion_min }, ...]` que ya usa la feature 009 para que `simulador-viajes` (el loop
de avance de ruta) las interprete sin cambios.

**Rationale**: Reutilizar el shape de datos ya consumido por `avanceRuta.js` evita tocar esa
lógica existente; sólo cambia cómo se genera la fila, no cómo se consume.

## D-08: Operar OSRM como parte del proceso de deploy del repo

**Decisión**: Se agrega un servicio `osrm` nuevo a `deploy/compose.yaml` (imagen
`osrm/osrm-backend`, mismo `profile: ["simulador"]` que `simulador-viajes`, sin `ports:` —
alcanzable sólo dentro de la red de Docker compose, igual que `simulador-viajes`), más un target
de `Makefile` (`make osrm`) que: (1) descarga el extracto OSM de Argentina desde Geofabrik a
`deploy/osrm-data/` si todavía no está, (2) corre `osrm-extract`/`osrm-partition`/
`osrm-customize` sobre ese extracto si el `.osrm` resultante todavía no existe, y (3) levanta el
contenedor `osrm-routed` vía `docker compose --profile simulador up -d osrm`. Los dos primeros
pasos son costosos (descarga de cientos de MB, varios minutos de procesamiento) pero se saltean
en corridas siguientes si los archivos ya existen — mismo principio de idempotencia que ya usan
`make simulador` y los scripts de `deploy/db/`/`deploy/migrations/`. `make simulador` pasa a
depender de `make osrm` además de `timescaledb`/`receptor`, para que levantar el simulador
complete también la pieza de generación de rutas sin un paso manual aparte.

**Rationale**: Al ser un proyecto de tesis/PoC (Clarifications), no hay otro equipo operando
OSRM como infraestructura ya resuelta — dejarlo fuera del repo obligaría a cada persona que
clona el proyecto a repetir a mano los mismos comandos `docker run` de `osrm-extract`/
`osrm-partition`/`osrm-customize`/`osrm-routed` documentados en `quickstart.md`, exactamente el
tipo de paso manual no reproducible que esta feature busca eliminar para `simulador.ruta`.
Integrarlo al mismo `Makefile`/`compose.yaml` que ya orquesta el resto del stack (FR-012, SC-005)
lo vuelve un comando más, no una receta aparte.

**Alternatives considered**:
- *Dejarlo como pasos manuales en `quickstart.md` únicamente* (la posición original de esta
  feature) — descartada tras la Clarification: en un repo académico sin equipo de
  infraestructura separado, esa documentación manual es, en la práctica, el único lugar donde
  vive el servicio, lo que contradice el objetivo de reproducibilidad del resto del stack
  (`make dev`, `make stack`, `make simulador`).
- *Un extracto más chico que todo el país* (p. ej. sólo el área metropolitana de Buenos Aires)
  para acortar la descarga/el procesamiento — se descarta por ahora porque Geofabrik no publica
  un extracto oficial más chico que el de provincia/país para Argentina sin herramientas de
  recorte adicionales (`osmium extract` + un polígono propio), complejidad no justificada para
  esta primera versión; se puede revisar más adelante si el tiempo de `make osrm` resulta
  prohibitivo para el equipo.
