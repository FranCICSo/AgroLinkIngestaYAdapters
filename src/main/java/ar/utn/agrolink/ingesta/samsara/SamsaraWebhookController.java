package ar.utn.agrolink.ingesta.samsara;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Webhook de Samsara y consulta por cursor (contracts/samsara-webhook-http.md,
 * contracts/samsara-eventos-consulta-http.md). Sin autenticacion ni verificacion de firma: desvio
 * explicito de la POC, documentado en el Complexity Tracking del plan (Principio VI).
 */
@RestController
@RequestMapping("/api/v1/proveedores/samsara")
public class SamsaraWebhookController {

    static final int CUERPO_MAXIMO_BYTES = 256 * 1024;

    private static final Logger log = LoggerFactory.getLogger(SamsaraWebhookController.class);

    private final SamsaraEventoService service;

    public SamsaraWebhookController(SamsaraEventoService service) {
        this.service = service;
    }

    // Sin `consumes`: un Content-Type distinto no es motivo de rechazo, solo el cuerpo ilegible.
    @PostMapping(value = "/webhook", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> recibir(@RequestBody(required = false) String cuerpo) {
        if (cuerpo != null && cuerpo.length() > CUERPO_MAXIMO_BYTES) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                    .body(new EventoSamsaraDto.ErrorResponse("payload_demasiado_grande", null));
        }
        // 200 tambien para el duplicado: Samsara solo distingue 2xx de no-2xx.
        return ResponseEntity.ok(service.recibir(cuerpo));
    }

    @GetMapping(value = "/eventos", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> consultar(
            @RequestParam(required = false) Long despuesDe,
            @RequestParam(required = false) Integer limite) {
        if (despuesDe == null || despuesDe < 0) {
            return validacion("despuesDe es obligatorio y debe ser >= 0");
        }
        int limiteEfectivo = limite == null ? SamsaraEventoService.LIMITE_DEFAULT : limite;
        if (limiteEfectivo < 1 || limiteEfectivo > SamsaraEventoService.LIMITE_MAXIMO) {
            return validacion("limite debe estar entre 1 y " + SamsaraEventoService.LIMITE_MAXIMO);
        }
        return ResponseEntity.ok(service.consultar(despuesDe, limiteEfectivo));
    }

    @ExceptionHandler(JsonInvalidoException.class)
    public ResponseEntity<EventoSamsaraDto.ErrorResponse> handleJsonInvalido(JsonInvalidoException ex) {
        return ResponseEntity.badRequest().body(new EventoSamsaraDto.ErrorResponse("json_invalido", ex.getMessage()));
    }

    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<EventoSamsaraDto.ErrorResponse> handleBase(DataAccessException ex) {
        log.error("Error de base en el webhook/consulta Samsara: {}", ex.getMessage(), ex);
        return ResponseEntity.internalServerError().body(new EventoSamsaraDto.ErrorResponse("error_interno", null));
    }

    private static ResponseEntity<EventoSamsaraDto.ErrorResponse> validacion(String detalle) {
        return ResponseEntity.badRequest().body(new EventoSamsaraDto.ErrorResponse("validacion", detalle));
    }
}
