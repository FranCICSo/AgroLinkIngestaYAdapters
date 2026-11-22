// Ultima temperatura de carga (BLE) emitida por camion, en memoria del proceso. La escribe el
// ciclo (index.js) y la lee GET /camiones/{id}/falla-carga (feature 019,
// contracts/simulador-falla-carga-http.md §3). Se pierde al reiniciar, como el resto de
// estadoPorCamion; igual que registroTemperaturaMotor.js.
const ultimas = new Map();

export function registrarTemperaturaCarga(camionId, temperaturaC) {
  ultimas.set(camionId, temperaturaC);
}

export function obtenerTemperaturaCarga(camionId) {
  return ultimas.get(camionId) ?? null;
}
