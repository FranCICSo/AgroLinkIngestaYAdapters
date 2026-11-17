# Phase 0 — Research: Último valor CAN no nulo en la consulta de estado

**Feature**: `018-estado-ultimo-valor-can` | **Date**: 2026-11-15

Las decisiones de negocio están en `spec.md` (Clarifications). Este documento cubre las técnicas.

---

## D-01: Una sola consulta agregada con `last() FILTER`

**Decision**: un método nuevo `LecturaTelemetriaRepository.findUltimosValoresCanNoNulos`, con una
consulta nativa que resuelve todos los campos en una pasada:

```sql
SELECT public.last(combustible_pct, momento_evento) FILTER (WHERE combustible_pct IS NOT NULL),
       max(momento_evento)                          FILTER (WHERE combustible_pct IS NOT NULL),
       ...
FROM telemetria.lectura_telemetria
WHERE dispositivo_id = :dispositivoId AND momento_evento >= :desde AND momento_evento <= :hasta
```

**Rationale**: `last(valor, tiempo)` de TimescaleDB devuelve el valor de la fila con mayor `tiempo`.
Con `FILTER (WHERE valor IS NOT NULL)` se queda con el último no nulo. `max(momento_evento)` con el
mismo filtro da su momento. Un agregado sin `GROUP BY` siempre devuelve una fila, así que no hay que
manejar el "no encontrado": los campos sin dato vienen en `NULL`.

La ventana acota la búsqueda a los chunks de la hypertable que caen en esas 24 h, y usa el índice
`lectura_camion_tiempo_idx (dispositivo_id, momento_evento DESC)` de la feature 001. No hace falta
migración.

**Alternatives considered**:
- *Una subconsulta `ORDER BY momento_evento DESC LIMIT 1` por campo*: seis lecturas del índice en
  lugar de una. Es más simple de leer, pero no aporta nada.
- *`(array_agg(col ORDER BY momento_evento DESC) FILTER (WHERE col IS NOT NULL))[1]`*: es SQL
  estándar, sin depender de TimescaleDB, pero arma un arreglo con todas las lecturas de la ventana
  para usar solo el primero. La base ya es TimescaleDB (Principio II).
- *Window functions con `IGNORE NULLS`*: PostgreSQL 16 no las soporta.

## D-02: `public.last()` calificado con el esquema

**Decision**: la función se invoca como `public.last(...)`.

**Rationale**: la extensión `timescaledb` está instalada en `public` (`deploy/db/01-schema.sql`), y
la conexión de la app usa `currentSchema=telemetria`, que deja `public` fuera del `search_path`. Sin
calificar, la consulta falla con `function last(numeric, timestamp with time zone) does not exist`.
Lo detectó el test de integración contra una TimescaleDB real: con mocks no se veía.

**Alternatives considered**: agregar `public` al `search_path` de la conexión (`currentSchema=telemetria,public`).
Cambia la resolución de nombres de todas las consultas de la app para resolver un caso puntual.

## D-03: La ventana se ancla a la última lectura, no a `now()`

**Decision**: `desde = momentoEvento(última lectura) - 24 h` y `hasta = momentoEvento(última lectura)`.

**Rationale**:
- Un vehículo sin reportar hace días sigue mostrando los valores de su último día de actividad. Con
  `now()` perdería todos los datos CAN aunque su última posición se siga mostrando.
- Con `hasta` igual a la última lectura, una trama con fecha futura, por un reloj del dispositivo
  mal configurado, no puede aportar valores más nuevos que la propia lectura usada para `posicion`.
- La antigüedad respecto de ahora no se pierde: la expresan los `*Momento`.

## D-04: Qué campos se arrastran

**Decision**: `combustiblePct`, `combustibleConsumidoL`, `odometroKm` (con `odometroOrigen`), `vin`,
`rpm` y `temperaturaRefrigeranteC`.

**Rationale**: combustible, odómetro y VIN cambian lento o son acumulativos, así que un valor de
minutos atrás es una buena estimación del actual. `rpm` y `temperaturaRefrigeranteC` se agregaron a
pedido del usuario (spec, Clarifications). Su riesgo, mostrar un motor en marcha o caliente que ya no
lo está, se mitiga con su `*Momento` y con la regla FR-008 del backend.

`velocidadRuedaKmh` no tiene columna propia: vive en el JSON `datos_can`, y arrastrarlo exigiría
parsear JSON en la consulta. `presionAceiteKpa`, `tensionBateriaV` y `bleTemperaturaC` no se
pidieron. `bleTemperaturaC` además alimenta la alerta térmica de la carga, que no debe recibir datos
viejos.

## D-05: Un momento por campo, no uno por bloque

**Decision**: seis campos nuevos, `<campo>Momento`, en `canBus`. En el caso de `odometroKm`, el
campo es `odometroMomento`, porque cubre al par valor y origen.

**Rationale**: cada campo puede salir de una lectura distinta (spec, Historia 1, escenario 2). Un
único "momento de CAN" mentiría para todos menos uno.

**Alternatives considered**: un bloque `canBusMomentos` aparte. Separa el dato de su momento sin
necesidad, y cualquier consumidor que lea `canBus.rpm` tendría que ir a buscar el momento a otro
lado.

## D-06: `odometroOrigen` con el mismo filtro que `odometroKm`

**Decision**: `public.last(odometro_origen, momento_evento) FILTER (WHERE odometro_km IS NOT NULL)`.

**Rationale**: con el mismo filtro y el mismo orden, las dos funciones eligen la misma fila. Ver
spec, Edge Cases, para el caso teórico de dos lecturas con el mismo `momento_evento`.

## D-07: Cómo distingue el backend un valor arrastrado

**Decision**: AgroLinkBackend compara el `*Momento` del campo con `dispositivo.momentoEvento`. Si son
iguales, el valor es de la última lectura (`VehiculoEstadoResponse.esDeLaUltimaLectura`). Si el
`*Momento` no viene, porque la ingesta todavía no tiene este cambio, se toma como valor nuevo.

**Rationale**: no hace falta ningún campo de "es arrastrado" en el contrato: el momento ya lo dice.
Y un backend nuevo contra una ingesta vieja se comporta como antes.
