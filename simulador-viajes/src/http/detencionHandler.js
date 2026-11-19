// POST /camiones/{camionId}/detencion: detiene la simulacion Rinho de un camion cuando su viaje
// termina o se cancela en AgroLink (feature 014-simulacion-ruta-del-viaje, Historia 3, FR-011 a
// FR-013; contracts/simulador-viajes-http.md §3). Lo llama agrolink-ingesta, que es quien sabe a
// que tripCode corresponde la simulacion en curso: el simulador solo conoce el camion.
//
// Finaliza el viaje en curso sin crear el de vuelta. Idempotente: sin viaje en curso responde 200
// SIN_VIAJE_EN_CURSO. Sin autenticacion: el puerto no se publica fuera de la red de Docker
// (feature 011, research.md D-04).
import { log as logDefault } from '../log.js';
import * as viajeRepository from '../db/viajeRepository.js';

export const RUTA_DETENCION = /^\/camiones\/([^/?]*)\/detencion\/?(?:\?.*)?$/;
const CAMION_ID_VALIDO = /^[0-9A-Za-z_-]+$/;

// `leerBody` lo inyecta rutaHttpServer (su lector de JSON); sin el, el cuerpo se ignora.
export function crearDetencionHandler({ pool, repo = viajeRepository, leerBody = async () => ({}), log = logDefault } = {}) {
  return async function atender(req, res, responderJson) {
    const match = req.url.match(RUTA_DETENCION);
    const camionId = match ? decodeURIComponent(match[1]) : '';
    if (!CAMION_ID_VALIDO.test(camionId)) {
      responderJson(res, 400, { error: 'validacion', detalle: `camionId invalido: "${camionId}"` });
      return;
    }
    if (req.method !== 'POST') {
      responderJson(res, 405, { error: 'metodo_no_permitido' });
      return;
    }

    // Cuerpo opcional, solo para el log: { tripCode, motivo }. Un cuerpo invalido no impide detener.
    let aviso = {};
    try {
      aviso = (await leerBody(req)) ?? {};
    } catch {
      aviso = {};
    }

    if (!(await repo.existeCamion(pool, camionId))) {
      responderJson(res, 404, { error: 'camion_no_encontrado', detalle: `No existe el camion simulado ${camionId}` });
      return;
    }

    const viajesFinalizados = await repo.finalizarViajesEnCurso(pool, camionId);
    const efecto = viajesFinalizados.length > 0 ? 'DETENIDA' : 'SIN_VIAJE_EN_CURSO';
    log.info('Detencion de simulacion Rinho', {
      camionId,
      tripCode: aviso.tripCode ?? null,
      motivo: aviso.motivo ?? null,
      viajesFinalizados,
      efecto,
    });
    responderJson(res, 200, { camionId, viajesFinalizados, efecto });
  };
}
