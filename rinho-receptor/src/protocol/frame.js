// Envelope del protocolo Rinho: >BODY;#MSGNUM;ID=DEVICEID;*CHECKSUM<
// Contrato completo: specs/001-ingesta-adaptacion-telemetria/contracts/rinho-eq-frame.md

const FRAME_RE = /(>[^<]*<)/g;

// XOR byte a byte de todo el string desde '>' hasta el '*' inclusive, en 2 digitos hex
// mayusculas. Algoritmo validado en produccion (rinho-udp-server) y contra las dos tramas
// de referencia del contrato.
export function calculateChecksum(str) {
  let cs = 0;
  for (const ch of str) cs ^= ch.charCodeAt(0);
  return cs.toString(16).toUpperCase().padStart(2, '0');
}

function parseOneFrame(raw) {
  const inner = raw.slice(1, -1); // sin '>' ni '<'
  const starIdx = inner.lastIndexOf('*');
  if (starIdx === -1) {
    return { raw, body: inner, deviceId: null, msgNum: null, checksumValid: false };
  }

  const beforeStar = inner.slice(0, starIdx);
  const declaredChecksum = inner.slice(starIdx + 1);
  const upToStarInclusive = `>${beforeStar}*`;
  const checksumValid = calculateChecksum(upToStarInclusive) === declaredChecksum.toUpperCase();

  // El envelope siempre termina en ";ID=<deviceId>;" justo antes del '*': split(';')
  // produce por eso un ultimo elemento vacio en TODA trama, no solo en casos raros. Hay
  // que descartarlo explicitamente o se cuela como un segmento mas.
  const segments = beforeStar.split(';').filter((seg) => seg !== '');

  // El envelope es REQ<gps>[;<CAN>][;#msgNum];ID=<deviceId>. La seccion CAN es un segmento
  // mas, sin prefijo reconocible (no es ";#" ni ";ID="): hay que conservarla en el body en
  // vez de descartarla junto con los segmentos de metadata, o el mapper nunca la ve.
  const bodyParts = [segments[0]];
  let deviceId = null;
  let msgNum = null;
  for (const seg of segments.slice(1)) {
    if (seg.startsWith('ID=')) deviceId = seg.slice(3) || null;
    else if (seg.startsWith('#')) msgNum = seg.slice(1) || null;
    else bodyParts.push(seg);
  }
  const body = bodyParts.join(';');

  return { raw, body, deviceId, msgNum, checksumValid };
}

// Un datagrama UDP puede traer mas de una trama concatenada; se itera todas.
export function parseDatagram(datagramText) {
  const matches = datagramText.match(FRAME_RE) || [];
  return matches.map(parseOneFrame);
}
