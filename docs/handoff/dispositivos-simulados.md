# Convención de dispositivos simulados y alcance de la simulación

Este documento fija, desde el lado de la ingesta/simulador, qué `dispositivoId` pueden
efectivamente emitir telemetría y por lo tanto ser consultados desde AgroLinkBackend
(`GET /api/v1/vehiculos/{dispositivoId}/estado`) — y cuáles quedan fuera de alcance. No se
actualiza automáticamente: cada alta nueva de camión simulado, o cada vehículo nuevo sembrado
en AgroLinkBackend con un `iotDeviceId` que debería ser simulado, debería reflejarse acá.

## Cómo verificar el estado actual

```bash
cd simulador-viajes && npm run listar-camiones
```

Lista cada `simulador.camion` configurado con su `dispositivoId`, si está activo, si tiene un
viaje `en_curso` y si cae dentro del rango reservado.

## Convención de rango reservado (spec 009)

- **900001-900999**: reservado para camiones simulados por `simulador-viajes`. Nunca se usa
  para un IMEI real (ver `docs/handoff/simulador-viajes.md` § Decisiones ya tomadas).
- Cualquier `dispositivoId` fuera de ese rango que SÍ tenga telemetría es, por convención, un
  dispositivo real (ej. `860693084873877`, Rinho Spider IoT físico de referencia, spec 009).

## Registro de dispositivos conocidos

> **Actualización (2026-10-10/11, features 011/013)**: `simulador.camion.id` se ensanchó de
> `VARCHAR(6)` a `VARCHAR(20)` (`deploy/migrations/006_widen_camion_id.sql`) y la validación de
> `camion.id` ahora acepta cualquier id con un carácter no numérico (nunca puede ser un IMEI
> real, que es siempre puramente numérico de 15 dígitos) — ver
> `src/domain/rangoDispositivoSimulado.js`. Esto resuelve lo que antes era un "mismatch" entre
> `tra-demo-004` y un `900004` numérico: hoy `tra-demo-004` puede ser literalmente el
> `camion.id`, sin necesidad de un id numérico sustituto.
>
> La feature 013-autostart-simulacion-viaje va un paso más allá: define una lista **cerrada** de
> 5 `iotDeviceId` (los mismos 5 de la tabla de abajo, salvo el IMEI real) para los que
> AgroLinkBackend arranca la simulación automáticamente al dar de alta un viaje, sin ningún
> comando manual — ver `specs/013-autostart-simulacion-viaje/`.

| `dispositivoId` | Origen | Proveedor (AgroLinkBackend) | ¿Consultable? |
|---|---|---|---|
| `geo-demo-001` | Vehículo demo sembrado en AgroLinkBackend (`LocalDataSeeder.java`, AGL001) | GEOTAB | Sí — feature 013 arranca la simulación automáticamente al dar de alta un viaje para este dispositivo |
| `tel-demo-003` | Vehículo demo sembrado en AgroLinkBackend (`LocalDataSeeder.java`, AGL003) | TELTONIKA | Sí — idem |
| `tra-demo-004` | Vehículo demo sembrado en AgroLinkBackend (`LocalDataSeeder.java`, AGL004) | TRACCAR | Sí — idem (ya no hace falta el `900004` sustituto, ver nota arriba) |
| `900001` | Vehículo demo sembrado en AgroLinkBackend (`LocalDataSeeder.java`, AGL005) | RINHO1 | Sí — idem |
| `900002` | Vehículo demo sembrado en AgroLinkBackend (`LocalDataSeeder.java`, AGL006) | RINHO1 | Sí — idem |
| `860693084873877` | Dispositivo real de referencia (spec 009) | RINHO1 | Sí, si el equipo físico o `deploy/seed/seed-demo-telemetry.sql` escribieron una lectura |

## Fuera de alcance: proveedores sin soporte en el receptor

`rinho-receptor` y `simulador-viajes` solo implementan el protocolo del Rinho Spider IoT
(TAIP, puerto 5031 — ver `specs/001-ingesta-adaptacion-telemetria/contracts/rinho-eq-frame.md`).
Un `dispositivoId` sembrado en AgroLinkBackend con un proveedor distinto, y que además no esté
en la lista cerrada de arriba, **nunca** va a tener una fila en `telemetria.lectura_telemetria`
a menos que se reasigne a un dispositivo real o simulado soportado — no es un bug de ingesta, es
una limitación de alcance documentada. Al momento de esta actualización, los 5 vehículos demo
conocidos de `LocalDataSeeder.java` ya están todos cubiertos (tabla de arriba); este caso aplica
a cualquier vehículo nuevo que el equipo agregue sin pasar por ese mismo camino.
