# Quickstart: validar la integración Samsara de punta a punta

**Feature**: `015-samsara-webhook-exceso-velocidad` | **Date**: 2026-11-04

Guía de validación manual. Contratos: [contracts/](./contracts/). Modelo:
[data-model.md](./data-model.md).

## Prerrequisitos

- Stack local de este repo: `make stack` (TimescaleDB, `rinho-receptor`, `agrolink-ingesta`) con
  la migración `009_add_evento_samsara.sql` aplicada (`make migrate`).
- `simulador-viajes` levantado con el servidor HTTP y el emisor habilitado. En `deploy/.env`:

  ```dotenv
  SIMULADOR_PUERTO_HTTP=8090
  SAMSARA_EMISOR_HABILITADO=true
  SAMSARA_EXCESOS_POR_HORA=6        # demo: ~1 exceso cada 10 min por vehículo
  ```

  Después, `make simulador` en su propia terminal: corre en esta máquina y manda el webhook a
  `http://localhost:${REPORTES_HTTP_PORT}` (ingesta local, `make ingesta`). Con el simulador en
  Docker (`make simulador-docker`) e ingesta local, definir `SAMSARA_WEBHOOK_URL` con la IP del
  gateway de la red de compose.
- AgroLinkBackend en perfil `local`, con `agrolink.telemetry.ingesta.base-url` apuntando al puerto
  publicado de `agrolink-ingesta` (8082). El seeder debe haber dejado `SAMSARA` en `ACTIVE` y los
  vehículos `AGL007`/`AGL008`.
- Frontend AgroLink corriendo contra ese backend, con un usuario del tenant demo.

## Escenario 1 — Webhook manual (US1, sin emisor)

1. Enviar un Started para `AGL007` al webhook, con el ejemplo del contrato
   [samsara-webhook-http.md](./contracts/samsara-webhook-http.md) sin `endTime`:
   `curl -s -X POST http://localhost:8082/api/v1/proveedores/samsara/webhook -H 'Content-Type: application/json' -d @started.json`
   → `200 {"estado":"GUARDADO", …}`.
2. Repetir el mismo comando → `200 {"estado":"DUPLICADO"}` (SC-005).
3. `curl -s 'http://localhost:8082/api/v1/proveedores/samsara/eventos?despuesDe=0'` → un solo
   evento, después de ~2 s (margen de commit).
4. En ≤ 15 s, la pestaña **Conducción** de la pantalla de alertas muestra una alerta activa de
   `AGL007` "en curso", y aparece la notificación en tiempo real (SC-001, FR-023…FR-026).
5. Enviar el Ended (mismo `startTime`, otro `eventId`, con `endTime`) → en ≤ 15 s la alerta pasa
   a resuelta, con hora de fin y duración.

## Escenario 2 — Robustez (US3)

- Enviar un Ended con un `startTime` nuevo, sin Started previo → se crea el episodio ya cerrado.
  Enviar después su Started → no se reabre.
- Enviar `{"eventType":"VehicleCreated","eventId":"x1"}` → `200 GUARDADO`. No hay alerta, y el
  backend registra que el tipo no es soportado.
- Enviar `no-es-json` → `400 json_invalido` y nada guardado.
- Enviar un Started con patente `ZZZ999` y un id desconocido → guardado en ingesta. Sin alerta y
  con `WARN` en el backend (SC-008).
- Detener `agrolink-ingesta` 1 minuto → el backend registra `WARN` por cada consulta fallida. Al
  volver, sigue desde el mismo cursor.
- Detener AgroLinkBackend, enviar 3 webhooks y volver a arrancarlo → procesa los 3 una sola vez,
  porque el cursor persiste entre reinicios.

## Escenario 3 — Emisor por umbral (US2)

1. Crear y despachar un viaje para `AGL007`, y pasarlo a **En ruta**.
   - Logs de `agrolink-ingesta`: reenvío a `/samsara/viajes` → `202 ARRANCADA`.
   - Logs del emisor: "simulando AGL007". **No** aparece ninguna ruta Rinho nueva para ese
     vehículo (SC-003).
2. Esperar: con λ = 6/h deberían llegar 1–2 excesos en 15–20 min. En los logs del emisor, cada
   envío figura con la velocidad interna del cruce (solo en el log, nunca en el payload) y el
   resultado HTTP (FR-020).
3. Completar o cancelar el viaje con un exceso abierto → Ended inmediato, y el emisor deja de
   simular `AGL007`.
4. Con un viaje Rinho en curso en simultáneo (p. ej. `AGL005`/`900001`), verificar que sigue
   enviando tramas UDP con normalidad (SC-006).

## Escenario 4 — Pruebas automáticas

- `simulador-viajes`: `npm test`, que incluye `test/samsara/*.test.js`:
  - modelo de velocidad determinista con `rng` sembrado, y frecuencia de 8 h simuladas con λ por
    defecto dentro de 1–4 (SC-002);
  - detector de cruces e histéresis (SC-004);
  - payload contra el contrato;
  - disjunción de listas.
- `agrolink-ingesta`: `mvn test`. Extracción de campos (completo / faltante / inválido), endpoint
  webhook (guardado, duplicado, JSON inválido), consulta con cursor y despacho Samsara del
  controlador.
- AgroLinkBackend: `mvn test`. `SamsaraSpeedingEventAdapter` en los tres casos (Principio VIII),
  `SpeedingEpisodeService` (orden normal, fin antes que inicio, duplicado, vehículo desconocido,
  proveedor distinto) y avance de cursor ante error.
- Frontend: `npm test`. Pestaña Conducción y tarjeta KPI, sin cambio en las tarjetas existentes.
