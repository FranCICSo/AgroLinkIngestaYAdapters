// handleFrame con socket y repositorio falsos (feature 008, hallazgo C2 de
// /speckit-analyze): los tests del mapper encadenan las funciones a mano y no detectarian
// que udpServer dejara de pasar el segmento BLE al mapper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleFrame } from '../src/net/udpServer.js';
import { parseDatagram } from '../src/protocol/frame.js';
import { buildAck } from '../src/net/ack.js';
import { buildFrame } from './tools/buildFrame.js';

const RINFO = { address: '10.0.0.7', port: 40123 };
const CAN_VACIO = '1=,2=,3=,B=,14=,15=,2A=,2C=';

function fakeRepository({ falla = false } = {}) {
  const repo = {
    persistidas: [],
    async persist(lectura) {
      if (falla) throw new Error('db caida');
      repo.persistidas.push(lectura);
      return { inserted: true, deduplicated: false };
    },
  };
  return repo;
}

function fakeSocket() {
  const socket = {
    enviados: [],
    send(buf, port, address, cb) {
      socket.enviados.push({ buf: String(buf), port, address });
      cb?.();
    },
  };
  return socket;
}

function frameDe(opciones) {
  const [frame] = parseDatagram(buildFrame({ deviceId: '2326', msgNum: '0012', ...opciones }));
  return frame;
}

test('trama con segmento BLE: persiste los tres valores y envia el ACK al origen', async () => {
  const repo = fakeRepository();
  const socket = fakeSocket();

  await handleFrame(frameDe({ can: CAN_VACIO, ble: 'T0=23.5,H0=45.0,B0=3012' }), repo, socket, RINFO, 0);

  assert.equal(repo.persistidas.length, 1);
  const [lectura] = repo.persistidas;
  assert.equal(lectura.bleTemperaturaC, 23.5);
  assert.equal(lectura.bleHumedadPct, 45);
  assert.equal(lectura.bleBateria, 3012);
  assert.deepEqual(socket.enviados, [
    { buf: buildAck({ deviceId: '2326', msgNum: '0012' }), port: RINFO.port, address: RINFO.address },
  ]);
});

test('misma trama sin segmento BLE: mismo ACK y columnas BLE en null', async () => {
  const repo = fakeRepository();
  const socket = fakeSocket();

  await handleFrame(frameDe({ can: CAN_VACIO }), repo, socket, RINFO, 0);

  const [lectura] = repo.persistidas;
  assert.equal(lectura.bleTemperaturaC, null);
  assert.equal(lectura.bleHumedadPct, null);
  assert.equal(lectura.bleBateria, null);
  assert.equal(socket.enviados.length, 1);
});

test('si persistir falla no se envia ACK (el silencio es la senal de reintento)', async () => {
  const socket = fakeSocket();

  await handleFrame(
    frameDe({ can: CAN_VACIO, ble: 'T0=23.5,H0=45.0,B0=3012' }),
    fakeRepository({ falla: true }),
    socket,
    RINFO,
    0,
  );

  assert.equal(socket.enviados.length, 0);
});
