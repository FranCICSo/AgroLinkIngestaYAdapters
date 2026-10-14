package ar.utn.agrolink.ingesta.viajeprogramado;

/**
 * Resultado tipado de {@link SimuladorViajesClient#arrancarViaje}: nunca una excepcion
 * propagada (FR-004) — exito o fallo con el detalle para loggear/diagnosticar (FR-005).
 */
public record SimulacionResultado(boolean exito, String detalleError) {

    public static SimulacionResultado ok() {
        return new SimulacionResultado(true, null);
    }

    public static SimulacionResultado fallo(String detalleError) {
        return new SimulacionResultado(false, detalleError);
    }
}
