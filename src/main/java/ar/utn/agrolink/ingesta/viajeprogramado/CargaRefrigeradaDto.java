package ar.utn.agrolink.ingesta.viajeprogramado;

import java.math.BigDecimal;

/**
 * Carga refrigerada del viaje (contrato {@code viajes-simulados-http-api.md}): los umbrales
 * termicos (°C) que AgroLinkBackend fija en el viaje. Ausente en el request = carga no
 * refrigerada. Con ella el camion simulado emite el segmento BLE de temperatura.
 */
public record CargaRefrigeradaDto(BigDecimal umbralTermicoMinC, BigDecimal umbralTermicoMaxC) {}
