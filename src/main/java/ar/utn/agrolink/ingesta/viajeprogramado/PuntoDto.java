package ar.utn.agrolink.ingesta.viajeprogramado;

import java.math.BigDecimal;

/** Coordenada de origen/destino del contrato {@code viajes-simulados-http-api.md}. */
public record PuntoDto(BigDecimal lat, BigDecimal lon) {}
