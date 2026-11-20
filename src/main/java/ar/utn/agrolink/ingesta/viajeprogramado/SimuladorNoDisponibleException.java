package ar.utn.agrolink.ingesta.viajeprogramado;

/**
 * Habia una simulacion en curso pero {@code simulador-viajes} no pudo detenerla (feature 014,
 * FR-018; contrato 026 §3.2 {@code 502 simulador_no_disponible}). La fila sigue DISPARADO con el
 * detalle en {@code ultimoError}; AgroLinkBackend no reintenta solo.
 */
public class SimuladorNoDisponibleException extends RuntimeException {

    public SimuladorNoDisponibleException(String tripCode, String detalle) {
        super("No se pudo detener la simulacion del viaje " + tripCode + ": " + detalle);
    }
}
