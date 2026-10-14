package ar.utn.agrolink.ingesta.viajeprogramado;

import java.time.LocalDateTime;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Poller de baja frecuencia (research.md D-01): relee {@code ingesta.viaje_programado} y
 * dispara cada fila PENDIENTE cuyo horario ya llegó. Mismo patrón que el daemon de
 * {@code simulador-viajes} (sin caché en memoria, relectura periódica) — sin introducir un
 * broker de mensajería (Principio III).
 */
@Component
public class ViajeSimuladoScheduler {

    private static final Logger log = LoggerFactory.getLogger(ViajeSimuladoScheduler.class);

    private final ViajeProgramadoService service;
    private final ViajeProgramadoRepository repository;

    public ViajeSimuladoScheduler(ViajeProgramadoService service, ViajeProgramadoRepository repository) {
        this.service = service;
        this.repository = repository;
    }

    @Scheduled(fixedDelayString = "${agrolink.viaje-programado.poll-interval-ms}")
    public void dispararVencidos() {
        List<ViajeProgramado> vencidos = repository.findByEstadoAndEstimatedStartDateTimeLessThanEqual(
                ViajeProgramado.PENDIENTE, LocalDateTime.now());

        for (ViajeProgramado viaje : vencidos) {
            try {
                // dispararAhora ya absorbe y loggea cualquier fallo (FR-004/FR-005): este
                // try/catch es una red adicional ante un error inesperado fuera de ese
                // contrato (p. ej. de persistencia), para que una fila problemática nunca
                // interrumpa el resto del ciclo.
                service.dispararAhora(viaje);
            } catch (RuntimeException ex) {
                log.warn("Fallo inesperado al disparar el viaje programado tripCode={}",
                        viaje.getTripCode(), ex);
            }
        }
    }
}
