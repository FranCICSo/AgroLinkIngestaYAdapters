import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDatagram, calculateChecksum } from '../src/protocol/frame.js';

const VENDOR_FRAME =
  '>REQ00000000000000-2780656-064296830000117F00000010836F1130112FFFF1117;1=,2=,3=,B=,14=,15=,2A=,2C=;ID=2326;*01<';

const REAL_FRAME =
  '>REQ00210918170359-2778100-064258570001517F000000000049D13010900001516;1=1M8GDM9A_KP042788,2=2200,3=45,B=66010,14=30000,15=75,2A=90,2C=340;ID=037883;*01<';

test('checksum XOR coincide con el ejemplo oficial del fabricante', () => {
  const upTo = VENDOR_FRAME.slice(0, VENDOR_FRAME.lastIndexOf('*') + 1);
  assert.equal(calculateChecksum(upTo), '01');
});

test('checksum XOR coincide con la trama real de referencia', () => {
  const upTo = REAL_FRAME.slice(0, REAL_FRAME.lastIndexOf('*') + 1);
  assert.equal(calculateChecksum(upTo), '01');
});

test('parseDatagram extrae body, ID y msgNum ausente', () => {
  const [frame] = parseDatagram(VENDOR_FRAME);
  assert.equal(frame.deviceId, '2326');
  assert.equal(frame.msgNum, null);
  assert.equal(frame.checksumValid, true);
  assert.ok(frame.body.startsWith('REQ'));
});

test('trama con checksum invalido se marca invalida, no se descarta silenciosamente', () => {
  const corrupt = VENDOR_FRAME.replace('*01<', '*FF<');
  const [frame] = parseDatagram(corrupt);
  assert.equal(frame.checksumValid, false);
});

test('trama sin ;ID= se marca sin deviceId (rechazo aguas arriba, FR-013)', () => {
  const sinId = '>REQ00000000000000-2780656-064296830000117F00000010836F1130112FFFF1117;1=,2=,3=,B=,14=,15=,2A=,2C=;*01<';
  const upTo = sinId.slice(0, sinId.lastIndexOf('*') + 1);
  const cs = calculateChecksum(upTo);
  const fixed = sinId.replace('*01<', `*${cs}<`);
  const [frame] = parseDatagram(fixed);
  assert.equal(frame.deviceId, null);
});

test('trama con ;#msgNum lo extrae', () => {
  const withMsgNum = REAL_FRAME.replace(';ID=037883', ';#0001;ID=037883');
  const upTo = withMsgNum.slice(0, withMsgNum.lastIndexOf('*') + 1);
  const cs = calculateChecksum(upTo);
  const fixed = withMsgNum.replace('*01<', `*${cs}<`);
  const [frame] = parseDatagram(fixed);
  assert.equal(frame.msgNum, '0001');
});

test('REGRESION: la seccion CAN no se pierde cuando ademas hay ;#msgNum e ;ID=', () => {
  // La seccion CAN es un segmento ";"-delimitado sin prefijo reconocible (no es ";#" ni
  // ";ID="): un parseo ingenuo que solo retiene segments[0] como body la descarta junto
  // con los segmentos de metadata, y el mapper nunca ve combustible/odometro del ECU.
  const withMsgNum = REAL_FRAME.replace(';ID=037883', ';#0001;ID=037883');
  const upTo = withMsgNum.slice(0, withMsgNum.lastIndexOf('*') + 1);
  const withValidChecksum = withMsgNum.replace('*01<', `*${calculateChecksum(upTo)}<`);

  const [frame] = parseDatagram(withValidChecksum);
  // El body no debe traer ';' colgante: contaminaria el ultimo valor CAN aguas abajo
  // (ej. "B=66010;" en vez de "B=66010", que Number() convierte en NaN).
  assert.equal(frame.body.endsWith(';'), false);
  assert.ok(frame.body.endsWith('2C=340'));
  assert.equal(frame.msgNum, '0001');
  assert.equal(frame.deviceId, '037883');
});

test('datagrama con multiples tramas concatenadas se itera completo', () => {
  const doble = VENDOR_FRAME + REAL_FRAME;
  const frames = parseDatagram(doble);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].deviceId, '2326');
  assert.equal(frames[1].deviceId, '037883');
});
