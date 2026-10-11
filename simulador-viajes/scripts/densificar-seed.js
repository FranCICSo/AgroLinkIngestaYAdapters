#!/usr/bin/env node
// Script de un solo uso (feature 012-velocidad-rpm-verosimil, research.md D-05): densifica el
// trazado de los dos camiones ya sembrados en deploy/seed/simulador-camion-{1,2}.sql. No corre
// en cada arranque del stack (el seed es estatico e idempotente) - se corre manualmente una vez
// y el resultado (los nuevos arreglos `puntos`/`paradas`) se pega a mano en cada `.sql`,
// preservando el resto de cada archivo (comentarios, `ON CONFLICT`, `WHERE NOT EXISTS`, etc.).
//
// Uso: node scripts/densificar-seed.js [ruta/al/archivo.sql ...]
// Sin argumentos, procesa los dos archivos de seed conocidos.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { densificarTrazado } from '../src/services/densificacionRutaService.js';
import { indiceMasCercano } from '../src/services/routeGenerationService.js';
import { VELOCIDAD_MAX_URBANA_KMH } from '../src/domain/limitesVelocidad.js';

const CICLO_SEGUNDOS = 60;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVOS_DEFAULT = [
  path.join(__dirname, '..', '..', 'deploy', 'seed', 'simulador-camion-1.sql'),
  path.join(__dirname, '..', '..', 'deploy', 'seed', 'simulador-camion-2.sql'),
];

// Matchea el `SELECT <id>, '<nombre>', '<puntos>'::jsonb, '<paradas>'::jsonb` que arma cada
// INSERT INTO simulador.ruta de estos dos archivos (mismo shape en ambos).
const PATRON_RUTA = /(SELECT \d+, '[^']*',\s*)'(\[.*?\])'::jsonb(,\s*)'(\[.*?\])'::jsonb/s;

function procesarArchivo(rutaArchivo) {
  const contenido = readFileSync(rutaArchivo, 'utf8');
  const match = contenido.match(PATRON_RUTA);
  if (!match) {
    console.error(`No se encontro el patron esperado de simulador.ruta en ${rutaArchivo}`);
    return;
  }

  const puntosOriginales = JSON.parse(match[2]);
  const paradasOriginales = JSON.parse(match[4]);

  const puntosDensificados = densificarTrazado(puntosOriginales, {
    cicloSegundos: CICLO_SEGUNDOS,
    velocidadPorSegmentoKmh: VELOCIDAD_MAX_URBANA_KMH,
  });

  const paradasReindexadas = paradasOriginales.map((parada) => ({
    indice: indiceMasCercano(puntosDensificados, puntosOriginales[parada.indice]),
    duracionMin: parada.duracionMin,
  }));

  console.log(`\n=== ${path.basename(rutaArchivo)} ===`);
  console.log(
    `Puntos: ${puntosOriginales.length} -> ${puntosDensificados.length} ` +
      `(+${puntosDensificados.length - puntosOriginales.length})`,
  );
  console.log('Nuevo arreglo de puntos (pegar reemplazando el JSON actual):');
  console.log(JSON.stringify(puntosDensificados));
  console.log('Nuevo arreglo de paradas (pegar reemplazando el JSON actual):');
  console.log(JSON.stringify(paradasReindexadas));
}

const archivos = process.argv.length > 2 ? process.argv.slice(2) : ARCHIVOS_DEFAULT;
archivos.forEach(procesarArchivo);
