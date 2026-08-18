const REQUIRED_VARS = [
  'UDP_PORT',
  'DB_HOST',
  'DB_PORT',
  'POSTGRES_DB',
  'RINHO_RECEPTOR_DB_USER',
  'RINHO_RECEPTOR_DB_PASSWORD',
];

function readInt(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new Error(`Variable de entorno ${name} debe ser un entero, recibido: "${value}"`);
  }
  return n;
}

export function loadConfig(env = process.env) {
  const missing = REQUIRED_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno obligatorias: ${missing.join(', ')}. ` +
        'Ver deploy/.env.example.',
    );
  }

  return {
    udp: {
      port: readInt('UDP_PORT', env.UDP_PORT),
      host: env.UDP_HOST || '0.0.0.0',
    },
    health: {
      port: readInt('RECEPTOR_HEALTH_PORT', env.RECEPTOR_HEALTH_PORT, 8081),
    },
    db: {
      host: env.DB_HOST,
      port: readInt('DB_PORT', env.DB_PORT),
      database: env.POSTGRES_DB,
      user: env.RINHO_RECEPTOR_DB_USER,
      password: env.RINHO_RECEPTOR_DB_PASSWORD,
    },
    dedupCacheTtlMs: readInt('DEDUP_CACHE_TTL_MS', env.DEDUP_CACHE_TTL_MS, 5 * 60 * 1000),
    // Parche de despliegue (D-12): 0 = el campo hora de la trama es UTC, tal como lo
    // documenta el contrato del fabricante. Cambiar SOLO si el equipo esta configurado con
    // hora local en vez de UTC (ver deploy/README.md). No es una caracteristica del
    // protocolo, es una correccion para un equipo mal configurado.
    horaUtcOffsetHours: readInt('DEVICE_HORA_UTC_OFFSET_HOURS', env.DEVICE_HORA_UTC_OFFSET_HOURS, 0),
  };
}
