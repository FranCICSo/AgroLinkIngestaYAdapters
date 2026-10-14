package ar.utn.agrolink.ingesta.viajeprogramado;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * A diferencia de {@code LecturaTelemetriaRepository} (solo-lectura, Principio IV), este
 * repositorio es mutable: extiende {@code JpaRepository} porque {@code ViajeProgramado} no
 * tiene ninguna restriccion de inmutabilidad (data-model.md).
 */
public interface ViajeProgramadoRepository extends JpaRepository<ViajeProgramado, Long> {

    Optional<ViajeProgramado> findByTripCode(String tripCode);

    // Scoped por dispositivo (no solo por tripCode): evita que el {dispositivoId} del path
    // reprograme/cancele el viaje de otro dispositivo con el mismo tripCode (IDOR).
    Optional<ViajeProgramado> findByTripCodeAndIotDeviceId(String tripCode, String iotDeviceId);

    // Consulta principal del poller (ViajeSimuladoScheduler): filas pendientes cuyo horario
    // ya llego. Reutiliza el indice parcial viaje_programado_pendiente_idx.
    List<ViajeProgramado> findByEstadoAndEstimatedStartDateTimeLessThanEqual(
            String estado, LocalDateTime hasta);
}
