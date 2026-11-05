package ar.utn.agrolink.ingesta.samsara;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Recepcion y consulta de notificaciones webhook de Samsara (spec FR-001..FR-004a). Guarda casi
 * sin controles: la interpretacion del evento (vehiculo, episodio, alerta) es de AgroLinkBackend,
 * que lo consume por la consulta con cursor.
 */
@Service
public class SamsaraEventoService {

    static final int LIMITE_DEFAULT = 100;
    static final int LIMITE_MAXIMO = 500;

    private static final Logger log = LoggerFactory.getLogger(SamsaraEventoService.class);

    private final ExtractorEventoSamsara extractor;
    private final EventoSamsaraRepository repository;
    private final ObjectMapper objectMapper;

    public SamsaraEventoService(ExtractorEventoSamsara extractor, EventoSamsaraRepository repository,
                                ObjectMapper objectMapper) {
        this.extractor = extractor;
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    public EventoSamsaraDto.RecepcionResponse recibir(String cuerpo) {
        EventoSamsaraExtraido evento;
        try {
            evento = extractor.extraer(cuerpo);
        } catch (JsonInvalidoException e) {
            log.warn("Webhook Samsara rechazado: cuerpo no es JSON legible ({})", e.getMessage());
            throw e;
        }

        Optional<Long> id = repository.insertar(evento);
        if (id.isEmpty()) {
            log.info("Webhook Samsara duplicado: eventId={} eventType={}", evento.eventId(), evento.tipoEvento());
            return EventoSamsaraDto.RecepcionResponse.duplicado();
        }
        if (evento.camposFaltantes().isEmpty()) {
            log.info("Webhook Samsara guardado: id={} eventId={} eventType={} samsaraVehiculoId={}",
                    id.get(), evento.eventId(), evento.tipoEvento(), evento.samsaraVehiculoId());
        } else {
            log.info("Webhook Samsara guardado con campos faltantes o invalidos: id={} eventId={} eventType={} samsaraVehiculoId={} faltantes={}",
                    id.get(), evento.eventId(), evento.tipoEvento(), evento.samsaraVehiculoId(), evento.camposFaltantes());
        }
        return EventoSamsaraDto.RecepcionResponse.guardado(id.get());
    }

    public EventoSamsaraDto.ConsultaResponse consultar(long despuesDe, int limite) {
        List<EventoSamsaraGuardado> filas = repository.buscarPosterioresA(despuesDe, limite);
        List<EventoSamsaraDto.EventoResponse> eventos = filas.stream().map(this::aRespuesta).toList();
        long ultimaPosicion = filas.isEmpty() ? despuesDe : filas.get(filas.size() - 1).id();
        return new EventoSamsaraDto.ConsultaResponse(eventos, ultimaPosicion, filas.size() == limite);
    }

    private EventoSamsaraDto.EventoResponse aRespuesta(EventoSamsaraGuardado fila) {
        return new EventoSamsaraDto.EventoResponse(fila.id(), fila.eventId(), fila.tipoEvento(),
                fila.momentoEvento(), fila.momentoRecepcion(), fila.samsaraVehiculoId(), fila.patente(),
                fila.inicioExceso(), fila.finExceso(), fila.inicioViaje(), json(fila.payloadJson()));
    }

    private JsonNode json(String payload) {
        try {
            return objectMapper.readTree(payload);
        } catch (JsonProcessingException e) {
            // payload_crudo es JSONB: siempre es JSON valido al leerlo.
            throw new IllegalStateException("payload_crudo no es JSON", e);
        }
    }
}
