package ar.utn.agrolink.ingesta.estado;

/**
 * Los tres bloques del schema EstadoVehiculo de contracts/agrolink-vehiculo-estado-api.yaml:
 * posicion, canBus y dispositivo, derivados de una unica fila (la de momento_evento mas
 * reciente, FR-002/FR-006).
 */
public record EstadoVehiculoDto(PosicionDto posicion, CanBusDto canBus, DispositivoInfoDto dispositivo) {}
