package ar.utn.agrolink.ingesta.samsara;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Extrae los campos de consulta de una notificacion SevereSpeedingStarted/Ended (sobre
 * documentado por Samsara, research.md D-01). No interpreta el evento ni lo valida: un campo
 * ausente, de otro tipo o con una fecha que no es RFC 3339 queda en {@code null} y se anota en
 * {@code camposFaltantes}, sin rechazar la notificacion (spec FR-002). Solo un cuerpo que no es
 * JSON legible se rechaza.
 */
@Component
public class ExtractorEventoSamsara {

    private final ObjectMapper objectMapper;

    public ExtractorEventoSamsara(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public EventoSamsaraExtraido extraer(String cuerpo) {
        if (cuerpo == null || cuerpo.isBlank()) {
            throw new JsonInvalidoException("cuerpo vacio");
        }
        JsonNode raiz;
        try {
            raiz = objectMapper.readTree(cuerpo);
        } catch (JsonProcessingException e) {
            throw new JsonInvalidoException(e.getOriginalMessage());
        }

        List<String> faltantes = new ArrayList<>();
        JsonNode datos = raiz.path("data").path("data");
        JsonNode vehiculo = datos.path("vehicle");

        String eventId = texto(raiz, "eventId", faltantes);
        String tipoEvento = texto(raiz, "eventType", faltantes);
        Instant momentoEvento = fecha(raiz, "eventTime", faltantes);
        String vehiculoId = texto(vehiculo, "id", faltantes, "vehicle.id");
        String patente = texto(vehiculo, "licensePlate", faltantes, "vehicle.licensePlate");
        Instant inicioExceso = fecha(datos, "startTime", faltantes);
        // endTime solo existe en SevereSpeedingEnded: su ausencia en un Started no es un faltante.
        Instant finExceso = datos.has("endTime") ? fecha(datos, "endTime", faltantes) : null;
        Instant inicioViaje = fecha(datos, "tripStartTime", faltantes);

        return new EventoSamsaraExtraido(eventId, tipoEvento, momentoEvento, vehiculoId, patente,
                inicioExceso, finExceso, inicioViaje, raiz.toString(), List.copyOf(faltantes));
    }

    private static String texto(JsonNode nodo, String campo, List<String> faltantes) {
        return texto(nodo, campo, faltantes, campo);
    }

    private static String texto(JsonNode nodo, String campo, List<String> faltantes, String nombre) {
        JsonNode valor = nodo.path(campo);
        // Samsara documenta ids como string, pero un id numerico se acepta igual.
        if (valor.isTextual() && !valor.asText().isBlank() || valor.isNumber()) {
            return valor.asText();
        }
        faltantes.add(nombre);
        return null;
    }

    private static Instant fecha(JsonNode nodo, String campo, List<String> faltantes) {
        JsonNode valor = nodo.path(campo);
        if (valor.isTextual()) {
            try {
                return OffsetDateTime.parse(valor.asText()).toInstant();
            } catch (DateTimeParseException e) {
                // cae al registro de faltante
            }
        }
        faltantes.add(campo);
        return null;
    }
}
