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
    private final AvisoViajeSamsaraService avisoSamsara;

    public ViajeProgramadoController(ViajeProgramadoService service, AvisoViajeSamsaraService avisoSamsara) {
        this.service = service;
        this.avisoSamsara = avisoSamsara;
    }

    @PostMapping(
            value = "/api/v1/vehiculos/{dispositivoId}/viajes-simulados",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> programar(
            @PathVariable String dispositivoId, @RequestBody ProgramarViajeRequest request) {
        // Feature 015 (research.md D-10): un vehiculo Samsara nunca dispara una simulacion de ruta
        // Rinho; su aviso va al emisor Samsara, sin origen/destino ni persistencia.
        if (VehiculosSamsaraSimulados.esSamsara(dispositivoId)) {
            return avisoSamsara.iniciar(dispositivoId, request);
        }
        ViajeProgramadoDto resultado = service.programar(dispositivoId, request);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(resultado);
    }

    /**
     * Detencion (contrato 026 v2 §3). Samsara (feature 015) va al emisor Samsara; Rinho (feature 014,
     * Historia 3) detiene la simulacion del camion en simulador-viajes. Un dispositivo fuera de las
     * dos listas sigue respondiendo 404.
     */
    @PostMapping(
            value = "/api/v1/vehiculos/{dispositivoId}/viajes-simulados/{tripCode}/detencion",
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> detener(
            @PathVariable String dispositivoId,
            @PathVariable String tripCode,
            @RequestBody(required = false) DetencionRequest request) {
        String motivo = request == null ? null : request.motivo();
        if (VehiculosSamsaraSimulados.esSamsara(dispositivoId)) {
            return avisoSamsara.detener(dispositivoId, tripCode, motivo);
        }
        return ResponseEntity.ok(service.detener(dispositivoId, tripCode, motivo));
    }

    public record DetencionRequest(String motivo) {
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

    @ExceptionHandler(CoordenadasNoDisponiblesException.class)
    public ResponseEntity<ProblemDetail> handleCoordenadasNoDisponibles(CoordenadasNoDisponiblesException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, ex.getMessage());
        problem.setTitle("Coordenadas no disponibles");
        problem.setType(URI.create("about:blank"));
        problem.setProperty("error", "coordenadas_no_disponibles");
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }

    @ExceptionHandler(CargaRefrigeradaInvalidaException.class)
    public ResponseEntity<ProblemDetail> handleCargaRefrigeradaInvalida(CargaRefrigeradaInvalidaException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, ex.getMessage());
        problem.setTitle("Carga refrigerada invalida");
        problem.setType(URI.create("about:blank"));
        problem.setProperty("error", "carga_refrigerada_invalida");
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
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

    @ExceptionHandler(ViajeDeOtroDispositivoException.class)
    public ResponseEntity<ProblemDetail> handleViajeDeOtroDispositivo(ViajeDeOtroDispositivoException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        problem.setTitle("Viaje de otro dispositivo");
        problem.setType(URI.create("about:blank"));
        problem.setProperty("error", "viaje_de_otro_dispositivo");
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }

    @ExceptionHandler(SimuladorNoDisponibleException.class)
    public ResponseEntity<ProblemDetail> handleSimuladorNoDisponible(SimuladorNoDisponibleException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_GATEWAY, ex.getMessage());
        problem.setTitle("Simulador no disponible");
        problem.setType(URI.create("about:blank"));
        problem.setProperty("error", "simulador_no_disponible");
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }
}
