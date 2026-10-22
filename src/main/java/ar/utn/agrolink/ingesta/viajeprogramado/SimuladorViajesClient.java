package ar.utn.agrolink.ingesta.viajeprogramado;

import com.fasterxml.jackson.annotation.JsonInclude;
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
                new CamionRequest(viajeProgramado.getIotDeviceId(), viajeProgramado.getOdometroInicialKm()));
    }

    private record RutaRequest(String nombre, PuntoRequest origen, PuntoRequest destino, CamionRequest camion) {
    }

    private record PuntoRequest(java.math.BigDecimal lat, java.math.BigDecimal lon) {
    }

    // odometroInicialKm null se omite: el simulador sigue desde el ultimo odometro del camion.
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private record CamionRequest(String id, java.math.BigDecimal odometroInicialKm) {
    }
}
