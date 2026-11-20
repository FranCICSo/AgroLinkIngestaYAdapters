package ar.utn.agrolink.ingesta.viajeprogramado;

/**
 * Detencion con un {@code tripCode} que pertenece a otro dispositivo (feature 014, FR-013;
 * contrato 026 §3.2 {@code 409 viaje_de_otro_dispositivo}): la simulacion del otro dispositivo no
 * se toca.
 */
public class ViajeDeOtroDispositivoException extends RuntimeException {

    public ViajeDeOtroDispositivoException(String tripCode, String dispositivoId) {
        super("El viaje " + tripCode + " no pertenece al dispositivo " + dispositivoId);
    }
}
