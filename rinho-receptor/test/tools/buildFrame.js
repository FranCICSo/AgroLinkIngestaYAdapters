#!/usr/bin/env node
// CLI que emite por stdout una trama EQ valida para un deviceId dado, con checksum XOR
// recalculado sobre el contenido final (T069). La usan T061 (SC-004, concurrencia
// multi-camion) y quickstart.md §7.
//
// Uso:
//   node test/tools/buildFrame.js --device-id 1001
//   node test/tools/buildFrame.js --device-id 1001 --lat -2778100 --lon -06425857 \
//       --speed 000 --heading 151 --can "15=75,B=66010"

import { calculateChecksum } from '../../src/protocol/frame.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

function pad(value, width) {
  return String(value).padStart(width, '0').slice(0, width);
}

export function buildFrame({
  deviceId,
  reportId = '00',
  date = '000000',
  time = '000000',
  lat = '-2778100',
  lon = '-064258570',
  speed = '000',
  heading = '000',
  ignInputs = '7F',
  outputs = '00',
  battery = '000',
  odometer = '00000000',
  gpsPower = '1',
  fixMode = '3',
  pdop = '01',
  sats = '09',
  posAge = '0000',
  modemPower = '1',
  gsm = '1',
  csq = '16',
  can = '',
  msgNum = null,
} = {}) {
  if (!deviceId) throw new Error('deviceId es obligatorio');

  const gps =
    pad(reportId, 2) +
    pad(date, 6) +
    pad(time, 6) +
    pad(lat, 8) +
    pad(lon, 9) +
    pad(speed, 3) +
    pad(heading, 3) +
    pad(ignInputs, 2) +
    pad(outputs, 2) +
    pad(battery, 3) +
    pad(odometer, 8) +
    pad(gpsPower, 1) +
    pad(fixMode, 1) +
    pad(pdop, 2) +
    pad(sats, 2) +
    pad(posAge, 4) +
    pad(modemPower, 1) +
    pad(gsm, 1) +
    pad(csq, 2);

  if (gps.length !== 66) {
    throw new Error(`Seccion GPS generada con largo ${gps.length}, se esperaban 66`);
  }

  const segments = [`REQ${gps}${can ? `;${can}` : ''}`];
  if (msgNum) segments.push(`#${msgNum}`);
  segments.push(`ID=${deviceId}`);

  const bodyUpToStar = `>${segments.join(';')};*`;
  const checksum = calculateChecksum(bodyUpToStar);
  return `${bodyUpToStar}${checksum}<`;
}

// Solo ejecuta el CLI si el archivo se invoca directamente (no al importarlo en tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const frame = buildFrame({
    deviceId: args['device-id'],
    lat: args.lat,
    lon: args.lon,
    speed: args.speed,
    heading: args.heading,
    can: args.can,
    msgNum: args['msg-num'],
  });
  process.stdout.write(frame);
}
