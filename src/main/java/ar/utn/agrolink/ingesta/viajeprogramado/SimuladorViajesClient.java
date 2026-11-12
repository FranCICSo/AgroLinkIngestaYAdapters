package ar.utn.agrolink.ingesta.viajeprogramado;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.ClientHttpRequestFactories;
import org.springframework.boot.web.client.ClientHttpRequestFactorySettings;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Cliente HTTP server-to-server hacia {@code simulador-viajes} (research.md D-07): arranca la
 * simulacion reenviando internamente a su {@code POST /rutas} ya existente (feature 011,
 * contrato {@code specs/011-generar-ruta-simulada/contracts/rutas-http-api.md}), con el bloque
 * {@code camion} para que, en la misma llamada, se de de alta el viaje simulado.
 *
 * <p>Mismo criterio que un cliente de este tipo exige (FR-004): nunca propaga
 * {@code RestClientException} — cualquier falla (red, 4xx, 5xx) se traduce a un
 * {@link SimulacionResultado} de fallo, para que el llamador (el poller) jamas se rompa por
 * una falla de este componente secundario.
 */
@Component
public class SimuladorViajesClient {

    static final String TIPO_CARGA_SECA = "seca";
    static final String TIPO_CARGA_REFRIGERADA = "refrigerada";

    private final RestClient restClient;

    @Autowired
    public SimuladorViajesClient(
            @Value("${agrolink.simulador-viajes.base-url}") String baseUrl,
            @Value("${agrolink.simulador-viajes.connect-timeout-ms}") long connectTimeoutMs,
            @Value("${agrolink.simulador-viajes.read-timeout-ms}") long readTimeoutMs) {
        var settings = ClientHttpRequestFactorySettings.DEFAULTS
                .withConnectTimeout(Duration.ofMillis(connectTimeoutMs))
                .withReadTimeout(Duration.ofMillis(readTimeoutMs));
        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(ClientHttpRequestFactories.get(settings))
                .build();
    }

    // Visibilidad de paquete: permite inyectar un RestClient ya armado (p. ej. atado a
    // MockRestServiceServer) desde el test, sin pasar por @Value ni por un ClientHttpRequestFactory real.
    SimuladorViajesClient(RestClient restClient) {
        this.restClient = restClient;
    }

    public SimulacionResultado arrancarViaje(ViajeProgramado viajeProgramado) {
        try {
            restClient.post()
                    .uri("/rutas")
                    .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                    .body(construirRequest(viajeProgramado))
                    .retrieve()
                    .toBodilessEntity();
            return SimulacionResultado.ok();
        } catch (RestClientException ex) {
            return SimulacionResultado.fallo(ex.getMessage());
        }
    }

    private RutaRequest construirRequest(ViajeProgramado viajeProgramado) {
        return new RutaRequest(
                viajeProgramado.getNombreRuta(),
                new PuntoRequest(viajeProgramado.getOrigenLat(), viajeProgramado.getOrigenLon()),
                new PuntoRequest(viajeProgramado.getDestinoLat(), viajeProgramado.getDestinoLon()),
                camion(viajeProgramado));
    }

    /**
     * Siempre informa {@code tipoCarga}: el simulador la pisa en el camion existente, asi un camion
     * que antes llevo carga seca pasa a emitir el segmento BLE (y viceversa). El setpoint es el
     * centro del rango de umbrales del viaje, para que la temperatura normal simulada no dispare
     * alertas; la humedad la completa el simulador con su default.
     */
    private CamionRequest camion(ViajeProgramado viajeProgramado) {
        if (!viajeProgramado.esCargaRefrigerada()) {
            return new CamionRequest(viajeProgramado.getIotDeviceId(), viajeProgramado.getOdometroInicialKm(),
                    TIPO_CARGA_SECA, null);
        }
        BigDecimal setpoint = viajeProgramado.getUmbralTermicoMinC()
                .add(viajeProgramado.getUmbralTermicoMaxC())
                .divide(BigDecimal.valueOf(2), 1, RoundingMode.HALF_UP);
        return new CamionRequest(viajeProgramado.getIotDeviceId(), viajeProgramado.getOdometroInicialKm(),
                TIPO_CARGA_REFRIGERADA, setpoint);
    }

    private record RutaRequest(String nombre, PuntoRequest origen, PuntoRequest destino, CamionRequest camion) {
    }

    private record PuntoRequest(java.math.BigDecimal lat, java.math.BigDecimal lon) {
    }

    // Los null se omiten: odometroInicialKm null = el simulador sigue desde el ultimo odometro
    // del camion; setpointTempC null = carga seca.
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private record CamionRequest(String id, BigDecimal odometroInicialKm, String tipoCarga, BigDecimal setpointTempC) {
    }
}
