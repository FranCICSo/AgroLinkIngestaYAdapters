# Phase 1 — Quickstart & Validación: Velocidad y RPM verosímiles en el simulador de viajes

**Feature**: `012-velocidad-rpm-verosimil` | **Date**: 2026-10-08

Requiere el entorno de la feature [011-generar-ruta-simulada](../011-generar-ruta-simulada/quickstart.md)
ya levantado (TimescaleDB + schema `simulador` + OSRM corriendo).

---

## 1. Tests unitarios (Principio VIII)

```bash
cd simulador-viajes && npm test
```

**Esperado** (casos nuevos de esta feature, ver `research.md` D-02 a D-07):

| Test | Casos |
|------|-------|
| `densificacionRutaService.test.js` | trazado sin saltos grandes queda sin cambios (no-op); un salto mayor al recorrible en un ciclo se densifica con los puntos intermedios esperados; un par de puntos idénticos (distancia 0) no agrega puntos ni rompe |
| `routeGenerationService.test.js` (ampliado) | la ruta persistida en `simulador.ruta.puntos` nunca tiene dos puntos consecutivos separados por más de lo recorrible a la velocidad objetivo del tramo; `paradas.indice` sigue apuntando al punto correcto tras la densificación |
| `sintesisCan.test.js` (amplía los 4 tests existentes) | detenido → RPM en rango 600–800 (ya cubierto, ajustar límites); velocidad de crucero en ruta (80 km/h) → RPM en rango 1200–1800 (caso nuevo); nunca alcanza `RPM_MAX` (2200) salvo en el extremo de 80 km/h (caso nuevo) |

## 2. Verificar que una ruta nueva (vía OSRM) queda densificada

```bash
npm run crear-ruta -- \
  --nombre "Ruta demo verosimil" \
  --origenLat -34.6467 --origenLon -58.4894 \
  --destinoLat -34.6037 --destinoLon -58.3816
```

```bash
docker compose exec -T timescaledb psql -U postgres -d agrolink_telemetria -c "
  SELECT nombre, jsonb_array_length(puntos) AS cantidad_puntos
  FROM simulador.ruta WHERE nombre = 'Ruta demo verosimil';
"
```

**Esperado**: `cantidad_puntos` es igual o mayor a la que daría la misma ruta antes de esta
feature (la densificación solo agrega puntos, nunca quita).

## 3. Verificar que el viaje simulado no reporta picos de velocidad

Con el camión asociado a esa ruta corriendo (`npm start` en `simulador-viajes`, o el contenedor
`simulador-viajes` del compose con el profile `simulador`), consultar las lecturas que llegaron a
la ingesta para ese dispositivo durante el viaje:

```bash
docker compose exec -T timescaledb psql -U postgres -d agrolink_telemetria -c "
  SELECT momento_evento, velocidad_kmh, rpm
  FROM telemetria.lectura_telemetria
  WHERE dispositivo_id = '<id_del_camion_demo>'
  ORDER BY momento_evento DESC LIMIT 50;
"
```

**Esperado** (SC-001 a SC-003):
- Ninguna fila con `velocidad_kmh > 80`.
- Ninguna fila con `rpm` en el máximo configurado (2200) salvo que `velocidad_kmh` esté también
  en su máximo (80).

## 4. Verificar los camiones ya sembrados (`camion-1`, `camion-2`)

Tras regenerar `deploy/seed/simulador-camion-1.sql` y `-2.sql` (research.md D-05) y recargar el
seed en un entorno local limpio:

```bash
docker compose exec -T timescaledb psql -U postgres -d agrolink_telemetria -c "
  SELECT c.nombre, jsonb_array_length(r.puntos) AS cantidad_puntos
  FROM simulador.camion c JOIN simulador.ruta r ON r.id = (
    SELECT ruta_id FROM simulador.viaje WHERE camion_id = c.id LIMIT 1
  );
"
```

**Esperado**: `cantidad_puntos` mayor que antes de la densificación para ambos camiones (88 para
`camion-1` antes de densificar → más puntos después, donde el trazado original tenía saltos
grandes).

Dejar correr el simulador unos minutos con ambos camiones activos y repetir la consulta del
paso 3 para cada `dispositivo_id`/`vin` — mismo criterio de aceptación (SC-001 a SC-003).

## 5. Revisión cualitativa (SC-004)

Con los datos del paso 3 o 4, graficar `momento_evento` vs. `velocidad_kmh` (por ejemplo, en una
hoja de cálculo o un notebook rápido) para un viaje completo ciudad → ruta → ciudad, y confirmar
a simple vista que no hay picos aislados ni caídas abruptas inexplicables — la curva debe
parecerse a la de un vehículo real acelerando/frenando de forma gradual, no a un valor que salta
de 0 a 150 y vuelve a 0 entre dos muestras consecutivas.
