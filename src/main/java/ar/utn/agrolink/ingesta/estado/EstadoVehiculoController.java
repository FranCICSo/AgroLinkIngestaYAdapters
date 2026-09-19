package ar.utn.agrolink.ingesta.estado;

import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class EstadoVehiculoController {

    private final EstadoVehiculoService service;

    public EstadoVehiculoController(EstadoVehiculoService service) {
        this.service = service;
    }

    @GetMapping(value = "/api/v1/vehiculos/{dispositivoId}/estado", produces = MediaType.APPLICATION_JSON_VALUE)
    public EstadoVehiculoDto obtenerEstadoVehiculo(@PathVariable String dispositivoId) {
        if (!StringUtils.hasText(dispositivoId)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "El identificador de dispositivo no puede estar vacio.");
        }
        return service.obtenerEstado(dispositivoId);
    }

    // No un 200 con campos en null: seria indistinguible de una lectura real degradada
    // (spec, Assumptions y Edge Cases; FR-007/FR-008).
    @ExceptionHandler(VehiculoSinTelemetriaException.class)
    public ResponseEntity<ProblemDetail> handleSinTelemetria(VehiculoSinTelemetriaException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        problem.setTitle("Vehiculo sin telemetria");
        problem.setType(URI.create("about:blank"));
        problem.setProperty("dispositivoId", ex.getDispositivoId());
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }
}
