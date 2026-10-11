// Persiste filas nuevas de simulador.ruta (feature 011-generar-ruta-simulada).
//
// No hace un SELECT previo para chequear el nombre: deja que la restriccion UNIQUE
// (deploy/migrations/005_add_ruta_nombre_unique.sql) sea quien detecte el conflicto en el
// INSERT, y traduce el 23505 unique_violation de Postgres a un resultado explicito en vez
// de propagar el error crudo (research.md D-03, data-model.md §1) - evita la condicion de
// carrera de un SELECT-then-INSERT entre dos generaciones casi simultaneas.
const CODIGO_UNIQUE_VIOLATION = '23505';

export async function insertarRuta(pool, { nombre, puntos, paradas }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO simulador.ruta (nombre, puntos, paradas)
       VALUES ($1, $2::jsonb, $3::jsonb)
       RETURNING id, nombre, puntos, paradas`,
      [nombre, JSON.stringify(puntos), JSON.stringify(paradas)],
    );
    return { ok: true, ruta: rows[0] };
  } catch (err) {
    if (err.code === CODIGO_UNIQUE_VIOLATION) {
      return { ok: false, motivo: 'nombre_duplicado' };
    }
    throw err;
  }
}
