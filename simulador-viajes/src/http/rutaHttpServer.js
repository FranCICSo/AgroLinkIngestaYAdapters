// Endpoint HTTP interno POST /rutas (feature 011-generar-ruta-simulada, FR-005), mas los avisos
// de viaje del emisor Samsara (feature 015): POST /samsara/viajes[/{tripCode}/detencion].
//
// `node:http` puro, sin framework (Express/Fastify): el repo no usa ninguno en ningun otro
// lado (ver plan.md § Technical Context) y el endpoint no necesita mas que parsear un body
// JSON y despachar a routeGenerationService. NO se publica al host en deploy/compose.yaml
// (research.md D-04, FR-006): alcanzable solo dentro de la red de Docker compose.
import { createServer } from 'node:http';
import { log } from '../log.js';
import { generarRuta } from '../services/routeGenerationService.js';

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

export function crearRutaHttpServer(pool, osrmBaseUrl, emisorSamsara = null) {
  return createServer(async (req, res) => {
    if (req.method === 'POST' && (req.url === '/samsara/viajes' || RUTA_DETENCION_SAMSARA.test(req.url))) {
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

export function iniciarRutaHttpServer(pool, { osrmBaseUrl, puertoHttp, emisorSamsara = null }) {
  const server = crearRutaHttpServer(pool, osrmBaseUrl, emisorSamsara);
  server.listen(puertoHttp, () => {
    log.info('Servidor HTTP de generacion de rutas escuchando', { puerto: puertoHttp });
  });
  return server;
}
