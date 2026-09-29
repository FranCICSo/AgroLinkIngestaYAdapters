// Lee/actualiza la configuracion mutable del simulador (schema `simulador`): camiones
// activos con su viaje en curso y ruta asociada, y el avance de cada viaje.
//
// FR-004/US3: NO cachea la flota en memoria entre ciclos. `obtenerViajesEnCurso` se llama
// una vez por ciclo de 60s (ver index.js) y siempre relee las tablas, asi que agregar,
// editar o desactivar un camion en la base tiene efecto en el ciclo siguiente sin
// reiniciar el proceso (research.md D-04).

import { log } from '../log.js';

// Rango reservado de dispositivo_id para camiones simulados: nunca puede coincidir con un
// IMEI real de 15 digitos (research.md D-02, spec US5).
const ID_RANGE_RE = /^900[0-9]{3}$/;

export function validarCamion(camion) {
  if (!ID_RANGE_RE.test(camion.id)) {
    return { valido: false, motivo: `id fuera del rango reservado 900001-900999: ${camion.id}` };
  }
  if (camion.tipoCarga === 'refrigerada') {
    if (camion.setpointTempC == null || camion.setpointHumedadPct == null) {
      return {
        valido: false,
        motivo: `camion ${camion.id} es refrigerada pero le falta setpoint_temp_c o setpoint_humedad_pct`,
      };
    }
  }
  return { valido: true };
}

function mapRow(row) {
  return {
    camion: {
      id: row.camion_id,
      nombre: row.nombre,
      vin: row.vin,
      tipoCarga: row.tipo_carga,
      setpointTempC: row.setpoint_temp_c == null ? null : Number(row.setpoint_temp_c),
      setpointHumedadPct: row.setpoint_humedad_pct == null ? null : Number(row.setpoint_humedad_pct),
      odometroInicialKm: Number(row.odometro_inicial_km),
    },
    ruta: {
      id: row.ruta_id,
      nombre: row.ruta_nombre,
      puntos: row.puntos,
      paradas: row.paradas,
    },
    viaje: {
      id: row.viaje_id,
      camionId: row.camion_id,
      rutaId: row.ruta_id,
      sentido: row.sentido,
      indiceActual: row.indice_actual,
      odometroActualKm: Number(row.odometro_actual_km),
      estado: row.estado,
      fallaTipo: row.falla_tipo,
      fallaIndiceDisparo: row.falla_indice_disparo,
    },
  };
}

// Camiones activos (US3) con un viaje 'en_curso' y su ruta. Un camion activo sin viaje
// asignado simplemente no aparece en el resultado (edge case: no debe hacer fallar el
// ciclo completo).
export async function obtenerViajesEnCurso(pool) {
  const { rows } = await pool.query(`
    SELECT
      c.id AS camion_id, c.nombre, c.vin, c.tipo_carga,
      c.setpoint_temp_c, c.setpoint_humedad_pct, c.odometro_inicial_km,
      r.id AS ruta_id, r.nombre AS ruta_nombre, r.puntos, r.paradas,
      v.id AS viaje_id, v.sentido, v.indice_actual, v.odometro_actual_km, v.estado,
      v.falla_tipo, v.falla_indice_disparo
    FROM simulador.camion c
    JOIN simulador.viaje v ON v.camion_id = c.id AND v.estado = 'en_curso'
    JOIN simulador.ruta r ON r.id = v.ruta_id
    WHERE c.activo = true
  `);

  const resultado = [];
  for (const row of rows) {
    const entry = mapRow(row);
    const { valido, motivo } = validarCamion(entry.camion);
    if (!valido) {
      log.warn('Camion simulado excluido del ciclo: configuracion invalida', {
        camionId: entry.camion.id,
        motivo,
      });
      continue;
    }
    resultado.push(entry);
  }
  return resultado;
}

export async function actualizarProgresoViaje(pool, viajeId, { indiceActual, odometroActualKm }) {
  await pool.query(
    `UPDATE simulador.viaje SET indice_actual = $1, odometro_actual_km = $2 WHERE id = $3`,
    [indiceActual, odometroActualKm, viajeId],
  );
}

// FR-014/research.md D-07: al completar la ruta, finaliza el viaje actual y crea
// automaticamente el de vuelta (misma ruta, sentido invertido), alternando ida/vuelta
// indefinidamente para que el camion siga emitiendo sin intervencion manual.
export async function finalizarYCrearVuelta(pool, viaje) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE simulador.viaje SET estado = 'finalizado' WHERE id = $1`, [viaje.id]);

    const nuevoSentido = viaje.sentido === 'ida' ? 'vuelta' : 'ida';
    const { rows } = await client.query(
      `INSERT INTO simulador.viaje
         (camion_id, ruta_id, sentido, indice_actual, odometro_actual_km, estado)
       VALUES ($1, $2, $3, 0, $4, 'en_curso')
       RETURNING id, sentido, indice_actual, odometro_actual_km, estado, falla_tipo, falla_indice_disparo`,
      [viaje.camionId, viaje.rutaId, nuevoSentido, viaje.odometroActualKm],
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
