import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAck } from '../src/net/ack.js';

test('construye el ACK con formato y checksum validos', () => {
  const ack = buildAck({ deviceId: '2326', msgNum: '0001' });
  assert.match(ack, /^>ACK;#0001;ID=2326;\*[0-9A-F]{2}<$/);
});

test('no construye ACK cuando falta msgNum', () => {
  const ack = buildAck({ deviceId: '2326', msgNum: null });
  assert.equal(ack, null);
});
