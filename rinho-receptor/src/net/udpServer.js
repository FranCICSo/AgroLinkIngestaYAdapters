import dgram from 'node:dgram';
import { parseDatagram } from '../protocol/frame.js';
import { parseGpsSection } from '../protocol/eqParser.js';
import { parseCanSection } from '../protocol/canObd.js';
import { mapFrameToLectura } from '../domain/lecturaMapper.js';
import { buildAck } from './ack.js';
import { log } from '../log.js';

function splitBody(body) {
  // body = "REQ<gps>[;<can>]"
  const withoutPrefix = body.slice(3);
  const semiIdx = withoutPrefix.indexOf(';');
  if (semiIdx === -1) return { gpsText: withoutPrefix, canText: '' };
  return { gpsText: withoutPrefix.slice(0, semiIdx), canText: withoutPrefix.slice(semiIdx + 1) };
}

async function handleFrame(frame, repository, socket, rinfo, horaUtcOffsetHours) {
  // Rechazo explicito y registrado (nunca silencioso, FR-013 + Principio IX): sin
  // dispositivo_id valido o con checksum invalido, la trama se descarta ANTES de intentar
  // interpretarla.
  if (!frame.checksumValid) {
    log.warn('Trama rechazada: checksum invalido', { raw: frame.raw, from: rinfo.address });
    return;
  }
  if (!frame.deviceId) {
    log.warn('Trama rechazada: sin ID de dispositivo valido', { raw: frame.raw, from: rinfo.address });
    return;
  }

  let lectura;
  try {
    const { gpsText, canText } = splitBody(frame.body);
    const gps = parseGpsSection(gpsText);
    const can = parseCanSection(canText);
    lectura = mapFrameToLectura({
      deviceId: frame.deviceId,
      gps,
      can,
      payloadCrudo: frame.raw,
      msgNum: frame.msgNum,
      horaUtcOffsetHours,
    });
  } catch (err) {
    // Fallo de parseo (p.ej. seccion GPS de largo distinto al esperado): se registra con
    // la trama cruda completa, nunca se descarta en silencio.
    log.error('Trama rechazada: fallo de parseo', {
      raw: frame.raw,
      from: rinfo.address,
      error: err.message,
    });
    return;
  }

  try {
    await repository.persist(lectura);
  } catch (err) {
    // Fallo de persistencia: NO se envia ACK. El silencio es la senal de reintento para
    // el dispositivo (US2, escenario 2). Se deja evidencia completa para diagnosticar.
    log.error('Fallo al persistir lectura, no se enviara ACK', {
      dispositivoId: lectura.dispositivoId,
      raw: frame.raw,
      error: err.message,
    });
    return;
  }

  // El ACK solo se emite DESPUES de que el insert esta confirmado en base.
  const ack = buildAck({ deviceId: frame.deviceId, msgNum: frame.msgNum });
  if (!ack) {
    log.info('Lectura persistida sin msgNum: no hay ACK que construir', {
      dispositivoId: lectura.dispositivoId,
    });
    return;
  }

  // Al address:port DE ORIGEN del datagrama, nunca a una direccion configurada: el
  // dispositivo esta detras del NAT del operador celular (D-06).
  socket.send(ack, rinfo.port, rinfo.address, (err) => {
    if (err) {
      log.error('Fallo al enviar ACK', { dispositivoId: lectura.dispositivoId, error: err.message });
    }
  });
}

export function createUdpServer({ repository, horaUtcOffsetHours = 0 }) {
  const socket = dgram.createSocket('udp4');

  socket.on('message', (msg, rinfo) => {
    const datagramText = msg.toString('ascii');
    const frames = parseDatagram(datagramText);
    for (const frame of frames) {
      handleFrame(frame, repository, socket, rinfo, horaUtcOffsetHours).catch((err) => {
        log.error('Error inesperado procesando trama', { error: err.message });
      });
    }
  });

  socket.on('error', (err) => {
    log.error('Error en el socket UDP', { error: err.message });
  });

  return {
    listen: (port, host) =>
      new Promise((resolve) => {
        socket.bind(port, host, () => {
          log.info('Receptor UDP escuchando', { port, host });
          resolve();
        });
      }),
    close: () => new Promise((resolve) => socket.close(resolve)),
  };
}
