package ar.utn.agrolink.ingesta.samsara;

import java.time.Instant;
import java.util.List;

/**
 * Campos de consulta extraidos de una notificacion webhook de Samsara (data-model.md §1). Todo
 * es opcional salvo {@code payloadJson}: el endpoint guarda cualquier JSON legible, aunque le
 * falten datos (spec FR-002); {@code camposFaltantes} solo se usa para dejar rastro en el log
 * (Principio IX).
 */
public record EventoSamsaraExtraido(
        String eventId,
        String tipoEvento,
        Instant momentoEvento,
        String samsaraVehiculoId,
        String patente,
        Instant inicioExceso,
        Instant finExceso,
        Instant inicioViaje,
        String payloadJson,
        List<String> camposFaltantes) {
}
