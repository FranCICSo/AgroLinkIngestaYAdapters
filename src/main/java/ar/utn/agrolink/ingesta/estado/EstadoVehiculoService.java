package ar.utn.agrolink.ingesta.estado;

import ar.utn.agrolink.ingesta.telemetry.LecturaTelemetria;
import ar.utn.agrolink.ingesta.telemetry.LecturaTelemetriaRepository;
import ar.utn.agrolink.ingesta.telemetry.OrigenOdometro;
import ar.utn.agrolink.ingesta.telemetry.UltimosValoresCan;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;

/**
 * Busca la lectura de telemetria con momento_evento mas reciente para un identificador de
 * dispositivo (FR-002, FR-006) y la mapea a los tres bloques de EstadoVehiculoDto (spec, Key
 * Entities). No persiste nada: como el reporte de viaje, es una entidad derivada a demanda.
 *
 * Posicion, dispositivo y el resto de los campos CAN salen siempre de esa ultima lectura. Los
 * campos CAN arrastrables (combustible %, combustible consumido, odometro, VIN, rpm y
 * temperatura de refrigerante) se completan con su ultimo valor no nulo dentro de {@link #VENTANA_ULTIMO_VALOR_CAN} hacia atras
 * desde la ultima lectura, porque muchas tramas llegan sin datos CAN. La ventana se ancla a la
 * ultima lectura y no a "ahora": un vehiculo sin reportar hace dias sigue mostrando los valores
 * de su ultima jornada, y el {@code *Momento} de cada campo deja ver su antiguedad.
 */
@Service
public class EstadoVehiculoService {

    static final Duration VENTANA_ULTIMO_VALOR_CAN = Duration.ofHours(24);

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

        Instant hasta = lectura.getMomentoEvento();
        UltimosValoresCan ultimos =
                repository.findUltimosValoresCanNoNulos(
                        dispositivoId, hasta.minus(VENTANA_ULTIMO_VALOR_CAN), hasta);

        return new EstadoVehiculoDto(
                mapearPosicion(lectura), mapearCanBus(lectura, ultimos), mapearDispositivo(lectura));
    }

    private PosicionDto mapearPosicion(LecturaTelemetria lectura) {
        return new PosicionDto(
                lectura.getLatitud(), lectura.getLongitud(), lectura.getVelocidadKmh(), lectura.getRumboGrados());
    }

    private CanBusDto mapearCanBus(LecturaTelemetria lectura, UltimosValoresCan ultimos) {
        Integer velocidadRuedaKmh = DatosCanCrudoReader.leerEntero(lectura.getDatosCan(), "3");
        // La consulta agregada siempre devuelve una fila; el null solo cubre un repositorio que
        // no la devuelva (p.ej. un mock sin stub): en ese caso los campos quedan sin informar.
        Optional<UltimosValoresCan> u = Optional.ofNullable(ultimos);
        return new CanBusDto(
                u.map(UltimosValoresCan::getVin).orElse(null),
                utc(u.map(UltimosValoresCan::getVinMomento).orElse(null)),
                u.map(UltimosValoresCan::getRpm).orElse(null),
                utc(u.map(UltimosValoresCan::getRpmMomento).orElse(null)),
                velocidadRuedaKmh,
                u.map(UltimosValoresCan::getOdometroKm).orElse(null),
                u.map(UltimosValoresCan::getOdometroOrigen).map(OrigenOdometro::valueOf).orElse(null),
                utc(u.map(UltimosValoresCan::getOdometroMomento).orElse(null)),
                u.map(UltimosValoresCan::getCombustibleConsumidoL).orElse(null),
                utc(u.map(UltimosValoresCan::getCombustibleConsumidoLMomento).orElse(null)),
                u.map(UltimosValoresCan::getCombustiblePct).orElse(null),
                utc(u.map(UltimosValoresCan::getCombustiblePctMomento).orElse(null)),
                u.map(UltimosValoresCan::getTemperaturaRefrigeranteC).orElse(null),
                utc(u.map(UltimosValoresCan::getTemperaturaRefrigeranteCMomento).orElse(null)),
                lectura.getPresionAceiteKpa(),
                lectura.getTensionBateriaV(),
                lectura.getBleTemperaturaC());
    }

    private DispositivoInfoDto mapearDispositivo(LecturaTelemetria lectura) {
        return new DispositivoInfoDto(
                lectura.getDispositivoId(),
                utc(lectura.getMomentoEvento()),
                utc(lectura.getMomentoRecepcion()),
                lectura.getIgnicion(),
                lectura.getSatelites(),
                lectura.getEstadoInterpretacion(),
                Optional.ofNullable(lectura.getCamposFaltantes()).orElse(List.of()));
    }

    private static OffsetDateTime utc(Instant instant) {
        return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
    }
}
