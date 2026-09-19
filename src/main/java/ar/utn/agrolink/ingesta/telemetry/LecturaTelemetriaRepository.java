package ar.utn.agrolink.ingesta.telemetry;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.repository.Repository;

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
}
