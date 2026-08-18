import http from 'node:http';
import { log } from '../log.js';

// Un socket UDP no tiene nocion de "conexion": un proceso colgado se veria igual de
// "corriendo" que uno sano. Este endpoint HTTP separado es lo unico que Docker Compose
// puede sondear para decidir si el receptor esta realmente vivo (decision D-12).
export function createHealthServer(port) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'UP' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return {
    listen: () =>
      new Promise((resolve) => {
        server.listen(port, () => {
          log.info('Health server escuchando', { port });
          resolve();
        });
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
