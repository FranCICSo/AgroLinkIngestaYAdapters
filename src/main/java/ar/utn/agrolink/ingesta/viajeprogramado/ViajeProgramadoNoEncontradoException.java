package ar.utn.agrolink.ingesta.viajeprogramado;

/** No existe ninguna fila de {@code ingesta.viaje_programado} con el {@code tripCode} pedido. */
public class ViajeProgramadoNoEncontradoException extends RuntimeException {

    public ViajeProgramadoNoEncontradoException(String tripCode) {
        super("No existe un viaje programado con tripCode " + tripCode);
    }
}
