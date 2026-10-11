# Research: Velocidad y RPM verosímiles en el simulador de viajes

## D-01: Causa raíz del pico de velocidad

**Decision**: La velocidad se calcula hoy en `avanceRuta.js` como
`distanciaHaversine(puntoActual, puntoSiguiente) / (cicloSegundos / 3600)`, usando el trazado
crudo que devuelve `obtenerRutaOsrm()` (geometría completa de OSRM, `overview=full`) o, para los
camiones sembrados, un arreglo de puntos ya fijo en SQL. Ninguno de los dos trazados garantiza
que dos vértices consecutivos estén separados por una distancia acorde a un ciclo de simulación
(`cicloMs`, 60000 ms por defecto) — OSRM simplifica la geometría donde la vía es recta, y los
puntos capturados de un dispositivo real tienen intervalos de GPS irregulares. El resultado:
cualquier vértice espaciado (p. ej. ~2.5 km) se recorre en un solo ciclo de 60 s, dando una
velocidad implícita de ~150 km/h aunque el tramo sea una calle.

**Rationale**: Confirmado leyendo `avanceRuta.js:86` (`velocidadKmh: detenido ? 0 : distanciaKm
/ (cicloSegundos / 3600)`, sin clamp) y `routeGenerationService.js` (los `puntos` que persiste
vienen directo de `resultadoOsrm.puntos`, sin resampleo).

**Alternatives considered**: Ninguna — es un hallazgo de código, no una decisión de diseño.

## D-02: Fuente de la velocidad "típica" por tramo (rutas generadas vía OSRM)

**Decision**: Pedir a OSRM el parámetro `annotations=speed` además de
`overview=full&geometries=geojson` ya usados en `osrmClient.js`. La respuesta de
`/route/v1/driving/...` incluye, por cada leg, un objeto `annotation` con un arreglo `speed` —
un valor por cada segmento entre dos coordenadas consecutivas de la geometría completa —, que
refleja la velocidad que el profile de OSRM ya infiere para ese tramo de vía (naturalmente más
baja en calles residenciales, más alta en una avenida/autopista). Esa velocidad por segmento es
la base para decidir cuántos puntos intermedios hacen falta. (`distance`/`duration` no se piden:
la densificación recalcula su propia distancia por Haversine, igual que el resto del código —
ver D-04 —, así que esos dos valores de OSRM no se consumen en ningún lado.)

**Rationale**: Evita construir una clasificación propia "calle vs. avenida vs. autopista" a mano
— se reutiliza la inferencia que OSRM ya hace a partir de la clase de vía de OpenStreetMap, que
es justamente lo que un router de calles reales ya resuelve. Esto es consistente con la
Assumption de spec.md ("no es necesaria una clasificación manual explícita").

**Alternatives considered**:
- Clasificar manualmente cada punto como "urbano"/"ruta" por cercanía a un polígono de ciudad:
  descartado por complejidad (requeriría datos geográficos adicionales) sin necesidad demostrada
  para un MVP de tesis.
- Ignorar la velocidad de OSRM y aplicar siempre un único tope (p. ej. 60 km/h) a todo el
  trazado: más simple, pero pierde la distinción ciudad/ruta que pide la spec (SC-002 vs SC-001)
  y haría que un tramo de autopista real avance irrealmente lento.

**Riesgo a verificar en implementación**: la unidad exacta de `annotation.speed` (m/s vs. km/h)
y el alineamiento 1:1 entre el arreglo de anotaciones y los vértices de la geometría cuando
`overview=full` puede variar levemente entre versiones de OSRM — verificar contra la versión de
`osrm/osrm-backend` fijada en `deploy/compose.yaml` antes de confiar en el valor crudo (test de
integración contra el servidor OSRM real, no solo mocks).

## D-03: Tope legal aplicado sobre la velocidad de OSRM

**Decision**: El target de velocidad por segmento (para decidir la densificación) es
`min(velocidad_osrm_kmh, 80)` como tope global de seguridad (FR-002), y el tramo se trata como
"zona urbana" (tope 60) cuando `velocidad_osrm_kmh <= 60`, o como "ruta" (tope 80) en caso
contrario. Así, el propio valor de OSRM funciona como clasificador implícito de tipo de vía, sin
mantener una tabla de clasificación separada.

**Rationale**: OSRM modela velocidad de un perfil "driving" (auto), no de un camión con límite
legal propio; el tope de FR-002 es la salvaguarda de que, aun si OSRM asumiera una autopista a
130 km/h, el simulador nunca reporte más de 80 km/h para un camión.

**Alternatives considered**: Usar directamente la velocidad de OSRM sin tope legal — descartado,
viola FR-002 explícitamente (un camión no puede ir a 130 km/h sin importar lo que diga el router
de autos).

## D-04: Mecanismo de densificación (algoritmo)

**Decision**: Para cada par de vértices consecutivos (A, B) del trazado original, con distancia
`d` (haversine) y velocidad objetivo ya acotada `v_kmh` (D-03): si
`d > v_kmh * 1000/3600 * cicloSegundos`, insertar `n = ceil(d / (v_kmh * 1000/3600 *
cicloSegundos)) - 1` puntos intermedios, interpolando linealmente latitud/longitud entre A y B
(suficiente a la escala de un tramo entre dos vértices de ruta — no se requiere interpolación
esférica para esta precisión). El resultado reemplaza al arreglo `puntos` original antes de
persistirlo.

