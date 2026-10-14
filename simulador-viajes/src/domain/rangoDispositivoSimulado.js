// Que un dispositivoId pueda darse de alta como camion simulado (spec 009-simulador-viajes):
// nunca puede coincidir con un IMEI real. Un IMEI real es siempre puramente numerico (15
// digitos); un id numerico corto (900001-900999, el rango clasico reservado) o cualquier id
// que contenga una letra/guion (ej. "tra-demo-004", calcado de un iotDeviceId sembrado en
// AgroLinkBackend) no puede confundirse con uno. Compartido entre camionRepository.js
// (diagnostico) y la validacion de alta de camion vía /rutas.
export const RANGO_RESERVADO_MIN = 900001;
export const RANGO_RESERVADO_MAX = 900999;

export function enRangoReservado(dispositivoId) {
  if (dispositivoId === undefined || dispositivoId === null || dispositivoId === '') {
    return false;
  }
  const texto = String(dispositivoId);
  if (!/^\d+$/.test(texto)) {
    // Contiene algo que no es un digito: no puede ser un IMEI real.
    return true;
  }
  const n = Number(texto);
  return n >= RANGO_RESERVADO_MIN && n <= RANGO_RESERVADO_MAX;
}
