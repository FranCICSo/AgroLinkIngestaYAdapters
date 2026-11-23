package ar.utn.agrolink.ingesta.viajeprogramado;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
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
    void arrancarViaje_conOdometroInicial_loReenviaEnElCamion() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("/rutas")).andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.camion.id").value("900001"))
                .andExpect(jsonPath("$.camion.odometroInicialKm").value(184400))
                .andRespond(withStatus(HttpStatus.CREATED));
        ViajeProgramado viaje = viajeDeEjemplo();
        viaje.setOdometroInicialKm(new BigDecimal("184400"));

        SimulacionResultado resultado = new SimuladorViajesClient(builder.build()).arrancarViaje(viaje);

        assertThat(resultado.exito()).isTrue();
        server.verify();
    }

    @Test
    void arrancarViaje_sinOdometroInicial_noMandaElCampo() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("/rutas")).andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.camion.odometroInicialKm").doesNotExist())
                .andRespond(withStatus(HttpStatus.CREATED));

        new SimuladorViajesClient(builder.build()).arrancarViaje(viajeDeEjemplo());

        server.verify();
    }

    @Test
    void arrancarViaje_conCargaRefrigerada_mandaTipoCargaYSetpointEnElCentroDelRango() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("/rutas")).andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.camion.tipoCarga").value("refrigerada"))
                .andExpect(jsonPath("$.camion.setpointTempC").value(4.5))
                .andExpect(jsonPath("$.camion.setpointHumedadPct").doesNotExist())
                .andExpect(jsonPath("$.camion.umbralTermicoMinC").value(2))
                .andExpect(jsonPath("$.camion.umbralTermicoMaxC").value(7))
                .andRespond(withStatus(HttpStatus.CREATED));
        ViajeProgramado viaje = viajeDeEjemplo();
        viaje.setUmbralesTermicos(new BigDecimal("2"), new BigDecimal("7"));

        new SimuladorViajesClient(builder.build()).arrancarViaje(viaje);

        server.verify();
    }

    @Test
    void arrancarViaje_sinCargaRefrigerada_mandaCargaSecaSinSetpoint() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("/rutas")).andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.camion.tipoCarga").value("seca"))
                .andExpect(jsonPath("$.camion.setpointTempC").doesNotExist())
                .andExpect(jsonPath("$.camion.umbralTermicoMinC").doesNotExist())
                .andExpect(jsonPath("$.camion.umbralTermicoMaxC").doesNotExist())
                .andRespond(withStatus(HttpStatus.CREATED));

        new SimuladorViajesClient(builder.build()).arrancarViaje(viajeDeEjemplo());

        server.verify();
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

    // Feature 014, Historia 3: detencion de la simulacion Rinho.

    @Test
    void detener_conViajeEnCurso_postAlCamion_yDevuelveDetenida() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("/camiones/900001/detencion")).andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.tripCode").value("V1"))
                .andExpect(jsonPath("$.motivo").value("COMPLETADO"))
                .andRespond(withStatus(HttpStatus.OK)
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .body("{\"camionId\":\"900001\",\"viajesFinalizados\":[41],\"efecto\":\"DETENIDA\"}"));

        var r = new SimuladorViajesClient(builder.build()).detener("900001", "V1", "COMPLETADO");

        assertThat(r.resultado()).isEqualTo(SimuladorViajesClient.Detencion.DETENIDA);
        server.verify();
    }

    @Test
    void detener_sinViajeEnCurso_devuelveSinViaje() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("/camiones/900001/detencion"))
                .andRespond(withStatus(HttpStatus.OK)
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .body("{\"camionId\":\"900001\",\"viajesFinalizados\":[],\"efecto\":\"SIN_VIAJE_EN_CURSO\"}"));

        var r = new SimuladorViajesClient(builder.build()).detener("900001", "V1", null);

        assertThat(r.resultado()).isEqualTo(SimuladorViajesClient.Detencion.SIN_VIAJE_EN_CURSO);
    }

    @Test
    void detener_camionNoEncontrado_cuentaComoSinViaje() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("/camiones/900001/detencion")).andRespond(withStatus(HttpStatus.NOT_FOUND));

        var r = new SimuladorViajesClient(builder.build()).detener("900001", "V1", null);

        assertThat(r.resultado()).isEqualTo(SimuladorViajesClient.Detencion.SIN_VIAJE_EN_CURSO);
    }

    @Test
    void detener_errorDelSimulador_devuelveFalloSinPropagar() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("/camiones/900001/detencion")).andRespond(withServerError());

        var r = new SimuladorViajesClient(builder.build()).detener("900001", "V1", null);

        assertThat(r.resultado()).isEqualTo(SimuladorViajesClient.Detencion.FALLO);
        assertThat(r.detalle()).isNotBlank();
    }
}
