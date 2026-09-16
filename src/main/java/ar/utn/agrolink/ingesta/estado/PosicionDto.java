package ar.utn.agrolink.ingesta.estado;

/**
 * Bloque de posicion del contrato EstadoVehiculo (spec, Key Entities). Todos los campos son
 * nulos cuando la lectura mas reciente no tenia fix GPS (spec, Edge Cases).
 */
public record PosicionDto(Double latitud, Double longitud, Double velocidadKmh, Integer rumboGrados) {}
