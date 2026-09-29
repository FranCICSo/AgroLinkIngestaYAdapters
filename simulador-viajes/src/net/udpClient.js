// Cliente UDP del simulador: envia una trama y espera el ACK del receptor
// (`>ACK;#<msgNum>;ID=<deviceId>;*<checksum><`, formato de rinho-receptor/src/net/ack.js,
// sin cambios). Ante falta de ACK reintenta la MISMA trama (mismo msgNum) hasta un limite
// acotado, con espera fija entre intentos (FR-011; research.md D-03).

import dgram from 'node:dgram';
import { log } from '../log.js';

const ACK_RE = /^>ACK;#(\d+);ID=([^;]+);\*[0-9A-Fa-f]{2}<$/;
const ACK_TIMEOUT_MS = 10_000;
const REINTENTOS_MAX = 3;
const ESPERA_ENTRE_REINTENTOS_MS = 5_000;

export function crearUdpClient({
  host,
  port,
  ackTimeoutMs = ACK_TIMEOUT_MS,
  reintentosMax = REINTENTOS_MAX,
  esperaEntreReintentosMs = ESPERA_ENTRE_REINTENTOS_MS,
}) {
  const socket = dgram.createSocket('udp4');
  const pendientes = new Map(); // key `${deviceId}:${msgNum}` -> resolve()

  socket.on('message', (msg) => {
    const match = ACK_RE.exec(msg.toString());
    if (!match) return;
    const [, msgNum, deviceId] = match;
    const key = `${deviceId}:${msgNum}`;
    const resolver = pendientes.get(key);
    if (resolver) {
      pendientes.delete(key);
      resolver();
    }
  });

  socket.on('error', (err) => {
    log.error('Error inesperado en el socket UDP del simulador', { error: err.message });
  });

  function esperarAck(key) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendientes.delete(key);
        resolve(false);
      }, ackTimeoutMs);

      pendientes.set(key, () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function enviarDatagrama(trama) {
    return new Promise((resolve, reject) => {
      socket.send(trama, port, host, (err) => (err ? reject(err) : resolve()));
    });
  }

  // Devuelve true si el receptor confirmo la trama, false si se agotaron los reintentos
  // (la trama puntual se descarta, pero el simulador sigue con el ciclo siguiente).
  async function enviarConReintentos(trama, { deviceId, msgNum, camionId, viajeId }) {
    const key = `${deviceId}:${msgNum}`;

    for (let intento = 1; intento <= reintentosMax; intento += 1) {
      await enviarDatagrama(trama);
      const ackRecibido = await esperarAck(key);
      if (ackRecibido) return true;

      log.warn('Trama simulada sin ACK, reintentando', {
        camionId,
        viajeId,
        msgNum,
        intento,
      });
      if (intento < reintentosMax) await sleep(esperaEntreReintentosMs);
    }

    log.warn('Trama simulada descartada: se agotaron los reintentos sin ACK', {
      camionId,
      viajeId,
      msgNum,
    });
    return false;
  }

  async function cerrar() {
    await new Promise((resolve) => socket.close(resolve));
  }

  return { enviarConReintentos, cerrar };
}
