// Sobre webhook de Samsara para SevereSpeedingStarted/Ended (spec 015, FR-013; contrato
// specs/015-samsara-webhook-exceso-velocidad/contracts/samsara-webhook-http.md, forma tomada de
// developers.samsara.com/docs/severespeedingstarted y .../severespeedingended). Puro.
import { randomUUID } from 'node:crypto';

export const TIPO_EVENTO = Object.freeze({
  STARTED: 'SevereSpeedingStarted',
  ENDED: 'SevereSpeedingEnded',
});

/**
 * @param evento 'STARTED' | 'ENDED'
 * @param vehiculo { id, nombre, patente, vin }
 * @param fechas { startTime: Date, endTime?: Date, tripStartTime: Date }
 * @param envio { orgId, webhookId, eventId?, eventTime? }
 */
export function construirPayload(evento, vehiculo, { startTime, endTime, tripStartTime }, { orgId, webhookId, eventId, eventTime }) {
  const datos = {
    startTime: startTime.toISOString(),
    ...(evento === 'ENDED' ? { endTime: endTime.toISOString() } : {}),
    tripStartTime: tripStartTime.toISOString(),
    vehicle: {
      id: vehiculo.id,
      name: vehiculo.nombre,
      licensePlate: vehiculo.patente,
      vehicleVin: vehiculo.vin,
      assetType: 'vehicle',
      externalIds: {},
    },
  };
  const orgIdNumerico = Number(orgId);
  return {
    eventId: eventId ?? randomUUID(),
    eventTime: (eventTime ?? (evento === 'ENDED' ? endTime : startTime)).toISOString(),
    eventType: TIPO_EVENTO[evento],
    orgId: Number.isFinite(orgIdNumerico) ? orgIdNumerico : orgId,
    webhookId,
    data: { data: datos },
  };
}
