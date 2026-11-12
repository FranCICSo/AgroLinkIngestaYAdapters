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

// Demo server publico de OSRM: la imagen osrm/osrm-backend no corre en la VM de produccion
// (ARM), asi que no se opera un OSRM self-hosted. Tiene rate limiting (~1 req/s) y sin
// garantia de disponibilidad, aceptable para la escala de esta PoC (una ruta por viaje).
const OSRM_BASE_URL_DEFAULT = 'https://router.project-osrm.org';

function readInt(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new Error(`Variable de entorno ${name} debe ser un entero, recibido: "${value}"`);
  }
  return n;
}

function readNumber(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Variable de entorno ${name} debe ser un numero, recibido: "${value}"`);
  }
  return n;
}

// Feature 015-samsara-webhook-exceso-velocidad (data-model.md §2): emisor de webhooks Samsara
// simulado. Solo se valida si esta habilitado, para no romper el arranque de quien no lo usa.
// Una configuracion sin sentido (umbral no positivo, tasa negativa) corta el arranque en vez de
// emitir excesos absurdos (spec, Edge Cases).
export function loadSamsaraConfig(env = process.env) {
  const habilitado = readBool(env.SAMSARA_EMISOR_HABILITADO, false);
  const config = {
    habilitado,
    webhookUrl: env.SAMSARA_WEBHOOK_URL || undefined,
    limiteKmh: readNumber('SAMSARA_LIMITE_KMH', env.SAMSARA_LIMITE_KMH, 80),
    margenKmh: readNumber('SAMSARA_MARGEN_KMH', env.SAMSARA_MARGEN_KMH, 20),
    cicloMs: readInt('SAMSARA_CICLO_MS', env.SAMSARA_CICLO_MS, 5000),
    excesosPorHora: readNumber('SAMSARA_EXCESOS_POR_HORA', env.SAMSARA_EXCESOS_POR_HORA, 0.3125),
    orgId: env.SAMSARA_ORG_ID || '1001',
    webhookId: env.SAMSARA_WEBHOOK_ID || 'agrolink-poc',
  };
  if (!habilitado) return config;

  if (!config.webhookUrl) {
    throw new Error('SAMSARA_EMISOR_HABILITADO=true requiere SAMSARA_WEBHOOK_URL.');
  }
  if (config.limiteKmh <= 0) {
    throw new Error(`SAMSARA_LIMITE_KMH debe ser > 0, recibido: ${config.limiteKmh}`);
  }
  if (config.margenKmh <= 0) {
    throw new Error(`SAMSARA_MARGEN_KMH debe ser > 0, recibido: ${config.margenKmh}`);
  }
  if (config.cicloMs < 1000) {
    throw new Error(`SAMSARA_CICLO_MS debe ser >= 1000, recibido: ${config.cicloMs}`);
  }
  if (config.excesosPorHora < 0) {
    throw new Error(`SAMSARA_EXCESOS_POR_HORA debe ser >= 0, recibido: ${config.excesosPorHora}`);
  }
  return { ...config, umbralKmh: config.limiteKmh + config.margenKmh };
}

// Feature 016-alerta-temperatura-motor (research.md D-06): temperatura del motor y falla de
// sobrecalentamiento. Se valida siempre, porque la temperatura normal se emite en toda trama.
// 105 C es el umbral de alerta por defecto del backend: un pico que no lo supere no permitiria
// demostrar la alerta (FR-007).
export const UMBRAL_ALERTA_MOTOR_DEFAULT_C = 105;

export function loadMotorConfig(env = process.env) {
  const config = {
    probabilidadPct: readNumber('MOTOR_FALLA_PROBABILIDAD_PCT', env.MOTOR_FALLA_PROBABILIDAD_PCT, 5),
    duracionMinMin: readInt('MOTOR_FALLA_DURACION_MIN_MIN', env.MOTOR_FALLA_DURACION_MIN_MIN, 20),
    duracionMaxMin: readInt('MOTOR_FALLA_DURACION_MAX_MIN', env.MOTOR_FALLA_DURACION_MAX_MIN, 40),
    subidaCPorTrama: readNumber('MOTOR_SUBIDA_C_POR_TRAMA', env.MOTOR_SUBIDA_C_POR_TRAMA, 2),
    picoC: readNumber('MOTOR_PICO_C', env.MOTOR_PICO_C, 115),
  };
  if (config.probabilidadPct < 0 || config.probabilidadPct > 100) {
    throw new Error(`MOTOR_FALLA_PROBABILIDAD_PCT debe estar entre 0 y 100, recibido: ${config.probabilidadPct}`);
  }
  if (config.duracionMinMin <= 0) {
    throw new Error(`MOTOR_FALLA_DURACION_MIN_MIN debe ser > 0, recibido: ${config.duracionMinMin}`);
  }
  if (config.duracionMaxMin < config.duracionMinMin) {
    throw new Error(
      `MOTOR_FALLA_DURACION_MAX_MIN (${config.duracionMaxMin}) debe ser >= MOTOR_FALLA_DURACION_MIN_MIN (${config.duracionMinMin})`,
    );
  }
  if (config.subidaCPorTrama <= 0) {
    throw new Error(`MOTOR_SUBIDA_C_POR_TRAMA debe ser > 0, recibido: ${config.subidaCPorTrama}`);
  }
  if (config.picoC <= UMBRAL_ALERTA_MOTOR_DEFAULT_C) {
    throw new Error(
      `MOTOR_PICO_C debe ser > ${UMBRAL_ALERTA_MOTOR_DEFAULT_C} (umbral de alerta), recibido: ${config.picoC}`,
    );
  }
  return config;
}

// Feature 016, ampliacion (research.md D-15): nivel del tanque de combustible. Baja PCT_POR_KM
// por km recorrido y vuelve a 100 % en la trama siguiente a la que quedo debajo de
// RECARGA_DEBAJO_PCT.
export function loadCombustibleConfig(env = process.env) {
  const config = {
    pctPorKm: readNumber('COMBUSTIBLE_PCT_POR_KM', env.COMBUSTIBLE_PCT_POR_KM, 0.05),
    recargaDebajoPct: readNumber('COMBUSTIBLE_RECARGA_DEBAJO_PCT', env.COMBUSTIBLE_RECARGA_DEBAJO_PCT, 7),
  };
  if (config.pctPorKm <= 0 || config.pctPorKm > 100) {
    throw new Error(`COMBUSTIBLE_PCT_POR_KM debe estar en (0, 100], recibido: ${config.pctPorKm}`);
  }
  if (config.recargaDebajoPct <= 0 || config.recargaDebajoPct >= 100) {
    throw new Error(
      `COMBUSTIBLE_RECARGA_DEBAJO_PCT debe estar entre 0 y 100 (exclusivos), recibido: ${config.recargaDebajoPct}`,
    );
  }
  return config;
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
    osrmBaseUrl: env.OSRM_BASE_URL || OSRM_BASE_URL_DEFAULT,
    // Sin default: si no esta definida, iniciarRutaHttpServer() no se levanta (FR-005 es
    // opcional para el loop de simulacion en si, T009/research.md D-04).
    puertoHttp: readInt('PUERTO_HTTP', env.PUERTO_HTTP, undefined),
    samsara: loadSamsaraConfig(env),
    motor: loadMotorConfig(env),
    combustible: loadCombustibleConfig(env),
  };
}
