package ar.utn.agrolink.ingesta.report;

/**
 * No existe ninguna lectura para el camion en el rango pedido (FR-006). Se traduce a 404
 * application/problem+json, nunca a un 200 con metricas en cero: un reporte todo en cero
 * seria indistinguible de un camion detenido todo el rango (decision D-13).
 */
public class SinDatosException extends RuntimeException {

    private final String camionId;

    public SinDatosException(String camionId, String message) {
        super(message);
        this.camionId = camionId;
    }

    public String getCamionId() {
        return camionId;
    }
}
