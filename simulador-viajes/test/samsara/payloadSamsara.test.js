import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirPayload } from '../../src/samsara/payloadSamsara.js';
import { VEHICULOS_SAMSARA } from '../../src/samsara/vehiculosSamsara.js';

const vehiculo = VEHICULOS_SAMSARA[0];
const fechas = {
  startTime: new Date('2026-11-04T13:05:12Z'),
  endTime: new Date('2026-11-04T13:06:40Z'),
  tripStartTime: new Date('2026-11-04T12:40:00Z'),
};
const envio = { orgId: '1001', webhookId: 'agrolink-poc' };

test('Started tiene el sobre documentado por Samsara, sin endTime ni velocidad', () => {
  const p = construirPayload('STARTED', vehiculo, fechas, envio);
  assert.equal(p.eventType, 'SevereSpeedingStarted');
  assert.match(p.eventId, /^[0-9a-f-]{36}$/);
  assert.equal(p.eventTime, '2026-11-04T13:05:12.000Z');
  assert.equal(p.orgId, 1001);
  assert.equal(p.webhookId, 'agrolink-poc');
  assert.deepEqual(Object.keys(p.data.data).sort(), ['startTime', 'tripStartTime', 'vehicle']);
  assert.deepEqual(p.data.data.vehicle, {
    id: vehiculo.id,
    name: vehiculo.nombre,
    licensePlate: vehiculo.patente,
    vehicleVin: vehiculo.vin,
    assetType: 'vehicle',
    externalIds: {},
  });
  assert.equal(JSON.stringify(p).includes('velocidad'), false);
});

test('Ended agrega endTime y usa la hora del fin como eventTime', () => {
  const p = construirPayload('ENDED', vehiculo, fechas, envio);
  assert.equal(p.eventType, 'SevereSpeedingEnded');
  assert.equal(p.data.data.endTime, '2026-11-04T13:06:40.000Z');
  assert.equal(p.data.data.startTime, '2026-11-04T13:05:12.000Z');
  assert.equal(p.eventTime, '2026-11-04T13:06:40.000Z');
});

test('cada envio tiene un eventId distinto', () => {
  assert.notEqual(construirPayload('STARTED', vehiculo, fechas, envio).eventId,
    construirPayload('STARTED', vehiculo, fechas, envio).eventId);
});
