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

// fallaMotor: resultado de sortearFallaMotor (feature 016, research.md D-03) o null/undefined
// cuando el viaje no tiene falla de motor al azar.
export async function insertarViaje(pool, { camionId, rutaId, odometroActualKm, fallaMotor = null }) {
  const { rows } = await pool.query(
    `INSERT INTO simulador.viaje
       (camion_id, ruta_id, sentido, indice_actual, odometro_actual_km, estado,
        falla_motor_origen, falla_motor_indice_disparo, falla_motor_duracion_min)
     VALUES ($1, $2, 'ida', 0, $3, 'en_curso', $4, $5, $6)
     RETURNING id, camion_id, ruta_id, sentido, estado`,
    [
      camionId,
      rutaId,
      odometroActualKm,
      fallaMotor?.origen ?? null,
      fallaMotor?.indiceDisparo ?? null,
      fallaMotor?.duracionMin ?? null,
    ],
  );
  return rows[0];
}

// Cantidad de puntos de una ruta, para ubicar el disparo de la falla al azar (D-03).
export async function contarPuntosRuta(pool, rutaId) {
  const { rows } = await pool.query(
    `SELECT jsonb_array_length(puntos) AS cantidad FROM simulador.ruta WHERE id = $1`,
    [rutaId],
  );
  return rows[0] ? Number(rows[0].cantidad) : 0;
}

// --- Falla de motor: lecturas y escrituras del endpoint HTTP y del ciclo (data-model.md §1) ---

export function mapFallaMotor(row) {
  return {
    fallaMotorOrigen: row.falla_motor_origen ?? null,
    fallaMotorIndiceDisparo: row.falla_motor_indice_disparo ?? null,
    fallaMotorDuracionMin: row.falla_motor_duracion_min ?? null,
    fallaMotorActivadaEn: row.falla_motor_activada_en ? new Date(row.falla_motor_activada_en) : null,
    fallaMotorDesactivadaEn: row.falla_motor_desactivada_en ? new Date(row.falla_motor_desactivada_en) : null,
  };
}

// Camion (exista o no) y su viaje en curso. Distingue "no existe" (404) de "sin viaje" (409).
export async function obtenerCamionYViajeEnCurso(pool, camionId) {
  const { rows } = await pool.query(
    `SELECT c.id AS camion_id, c.activo,
            v.id AS viaje_id, v.indice_actual,
            v.falla_motor_origen, v.falla_motor_indice_disparo, v.falla_motor_duracion_min,
            v.falla_motor_activada_en, v.falla_motor_desactivada_en
       FROM simulador.camion c
       LEFT JOIN simulador.viaje v ON v.camion_id = c.id AND v.estado = 'en_curso'
      WHERE c.id = $1
      ORDER BY v.id DESC
      LIMIT 1`,
    [camionId],
  );
  const row = rows[0];
  if (!row) return { camion: null, viaje: null };
  return {
    camion: { id: row.camion_id, activo: row.activo },
    viaje: row.viaje_id == null ? null : { id: row.viaje_id, indiceActual: row.indice_actual, ...mapFallaMotor(row) },
  };
}

export async function activarFallaMotorManual(pool, viajeId, ahora = new Date()) {
  await pool.query(
    `UPDATE simulador.viaje
        SET falla_motor_origen = 'manual', falla_motor_indice_disparo = NULL,
            falla_motor_duracion_min = NULL, falla_motor_activada_en = $2,
            falla_motor_desactivada_en = NULL
      WHERE id = $1`,
    [viajeId, ahora],
  );
}

export async function marcarFallaMotorActivada(pool, viajeId, ahora = new Date()) {
  await pool.query(
    `UPDATE simulador.viaje SET falla_motor_activada_en = $2
      WHERE id = $1 AND falla_motor_activada_en IS NULL`,
    [viajeId, ahora],
  );
}

export async function marcarFallaMotorDesactivada(pool, viajeId, ahora = new Date()) {
  await pool.query(
    `UPDATE simulador.viaje SET falla_motor_desactivada_en = $2
      WHERE id = $1 AND falla_motor_desactivada_en IS NULL`,
    [viajeId, ahora],
  );
}
