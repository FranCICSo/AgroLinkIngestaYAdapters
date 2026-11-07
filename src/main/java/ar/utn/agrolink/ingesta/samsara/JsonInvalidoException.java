package ar.utn.agrolink.ingesta.samsara;

/** El cuerpo del webhook no es JSON legible: unico rechazo del endpoint (contracts/samsara-webhook-http.md). */
public class JsonInvalidoException extends RuntimeException {

    public JsonInvalidoException(String detalle) {
        super(detalle);
    }
}
