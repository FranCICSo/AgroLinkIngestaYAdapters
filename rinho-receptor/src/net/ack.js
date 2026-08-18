import { calculateChecksum } from '../protocol/frame.js';

// >ACK;#<msgNum>;ID=<deviceId>;*<checksum><
// Sin msgNum no hay ACK que construir: la trama de origen no traia el segmento opcional
// ;#msgNum, asi que el dispositivo no espera confirmacion (D-06).
export function buildAck({ deviceId, msgNum }) {
  if (!msgNum) return null;

  const bodyUpToStar = `>ACK;#${msgNum};ID=${deviceId};*`;
  const checksum = calculateChecksum(bodyUpToStar);
  return `${bodyUpToStar}${checksum}<`;
}
