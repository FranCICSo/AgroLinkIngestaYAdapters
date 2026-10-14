package ar.utn.agrolink.ingesta.viajeprogramado;

/**
 * El {@code iotDeviceId} del path no esta en la lista cerrada de dispositivos simulados
 * (FR-001/FR-003) — ni siquiera se persiste una planificacion para el.
 */
public class DispositivoNoSimuladoException extends RuntimeException {

    private final String dispositivoId;

    public DispositivoNoSimuladoException(String dispositivoId) {
        super("El dispositivo " + dispositivoId + " no esta en la lista cerrada de dispositivos simulados");
        this.dispositivoId = dispositivoId;
    }

    public String getDispositivoId() {
        return dispositivoId;
    }
}
