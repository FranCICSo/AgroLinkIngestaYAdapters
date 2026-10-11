package ar.utn.agrolink.ingesta.viajeprogramado;

import java.time.LocalDateTime;

/**
 * Body de {@code PUT .../viajes-simulados/{tripCode}} (FR-009, contrato
 * {@code viajes-simulados-http-api.md}).
 */
public record ReprogramarViajeRequest(LocalDateTime estimatedStartDateTime) {}
