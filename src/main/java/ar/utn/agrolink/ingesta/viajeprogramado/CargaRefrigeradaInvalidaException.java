package ar.utn.agrolink.ingesta.viajeprogramado;

/**
 * El request informo {@code cargaRefrigerada} sin alguno de los dos umbrales o con el minimo
 * por encima del maximo: sin un rango valido no hay setpoint que simular. 400 explicito.
 */
public class CargaRefrigeradaInvalidaException extends RuntimeException {

    public CargaRefrigeradaInvalidaException(String tripCode, String detalle) {
        super("Carga refrigerada invalida en el viaje " + tripCode + ": " + detalle);
    }
}
