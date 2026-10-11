# Feature Specification: Velocidad y RPM verosímiles en el simulador de viajes

**Feature Branch**: `012-velocidad-rpm-verosimil`

**Created**: 2026-10-08

**Status**: Draft

**Input**: User description: "en algunas pruebas, los camiones simulados andaban a 150km en la ciudad; lo que es inverosimil. También el rpm del camión. Hacer una pequeña investigación de qué valores serían razonables en ruta, en ciudad y lograr que el simulador coloque valores verosímiles en las tramas que simula"

## Clarifications

### Session 2026-10-08

- Q: Cuando dos puntos consecutivos del trazado están tan separados que ni la velocidad máxima verosímil del tramo alcanza para cubrir esa distancia en un ciclo, ¿qué debe hacer el simulador? → A: Interpolar la posición a lo largo del trazado según la velocidad máxima verosímil, de modo que la posición y la velocidad reportada queden siempre consistentes entre sí (sin saltos de posición a velocidad reportada baja).
- Q: ¿Dónde ocurre esa interpolación/densificación de puntos? → A: Una sola vez, al generar la ruta (OSRM) o al cargar los datos sembrados (`camion-1`/`camion-2`): se guarda en `simulador.ruta.puntos` una versión ya densificada, y el simulador sigue avanzando un punto por ciclo sin cambios de esquema en `simulador.viaje`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Velocidad verosímil durante todo el viaje simulado (Priority: P1)

Como evaluador del simulador de viajes, al ejecutar un viaje que atraviesa tanto calles de zona urbana como tramos de ruta/autopista, quiero que la velocidad reportada en cada trama sea coherente con el tipo de vía que el camión está recorriendo en ese momento, para que los datos de telemetría simulados sean creíbles y no revelen al primer vistazo que son artificiales.

**Why this priority**: La velocidad es el dato base del que derivan RPM, consumo de combustible y tiempos de viaje. Si la velocidad es inverosímil (150 km/h en una calle), toda la demás telemetría simulada hereda ese defecto y pierde credibilidad frente a un evaluador o a una demo.

**Independent Test**: Generar una ruta que combine un tramo urbano y un tramo de ruta/autopista, ejecutar el simulador de punta a punta, y verificar que ninguna trama reporta una velocidad por encima del máximo verosímil para el tipo de vía que corresponde a ese punto del recorrido.

**Acceptance Scenarios**:

1. **Given** un camión simulado circulando por un tramo clasificado como zona urbana, **When** se genera la trama de esa posición, **Then** la velocidad reportada no supera el máximo verosímil para zona urbana.
2. **Given** un camión simulado circulando por un tramo de ruta o autopista, **When** se genera la trama de esa posición, **Then** la velocidad reportada no supera el máximo legal verosímil para un camión en ruta.
3. **Given** dos puntos consecutivos del trazado de la ruta separados por una distancia inusualmente grande para el tiempo transcurrido entre tramas, **When** se genera la ruta o se cargan los datos sembrados, **Then** el trazado queda densificado con puntos intermedios de modo que ningún salto entre dos puntos consecutivos implique, a la velocidad máxima verosímil del tramo, más distancia de la recorrible en un ciclo — la posición y la velocidad reportada quedan siempre consistentes entre sí, sin saltos de posición a velocidad reportada baja.
4. **Given** los camiones ya sembrados (`camion-1`, con ruta de puntos GPS reales capturados; `camion-2`, ruta armada a mano), **When** se ejecuta un viaje simulado para cualquiera de los dos, **Then** sus tramas también respetan los máximos verosímiles de velocidad y RPM, igual que una ruta nueva generada vía OSRM.

---

### User Story 2 - RPM coherente con la velocidad y el contexto (Priority: P2)

Como evaluador del simulador, quiero que el RPM reportado en cada trama sea coherente con la velocidad y el estado del camión (detenido, en ciudad, en ruta), para que no se repita el mismo problema de verosimilitud que con la velocidad.

**Why this priority**: El RPM depende directamente de la velocidad en el modelo actual; una vez acotada la velocidad (User Story 1), el RPM debería normalizarse, pero necesita su propio criterio de verificación porque también tiene un techo configurado que puede seguir siendo alcanzado si el mapeo velocidad→RPM no se ajusta en conjunto.

**Independent Test**: Sobre el mismo viaje simulado de la User Story 1, verificar que el RPM reportado en los tramos de ciudad y de ruta cae dentro de rangos realistas para un camión diésel mediano/pesado, y que el RPM máximo configurado solo se alcanza en escenarios de velocidad igualmente máxima (nunca por un valor de velocidad espurio).

**Acceptance Scenarios**:

1. **Given** un camión simulado detenido (parada de entrega o semáforo), **When** se genera la trama, **Then** el RPM reportado corresponde a un rango de ralentí realista.
2. **Given** un camión simulado circulando en ruta a velocidad de crucero, **When** se genera la trama, **Then** el RPM reportado corresponde a un rango de crucero realista para ese tipo de vehículo, no al RPM máximo configurado.

---

### Edge Cases

