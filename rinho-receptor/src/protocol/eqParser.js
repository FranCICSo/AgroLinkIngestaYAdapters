// Seccion GPS base del reporte EQ: 66 caracteres de ancho fijo, 19 campos.
// Layout normativo: contracts/rinho-eq-frame.md §3.
//
// ADVERTENCIA HISTORICA: una revision anterior de este documento decia "49 caracteres".
// Era un error de conteo, no un cambio de protocolo. Los offsets de abajo son la fuente de
// verdad: derivarlos de aca en vez de hardcodear indices sueltos evita que ese error vuelva.

const FIELDS = [
  ['reporteId', 2],
  ['fecha', 6],
  ['hora', 6],
  ['latitudRaw', 8],
  ['longitudRaw', 9],
  ['velocidadRaw', 3],
  ['rumboRaw', 3],
  ['ignicionEntradasRaw', 2],
  ['salidasRaw', 2],
  ['tensionRaw', 3],
  ['odometroRaw', 8],
  ['gpsPowerRaw', 1],
  ['fixMode', 1],
  ['pdopRaw', 2],
  ['satelitesRaw', 2],
  ['edadPosicionRaw', 4],
  ['modemPowerRaw', 1],
  ['gsmRaw', 1],
  ['csqRaw', 2],
];

const GPS_SECTION_WIDTH = FIELDS.reduce((sum, [, width]) => sum + width, 0); // 66

function sliceFields(gpsSection) {
  const raw = {};
  let offset = 0;
  for (const [name, width] of FIELDS) {
    raw[name] = gpsSection.slice(offset, offset + width);
    offset += width;
  }
  return raw;
}

export function parseGpsSection(gpsSection) {
  if (gpsSection.length !== GPS_SECTION_WIDTH) {
    throw new Error(
      `Seccion GPS de largo ${gpsSection.length}, se esperaban ${GPS_SECTION_WIDTH} chars. ` +
        'Una seccion de largo distinto es una trama de otro formato, no una a parsear a medias.',
    );
  }

  const raw = sliceFields(gpsSection);

  // Fecha/hora en ceros = sin fix de hora GPS (D-08). Se detecta ANTES de construir
  // cualquier fecha: alimentar un constructor de fecha con ceros produce 1999-11-30 por
  // normalizacion de mes/dia en base cero.
  const fechaHoraEnCeros = raw.fecha === '000000' && raw.hora === '000000';

  let anio = null;
  let mes = null;
  let dia = null;
  let hora = null;
  let minuto = null;
  let segundo = null;
  if (!fechaHoraEnCeros) {
    dia = Number(raw.fecha.slice(0, 2));
    mes = Number(raw.fecha.slice(2, 4));
    anio = 2000 + Number(raw.fecha.slice(4, 6));
    hora = Number(raw.hora.slice(0, 2));
    minuto = Number(raw.hora.slice(2, 4));
    segundo = Number(raw.hora.slice(4, 6));
  }

  const ignicionEntradas = parseInt(raw.ignicionEntradasRaw, 16);

  return {
    reporteId: raw.reporteId,
    fechaHoraEnCeros,
    anio,
    mes,
    dia,
    hora,
    minuto,
    segundo,
    latitud: Number(raw.latitudRaw) / 100000,
    longitud: Number(raw.longitudRaw) / 100000,
    // Velocidad ya viene en km/h. NO aplicar la conversion de nudos (x1.852): esa era
    // especifica del modelo interno de Traccar, no de esta trama (trampa historica,
    // ver contracts/rinho-eq-frame.md §3 y el test de regresion en lecturaMapper.test.js).
    velocidadKmh: Number(raw.velocidadRaw),
    rumboGrados: Number(raw.rumboRaw),
    ignicion: (ignicionEntradas & 0x80) !== 0,
    tensionBateriaV: Number(raw.tensionRaw) / 10,
    odometroGpsM: parseInt(raw.odometroRaw, 16),
    fixMode: raw.fixMode,
    satelites: Number(raw.satelitesRaw),
    edadPosicionRaw: raw.edadPosicionRaw,
    csq: Number(raw.csqRaw),
  };
}

export const GPS_SECTION_WIDTH_CHARS = GPS_SECTION_WIDTH;
