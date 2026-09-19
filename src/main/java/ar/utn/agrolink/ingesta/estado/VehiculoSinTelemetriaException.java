package ar.utn.agrolink.ingesta.estado;

/**
 * No existe ninguna lectura de telemetria para el identificador de dispositivo pedido
 * (FR-007/FR-008). En el alcance de esta feature no hay una entidad "vehiculo" separada del
 * dispositivo de telemetria (spec, Assumptions): "identificador no encontrado" y
 * "dispositivo sin lecturas" son el mismo caso, y ambos se traducen a 404
 * application/problem+json, nunca a un 200 con campos en null que podria confundirse con una
 * lectura real degradada.
 */
public class VehiculoSinTelemetriaException extends RuntimeException {

    private final String dispositivoId;

    public VehiculoSinTelemetriaException(String dispositivoId, String message) {
        super(message);
        this.dispositivoId = dispositivoId;
    }

    public String getDispositivoId() {
        return dispositivoId;
    }
}
