// POST | DELETE | GET /camiones/{camionId}/falla-motor: activacion manual del sobrecalentamiento
// de motor (feature 016-alerta-temperatura-motor, contracts/simulador-falla-motor-http.md,
// FR-003, FR-003b, FR-003c). Sin autenticacion: el puerto no se publica fuera de la red de Docker
// (research.md D-04). Uso: docker compose exec simulador-viajes curl -X POST localhost:8090/...
import { log as logDefault } from '../log.js';
import { estadoFallaMotor, finFallaMotor } from '../domain/fallaMotor.js';
import * as viajeRepository from '../db/viajeRepository.js';
import { obtenerTemperaturaMotor } from '../domain/registroTemperaturaMotor.js';

export const RUTA_FALLA_MOTOR = /^\/camiones\/([^/?]*)\/falla-motor\/?(?:\?.*)?$/;
const CAMION_ID_VALIDO = /^[0-9A-Za-z_-]+$/;

// 'por_activar' (llego al indice pero el ciclo todavia no persistio la activacion) se informa
// como 'pendiente': se activa en la trama siguiente.
function estadoPublico(estado) {
  return estado === 'por_activar' ? 'pendiente' : estado;
}

export function crearFallaMotorHandler({
  pool,
  repo = viajeRepository,
  temperaturaDe = obtenerTemperaturaMotor,
  reloj = () => new Date(),
  log = logDefault,
} = {}) {
  return async function atender(req, res, responderJson) {
    const match = req.url.match(RUTA_FALLA_MOTOR);
    const camionId = match ? decodeURIComponent(match[1]) : '';
    if (!CAMION_ID_VALIDO.test(camionId)) {
      responderJson(res, 400, { error: 'validacion', detalle: `camionId invalido: "${camionId}"` });
      return;
    }
    if (!['POST', 'DELETE', 'GET'].includes(req.method)) {
      responderJson(res, 405, { error: 'metodo_no_permitido' });
      return;
    }

    const { camion, viaje } = await repo.obtenerCamionYViajeEnCurso(pool, camionId);
    if (!camion) {
      responderJson(res, 404, { error: 'camion_no_encontrado', detalle: `No existe el camion simulado ${camionId}` });
      return;
    }
    if (!camion.activo || !viaje) {
      responderJson(res, 409, {
        error: 'sin_viaje_en_curso',
        detalle: `El camion ${camionId} no tiene un viaje en curso${camion.activo ? '' : ' (esta inactivo)'}`,
      });
      return;
    }

    const ahora = reloj();
    const estado = estadoFallaMotor(viaje, { ahora, indice: viaje.indiceActual });
    const base = { camionId, viajeId: viaje.id };

    if (req.method === 'GET') {
      const fin = finFallaMotor(viaje);
      responderJson(res, 200, {
        ...base,
        estado: estadoPublico(estado),
        origen: viaje.fallaMotorOrigen,
        indiceDisparo: viaje.fallaMotorIndiceDisparo,
        duracionMin: viaje.fallaMotorDuracionMin,
        activadaEn: viaje.fallaMotorActivadaEn,
        desactivadaEn: viaje.fallaMotorDesactivadaEn,
        terminaEn: estado === 'activa' && fin ? fin : null,
        ultimaTemperaturaC: temperaturaDe(camionId),
      });
      return;
    }

    if (req.method === 'POST') {
      if (estado === 'activa' || estado === 'por_activar') {
        responderJson(res, 200, { ...base, efecto: 'YA_ACTIVA', origen: viaje.fallaMotorOrigen });
        return;
      }
      await repo.activarFallaMotorManual(pool, viaje.id, ahora);
      log.info('Sobrecalentamiento de motor activado a mano', { ...base, efecto: 'ACTIVADA', origen: 'manual' });
      responderJson(res, 200, { ...base, efecto: 'ACTIVADA', origen: 'manual' });
      return;
    }

    // DELETE: desactiva una activa o cancela una pendiente (data-model.md §1).
    if (estado === 'activa' || estado === 'pendiente' || estado === 'por_activar') {
      await repo.marcarFallaMotorDesactivada(pool, viaje.id, ahora);
      log.info('Sobrecalentamiento de motor desactivado a mano', {
        ...base,
        efecto: 'DESACTIVADA',
        origen: viaje.fallaMotorOrigen,
      });
      responderJson(res, 200, { ...base, efecto: 'DESACTIVADA' });
      return;
    }
    responderJson(res, 200, { ...base, efecto: 'YA_INACTIVA' });
  };
}
