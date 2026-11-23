// Endpoint HTTP interno POST /rutas (feature 011-generar-ruta-simulada, FR-005), mas los avisos
// de viaje del emisor Samsara (feature 015): POST /samsara/viajes[/{tripCode}/detencion] y el
// exceso forzado a mano POST /samsara/vehiculos/{vehiculo}/exceso, y la
// activacion manual del sobrecalentamiento de motor (feature 016): POST|DELETE|GET
// /camiones/{camionId}/falla-motor, y la detencion de la simulacion Rinho de un camion
// (feature 014, Historia 3): POST /camiones/{camionId}/detencion, y el desvio termico manual de
// la carga refrigerada (feature 019): POST|DELETE|GET /camiones/{camionId}/falla-carga.
//
// `node:http` puro, sin framework (Express/Fastify): el repo no usa ninguno en ningun otro
// lado (ver plan.md § Technical Context) y el endpoint no necesita mas que parsear un body
// JSON y despachar a routeGenerationService. NO se publica al host en deploy/compose.yaml
// (research.md D-04, FR-006): alcanzable solo dentro de la red de Docker compose.
import { createServer } from 'node:http';
import { log } from '../log.js';
import { generarRuta } from '../services/routeGenerationService.js';
import { crearFallaMotorHandler, RUTA_FALLA_MOTOR } from './fallaMotorHandler.js';
import { crearDetencionHandler, RUTA_DETENCION } from './detencionHandler.js';
import { crearFallaCargaHandler, RUTA_FALLA_CARGA } from './fallaCargaHandler.js';

const MOTIVO_A_STATUS = {
  validacion: 400,
  nombre_duplicado: 409,
  trazado_no_disponible: 422,
};

function leerBodyJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function responderJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const RUTA_DETENCION_SAMSARA = /^\/samsara\/viajes\/([^/]+)\/detencion$/;
// Exceso de velocidad forzado a mano, para una demo: {vehiculo} es la patente (AGL007) o el id
// Samsara. Body opcional {"duracionS": 20..600}. Uso, desde la VM:
//   docker compose -f deploy/compose.yaml exec simulador-viajes \
//     curl -s -X POST localhost:8090/samsara/vehiculos/AGL007/exceso
export const RUTA_EXCESO_SAMSARA = /^\/samsara\/vehiculos\/([^/?]+)\/exceso\/?$/;

// Feature 015-samsara-webhook-exceso-velocidad: avisos de viaje para el emisor Samsara
// (contracts/simulacion-samsara-avisos.md §3). Con el emisor deshabilitado no hay nada en
// curso: el inicio responde 503 y la detencion 200 SIN_SIMULACION_EN_CURSO.
async function atenderSamsara(req, res, emisorSamsara) {
  let input;
  try {
    input = await leerBodyJson(req);
  } catch {
    responderJson(res, 400, { error: 'validacion', detalle: 'body no es JSON valido' });
    return;
  }

  const exceso = req.url.match(RUTA_EXCESO_SAMSARA);
  if (exceso) {
    if (!emisorSamsara) {
      responderJson(res, 503, { error: 'emisor_deshabilitado' });
      return;
    }
    const r = emisorSamsara.forzarExceso({ ...input, vehiculo: decodeURIComponent(exceso[1]) });
    responderJson(res, r.status, r.body);
    return;
  }

  const detencion = req.url.match(RUTA_DETENCION_SAMSARA);
  if (detencion) {
    const tripCode = decodeURIComponent(detencion[1]);
    if (!emisorSamsara) {
      responderJson(res, 200, { vehiculoId: input.vehiculoId, tripCode, efecto: 'SIN_SIMULACION_EN_CURSO' });
      return;
    }
    const r = await emisorSamsara.detenerViaje({ ...input, tripCode });
    responderJson(res, r.status, r.body);
    return;
  }

  if (!emisorSamsara) {
    responderJson(res, 503, { error: 'emisor_deshabilitado' });
    return;
  }
  const r = await emisorSamsara.iniciarViaje(input);
  responderJson(res, r.status, r.body);
}

export function crearRutaHttpServer(
  pool,
  osrmBaseUrl,
  emisorSamsara = null,
  { fallaMotorHandler, detencionHandler, fallaCargaHandler, cargaDesvio } = {},
) {
  const atenderFallaMotor = fallaMotorHandler ?? crearFallaMotorHandler({ pool });
  const atenderFallaCarga = fallaCargaHandler ?? crearFallaCargaHandler({ pool, config: cargaDesvio });
  const atenderDetencion = detencionHandler ?? crearDetencionHandler({ pool, leerBody: leerBodyJson });
  return createServer(async (req, res) => {
    // Feature 014 (Historia 3): detencion de la simulacion Rinho de un camion.
    if (RUTA_DETENCION.test(req.url)) {
      try {
        await atenderDetencion(req, res, responderJson);
      } catch (err) {
        log.error('Fallo atendiendo /camiones/{id}/detencion', { url: req.url, error: err.message });
        responderJson(res, 500, { error: 'interno', detalle: err.message });
      }
      return;
    }
    if (RUTA_FALLA_MOTOR.test(req.url)) {
      try {
        await atenderFallaMotor(req, res, responderJson);
      } catch (err) {
        log.error('Fallo atendiendo /camiones/{id}/falla-motor', { url: req.url, error: err.message });
        responderJson(res, 500, { error: 'interno', detalle: err.message });
      }
      return;
    }
    // Feature 019: desvio termico manual de la carga refrigerada.
    if (RUTA_FALLA_CARGA.test(req.url)) {
      try {
        await atenderFallaCarga(req, res, responderJson);
      } catch (err) {
        log.error('Fallo atendiendo /camiones/{id}/falla-carga', { url: req.url, error: err.message });
        responderJson(res, 500, { error: 'interno', detalle: err.message });
      }
      return;
    }
    if (
      req.method === 'POST' &&
      (req.url === '/samsara/viajes' || RUTA_DETENCION_SAMSARA.test(req.url) || RUTA_EXCESO_SAMSARA.test(req.url))
    ) {
      await atenderSamsara(req, res, emisorSamsara);
      return;
    }
    if (req.method !== 'POST' || req.url !== '/rutas') {
      responderJson(res, 404, { error: 'no_encontrado' });
      return;
    }

    let input;
    try {
      input = await leerBodyJson(req);
    } catch {
      responderJson(res, 400, { error: 'validacion', detalle: 'body no es JSON valido' });
      return;
    }

    const resultado = await generarRuta(pool, osrmBaseUrl, input);

    if (!resultado.ok) {
      const status = MOTIVO_A_STATUS[resultado.motivo] ?? 500;
      responderJson(res, status, { error: resultado.motivo, detalle: resultado.detalle });
      return;
    }

    // Si el body incluyo `camion`, la ruta ya tiene un viaje 'en_curso' arrancado (research.md
    // D-02 original quedaba sin cubrir esto; ahora se resuelve en un solo POST) - se expone sin
    // cambiar la forma de la respuesta para quien no manda `camion` (retrocompatible).
    const body = resultado.viaje ? { ...resultado.ruta, viaje: resultado.viaje } : resultado.ruta;
    responderJson(res, 201, body);
  });
}

export function iniciarRutaHttpServer(pool, { osrmBaseUrl, puertoHttp, emisorSamsara = null, cargaDesvio }) {
  const server = crearRutaHttpServer(pool, osrmBaseUrl, emisorSamsara, { cargaDesvio });
  server.listen(puertoHttp, () => {
    log.info('Servidor HTTP de generacion de rutas escuchando', { puerto: puertoHttp });
  });
  return server;
}
