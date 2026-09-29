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
    // Mismo motivo que rinho-receptor/src/db/pool.js: fijar el search_path en la conexion
    // evita la carrera entre un SET posterior y el primer query de la app.
    options: '-c search_path=simulador',
  });

  pool.on('error', (err) => {
    log.error('Error inesperado en el pool de conexiones', { error: err.message });
  });

  return pool;
}

export async function closePool(pool) {
  await pool.end();
}
