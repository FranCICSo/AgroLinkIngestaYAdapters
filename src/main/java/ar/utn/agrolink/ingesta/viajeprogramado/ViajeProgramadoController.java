package ar.utn.agrolink.ingesta.viajeprogramado;

import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Contrato {@code viajes-simulados-http-api.md} (spec 013-autostart-simulacion-viaje):
 * anidado bajo {@code /api/v1/vehiculos/{dispositivoId}/**}, mismo prefijo ya permitido por
 * {@code PuertoAccesoFilter} (research.md D-03) — sin tocar ese filtro.
 */
@RestController
public class ViajeProgramadoController {

    private final ViajeProgramadoService service;

    public ViajeProgramadoController(ViajeProgramadoService service) {
        this.service = service;
    }

    @PostMapping(
            value = "/api/v1/vehiculos/{dispositivoId}/viajes-simulados",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ViajeProgramadoDto> programar(
            @PathVariable String dispositivoId, @RequestBody ProgramarViajeRequest request) {
        ViajeProgramadoDto resultado = service.programar(dispositivoId, request);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(resultado);
    }

    @PutMapping(
            value = "/api/v1/vehiculos/{dispositivoId}/viajes-simulados/{tripCode}",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ViajeProgramadoDto reprogramar(
            @PathVariable String dispositivoId,
            @PathVariable String tripCode,
            @RequestBody ReprogramarViajeRequest request) {
        return service.reprogramar(dispositivoId, tripCode, request);
    }

    @DeleteMapping(value = "/api/v1/vehiculos/{dispositivoId}/viajes-simulados/{tripCode}")
    public ResponseEntity<Void> cancelar(@PathVariable String dispositivoId, @PathVariable String tripCode) {
        service.cancelar(dispositivoId, tripCode);
        return ResponseEntity.noContent().build();
    }

    @ExceptionHandler(DispositivoNoSimuladoException.class)
    public ResponseEntity<ProblemDetail> handleDispositivoNoSimulado(DispositivoNoSimuladoException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        problem.setTitle("Dispositivo no simulado");
        problem.setType(URI.create("about:blank"));
        problem.setProperty("error", "dispositivo_no_simulado");
        problem.setProperty("dispositivoId", ex.getDispositivoId());
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }

    @ExceptionHandler(ViajeProgramadoNoEncontradoException.class)
    public ResponseEntity<ProblemDetail> handleNoEncontrado(ViajeProgramadoNoEncontradoException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        problem.setTitle("Viaje programado no encontrado");
        problem.setType(URI.create("about:blank"));
        problem.setProperty("error", "viaje_programado_no_encontrado");
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }

    @ExceptionHandler(ViajeNoModificableException.class)
    public ResponseEntity<ProblemDetail> handleNoModificable(ViajeNoModificableException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        problem.setTitle("Viaje no modificable");
        problem.setType(URI.create("about:blank"));
        problem.setProperty("error", "viaje_no_modificable");
        problem.setProperty("estadoActual", ex.getEstadoActual());
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }
}
