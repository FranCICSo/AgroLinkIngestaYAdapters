# Contrato: emisión de tramas del simulador hacia `rinho-receptor`

**Feature**: `009-simulador-viajes` | **Date**: 2026-09-28

El simulador es un **cliente** de dos contratos ya existentes y normativos — no define un
protocolo nuevo, los reutiliza sin modificarlos:

- GPS + CAN: [`specs/001-ingesta-adaptacion-telemetria/contracts/rinho-eq-frame.md`](../../001-ingesta-adaptacion-telemetria/contracts/rinho-eq-frame.md)
- Segmento BLE: [`specs/008-ble-sensor-ingestion/contracts/rinho-ble-segment.md`](../../008-ble-sensor-ingestion/contracts/rinho-ble-segment.md)

Este documento cubre solo lo que es específico del simulador como *emisor*: qué construye, a
qué apunta, y cómo maneja la confirmación.

## 1. Envelope emitido

```text
>REQ<gps 66>[;<CAN>][;<BLE>];#<msgNum>;ID=<camion.id>;*<checksum><
```

- Siempre incluye `#msgNum` (a diferencia del ejemplo canónico del fabricante en
  `rinho-eq-frame.md` §5, que lo omite): el simulador **siempre** espera ACK, para poder
  ejercitar US4 (reintentos).
- El segmento CAN va siempre presente (aunque sea `1=,2=,3=,B=,14=,15=,2A=,2C=` con solo VIN
  poblado) para que el segmento BLE, cuando exista, quede en la posición 2 esperada por
  `rinho-receptor` (contrato BLE §3).
- El segmento BLE solo se agrega si `camion.tipo_carga = 'refrigerada'`; si no, el envelope
  termina en el segmento CAN, igual que un dispositivo real sin sensores BLE emparejados.

## 2. Destino

| Variable de entorno | Default | Efecto |
|----------------------|---------|--------|
| `RECEPTOR_HOST` | `127.0.0.1` (local) | IP/host del receptor UDP |
| `RECEPTOR_PORT` | `UDP_PORT` del `.env` local | Puerto UDP del receptor |
| `APUNTAR_A_PRODUCCION` | `false` | Debe pasarse explícitamente `true` (más `RECEPTOR_HOST`
  apuntando a la VM de OCI) para enviar tramas contra el receptor real de producción — nunca por
  default (FR-012) |

## 3. Confirmación y reintentos (FR-011)

1. El simulador envía la trama y arranca un timeout de **10 s** esperando
   `>ACK;#<msgNum>;ID=<camion.id>;*<checksum><` (formato de `rinho-receptor/src/net/ack.js`,
   sin cambios) en el mismo socket UDP.
2. Si no llega dentro del timeout, reintenta la **misma** trama (mismo `msgNum`, así la
   deduplicación existente del receptor —`(dispositivo_id, momento_evento, frame_hash)`— evita
   un duplicado si dos copias llegan a persistirse).
3. Hasta 3 reintentos con espera fija de 5 s entre cada uno (research.md D-03). Agotados,
   se loguea `warn` con `camion.id`, `viaje.id` y el `msgNum` descartado, y el simulador sigue
   con el próximo ciclo de 60 s — no reintenta esa trama puntual para siempre.

## 4. Cadencia y concurrencia

- Un temporizador independiente por camión activo, cada 60 s (FR-003). El retraso o falla de
  un camión (por ejemplo, agotando sus 3 reintentos) no debe demorar el ciclo de los demás.
- `msgNum` es un contador de 4 dígitos por camión (`0000`–`9999`, con wraparound), igual que el
  campo `msg_num` que ya persiste `telemetria.lectura_telemetria`.

## 5. Ejemplo — camión 1 (referencia real), sin falla activa

```text
>REQ00280928205943-3476065-058356660002247F0014200000988230109FFFF1125;1=LGWEEUA55TL612021,2=1050,3=17,B=,14=12.40,15=84.85,2A=,2C=380;#0142;ID=900001;*07<
```

(checksum XOR calculado sobre este ejemplo concreto, no un valor de relleno — igual que exige
`frame.js`.)

- `900001`: primer camión simulado (research.md D-02).
- Sin BLE: este camión de referencia transporta carga seca en este ejemplo. Un camión con
  `tipo_carga = 'refrigerada'` agrega `;T0=2.3,H0=87.0` antes de `;#0142`.
