package ar.utn.agrolink.ingesta.viajeprogramado;

import java.time.LocalDateTime;

/**
 * Body de {@code POST /api/v1/vehiculos/{dispositivoId}/viajes-simulados} (FR-002/FR-008,
 * contrato {@code viajes-simulados-http-api.md}).
 */
public record ProgramarViajeRequest(
        String tripCode, LocalDateTime estimatedStartDateTime, PuntoDto origen, PuntoDto destino) {}
