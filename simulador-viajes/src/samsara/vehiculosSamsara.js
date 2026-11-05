// Lista cerrada de vehiculos Samsara simulados (spec 015-samsara-webhook-exceso-velocidad,
// FR-014; research.md D-12). El `id` es el id de vehiculo en Samsara y, a la vez, el
// iotDeviceId del vehiculo en AgroLinkBackend: con el llega el aviso de viaje y con el se
// empareja el webhook. Copias mantenidas a mano en AgroLinkBackend (SimulatedDeviceRegistry)
// y en agrolink-ingesta (VehiculosSamsaraSimulados). Nunca deben figurar como camion Rinho.
export const VEHICULOS_SAMSARA = Object.freeze([
  Object.freeze({ id: '281474977000101', patente: 'AGL007', nombre: 'Camión AGL007', vin: '8AC906635RE000107' }),
  Object.freeze({ id: '281474977000102', patente: 'AGL008', nombre: 'Camión AGL008', vin: '8AC906635RE000108' }),
]);

export function buscarVehiculoSamsara(id) {
  return VEHICULOS_SAMSARA.find((v) => v.id === id) ?? null;
}
