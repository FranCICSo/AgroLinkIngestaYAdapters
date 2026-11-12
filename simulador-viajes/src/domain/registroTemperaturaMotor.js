// Ultima temperatura de motor emitida por camion, en memoria del proceso. La escribe el ciclo
// (index.js) y la lee GET /camiones/{id}/falla-motor (contracts/simulador-falla-motor-http.md §3).
// Se pierde al reiniciar, igual que el resto de estadoPorCamion (spec, Edge Cases).
const ultimas = new Map();

export function registrarTemperaturaMotor(camionId, temperaturaC) {
  ultimas.set(camionId, temperaturaC);
}

export function obtenerTemperaturaMotor(camionId) {
  return ultimas.get(camionId) ?? null;
}
