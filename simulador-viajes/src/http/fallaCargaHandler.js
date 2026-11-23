// POST | DELETE | GET /camiones/{camionId}/falla-carga: desvio termico manual de la carga
// refrigerada (feature 019-falla-carga-refrigerada-http, contracts/simulador-falla-carga-http.md).
// Mismas convenciones que falla-motor (FR-012). Sin autenticacion: el puerto no se publica fuera de
// la red de Docker. Uso: docker compose exec simulador-viajes curl -X POST localhost:8090/...
import { log as logDefault } from '../log.js';
import * as viajeRepository from '../db/viajeRepository.js';
import { obtenerTemperaturaCarga } from '../domain/registroTemperaturaCarga.js';
import { objetivoDesvio, CARGA_DESVIO_DEFAULTS } from '../domain/sintesisBle.js';

export const RUTA_FALLA_CARGA = /^\/camiones\/([^/?]*)\/falla-carga\/?(?:\?.*)?$/;
const CAMION_ID_VALIDO = /^[0-9A-Za-z_-]+$/;
const SENTIDOS = ['arriba', 'abajo'];
export const DESVIO_TERMICO = 'desvio_termico';

function leerSentido(url) {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  return new URLSearchParams(query).get('sentido') ?? 'arriba';
}

export function crearFallaCargaHandler({
  pool,
  repo = viajeRepository,
  temperaturaDe = obtenerTemperaturaCarga,
  reloj = () => new Date(),
  log = logDefault,
  config = CARGA_DESVIO_DEFAULTS,
} = {}) {
  return async function atender(req, res, responderJson) {
    const match = req.url.match(RUTA_FALLA_CARGA);
    let camionId = '';
    try {
      camionId = match ? decodeURIComponent(match[1]) : '';
    } catch {
      camionId = '';
    }
    if (!CAMION_ID_VALIDO.test(camionId)) {
      responderJson(res, 400, { error: 'validacion', detalle: `camionId invalido: "${camionId}"` });
      return;
    }
    if (!['POST', 'DELETE', 'GET'].includes(req.method)) {
      responderJson(res, 405, { error: 'metodo_no_permitido' });
      return;
    }
    const sentido = leerSentido(req.url);
    if (req.method === 'POST' && !SENTIDOS.includes(sentido)) {
      responderJson(res, 400, { error: 'validacion', detalle: 'sentido debe ser arriba o abajo' });
      return;
    }

    const { camion, viaje } = await repo.obtenerCamionConCargaYViajeEnCurso(pool, camionId);
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
    if (camion.tipoCarga !== 'refrigerada') {
      responderJson(res, 409, {
        error: 'sin_carga_refrigerada',
        detalle: `El camion ${camionId} lleva carga seca: no hay temperatura de carga que desviar`,
      });
      return;
    }

    const base = { camionId, viajeId: viaje.id };
    const objetivoPara = (s) =>
      objetivoDesvio({
        sentido: s,
        umbralMinC: camion.umbralMinC,
        umbralMaxC: camion.umbralMaxC,
        setpointTempC: camion.setpointTempC,
        config,
      });

    if (req.method === 'POST') {
      if (viaje.fallaTipo === DESVIO_TERMICO) {
        responderJson(res, 200, { ...base, efecto: 'YA_ACTIVA', sentido: viaje.fallaCargaSentido });
        return;
      }
      await repo.activarDesvioTermico(pool, viaje.id, sentido, reloj());
      const cuerpo = { ...base, efecto: 'ACTIVADA', sentido, objetivoC: objetivoPara(sentido) };
      if (viaje.fallaTipo) cuerpo.reemplaza = viaje.fallaTipo;
      log.info('Desvio termico de carga activado a mano', cuerpo);
      responderJson(res, 200, cuerpo);
      return;
    }

    if (req.method === 'DELETE') {
      if (!viaje.fallaTipo) {
        responderJson(res, 200, { ...base, efecto: 'YA_INACTIVA' });
        return;
      }
      await repo.cerrarFallaCarga(pool, viaje.id, reloj());
      const cuerpo = { ...base, efecto: 'DESACTIVADA', tipoCerrado: viaje.fallaTipo };
      log.info('Falla de carga cerrada a mano', { ...cuerpo, sentido: viaje.fallaCargaSentido });
      responderJson(res, 200, cuerpo);
      return;
    }

    // GET (contrato §3). El estado se deriva de falla_tipo (data-model.md §1).
    const activo = viaje.fallaTipo === DESVIO_TERMICO;
    const estado = activo ? 'activo' : viaje.fallaTipo ? 'otra_falla' : 'inactivo';
    responderJson(res, 200, {
      ...base,
      estado,
      fallaTipo: viaje.fallaTipo,
      sentido: activo ? viaje.fallaCargaSentido : null,
      objetivoC: activo ? objetivoPara(viaje.fallaCargaSentido) : null,
      activadaEn: viaje.fallaCargaActivadaEn ? viaje.fallaCargaActivadaEn.toISOString() : null,
      desactivadaEn: viaje.fallaCargaDesactivadaEn ? viaje.fallaCargaDesactivadaEn.toISOString() : null,
      umbralMinC: camion.umbralMinC,
      umbralMaxC: camion.umbralMaxC,
      setpointTempC: camion.setpointTempC,
      ultimaTemperaturaC: temperaturaDe(camionId),
    });
  };
}
