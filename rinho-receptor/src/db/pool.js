import pg from 'pg';
import { log } from '../log.js';

const { Pool } = pg;

export function createPool(dbConfig) {
  const pool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    // El rol de aplicacion no tiene el schema en su search_path por defecto. Se fija via
    // opciones de conexion (no con un 'SET' posterior en el evento 'connect'): un query
    // disparado por la app puede ganarle la carrera a un 'SET' asincrono en ese evento,
    // corriendo con el search_path por defecto todavia sin aplicar.
    options: '-c search_path=telemetria',
  });

  pool.on('error', (err) => {
    // Error en un cliente ocioso del pool (p.ej. la base cae mientras nadie lo usa).
    // No debe tumbar el proceso: el proximo query fallara y se manejara ahi.
    log.error('Error inesperado en el pool de conexiones', { error: err.message });
  });

  return pool;
}

export async function closePool(pool) {
  await pool.end();
}
