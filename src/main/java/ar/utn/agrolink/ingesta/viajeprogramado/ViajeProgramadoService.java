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
        validarCargaRefrigerada(request);

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
        CargaRefrigeradaDto carga = request.cargaRefrigerada();
        viaje.setUmbralesTermicos(
                carga == null ? null : carga.umbralTermicoMinC(),
                carga == null ? null : carga.umbralTermicoMaxC());
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
     * Detencion de la simulacion Rinho de un viaje que se completo o cancelo en AgroLink (feature
     * 014-simulacion-ruta-del-viaje, Historia 3, FR-011 a FR-013, FR-018; contrato 026 §3; tabla
     * de research.md D-03, con las adaptaciones de D-14).
     *
     * <ul>
     *   <li>tripCode desconocido: {@code SIN_SIMULACION_EN_CURSO}, sin tombstone (D-14).</li>
     *   <li>PENDIENTE o CANCELADO: DETENIDO, sin tocar el simulador (el poller ya no la dispara).</li>
     *   <li>DISPARADO vigente: se detiene en simulador-viajes y queda DETENIDO; si el simulador
     *       falla, sigue DISPARADO con {@code ultimoError} y se responde 502.</li>
     *   <li>ERROR: detencion best-effort (un timeout pudo haber arrancado igual); si el simulador
     *       falla, DETENIDO + WARN y {@code SIN_SIMULACION_EN_CURSO}.</li>
     *   <li>DISPARADO o ERROR reemplazada por un arranque posterior del mismo dispositivo: DETENIDO
     *       sin tocar el simulador, que ya simula el viaje nuevo (FR-013).</li>
     *   <li>DETENIDO: nada (idempotente).</li>
     * </ul>
     */
    @Transactional(noRollbackFor = SimuladorNoDisponibleException.class)
    public DetencionResultado detener(String iotDeviceId, String tripCode, String motivo) {
        if (!DispositivosSimuladosConocidos.esSimulado(iotDeviceId)) {
            throw new DispositivoNoSimuladoException(iotDeviceId);
        }
        ViajeProgramado viaje = repository.findByTripCode(tripCode).orElse(null);
        if (viaje == null) {
            log.info("Detencion de un viaje sin simulacion registrada: tripCode={} iotDeviceId={} motivo={}",
                    tripCode, iotDeviceId, motivo);
            return sinSimulacion(tripCode, iotDeviceId);
        }
        if (!viaje.getIotDeviceId().equals(iotDeviceId)) {
            throw new ViajeDeOtroDispositivoException(tripCode, iotDeviceId);
        }
        if (viaje.estaDetenido()) {
            return sinSimulacion(tripCode, iotDeviceId);
        }
        if (!viaje.estaDisparado() && !ViajeProgramado.ERROR.equals(viaje.getEstado())) {
            // PENDIENTE o CANCELADO: nunca arranco.
            detenida(viaje, tripCode, iotDeviceId, motivo, "sin simulacion arrancada");
            return sinSimulacion(tripCode, iotDeviceId);
        }
        if (fueReemplazada(viaje)) {
            detenida(viaje, tripCode, iotDeviceId, motivo, "reemplazada por un viaje mas nuevo");
            return sinSimulacion(tripCode, iotDeviceId);
        }

        SimuladorViajesClient.DetencionSimulador resultado = simuladorViajesClient.detener(iotDeviceId, tripCode, motivo);
        if (resultado.resultado() == SimuladorViajesClient.Detencion.FALLO) {
            if (viaje.estaDisparado()) {
                viaje.registrarFalloDetencion("detencion: " + resultado.detalle());
                repository.save(viaje);
                log.warn("No se pudo detener la simulacion: tripCode={} iotDeviceId={} motivo={} detalle={}",
                        tripCode, iotDeviceId, motivo, resultado.detalle());
                throw new SimuladorNoDisponibleException(tripCode, resultado.detalle());
            }
            log.warn("Detencion best-effort de un viaje en ERROR sin respuesta del simulador: tripCode={} iotDeviceId={} detalle={}",
                    tripCode, iotDeviceId, resultado.detalle());
            detenida(viaje, tripCode, iotDeviceId, motivo, "ERROR, simulador sin respuesta");
            return sinSimulacion(tripCode, iotDeviceId);
        }
        String efecto = resultado.resultado() == SimuladorViajesClient.Detencion.DETENIDA
                ? DetencionResultado.DETENIDA
                : DetencionResultado.SIN_SIMULACION_EN_CURSO;
        detenida(viaje, tripCode, iotDeviceId, motivo, efecto);
        return DetencionResultado.de(tripCode, iotDeviceId, efecto);
    }

    /**
     * El simulador conoce el camion, no el tripCode: si el mismo dispositivo arranco otra simulacion
     * despues que esta, detener "el camion" frenaria la nueva. {@code actualizadoEn} de una fila
     * DISPARADO es el momento del arranque.
     */
    private boolean fueReemplazada(ViajeProgramado viaje) {
        return repository.existsByIotDeviceIdAndEstadoAndActualizadoEnAfter(
                viaje.getIotDeviceId(), ViajeProgramado.DISPARADO, viaje.getActualizadoEn());
    }

    private void detenida(ViajeProgramado viaje, String tripCode, String iotDeviceId, String motivo, String detalle) {
        viaje.marcarDetenido();
        repository.save(viaje);
        log.info("Simulacion detenida: tripCode={} iotDeviceId={} motivo={} resultado={}",
                tripCode, iotDeviceId, motivo, detalle);
    }

    private static DetencionResultado sinSimulacion(String tripCode, String iotDeviceId) {
        return DetencionResultado.de(tripCode, iotDeviceId, DetencionResultado.SIN_SIMULACION_EN_CURSO);
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

    private void validarCargaRefrigerada(ProgramarViajeRequest request) {
        CargaRefrigeradaDto carga = request.cargaRefrigerada();
        if (carga == null) {
            return;
        }
        if (carga.umbralTermicoMinC() == null || carga.umbralTermicoMaxC() == null) {
            throw new CargaRefrigeradaInvalidaException(request.tripCode(), "faltan umbralTermicoMinC y/o umbralTermicoMaxC");
        }
        if (carga.umbralTermicoMinC().compareTo(carga.umbralTermicoMaxC()) > 0) {
            throw new CargaRefrigeradaInvalidaException(request.tripCode(), "umbralTermicoMinC es mayor que umbralTermicoMaxC");
        }
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
