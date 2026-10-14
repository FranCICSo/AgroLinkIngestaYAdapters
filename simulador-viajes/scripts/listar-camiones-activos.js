// Script de diagnostico de solo lectura (feature 013-simulacion-viaje-backend, US2, FR-004):
// lista cada simulador.camion con su dispositivoId, para distinguir "va a ser consultable
// desde el backend" de "fuera de alcance" sin leer codigo de dos repositorios (ver
// specs/013-simulacion-viaje-backend/contracts/listar-camiones-activos-cli.md).
import { loadConfig } from '../src/config.js';
import { createPool, closePool } from '../src/db/pool.js';
import { listarCamionesConEstado } from '../src/db/camionRepository.js';

const COLUMNAS = ['dispositivoId', 'nombre', 'activo', 'viajeEnCurso', 'enRangoReservado'];

function siNo(valor) {
  return valor ? 'si' : 'no';
}

export function formatearTabla(camiones) {
  if (camiones.length === 0) {
    return '(sin camiones configurados)';
  }

  const filas = camiones.map((c) => [
    c.dispositivoId,
    c.nombre,
    siNo(c.activo),
    siNo(c.viajeEnCurso),
    siNo(c.enRangoReservado),
  ]);

  const anchos = COLUMNAS.map((col, i) =>
    Math.max(col.length, ...filas.map((fila) => String(fila[i]).length)),
  );

  const formatearFila = (celdas) => celdas.map((c, i) => String(c).padEnd(anchos[i])).join('  ');

  return [formatearFila(COLUMNAS), ...filas.map(formatearFila)].join('\n');
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.db);

  try {
    const camiones = await listarCamionesConEstado(pool);
    console.log(formatearTabla(camiones));
  } finally {
    await closePool(pool);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  });
}
