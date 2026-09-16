package ar.utn.agrolink.ingesta.report;

import java.time.OffsetDateTime;

/**
 * Los 11 campos del schema ReporteViaje de contracts/agrolink-reportes-api.yaml.
 */
public record ReporteViajeDto(
        String camionId,
        OffsetDateTime desde,
        OffsetDateTime hasta,
        double distanciaKm,
        Double combustibleConsumidoPct,
        Double tasaConsumoPromedio,
        boolean tasaConsumoPromedioNoCalculable,
        double velocidadPromedioKmh,
        double velocidadMaximaKmh,
        int lecturasConsideradas,
        boolean odometroOrigenMixto) {}
