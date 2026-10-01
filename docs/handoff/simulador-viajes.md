# Handoff: simulador de viajes con dispositivos ficticios (PoC universitaria)

Contexto traído de una sesión de análisis previa (2026-09-26). Objetivo: simular camiones
(incluidos refrigerados) que recorren rutas y emiten tramas como un Rinho Spider IoT.

## Decisiones ya tomadas

- **Proceso separado** del receptor. Nada de modo "dummy" dentro de rinho-receptor.
- El simulador envía tramas **por UDP al receptor real**, así se ejercita checksum, ACK,
  persistencia y dashboards igual que en producción.
- Dispositivos simulados **distinguibles** de los reales: rango de IDs reservado (que no pueda
  ser un IMEI real) e idealmente un flag `simulado` en el registro del dispositivo.
- Apunta a local/staging por defecto; a la VM de OCI solo por elección explícita.

## Piezas reutilizables

- `rinho-receptor/test/tools/buildFrame.js`: ya arma tramas EQ válidas (66 chars GPS, CAN,
  `#msgNum`, checksum XOR). Hay que sumarle opción `ble` (ver `ble-sensores.md`).
- Contrato de trama: `specs/001-ingesta-adaptacion-telemetria/contracts/rinho-eq-frame.md`.
- `deploy/seed/seed-demo-telemetry.sql` inserta directo en base (saltea el receptor): el
  simulador es otra cosa.

## Alcance propuesto

- **Rutas**: polilíneas reales (OSRM o GPX), p. ej. Mercado Central → Rosario, RN2 → Mar del
  Plata. Avance a velocidad realista con paradas.
- **Estado por camión**: odómetro, combustible que baja, RPM según velocidad, ignición en
  paradas, reintentos si no llega ACK.
- **Modelo de temperatura de carga refrigerada** (segmento BLE, depende de la feature BLE):
  - normal: setpoint (−18 °C congelado / 4 °C refrigerado) + ruido
  - apertura de puerta en entrega: pico y recuperación
  - falla de compresor: subida sostenida que cruza umbral (debe disparar alerta)
  - sensor fuera de rango: valores vacíos → `NULL`
- **Escenarios** en archivo (JSON/YAML: camiones, ruta, tipo de carga, fallas) para demos
  reproducibles.

## Dependencia

El modelo de temperatura necesita que el receptor acepte el segmento BLE opcional
(`ble-sensores.md`). Posición/CAN se pueden simular sin esperar esa feature.

## Siguiente paso sugerido

`/speckit-specify` para la feature "simulador de viajes con dispositivos ficticios".
