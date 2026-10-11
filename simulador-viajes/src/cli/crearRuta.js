// Comando CLI equivalente al endpoint HTTP (feature 011-generar-ruta-simulada, FR-007,
// research.md D-05): parsea argv a mano, como ya hace config.js, sin agregar una
// dependencia nueva (yargs/commander) solo para esto.
import { loadConfig } from '../config.js';
import { createPool, closePool } from '../db/pool.js';
import { generarRuta } from '../services/routeGenerationService.js';

const MOTIVO_A_MENSAJE = {
  validacion: (detalle) => `Error: ${detalle}`,
  nombre_duplicado: () => 'Error: ya existe una ruta con ese nombre',
  trazado_no_disponible: (detalle) => `Error: no se pudo trazar la ruta: ${detalle}`,
};

function parseArgv(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const nombre = token.slice(2);
    const valor = argv[i + 1];
    args[nombre] = valor;
    i += 1;
  }
  return args;
}

export function construirInput(argv) {
  const args = parseArgv(argv);
  const paradas = args.paradas ? JSON.parse(args.paradas) : [];
  const input = {
    nombre: args.nombre,
    origen: { lat: Number(args.origenLat), lon: Number(args.origenLon) },
    destino: { lat: Number(args.destinoLat), lon: Number(args.destinoLon) },
    paradas,
  };

  // --camionId arranca un viaje 'en_curso' sobre la ruta apenas se persiste, en vez de dejarla
  // sin ningun camion asignandosela (ver docs/handoff/dispositivos-simulados.md).
  if (args.camionId) {
    input.camion = {
      id: args.camionId,
      nombre: args.camionNombre,
      tipoCarga: args.tipoCarga,
      odometroInicialKm: args.odometroInicialKm ? Number(args.odometroInicialKm) : undefined,
      setpointTempC: args.setpointTempC ? Number(args.setpointTempC) : undefined,
      setpointHumedadPct: args.setpointHumedadPct ? Number(args.setpointHumedadPct) : undefined,
    };
  }

  return input;
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.db);
  const input = construirInput(process.argv.slice(2));

  try {
    const resultado = await generarRuta(pool, config.osrmBaseUrl, input);

    if (!resultado.ok) {
      const mensaje = MOTIVO_A_MENSAJE[resultado.motivo] ?? (() => `Error: ${resultado.motivo}`);
      console.error(mensaje(resultado.detalle));
      process.exitCode = 1;
      return;
    }

    console.log(
      `Ruta creada: id=${resultado.ruta.id} nombre="${resultado.ruta.nombre}" puntos=${resultado.ruta.puntos.length}`,
    );
    if (resultado.viaje) {
      console.log(
        `Viaje iniciado: dispositivoId=${resultado.viaje.dispositivoId} viajeId=${resultado.viaje.viajeId}`,
      );
    }
  } finally {
    await closePool(pool);
  }
}

main().catch((err) => {
  console.error(`Error inesperado: ${err.message}`);
  process.exitCode = 1;
});
