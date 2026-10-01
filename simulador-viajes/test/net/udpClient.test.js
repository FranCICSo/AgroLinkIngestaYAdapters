import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { crearUdpClient } from '../../src/net/udpClient.js';

function buildAck(deviceId, msgNum) {
  return `>ACK;#${msgNum};ID=${deviceId};*00<`;
}

async function crearServidorFalso(comportamiento) {
  const server = dgram.createSocket('udp4');
  let mensajesRecibidos = 0;

  server.on('message', (msg, rinfo) => {
    mensajesRecibidos += 1;
    const texto = msg.toString();
    const match = /ID=([^;]+);#|#(\d+);ID=([^;]+)/.exec(texto);
    const deviceIdMatch = /ID=([^;]+)/.exec(texto);
    const msgNumMatch = /#(\d+)/.exec(texto);
    const deviceId = deviceIdMatch ? deviceIdMatch[1] : null;
    const msgNum = msgNumMatch ? msgNumMatch[1] : null;
    if (comportamiento(mensajesRecibidos)) {
      server.send(buildAck(deviceId, msgNum), rinfo.port, rinfo.address);
    }
  });

  await new Promise((resolve) => server.bind(0, '127.0.0.1', resolve));
  return { server, port: server.address().port, contador: () => mensajesRecibidos };
}

test('reintenta hasta recibir ACK y no sigue reintentando despues', async () => {
  const { server, port, contador } = await crearServidorFalso((n) => n >= 2); // responde recien al 2do intento
  const cliente = crearUdpClient({
    host: '127.0.0.1',
    port,
    ackTimeoutMs: 200,
    reintentosMax: 3,
    esperaEntreReintentosMs: 10,
  });

  const ok = await cliente.enviarConReintentos('>REQ...;#0001;ID=900001;*00<', {
    deviceId: '900001',
    msgNum: '0001',
    camionId: '900001',
    viajeId: 1,
  });

  assert.equal(ok, true);
  assert.equal(contador(), 2, 'debio reintentar exactamente una vez antes del ACK');

  await cliente.cerrar();
  server.close();
});

test('descarta la trama tras agotar los reintentos si nunca llega ACK', async () => {
  const { server, port, contador } = await crearServidorFalso(() => false); // nunca responde
  const cliente = crearUdpClient({
    host: '127.0.0.1',
    port,
    ackTimeoutMs: 100,
    reintentosMax: 3,
    esperaEntreReintentosMs: 5,
  });

  const ok = await cliente.enviarConReintentos('>REQ...;#0002;ID=900001;*00<', {
    deviceId: '900001',
    msgNum: '0002',
    camionId: '900001',
    viajeId: 1,
  });

  assert.equal(ok, false);
  assert.equal(contador(), 3, 'debio intentar exactamente 3 veces');

  await cliente.cerrar();
  server.close();
});
