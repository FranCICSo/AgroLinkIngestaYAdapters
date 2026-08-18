// Seccion CAN OBD-II del reporte EQ: pares ID=VALOR separados por coma. IDs hexadecimales
// de 1-2 caracteres. Un campo sin dato del ECU llega como "ID=" (identificador, '=', nada):
// es el caso normal, no un error (contrato §4).
//
// NO reutiliza canJsonTransform de rinho-udp-server: esa funcion parsea la variante ER/J1939
// (vehiculo pesado), cuyos IDs son de 4 digitos. Formato incompatible (ver research.md D-02).
//
// Los valores se devuelven como strings opacos: el mapper decide tipo/uso por ID. Coercionar
// aca convertiria el VIN alfanumerico (ID '1') a NaN y enmascararia su descarte explicito
// (Principio V).
export function parseCanSection(canSectionText) {
  const result = new Map();
  if (!canSectionText) return result;

  for (const pair of canSectionText.split(',')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const id = pair.slice(0, eqIdx);
    const value = pair.slice(eqIdx + 1);
    result.set(id, value);
  }

  return result;
}
