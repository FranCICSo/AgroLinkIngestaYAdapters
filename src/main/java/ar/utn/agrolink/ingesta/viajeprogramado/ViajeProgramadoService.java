package ar.utn.agrolink.ingesta.viajeprogramado;

import java.time.LocalDateTime;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Alta/reprogramación/cancelación de una planificación de simulación (spec
 * 013-autostart-simulacion-viaje, FR-002/FR-002a/FR-008/FR-009/FR-010). El disparo "vencido"
 * periódico lo hace {@link ViajeSimuladoScheduler}, reusando {@link #dispararAhora} para no
 * duplicar la lógica de éxito/fallo entre el camino inmediato (alta con horario ya pasado) y
 * el camino del poller.
 */
@Service
public class ViajeProgramadoService {

    private static final Logger log = LoggerFactory.getLogger(ViajeProgramadoService.class);

    private final ViajeProgramadoRepository repository;
    private final SimuladorViajesClient simuladorViajesClient;

    public ViajeProgramadoService(ViajeProgramadoRepository repository, SimuladorViajesClient simuladorViajesClient) {
        this.repository = repository;
        this.simuladorViajesClient = simuladorViajesClient;
    }

    @Transactional
    public ViajeProgramadoDto programar(String iotDeviceId, ProgramarViajeRequest request) {
        if (!DispositivosSimuladosConocidos.esSimulado(iotDeviceId)) {
            throw new DispositivoNoSimuladoException(iotDeviceId);
        }
        if (!tieneCoordenadas(request)) {
            // Edge case (spec.md): sin recorrido geocodificado no hay nada que simular. Se
            // rechaza explicito en 400 en vez de dejar que la falta de origen/destino termine
            // en un NullPointerException mas abajo.
            throw new CoordenadasNoDisponiblesException(request.tripCode());
        }

        ViajeProgramado viajeDeOtroDispositivo = repository.findByTripCode(request.tripCode())
                .filter(v -> !v.getIotDeviceId().equals(iotDeviceId))
                .orElse(null);
        if (viajeDeOtroDispositivo != null) {
            // Mismo tripCode, pero asociado a otro dispositivo: nunca se reasigna por una
            // llamada con un {dispositivoId} distinto (IDOR) — mismo tratamiento que si no
            // existiera para este dispositivo.
            throw new ViajeNoModificableException(request.tripCode(), viajeDeOtroDispositivo.getEstado());
        }

        ViajeProgramado viaje = repository.findByTripCodeAndIotDeviceId(request.tripCode(), iotDeviceId).orElse(null);
        if (viaje != null && !viaje.estaPendiente()) {
            throw new ViajeNoModificableException(request.tripCode(), viaje.getEstado());
        }

        if (viaje == null) {
            viaje = new ViajeProgramado(
                    request.tripCode(),
                    iotDeviceId,
                    request.estimatedStartDateTime(),
                    request.origen().lat(),
                    request.origen().lon(),
                    request.destino().lat(),
                    request.destino().lon(),
                    nombreRuta(request.tripCode()));
        } else {
            viaje.setEstimatedStartDateTime(request.estimatedStartDateTime());
        }
        viaje.setOdometroInicialKm(request.odometroInicialKm());
        viaje = repository.save(viaje);

        // FR-002a: si el horario ya paso (o es inmediato), dispara de una en vez de esperar
        // al proximo ciclo del poller.
        if (!viaje.getEstimatedStartDateTime().isAfter(LocalDateTime.now())) {
            viaje = dispararAhora(viaje);
        }
        return ViajeProgramadoDto.fromEntity(viaje);
    }

    @Transactional
    public ViajeProgramadoDto reprogramar(String iotDeviceId, String tripCode, ReprogramarViajeRequest request) {
        ViajeProgramado viaje = buscarPorDispositivoYTripCode(iotDeviceId, tripCode);
        if (!viaje.estaPendiente()) {
            throw new ViajeNoModificableException(tripCode, viaje.getEstado());
        }
        viaje.setEstimatedStartDateTime(request.estimatedStartDateTime());
        viaje = repository.save(viaje);
        return ViajeProgramadoDto.fromEntity(viaje);
    }

    @Transactional
    public void cancelar(String iotDeviceId, String tripCode) {
        ViajeProgramado viaje = buscarPorDispositivoYTripCode(iotDeviceId, tripCode);
        if (!viaje.estaPendiente()) {
            throw new ViajeNoModificableException(tripCode, viaje.getEstado());
        }
        viaje.marcarCancelado();
        repository.save(viaje);
    }

    /**
     * Scopea SIEMPRE la búsqueda por {@code iotDeviceId} además de {@code tripCode}: un
     * {dispositivoId} del path que no coincide con el dueño real del viaje nunca debe poder
     * reprogramarlo/cancelarlo (IDOR) — se trata igual que "no existe".
     */
    private ViajeProgramado buscarPorDispositivoYTripCode(String iotDeviceId, String tripCode) {
        return repository.findByTripCodeAndIotDeviceId(tripCode, iotDeviceId)
                .orElseThrow(() -> new ViajeProgramadoNoEncontradoException(tripCode));
    }

    /**
     * Dispara una fila PENDIENTE vencida (del alta inmediata o del poller). Nunca propaga una
     * excepción del lado de {@code simuladorViajesClient}: FR-004/FR-005 exigen registrar el
     * fallo (loggearlo + marcar ERROR con el detalle) sin romper al llamador.
     */
    ViajeProgramado dispararAhora(ViajeProgramado viaje) {
        SimulacionResultado resultado = simuladorViajesClient.arrancarViaje(viaje);
        if (resultado.exito()) {
            viaje.marcarDisparado();
            log.info("Simulacion del viaje programado arrancada: tripCode={} iotDeviceId={}",
                    viaje.getTripCode(), viaje.getIotDeviceId());
        } else {
            viaje.marcarError(resultado.detalleError());
            log.warn(
                    "No se pudo arrancar la simulacion del viaje programado: tripCode={} iotDeviceId={} detalle={}",
                    viaje.getTripCode(), viaje.getIotDeviceId(), resultado.detalleError());
        }
        return repository.save(viaje);
    }

    private String nombreRuta(String tripCode) {
        return "Viaje " + tripCode;
    }

    private boolean tieneCoordenadas(ProgramarViajeRequest request) {
        return request.origen() != null
                && request.destino() != null
                && request.origen().lat() != null
                && request.origen().lon() != null
                && request.destino().lat() != null
                && request.destino().lon() != null;
    }
}
