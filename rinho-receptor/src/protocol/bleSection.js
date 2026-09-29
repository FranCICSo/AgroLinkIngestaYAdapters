// Segmento BLE del reporte de usuario que emula EQ (feature 008): pares CLAVE=VALOR
// separados por coma, donde la clave es una letra de magnitud (T temperatura, H humedad,
// B bateria) mas el numero de slot. Un valor vacio ("T0=") es "sin lectura", no un error.
// Contrato: specs/008-ble-sensor-ingestion/contracts/rinho-ble-segment.md §4.
//
// Misma forma que parseCanSection pero NO la reutiliza: son dos contratos del fabricante
// independientes que pueden divergir cuando se verifique el formato con hardware
// (research.md D-02).
//
// Los valores se devuelven como strings opacos: el mapper decide que claves se usan y
// valida el formato numerico.
export function parseBleSection(bleSectionText) {
  const result = new Map();
  if (!bleSectionText) return result;

  for (const pair of bleSectionText.split(',')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    result.set(pair.slice(0, eqIdx), pair.slice(eqIdx + 1));
  }

  return result;
}
