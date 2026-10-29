package ar.utn.agrolink.ingesta.viajeprogramado;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * Body de {@code POST /api/v1/vehiculos/{dispositivoId}/viajes-simulados} (FR-002/FR-008,
 * contrato {@code viajes-simulados-http-api.md}). {@code odometroInicialKm} es opcional: el
 * odometro de partida que AgroLinkBackend ancla al iniciar el viaje.
 */
public record ProgramarViajeRequest(
        String tripCode,
        LocalDateTime estimatedStartDateTime,
        PuntoDto origen,
        PuntoDto destino,
        BigDecimal odometroInicialKm) {}
