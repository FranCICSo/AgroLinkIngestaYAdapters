package ar.utn.agrolink.ingesta.viajeprogramado;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class SimuladorViajesClientTest {

    private ViajeProgramado viajeDeEjemplo() {
        return new ViajeProgramado(
                "QUICKSTART-001",
                "900001",
                LocalDateTime.now(),
                new BigDecimal("-34.6467"),
                new BigDecimal("-58.4894"),
                new BigDecimal("-34.6037"),
                new BigDecimal("-58.3816"),
                "Viaje QUICKSTART-001");
    }

    @Test
    void arrancarViaje_simuladorResponde201_devuelveExito() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("/rutas")).andExpect(method(HttpMethod.POST))
                .andRespond(withStatus(HttpStatus.CREATED));

        SimuladorViajesClient client = new SimuladorViajesClient(builder.build());

        SimulacionResultado resultado = client.arrancarViaje(viajeDeEjemplo());

        assertThat(resultado.exito()).isTrue();
        assertThat(resultado.detalleError()).isNull();
    }

    @Test
    void arrancarViaje_simuladorResponde500_devuelveFalloSinPropagarExcepcion() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("/rutas")).andExpect(method(HttpMethod.POST))
                .andRespond(withServerError());

        SimuladorViajesClient client = new SimuladorViajesClient(builder.build());

        SimulacionResultado resultado = client.arrancarViaje(viajeDeEjemplo());

        assertThat(resultado.exito()).isFalse();
        assertThat(resultado.detalleError()).isNotBlank();
    }

    @Test
    void arrancarViaje_conexionRechazada_devuelveFalloSinPropagarExcepcion() {
        SimuladorViajesClient client = new SimuladorViajesClient(
                RestClient.builder().baseUrl("http://localhost:1").build());

        SimulacionResultado resultado = client.arrancarViaje(viajeDeEjemplo());

        assertThat(resultado.exito()).isFalse();
        assertThat(resultado.detalleError()).isNotBlank();
    }
}
