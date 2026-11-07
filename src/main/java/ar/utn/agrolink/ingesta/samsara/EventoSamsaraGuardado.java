package ar.utn.agrolink.ingesta.samsara;

import java.time.Instant;

/** Fila de {@code telemetria.evento_samsara} tal como se guardo. */
public record EventoSamsaraGuardado(
        long id,
        String eventId,
        String tipoEvento,
        Instant momentoEvento,
        Instant momentoRecepcion,
        String samsaraVehiculoId,
        String patente,
        Instant inicioExceso,
        Instant finExceso,
        Instant inicioViaje,
        String payloadJson) {
}
