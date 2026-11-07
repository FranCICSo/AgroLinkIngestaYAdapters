package ar.utn.agrolink.ingesta.viajeprogramado;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.ClientHttpRequestFactories;
import org.springframework.boot.web.client.ClientHttpRequestFactorySettings;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Cliente server-to-server hacia el emisor Samsara de {@code simulador-viajes} (feature
 * 015-samsara-webhook-exceso-velocidad, contracts/simulacion-samsara-avisos.md §3). Mismo destino
 * y timeouts que {@link SimuladorViajesClient}. Nunca propaga {@link RestClientException}: sin
 * respuesta devuelve vacio y cualquier status (2xx o no) vuelve como {@link Respuesta}.
 */
@Component
public class SimuladorSamsaraClient {

    private static final ParameterizedTypeReference<Map<String, Object>> CUERPO = new ParameterizedTypeReference<>() {};

    private final RestClient restClient;

    @Autowired
    public SimuladorSamsaraClient(
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

    SimuladorSamsaraClient(RestClient restClient) {
        this.restClient = restClient;
    }

    public record Respuesta(int status, Map<String, Object> cuerpo) {

        public boolean exito() {
            return status >= 200 && status < 300;
        }
    }

    public Optional<Respuesta> iniciar(String vehiculoId, String tripCode, OffsetDateTime inicioViaje) {
        return enviar("/samsara/viajes",
                Map.of("vehiculoId", vehiculoId, "tripCode", tripCode, "inicioViaje", inicioViaje.toString()));
    }

    public Optional<Respuesta> detener(String vehiculoId, String tripCode, String motivo) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("vehiculoId", vehiculoId);
        if (motivo != null) {
            body.put("motivo", motivo);
        }
        return enviar("/samsara/viajes/{tripCode}/detencion", body, tripCode);
    }

    private Optional<Respuesta> enviar(String uri, Map<String, Object> body, Object... variables) {
        try {
            return Optional.ofNullable(restClient.post()
                    .uri(uri, variables)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .exchange((request, response) -> {
                        Map<String, Object> cuerpo = null;
                        try {
                            cuerpo = response.bodyTo(CUERPO);
                        } catch (RestClientException ignorado) {
                            // cuerpo no JSON: se informa solo el status
                        }
                        return new Respuesta(response.getStatusCode().value(), cuerpo);
                    }));
        } catch (RestClientException ex) {
            return Optional.empty();
        }
    }
}
