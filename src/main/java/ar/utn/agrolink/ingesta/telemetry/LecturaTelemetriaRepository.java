package ar.utn.agrolink.ingesta.telemetry;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * Extiende el marcador {@link Repository}, NO {@code JpaRepository} ni {@code CrudRepository}:
 * esos exponen save()/delete() por defecto. Este repositorio solo declara las consultas que
 * necesita (Principio IV expresado tambien en el ORM).
 */
public interface LecturaTelemetriaRepository extends Repository<LecturaTelemetria, Long> {

    List<LecturaTelemetria> findByDispositivoIdAndMomentoEventoBetweenOrderByMomentoEventoAsc(
            String dispositivoId, Instant desde, Instant hasta);

    // Reutiliza el indice lectura_camion_tiempo_idx (dispositivo_id, momento_evento DESC) de
    // la feature 001: sin migraciones nuevas (data-model.md, feature 002).
    Optional<LecturaTelemetria> findFirstByDispositivoIdOrderByMomentoEventoDesc(String dispositivoId);

    // Ultimo valor no nulo por campo CAN arrastrable dentro de [desde, hasta], con el
    // momento_evento de la lectura de la que sale cada uno. Usa last() de TimescaleDB con
    // FILTER para resolver todos los campos en una sola pasada sobre el mismo indice
    // (dispositivo_id, momento_evento DESC). Un agregado sin GROUP BY siempre devuelve una
    // fila: si ninguna lectura de la ventana trae un campo, ese campo y su momento son NULL.
    // Los alias van entre comillas para que Postgres conserve el camelCase de la proyeccion.
    // last() va calificado con public: la extension timescaledb esta instalada en public, y la
    // conexion de la app fija currentSchema=telemetria, que saca public del search_path.
    @Query(
            nativeQuery = true,
            value =
                    """
                    SELECT
                        public.last(combustible_pct, momento_evento)
                            FILTER (WHERE combustible_pct IS NOT NULL)           AS "combustiblePct",
                        max(momento_evento)
                            FILTER (WHERE combustible_pct IS NOT NULL)           AS "combustiblePctMomento",
                        public.last(combustible_consumido_l, momento_evento)
                            FILTER (WHERE combustible_consumido_l IS NOT NULL)   AS "combustibleConsumidoL",
                        max(momento_evento)
                            FILTER (WHERE combustible_consumido_l IS NOT NULL)   AS "combustibleConsumidoLMomento",
                        public.last(odometro_km, momento_evento)
                            FILTER (WHERE odometro_km IS NOT NULL)               AS "odometroKm",
                        public.last(odometro_origen, momento_evento)
                            FILTER (WHERE odometro_km IS NOT NULL)               AS "odometroOrigen",
                        max(momento_evento)
                            FILTER (WHERE odometro_km IS NOT NULL)               AS "odometroMomento",
                        public.last(vin, momento_evento)
                            FILTER (WHERE vin IS NOT NULL)                       AS "vin",
                        max(momento_evento)
                            FILTER (WHERE vin IS NOT NULL)                       AS "vinMomento",
                        public.last(rpm, momento_evento)
                            FILTER (WHERE rpm IS NOT NULL)                       AS "rpm",
                        max(momento_evento)
                            FILTER (WHERE rpm IS NOT NULL)                       AS "rpmMomento",
                        public.last(temperatura_refrigerante_c, momento_evento)
                            FILTER (WHERE temperatura_refrigerante_c IS NOT NULL) AS "temperaturaRefrigeranteC",
                        max(momento_evento)
                            FILTER (WHERE temperatura_refrigerante_c IS NOT NULL) AS "temperaturaRefrigeranteCMomento"
                    FROM telemetria.lectura_telemetria
                    WHERE dispositivo_id = :dispositivoId
                      AND momento_evento >= :desde
                      AND momento_evento <= :hasta
                    """)
    UltimosValoresCan findUltimosValoresCanNoNulos(
            @Param("dispositivoId") String dispositivoId,
            @Param("desde") Instant desde,
            @Param("hasta") Instant hasta);
}
