package ar.utn.agrolink.ingesta.estado;

import ar.utn.agrolink.ingesta.telemetry.LecturaTelemetria;
import ar.utn.agrolink.ingesta.telemetry.LecturaTelemetriaRepository;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;

/**
 * Busca la lectura de telemetria con momento_evento mas reciente para un identificador de
 * dispositivo (FR-002, FR-006) y la mapea a los tres bloques de EstadoVehiculoDto (spec, Key
 * Entities). No persiste nada: como el reporte de viaje, es una entidad derivada a demanda.
 */
@Service
public class EstadoVehiculoService {

    private final LecturaTelemetriaRepository repository;

    public EstadoVehiculoService(LecturaTelemetriaRepository repository) {
        this.repository = repository;
    }

    public EstadoVehiculoDto obtenerEstado(String dispositivoId) {
        LecturaTelemetria lectura =
                repository
                        .findFirstByDispositivoIdOrderByMomentoEventoDesc(dispositivoId)
                        .orElseThrow(
                                () ->
                                        new VehiculoSinTelemetriaException(
                                                dispositivoId,
                                                "No hay lecturas de telemetria para el dispositivo '%s'."
                                                        .formatted(dispositivoId)));

        return new EstadoVehiculoDto(mapearPosicion(lectura), mapearCanBus(lectura), mapearDispositivo(lectura));
    }

    private PosicionDto mapearPosicion(LecturaTelemetria lectura) {
        return new PosicionDto(
                lectura.getLatitud(), lectura.getLongitud(), lectura.getVelocidadKmh(), lectura.getRumboGrados());
    }

    private CanBusDto mapearCanBus(LecturaTelemetria lectura) {
        Integer velocidadRuedaKmh = DatosCanCrudoReader.leerEntero(lectura.getDatosCan(), "3");
        return new CanBusDto(
                lectura.getVin(),
                lectura.getRpm(),
                velocidadRuedaKmh,
                lectura.getOdometroKm(),
                lectura.getOdometroOrigen(),
                lectura.getCombustibleConsumidoL(),
                lectura.getCombustiblePct(),
                lectura.getTemperaturaRefrigeranteC(),
                lectura.getPresionAceiteKpa(),
                lectura.getTensionBateriaV());
    }

    private DispositivoInfoDto mapearDispositivo(LecturaTelemetria lectura) {
        return new DispositivoInfoDto(
                lectura.getDispositivoId(),
                lectura.getMomentoEvento().atOffset(ZoneOffset.UTC),
                lectura.getMomentoRecepcion().atOffset(ZoneOffset.UTC),
                lectura.getIgnicion(),
                lectura.getSatelites(),
                lectura.getEstadoInterpretacion(),
                Optional.ofNullable(lectura.getCamposFaltantes()).orElse(List.of()));
    }
}
