package ar.utn.agrolink.ingesta.samsara;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Acceso a {@code telemetria.evento_samsara} (data-model.md §1). Solo inserta y consulta: no
 * existe ningun metodo de UPDATE/DELETE, y el rol agrolink_ingesta tampoco tiene esos permisos
 * sobre la tabla (Principio IV). JDBC directo en vez de JPA porque el insert necesita
 * {@code ON CONFLICT ... DO NOTHING RETURNING id} sobre un indice unico parcial (research.md D-03).
 */
@Repository
public class EventoSamsaraRepository {

    private static final String INSERT_SQL = """
            INSERT INTO telemetria.evento_samsara
                (momento_evento, event_id, tipo_evento, samsara_vehiculo_id, patente,
                 inicio_exceso, fin_exceso, inicio_viaje, payload_crudo)
            VALUES (COALESCE(?, now()), ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
            ON CONFLICT (event_id, momento_evento) WHERE event_id IS NOT NULL DO NOTHING
            RETURNING id
            """;

    // Margen de commit (research.md D-04): una fila con id menor cuya transaccion siguiera abierta
    // nunca queda detras del cursor del llamador.
    private static final String CONSULTA_SQL = """
            SELECT id, event_id, tipo_evento, momento_evento, momento_recepcion, samsara_vehiculo_id,
                   patente, inicio_exceso, fin_exceso, inicio_viaje, payload_crudo::text AS payload
            FROM telemetria.evento_samsara
            WHERE id > ? AND momento_recepcion <= now() - make_interval(secs => ?)
            ORDER BY id
            LIMIT ?
            """;

    private final JdbcTemplate jdbcTemplate;
    private final double margenCommitSegundos;

    public EventoSamsaraRepository(
            JdbcTemplate jdbcTemplate,
            @Value("${agrolink.samsara.margen-commit-ms:2000}") long margenCommitMs) {
        this.jdbcTemplate = jdbcTemplate;
        this.margenCommitSegundos = margenCommitMs / 1000.0;
    }

    /** @return el id asignado, o vacio si ya existia una fila con el mismo eventId + momento_evento. */
    public Optional<Long> insertar(EventoSamsaraExtraido evento) {
        List<Long> ids = jdbcTemplate.queryForList(INSERT_SQL, Long.class,
                utc(evento.momentoEvento()),
                evento.eventId(),
                evento.tipoEvento(),
                evento.samsaraVehiculoId(),
                evento.patente(),
                utc(evento.inicioExceso()),
                utc(evento.finExceso()),
                utc(evento.inicioViaje()),
                evento.payloadJson());
        return ids.stream().findFirst();
    }

    public List<EventoSamsaraGuardado> buscarPosterioresA(long despuesDe, int limite) {
        return jdbcTemplate.query(CONSULTA_SQL, (rs, n) -> new EventoSamsaraGuardado(
                        rs.getLong("id"),
                        rs.getString("event_id"),
                        rs.getString("tipo_evento"),
                        instante(rs.getObject("momento_evento", OffsetDateTime.class)),
                        instante(rs.getObject("momento_recepcion", OffsetDateTime.class)),
                        rs.getString("samsara_vehiculo_id"),
                        rs.getString("patente"),
                        instante(rs.getObject("inicio_exceso", OffsetDateTime.class)),
                        instante(rs.getObject("fin_exceso", OffsetDateTime.class)),
                        instante(rs.getObject("inicio_viaje", OffsetDateTime.class)),
                        rs.getString("payload")),
                despuesDe, margenCommitSegundos, limite);
    }

    private static OffsetDateTime utc(Instant instante) {
        return instante == null ? null : instante.atOffset(ZoneOffset.UTC);
    }

    private static Instant instante(OffsetDateTime valor) {
        return valor == null ? null : valor.toInstant();
    }
}
