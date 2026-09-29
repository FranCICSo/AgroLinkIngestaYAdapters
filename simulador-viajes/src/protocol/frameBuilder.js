// Arma el envelope REQ/EQ (GPS + CAN [+ BLE opcional]) reutilizando la construccion de
// tramas ya validada de rinho-receptor (research.md D-01): import relativo directo a
// test/tools/buildFrame.js, sin duplicar la logica de ancho fijo ni de checksum.
import { buildFrame } from '../../../rinho-receptor/test/tools/buildFrame.js';

function encodeCoord(valueDeg, magnitudDigits) {
  const sign = valueDeg < 0 ? '-' : '+';
  const magnitud = Math.round(Math.abs(valueDeg) * 100000);
  return sign + String(magnitud).padStart(magnitudDigits, '0');
}

function encodeOdometroMetros(km) {
  const metros = Math.round(km * 1000);
  return metros.toString(16).toUpperCase().padStart(8, '0');
}

function formatCanValue(value) {
  return value == null ? '' : String(value);
}

// can: { rpm, velocidadRuedaKmh, odometroEcuKm, combustibleConsumidoL, combustiblePct,
//        temperaturaRefrigeranteC, presionAceiteKpa } (cualquier campo puede venir null:
//        campo "sin dato del ECU", igual que un dispositivo real - contrato rinho-eq-frame.md).
function buildCanSection({ vin, can }) {
  return [
    `1=${formatCanValue(vin)}`,
    `2=${formatCanValue(can.rpm)}`,
    `3=${formatCanValue(can.velocidadRuedaKmh)}`,
    `B=${formatCanValue(can.odometroEcuKm)}`,
    `14=${formatCanValue(can.combustibleConsumidoL)}`,
    `15=${formatCanValue(can.combustiblePct)}`,
    `2A=${formatCanValue(can.temperaturaRefrigeranteC)}`,
    `2C=${formatCanValue(can.presionAceiteKpa)}`,
  ].join(',');
}

// ble: { temperaturaC, humedadPct, bateria } | null - null cuando el camion no tiene carga
// refrigerada (FR-017): en ese caso NO se agrega el segmento en absoluto, igual que un
// dispositivo real sin sensores BLE emparejados (contrato rinho-ble-segment.md SS3).
function buildBleSection(ble) {
  if (!ble) return '';
  const pares = [];
  if (ble.temperaturaC != null) pares.push(`T0=${ble.temperaturaC}`);
  if (ble.humedadPct != null) pares.push(`H0=${ble.humedadPct}`);
  if (ble.bateria != null) pares.push(`B0=${ble.bateria}`);
  return pares.join(',');
}

export function construirTrama({
  camionId,
  vin,
  momentoEvento,
  lat,
  lon,
  velocidadKmh,
  rumboGrados,
  ignicionEncendida,
  odometroKm,
  can,
  ble,
  msgNum,
}) {
  const date = [
    String(momentoEvento.getUTCDate()).padStart(2, '0'),
    String(momentoEvento.getUTCMonth() + 1).padStart(2, '0'),
    String(momentoEvento.getUTCFullYear() % 100).padStart(2, '0'),
  ].join('');
  const time = [
    String(momentoEvento.getUTCHours()).padStart(2, '0'),
    String(momentoEvento.getUTCMinutes()).padStart(2, '0'),
    String(momentoEvento.getUTCSeconds()).padStart(2, '0'),
  ].join('');

  return buildFrame({
    deviceId: camionId,
    date,
    time,
    lat: encodeCoord(lat, 7),
    lon: encodeCoord(lon, 8),
    speed: String(Math.round(velocidadKmh)).padStart(3, '0'),
    heading: String(Math.round(rumboGrados) % 360).padStart(3, '0'),
    // Bit 7 de ignInputs indica ignicion (contrato rinho-eq-frame.md SS5: 0x7F&0x80=0 =>
    // apagada). 0xFF prende ese bit manteniendo el resto de la base 0x7F.
    ignInputs: ignicionEncendida ? 'FF' : '7F',
    battery: '142',
    odometer: encodeOdometroMetros(odometroKm),
    gpsPower: '1',
    fixMode: '3',
    pdop: '01',
    sats: '09',
    posAge: '0000',
    modemPower: '1',
    gsm: '1',
    csq: '20',
    can: buildCanSection({ vin, can }),
    ble: buildBleSection(ble),
    msgNum: String(msgNum).padStart(4, '0'),
  });
}
