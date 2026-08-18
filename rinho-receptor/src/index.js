import { loadConfig } from './config.js';
import { log } from './log.js';
import { createPool, closePool } from './db/pool.js';
import { createLecturaRepository } from './db/lecturaRepository.js';
import { createUdpServer } from './net/udpServer.js';
import { createHealthServer } from './net/healthServer.js';

async function main() {
  const config = loadConfig();

  const pool = createPool(config.db);
  const repository = createLecturaRepository(pool, config.dedupCacheTtlMs);

  const udpServer = createUdpServer({ repository, horaUtcOffsetHours: config.horaUtcOffsetHours });
  const healthServer = createHealthServer(config.health.port);

  await udpServer.listen(config.udp.port, config.udp.host);
  await healthServer.listen();

  log.info('rinho-receptor arrancado', {
    udpPort: config.udp.port,
    healthPort: config.health.port,
  });

  // Apagado ordenado: cerrar socket y pool antes de salir, para que `docker compose
  // restart` no pierda datagramas en vuelo (T018).
  const shutdown = async (signal) => {
    log.info('Apagando rinho-receptor', { signal });
    await udpServer.close();
    await healthServer.close();
    await closePool(pool);
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.error('Fallo fatal al arrancar rinho-receptor', { error: err.message });
  process.exit(1);
});
