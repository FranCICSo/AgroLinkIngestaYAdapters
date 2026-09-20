package ar.utn.agrolink.ingesta.report;

import ar.utn.agrolink.ingesta.telemetry.LecturaTelemetria;
import ar.utn.agrolink.ingesta.telemetry.LecturaTelemetriaRepository;
import ar.utn.agrolink.ingesta.telemetry.OrigenOdometro;
import java.time.OffsetDateTime;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/**
 * Calculo de las cinco metricas del reporte de viaje (FR-005), a demanda, sin persistir
 * nada: el reporte es una entidad derivada (spec, Key Entities). Formulas en data-model.md.
 */
@Service
public class ReporteViajeService {

    private final LecturaTelemetriaRepository repository;

    public ReporteViajeService(LecturaTelemetriaRepository repository) {
        this.repository = repository;
    }

    public ReporteViajeDto calcular(String camionId, OffsetDateTime desde, OffsetDateTime hasta) {
        List<LecturaTelemetria> lecturas =
                repository.findByDispositivoIdAndMomentoEventoBetweenOrderByMomentoEventoAsc(
                        camionId, desde.toInstant(), hasta.toInstant());

        if (lecturas.isEmpty()) {
            throw new SinDatosException(
                    camionId,
                    "No hay lecturas de telemetria para el camion '%s' entre %s y %s."
                            .formatted(camionId, desde, hasta));
        }

        List<LecturaTelemetria> conOdometro =
                lecturas.stream().filter(l -> l.getOdometroKm() != null).toList();

        double distanciaKm =
                conOdometro.isEmpty()
                        ? 0.0
                        : conOdometro.get(conOdometro.size() - 1).getOdometroKm() - conOdometro.get(0).getOdometroKm();

        List<LecturaTelemetria> conCombustible =
                lecturas.stream().filter(l -> l.getCombustiblePct() != null).toList();

        Double combustibleConsumidoPct =
                conCombustible.isEmpty()
                        ? null
                        // Puede ser negativo si hubo recarga en el rango: se devuelve tal cual,
                        // sin recortar a cero (fuera de alcance modelar recargas, spec Assumptions).
                        : conCombustible.get(0).getCombustiblePct()
                                - conCombustible.get(conCombustible.size() - 1).getCombustiblePct();

        boolean tasaNoCalculable = distanciaKm == 0.0 || combustibleConsumidoPct == null;
        Double tasaConsumoPromedio = tasaNoCalculable ? null : combustibleConsumidoPct / distanciaKm;

        double velocidadPromedioKmh =
                lecturas.stream()
                        .filter(l -> l.getVelocidadKmh() != null)
                        .mapToDouble(LecturaTelemetria::getVelocidadKmh)
                        .average()
                        .orElse(0.0);

        double velocidadMaximaKmh =
                lecturas.stream()
                        .filter(l -> l.getVelocidadKmh() != null)
                        .mapToDouble(LecturaTelemetria::getVelocidadKmh)
                        .max()
                        .orElse(0.0);

        Set<OrigenOdometro> origenes =
                conOdometro.stream()
                        .map(LecturaTelemetria::getOdometroOrigen)
                        .collect(Collectors.toCollection(() -> EnumSet.noneOf(OrigenOdometro.class)));
        boolean odometroOrigenMixto = origenes.size() > 1;

        return new ReporteViajeDto(
                camionId,
                desde,
                hasta,
                distanciaKm,
                combustibleConsumidoPct,
                tasaConsumoPromedio,
                tasaNoCalculable,
                velocidadPromedioKmh,
                velocidadMaximaKmh,
                lecturas.size(),
                odometroOrigenMixto);
    }
}
