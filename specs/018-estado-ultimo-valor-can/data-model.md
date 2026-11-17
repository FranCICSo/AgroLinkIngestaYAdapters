# Phase 1 — Data Model: Último valor CAN no nulo en la consulta de estado

**Feature**: `018-estado-ultimo-valor-can` | **Date**: 2026-11-15

No hay entidad, columna ni migración nueva. `telemetria.lectura_telemetria` no cambia, y
`LecturaTelemetria` sigue siendo `@Immutable` (Principio IV).

---

## 1. `UltimosValoresCan` (proyección nueva, `ar.utn.agrolink.ingesta.telemetry`)

Interfaz de proyección que devuelve `findUltimosValoresCanNoNulos`. Todos los getters son nullable.

| Getter | Tipo | Columna de origen |
|---|---|---|
| `getCombustiblePct` / `getCombustiblePctMomento` | `Double` / `Instant` | `combustible_pct` |
| `getCombustibleConsumidoL` / `getCombustibleConsumidoLMomento` | `Double` / `Instant` | `combustible_consumido_l` |
| `getOdometroKm` / `getOdometroOrigen` / `getOdometroMomento` | `Double` / `String` / `Instant` | `odometro_km`, `odometro_origen` |
| `getVin` / `getVinMomento` | `String` / `Instant` | `vin` |
| `getRpm` / `getRpmMomento` | `Integer` / `Instant` | `rpm` |
| `getTemperaturaRefrigeranteC` / `getTemperaturaRefrigeranteCMomento` | `Integer` / `Instant` | `temperatura_refrigerante_c` |

Los alias de la consulta van entre comillas (`AS "combustiblePct"`), porque PostgreSQL pasa a
minúsculas los alias sin comillas y la proyección necesita el camelCase.

## 2. `LecturaTelemetriaRepository`

Método nuevo, de solo lectura:

```java
UltimosValoresCan findUltimosValoresCanNoNulos(String dispositivoId, Instant desde, Instant hasta);
```

La consulta está en research.md D-01.

## 3. `CanBusDto` (bloque `canBus` de la respuesta)

Seis componentes nuevos, cada uno a continuación de su campo:

| Campo nuevo | Tipo | Va después de |
|---|---|---|
| `vinMomento` | `OffsetDateTime` (UTC), nullable | `vin` |
| `rpmMomento` | `OffsetDateTime` (UTC), nullable | `rpm` |
| `odometroMomento` | `OffsetDateTime` (UTC), nullable | `odometroOrigen` |
| `combustibleConsumidoLMomento` | `OffsetDateTime` (UTC), nullable | `combustibleConsumidoL` |
| `combustiblePctMomento` | `OffsetDateTime` (UTC), nullable | `combustiblePct` |
| `temperaturaRefrigeranteCMomento` | `OffsetDateTime` (UTC), nullable | `temperaturaRefrigeranteC` |

## 4. `EstadoVehiculoService.obtenerEstado`

1. Busca la última lectura (`findFirstByDispositivoIdOrderByMomentoEventoDesc`). Si no hay, responde
   404, sin cambios.
2. Llama a `findUltimosValoresCanNoNulos(id, ultima - VENTANA_ULTIMO_VALOR_CAN, ultima)`, con
   `VENTANA_ULTIMO_VALOR_CAN = Duration.ofHours(24)`.
3. Arma `posicion` y `dispositivo` con la última lectura. Arma `canBus` con:
   - los campos arrastrables y sus momentos, desde la proyección;
   - `velocidadRuedaKmh`, `presionAceiteKpa`, `tensionBateriaV` y `bleTemperaturaC`, desde la
     última lectura.
