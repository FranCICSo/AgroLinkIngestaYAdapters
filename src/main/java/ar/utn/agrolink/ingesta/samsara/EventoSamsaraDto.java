package ar.utn.agrolink.ingesta.samsara;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;

/** Cuerpos de respuesta de contracts/samsara-webhook-http.md y samsara-eventos-consulta-http.md. */
public final class EventoSamsaraDto {

    private EventoSamsaraDto() {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record RecepcionResponse(String estado, Long id) {

        public static RecepcionResponse guardado(long id) {
            return new RecepcionResponse("GUARDADO", id);
        }

        public static RecepcionResponse duplicado() {
            return new RecepcionResponse("DUPLICADO", null);
        }
    }

    public record EventoResponse(
            long posicion,
            String eventId,
            String tipoEvento,
            Instant momentoEvento,
            Instant momentoRecepcion,
            String samsaraVehiculoId,
            String patente,
            Instant inicioExceso,
            Instant finExceso,
            Instant inicioViaje,
            JsonNode payloadCrudo) {
    }

    public record ConsultaResponse(List<EventoResponse> eventos, long ultimaPosicion, boolean hayMas) {
    }

    public record ErrorResponse(String error, String detalle) {
    }
}