**Rationale**: Interpolación lineal es la misma simplificación que ya usa el código existente
(`haversineKm`/`rumbo` en `avanceRuta.js` tratan la Tierra como esfera, no hay georreferenciación
de precisión geodésica en ningún punto del proyecto) — consistente con el nivel de fidelidad ya
aceptado en el resto del simulador.

**Alternatives considered**:
- Interpolar a lo largo de la polilínea completa de OSRM en vez de la cuerda recta A–B: más
  preciso en curvas, pero OSRM con `overview=full` ya da vértices suficientemente seguidos en
  curvas (las simplifica sobre todo en rectas) — la ganancia no justifica la complejidad extra
  para un simulador de demo.

## D-05: Densificación de los camiones ya sembrados (`camion-1`, `camion-2`)

**Decision**: No hay llamada en vivo a OSRM para estos dos camiones — son SQL estático
(`deploy/seed/simulador-camion-1.sql`, `-2.sql`). El mismo módulo de densificación (D-04) se
corre una vez, offline, sobre los arreglos de puntos ya existentes en esos archivos, tratando
todo el trazado como "zona urbana" (tope 60 km/h, ver Assumption de spec.md — ambos recorridos
están descriptos como dentro de CABA/GBA y no hay anotación de OSRM disponible para datos ya
capturados). El resultado (puntos densificados) reemplaza el array `puntos` en esos `.sql`, y los
índices de `paradas` se recalculan contra el nuevo array densificado (mismo criterio de
"índice más cercano" que ya usa `routeGenerationService.js` para una ruta nueva).

**Rationale**: Evita introducir un paso de densificación en tiempo de carga del seed (que
correría en cada `docker compose up`, sin necesidad — el seed es estático y ya es idempotente vía
`ON CONFLICT`/`WHERE NOT EXISTS`); regenerar el `.sql` una sola vez mantiene el mismo patrón de
"seed idempotente" que ya existe.

**Alternatives considered**: Resamplear en tiempo de carga (un script que lea el `.sql`, lo
procese y lo reinserte en cada arranque) — descartado por ser más complejo sin necesidad: el
trazado de estos dos camiones no cambia entre arranques, así que regenerar el archivo una vez es
suficiente y más simple.

## D-06: Rango de velocidad verosímil (ciudad / ruta)

**Decision**: 60 km/h como tope de zona urbana, 80 km/h como tope de ruta/autopista para
camiones.

**Rationale**: Ley Nacional de Tránsito 24.449 (Argentina), art. 51: camiones a 80 km/h en ruta,
zona rural y autopista (el mismo tope que para transporte de sustancias peligrosas); 60 km/h en
avenidas dentro de zona urbana (se usa este valor, más permisivo que los 40 km/h de calle, como
techo único para simplificar — ver Assumptions de spec.md).

**Alternatives considered**: Distinguir calle (40) de avenida (60) dentro de "zona urbana":
descartado por no haber, ni en OSRM ni en los datos sembrados, una forma simple de diferenciar
ambas sin agregar una clasificación geográfica adicional (ver D-02).

## D-07: Rango de RPM verosímil

**Decision**: Ralentí (camión detenido) 600–800 RPM; crucero en ruta 1200–1800 RPM; el RPM
máximo configurado (2200, sin cambios) solo se alcanza, si acaso, en el escenario de velocidad
máxima verosímil de ruta (80 km/h) — nunca por un valor de velocidad espurio, una vez resuelto
D-01 a D-05.

**Rationale**: Rango típico de un motor diésel de camión mediano/pesado según referencias de
campo (foros de propietarios de camiones/pickups diésel): ralentí diésel general 600–800 RPM;
crucero en autopista a ~100 km/h reportado entre 1350 y 2100 RPM según relación de caja, con
camiones pesados típicamente hacia el extremo más bajo de ese rango (~1650 RPM a 65 mph). No hay
ficha técnica del camión piloto real documentada en el proyecto, así que esto es una aproximación
razonable para el objetivo de verosimilitud del MVP (ya reflejado como Assumption en spec.md).

**Alternatives considered**: Mantener la fórmula lineal actual (`RPM_RALENTI_BASE - 50 +
velocidadKmh * RPM_POR_KMH`, con `RPM_POR_KMH = 25`) sin cambiar constantes: descartado porque,
incluso con velocidad ya acotada a 80 km/h, esa fórmula da `750 - 50 + 80*25 = 2700`, por encima
del propio `RPM_MAX` (2200) y del rango de crucero realista (1200–1800) — las constantes de
`sintesisCan.js` necesitan ajustarse, no solo la velocidad de entrada.

## Resumen de NEEDS CLARIFICATION resueltos

Ninguno quedó pendiente: las dos decisiones de mayor impacto (mecanismo de densificación y dónde
ocurre) ya se resolvieron en la sesión de `/speckit-clarify` del 2026-10-08 y están reflejadas en
`spec.md § Clarifications`. Este documento resuelve únicamente las preguntas técnicas de "cómo"
que quedaban abiertas para poder diseñar `data-model.md`.
