// Separa el body de una trama ("REQ<gps>[;<can>][;<ble>]", ya sin #msgNum ni ID=) en sus
// secciones. Contrato: specs/008-ble-sensor-ingestion/contracts/rinho-ble-segment.md §3.
//
// La identificacion es POSICIONAL, nunca por el nombre de las claves: la seccion CAN usa
// IDs hex de 1-2 caracteres, asi que "B" y "B0" son IDs CAN validos y un segmento BLE
// (T0=,H0=,B0=) no se puede distinguir de uno CAN por su contenido.
//
//   0 -> GPS (sin el prefijo "REQ")
//   1 -> CAN (vacio si falta)
//   2 -> BLE (vacio si falta: el caso normal de un EQ estandar)
//   3+ -> inesperados; el llamador decide como registrarlos

const PREFIX_LENGTH = 'REQ'.length;

export function splitBody(body) {
  const [gpsText, canText = '', bleText = '', ...extraSegments] = body
    .slice(PREFIX_LENGTH)
    .split(';');
  return { gpsText, canText, bleText, extraSegments };
}
