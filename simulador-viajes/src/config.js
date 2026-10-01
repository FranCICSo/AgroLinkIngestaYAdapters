// Config del simulador. FR-012: apunta a local/staging por defecto; ir a produccion
// exige APUNTAR_A_PRODUCCION=true de forma explicita, nunca por defecto.

const REQUIRED_VARS = [
  'RECEPTOR_HOST',
  'RECEPTOR_PORT',
  'DB_HOST',
  'DB_PORT',
  'POSTGRES_DB',
  'SIMULADOR_VIAJES_DB_USER',
  'SIMULADOR_VIAJES_DB_PASSWORD',
];

function readInt(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new Error(`Variable de entorno ${name} debe ser un entero, recibido: "${value}"`);
  }
  return n;
}

function readBool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return value === 'true';
}

export function loadConfig(env = process.env) {
  const missing = REQUIRED_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno obligatorias: ${missing.join(', ')}. ` +
        'Ver deploy/.env.example.',
    );
  }

  const apuntarAProduccion = readBool(env.APUNTAR_A_PRODUCCION, false);

  // El default de RECEPTOR_HOST en deploy/.env.example es el nombre del servicio local
  // (rinho-receptor). Si alguien deja APUNTAR_A_PRODUCCION=true sin cambiar RECEPTOR_HOST,
  // es casi seguro un error de configuracion: el simulador nunca debe terminar mandando
  // tramas a un host local con el flag de produccion prendido (FR-012).
  if (apuntarAProduccion && env.RECEPTOR_HOST === 'rinho-receptor') {
    throw new Error(
      'APUNTAR_A_PRODUCCION=true pero RECEPTOR_HOST sigue en el default local ' +
        '("rinho-receptor"). Fijar RECEPTOR_HOST a la VM de produccion de forma explicita.',
    );
  }

  return {
    receptor: {
      host: env.RECEPTOR_HOST,
      port: readInt('RECEPTOR_PORT', env.RECEPTOR_PORT),
    },
    apuntarAProduccion,
    db: {
      host: env.DB_HOST,
      port: readInt('DB_PORT', env.DB_PORT),
      database: env.POSTGRES_DB,
      user: env.SIMULADOR_VIAJES_DB_USER,
      password: env.SIMULADOR_VIAJES_DB_PASSWORD,
    },
    cicloMs: readInt('SIMULADOR_CICLO_MS', env.SIMULADOR_CICLO_MS, 60_000),
  };
}
