# Phase 1 — Data Model: Velocidad y RPM verosímiles en el simulador de viajes

**Feature**: `012-velocidad-rpm-verosimil` | **Date**: 2026-10-08

Esta feature **no cambia el esquema de ninguna tabla** (decisión de `/speckit-clarify`, Q2):
`simulador.ruta.puntos` y `simulador.viaje` mantienen exactamente la misma forma. Lo que cambia
es (a) **qué valores** quedan guardados en `simulador.ruta.puntos`/`paradas` al generar o cargar
una ruta, y (b) las constantes/rangos que usa `sintesisCan.js` para calcular RPM. A continuación
se modelan, a nivel de aplicación, los objetos nuevos que introduce la densificación.

## 1. `simulador.ruta` (existente, sin cambios de esquema — cambia el contenido)

| Columna | Tipo | Notas |
|---------|------|-------|
| `puntos` | `JSONB` | Sin cambio de forma (`[{lat, lon}, ...]`), pero ahora es el resultado de **densificar** el trazado original (OSRM o seed) — ver §2. Puede tener más elementos que antes para el mismo origen/destino. |
| `paradas` | `JSONB` | Sin cambio de forma (`[{indice, duracion_min}, ...]`), pero `indice` se recalcula contra el array `puntos` ya densificado, no contra el trazado original. |

**Invariante nuevo** (no enforced por constraint de base de datos, sino por el servicio que
escribe `puntos`): para cualquier par de puntos consecutivos `(A, B)` en `puntos`, la distancia
Haversine entre ambos debe ser `<= velocidadMaximaVerosimil(A, B) * 1000/3600 * cicloSegundos`.
Esto es lo que garantiza que `avanceRuta.js`, sin cambios, nunca calcule una velocidad por encima
del máximo verosímil (FR-001, FR-002).

## 2. `SegmentoOriginal` → `TramoDensificado` (objetos de aplicación, no persistidos como tabla)

**`SegmentoOriginal`** — un par de vértices consecutivos del trazado tal como viene de OSRM o del
seed, antes de densificar:

| Campo | Tipo | Notas |
|-------|------|-------|
| `a`, `b` | `{ lat: number, lon: number }` | Vértices consecutivos originales |
| `velocidadObjetivoKmh` | `number` | Para OSRM: `min(annotation.speed convertido a km/h, 80)` (research.md D-02/D-03). Para seed: `60` fijo (research.md D-05, sin anotación disponible). |

**`TramoDensificado`** — resultado de aplicar el algoritmo de research.md D-04 sobre un
`SegmentoOriginal`:

| Campo | Tipo | Notas |
|-------|------|-------|
| `puntos` | `{ lat: number, lon: number }[]` | `[a, ...intermedios, b]` — incluye `a` pero no duplica `b` (el siguiente tramo empieza en `b`), para poder concatenar los tramos de toda la ruta en un único array sin puntos repetidos. |

El servicio de densificación (`densificacionRutaService.js`, ver plan.md § Project Structure)
expone una única función conceptual:

```text
densificarTrazado(puntosOriginales, { cicloSegundos, velocidadPorSegmento }) -> puntosDensificados
```

donde `velocidadPorSegmento` es una función `(indiceSegmento) -> velocidadObjetivoKmh` que el
llamador provee: `routeGenerationService.js` la construye a partir de las anotaciones de OSRM
(D-02/D-03); el script que regenera los `.sql` de seed la provee como una constante `60` para
todo el trazado (D-05).

## 3. Remapeo de `paradas` tras densificar

**Entrada**: `paradas` originales con `indice` referido al array de puntos **sin densificar**
(tal como hoy las construye `routeGenerationService.js` con `indiceMasCercano`, o tal como están
hardcodeadas en los `.sql` de seed).

**Salida**: mismas `paradas`, mismo `duracionMin`/`duracion_min`, pero `indice` recalculado contra
el array `puntos` **ya densificado**, usando el mismo criterio de "índice del punto más cercano"
que ya implementa `indiceMasCercano()` en `routeGenerationService.js` — se reutiliza esa función
tal cual, solo que ahora se le pasa el array densificado en vez del original.

**Validación**: ninguna nueva — si una `parada` no tiene un punto razonablemente cercano en el
array densificado (no debería ocurrir, ya que densificar solo agrega puntos entre los originales,
nunca los quita), se comporta igual que hoy (toma el índice más cercano disponible).

## 4. `sintesisCan.js` — rangos de salida (sin cambio de forma, cambian las constantes)

| Constante actual | Valor actual | Valor nuevo | Fuente |
|---|---|---|---|
| `RPM_RALENTI_BASE` | 750 | 700 (punto medio de 600–800) | research.md D-07 |
| `RPM_POR_KMH` | 25 | recalculada para que a `velocidadKmh = 80` (máximo verosímil de ruta) el resultado caiga en 1200–1800, no en `RPM_MAX` | research.md D-07 |
| `RPM_MAX` | 2200 | sin cambio (sigue siendo el techo de seguridad, ya no alcanzable por una velocidad espuria) | — |

El valor exacto de la nueva `RPM_POR_KMH` y si el mapeo pasa a ser lineal o por tramos (ralentí /
ciudad / ruta) es una decisión de implementación de tasks.md, no de este data model — el
contrato observable es el de la tabla anterior: ralentí 600–800, crucero en ruta 1200–1800, sin
alcanzar 2200 salvo en el extremo de 80 km/h.
