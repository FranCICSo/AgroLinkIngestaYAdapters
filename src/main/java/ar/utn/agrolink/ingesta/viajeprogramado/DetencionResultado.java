package ar.utn.agrolink.ingesta.viajeprogramado;

/**
 * Respuesta {@code 200} del aviso de detencion (contrato 026 §3.2):
 * {@code { tripCode, dispositivoId, estado: "DETENIDO", efecto }}.
 */
public record DetencionResultado(String tripCode, String dispositivoId, String estado, String efecto) {

    public static final String DETENIDA = "DETENIDA";
    public static final String SIN_SIMULACION_EN_CURSO = "SIN_SIMULACION_EN_CURSO";

    static DetencionResultado de(String tripCode, String dispositivoId, String efecto) {
        return new DetencionResultado(tripCode, dispositivoId, ViajeProgramado.DETENIDO, efecto);
    }
}
