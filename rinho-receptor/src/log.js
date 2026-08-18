// Logger JSON estructurado a stdout, sin dependencias externas (Constraint: pg es la unica
// dependencia de runtime). Cada linea es un objeto JSON completo -> facil de parsear/indexar
// por cualquier colector de logs sin configuracion especial.

function write(level, msg, fields = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  const out = level === 'error' ? console.error : console.log;
  out(JSON.stringify(line));
}

export const log = {
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};