- ¿Qué pasa cuando el trazado (generado por el servicio de ruteo o sembrado desde datos reales capturados) tiene un salto entre dos vértices consecutivos mayor a lo recorrible en un ciclo a la velocidad máxima verosímil? El sistema debe densificar ese tramo con puntos intermedios al generar/cargar la ruta, en vez de propagar el salto crudo o solo acotar el número de velocidad reportado.
- ¿Qué pasa en una curva cerrada o rotonda dentro de un tramo clasificado como ruta, donde físicamente correspondería ir más lento que el máximo de ruta? Queda fuera de alcance modelar reducciones de velocidad por geometría de la curva; alcanza con no superar el máximo global del tipo de vía.
- El camión detenido en una parada de entrega ya reporta velocidad 0 e ignición apagada (comportamiento existente); esta feature no debe modificar ni regresionar ese caso.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El proceso de generación/carga de una ruta MUST densificar el trazado con puntos intermedios allí donde dos puntos consecutivos originales estén separados por una distancia mayor a la recorrible, a la velocidad máxima verosímil del tipo de vía, en un intervalo de simulación — en vez de dejar que el simulador calcule la velocidad como distancia cruda entre vértices originales dividida por el intervalo fijo de simulación.
- **FR-002**: El simulador MUST acotar la velocidad reportada en tramos de zona urbana a un máximo de 60 km/h, y en tramos de ruta/autopista a un máximo de 80 km/h (tope legal argentino para camiones, Ley Nacional de Tránsito 24.449, art. 51); este máximo es el que gobierna la densificación de FR-001.
- **FR-003**: El simulador MUST acotar el RPM reportado a un rango verosímil correlacionado con la velocidad y el estado del camión: ralentí (camión detenido) entre 600 y 800 RPM, y régimen de crucero en ruta entre 1200 y 1800 RPM.
- **FR-004**: El simulador MUST seguir reportando velocidad 0 y RPM de ralentí durante una parada de entrega, sin regresionar el comportamiento ya existente.
- **FR-005**: La densificación de FR-001 MUST aplicarse tanto a rutas nuevas generadas vía OSRM (feature 011) como a los datos ya sembrados de los camiones de referencia (`camion-1`, ruta de puntos GPS reales capturados; `camion-2`, ruta armada a mano), de modo que ambos queden con un trazado consistente con FR-002 sin requerir cambios de esquema en `simulador.viaje`.

### Key Entities

- **Tramo de ruta**: segmento entre dos puntos consecutivos del trazado (ya densificado) de una ruta simulada; tiene asociado un tipo de vía (zona urbana o ruta/autopista) que determina la velocidad máxima verosímil aplicable y, por lo tanto, la distancia máxima permitida entre dos puntos consecutivos.
- **Trama simulada**: registro de telemetría que el simulador genera periódicamente; incluye velocidad y RPM, entre otros campos, y debe ser consistente con el tramo de ruta al que corresponde.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las tramas generadas en un viaje simulado de extremo a extremo reportan una velocidad igual o menor a 80 km/h.
- **SC-002**: El 100% de las tramas generadas mientras el camión recorre un tramo urbano reportan una velocidad igual o menor a 60 km/h.
- **SC-003**: El RPM máximo configurado del simulador deja de alcanzarse como consecuencia de velocidades espurias; solo se alcanza (si acaso) en el escenario de velocidad máxima verosímil de ruta.
- **SC-004**: Una persona que revise una muestra de tramas de un viaje simulado completo (ciudad → ruta → ciudad) las juzga coherentes con el tipo de vía recorrido, sin picos de velocidad o RPM inexplicables.

## Assumptions

- Se toma como referencia la Ley Nacional de Tránsito 24.449 (Argentina): 80 km/h como tope para camiones en ruta, zona rural y autopista; 60 km/h en avenidas y 40 km/h en calles dentro de zona urbana. Para esta feature se usa 60 km/h como techo único de "zona urbana" (el valor más permisivo de avenida), priorizando un máximo verosímil simple sobre distinguir calle de avenida.
- Se asume el rango de RPM de referencia de un motor diésel de camión mediano/pesado: ralentí 600-800 RPM, crucero en ruta 1200-1800 RPM. No hay ficha técnica documentada del camión piloto real, por lo que estos valores son una aproximación razonable para el objetivo de verosimilitud del MVP, no una cifra de fábrica certificada.
- No es necesaria una clasificación manual explícita de cada punto del trazado como "ciudad" o "ruta": alcanza con que el mecanismo de densificación (FR-001) refleje la velocidad típica que ya implica el tipo de vía de cada tramo (por ejemplo, a partir de información que ya provee el servicio de ruteo), sujeto siempre a los topes de FR-002 como límite de seguridad.
- Los datos ya sembrados (`camion-1`, `camion-2`) no tienen metadata de tipo de vía por punto, a diferencia de una ruta nueva generada vía OSRM: para ellos se asume que todo el trazado es "zona urbana" (tope 60 km/h), ya que ambos recorridos están descriptos como dentro de CABA/GBA. Esto es una simplificación razonable para el MVP, no una clasificación precisa por tramo.
- Quedan fuera de alcance las normativas de velocidad específicas de provincias o municipios con reglas propias (por ejemplo, Córdoba) y la modelización de reducción de velocidad en curvas o rotondas.
- Esta corrección aplica únicamente al simulador de viajes (`simulador-viajes`), incluyendo tanto las rutas generadas vía OSRM como los datos ya sembrados de los camiones de referencia; no modifica el protocolo real del dispositivo Rinho Spider IoT ni el parser de `rinho-receptor`.
