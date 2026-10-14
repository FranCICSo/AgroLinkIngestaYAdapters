// Acceso a simulador.viaje para arrancar un viaje nuevo sobre una ruta recien creada
// (iniciarViajeService.js). No toca telemetria.lectura_telemetria: eso lo escribe el ciclo
// de simulacion (src/index.js), no este alta.

// Un camion tiene a lo sumo un viaje 'en_curso' a la vez (invariante de aplicacion, ver
// deploy/db/03-schema-simulador.sql) - antes de abrir uno nuevo, se cierran los que haya.
export async function finalizarViajesEnCurso(pool, camionId) {
  await pool.query(
    `UPDATE simulador.viaje SET estado = 'finalizado' WHERE camion_id = $1 AND estado = 'en_curso'`,
    [camionId],
  );
}

export async function obtenerUltimoOdometro(pool, camionId) {
  const { rows } = await pool.query(
    `SELECT odometro_actual_km
       FROM simulador.viaje
      WHERE camion_id = $1
      ORDER BY id DESC
      LIMIT 1`,
    [camionId],
  );
  return rows[0]?.odometro_actual_km ?? null;
}

export async function insertarViaje(pool, { camionId, rutaId, odometroActualKm }) {
  const { rows } = await pool.query(
    `INSERT INTO simulador.viaje
       (camion_id, ruta_id, sentido, indice_actual, odometro_actual_km, estado)
     VALUES ($1, $2, 'ida', 0, $3, 'en_curso')
     RETURNING id, camion_id, ruta_id, sentido, estado`,
    [camionId, rutaId, odometroActualKm],
  );
  return rows[0];
}
