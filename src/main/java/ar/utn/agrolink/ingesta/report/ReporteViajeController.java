package ar.utn.agrolink.ingesta.report;

import java.net.URI;
import java.time.OffsetDateTime;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class ReporteViajeController {

    private final ReporteViajeService service;

    public ReporteViajeController(ReporteViajeService service) {
        this.service = service;
    }

    @GetMapping(value = "/api/v1/reportes/viaje", produces = MediaType.APPLICATION_JSON_VALUE)
    public ReporteViajeDto obtenerReporteViaje(
            @RequestParam String camionId,
            @RequestParam OffsetDateTime desde,
            @RequestParam OffsetDateTime hasta) {
        if (!hasta.isAfter(desde)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "El parametro 'hasta' debe ser posterior a 'desde'.");
        }
        return service.calcular(camionId, desde, hasta);
    }

    // No un 200 con agregados en cero: seria indistinguible de un camion detenido todo el
    // rango (FR-006, decision D-13).
    @ExceptionHandler(SinDatosException.class)
    public ResponseEntity<ProblemDetail> handleSinDatos(SinDatosException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        problem.setTitle("Sin datos");
        problem.setType(URI.create("about:blank"));
        problem.setProperty("camionId", ex.getCamionId());
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }
}
