// Acceso a simulador.camion: lectura de diagnostico (listarCamionesConEstado) y el alta
// usada por /rutas cuando se pide arrancar un viaje sobre la ruta nueva (iniciarViajeService.js).
import { enRangoReservado } from '../domain/rangoDispositivoSimulado.js';

export async function listarCamionesConEstado(pool) {
  const { rows } = await pool.query(
    `SELECT c.id, c.nombre, c.activo,
            EXISTS (
              SELECT 1 FROM simulador.viaje v
              WHERE v.camion_id = c.id AND v.estado = 'en_curso'
            ) AS viaje_en_curso
       FROM simulador.camion c
      ORDER BY c.id`,
  );

  return rows.map((fila) => ({
    dispositivoId: fila.id,
    nombre: fila.nombre,
    activo: fila.activo,
    viajeEnCurso: fila.viaje_en_curso,
    enRangoReservado: enRangoReservado(fila.id),
  }));
}

export async function obtenerCamion(pool, id) {
  const { rows } = await pool.query(
    `SELECT id, nombre, tipo_carga, odometro_inicial_km, activo
       FROM simulador.camion
      WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function insertarCamion(
  pool,
  { id, nombre, tipoCarga, odometroInicialKm, setpointTempC, setpointHumedadPct },
) {
  const { rows } = await pool.query(
    `INSERT INTO simulador.camion
       (id, nombre, tipo_carga, setpoint_temp_c, setpoint_humedad_pct, odometro_inicial_km, activo)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING id, nombre, tipo_carga, odometro_inicial_km, activo`,
    [id, nombre, tipoCarga, setpointTempC ?? null, setpointHumedadPct ?? null, odometroInicialKm],
  );
  return rows[0];
}

export async function reactivarCamion(pool, id) {
  await pool.query(`UPDATE simulador.camion SET activo = true WHERE id = $1`, [id]);
}

// El tipo de carga es del viaje, no del camion: el mismo camion puede llevar carga seca en un
// viaje y refrigerada en el siguiente. Por eso al arrancar un viaje que informa la carga se
// pisa la del camion ya existente (si no, quedaba fija en la del alta y el segmento BLE nunca
// aparecia en las tramas).
export async function actualizarCargaCamion(pool, { id, tipoCarga, setpointTempC, setpointHumedadPct }) {
  await pool.query(
    `UPDATE simulador.camion
        SET tipo_carga = $2, setpoint_temp_c = $3, setpoint_humedad_pct = $4
      WHERE id = $1`,
    [id, tipoCarga, setpointTempC ?? null, setpointHumedadPct ?? null],
  );
}
