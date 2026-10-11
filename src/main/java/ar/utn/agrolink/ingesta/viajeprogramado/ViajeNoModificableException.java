package ar.utn.agrolink.ingesta.viajeprogramado;

/**
 * La fila ya no esta {@code PENDIENTE} (ya se disparo, se cancelo, o quedo en error) —
 * reprogramar o cancelar un viaje en ese estado queda fuera de alcance (FR-009/FR-010, spec
 * Assumptions).
 */
public class ViajeNoModificableException extends RuntimeException {

    private final String estadoActual;

    public ViajeNoModificableException(String tripCode, String estadoActual) {
        super("El viaje " + tripCode + " ya no esta PENDIENTE (estado actual: " + estadoActual + ")");
        this.estadoActual = estadoActual;
    }

    public String getEstadoActual() {
        return estadoActual;
    }
}
