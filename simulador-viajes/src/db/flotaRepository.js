// Lee/actualiza la configuracion mutable del simulador (schema `simulador`): camiones
// activos con su viaje en curso y ruta asociada, y el avance de cada viaje.
//
// FR-004/US3: NO cachea la flota en memoria entre ciclos. `obtenerViajesEnCurso` se llama
// una vez por ciclo de 60s (ver index.js) y siempre relee las tablas, asi que agregar,
// editar o desactivar un camion en la base tiene efecto en el ciclo siguiente sin
// reiniciar el proceso (research.md D-04).

import { log } from '../log.js';
import { enRangoReservado } from '../domain/rangoDispositivoSimulado.js';
import { mapFallaMotor, mapFallaCarga } from './viajeRepository.js';

export function validarCamion(camion) {
  if (!enRangoReservado(camion.id)) {
    return {
      valido: false,
      motivo: `id numerico fuera del rango reservado 900001-900999 (podria ser un IMEI real): ${camion.id}`,
    };
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
      // Feature 019: rango del viaje refrigerado en curso, null si no llego.
      umbralMinC: row.umbral_min_c == null ? null : Number(row.umbral_min_c),
      umbralMaxC: row.umbral_max_c == null ? null : Number(row.umbral_max_c),
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
      fallaIndiceDisparo: row.falla_indice_disparo,
      // Feature 019: desvio termico manual (falla_tipo = 'desvio_termico').
      ...mapFallaCarga(row),
      // Feature 016: falla de motor, independiente de la de carga (FR-004).
      ...mapFallaMotor(row),
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
      c.setpoint_temp_c, c.setpoint_humedad_pct, c.umbral_min_c, c.umbral_max_c, c.odometro_inicial_km,
      r.id AS ruta_id, r.nombre AS ruta_nombre, r.puntos, r.paradas,
      v.id AS viaje_id, v.sentido, v.indice_actual, v.odometro_actual_km, v.estado,
      v.falla_tipo, v.falla_indice_disparo,
      v.falla_carga_sentido, v.falla_carga_activada_en, v.falla_carga_desactivada_en,
      v.falla_motor_origen, v.falla_motor_indice_disparo, v.falla_motor_duracion_min,
      v.falla_motor_activada_en, v.falla_motor_desactivada_en
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
//
// Feature 016 (FR-008): el viaje de vuelta NO copia la falla de motor del anterior; trae su propio
// sorteo (`fallaMotor`, resultado de sortearFallaMotor o null).
//
// Feature 014 (Historia 3): si el viaje ya no esta 'en_curso' (se detuvo por HTTP mientras este
// ciclo lo procesaba), no crea la vuelta y devuelve null, para no revivir una simulacion detenida.
export async function finalizarYCrearVuelta(pool, viaje, fallaMotor = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const finalizado = await client.query(
      `UPDATE simulador.viaje SET estado = 'finalizado' WHERE id = $1 AND estado = 'en_curso'`,
      [viaje.id],
    );
    if (finalizado.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const nuevoSentido = viaje.sentido === 'ida' ? 'vuelta' : 'ida';
    const { rows } = await client.query(
      `INSERT INTO simulador.viaje
         (camion_id, ruta_id, sentido, indice_actual, odometro_actual_km, estado,
          falla_motor_origen, falla_motor_indice_disparo, falla_motor_duracion_min)
       VALUES ($1, $2, $3, 0, $4, 'en_curso', $5, $6, $7)
       RETURNING id, sentido, indice_actual, odometro_actual_km, estado, falla_tipo, falla_indice_disparo,
                 falla_motor_origen, falla_motor_indice_disparo, falla_motor_duracion_min`,
      [
        viaje.camionId,
        viaje.rutaId,
        nuevoSentido,
        viaje.odometroActualKm,
        fallaMotor?.origen ?? null,
        fallaMotor?.indiceDisparo ?? null,
        fallaMotor?.duracionMin ?? null,
      ],
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
