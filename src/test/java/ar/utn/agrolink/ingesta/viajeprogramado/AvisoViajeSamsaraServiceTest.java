package ar.utn.agrolink.ingesta.viajeprogramado;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;

import java.time.LocalDateTime;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class AvisoViajeSamsaraServiceTest {

    private static final String ID = "281474977000101";

    private MockRestServiceServer server;
    private AvisoViajeSamsaraService service;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        service = new AvisoViajeSamsaraService(new SimuladorSamsaraClient(builder.build()));
    }

    private static ProgramarViajeRequest inicio(String tripCode, LocalDateTime inicio) {
        return new ProgramarViajeRequest(tripCode, inicio, null, null, null);
    }

    @Test
    void inicio_sinCoordenadas_reenviaConHoraConOffsetArgentina_yCopiaEl202() {
        server.expect(requestTo("/samsara/viajes")).andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.vehiculoId").value(ID))
                .andExpect(jsonPath("$.tripCode").value("T-1"))
                .andExpect(jsonPath("$.inicioViaje").value("2026-11-04T09:40-03:00"))
                .andRespond(withStatus(HttpStatus.ACCEPTED).contentType(MediaType.APPLICATION_JSON)
                        .body("{\"vehiculoId\":\"" + ID + "\",\"tripCode\":\"T-1\",\"efecto\":\"ARRANCADA\"}"));

        ResponseEntity<Map<String, Object>> r = service.iniciar(ID, inicio("T-1", LocalDateTime.of(2026, 11, 4, 9, 40)));

        assertThat(r.getStatusCode().value()).isEqualTo(202);
        assertThat(r.getBody()).containsEntry("estado", "ARRANCADO").containsEntry("efecto", "ARRANCADA")
                .containsEntry("dispositivoId", ID);
        server.verify();
    }

    @Test
    void inicio_sinTripCodeOFecha_devuelve400SinLlamarAlSimulador() {
        assertThat(service.iniciar(ID, inicio(null, LocalDateTime.now())).getStatusCode().value()).isEqualTo(400);
        assertThat(service.iniciar(ID, inicio("T-1", null)).getBody()).containsEntry("error", "validacion");
        assertThat(service.iniciar(ID, null).getStatusCode().value()).isEqualTo(400);
        server.verify();
    }

    @Test
    void inicio_conEmisorDeshabilitadoOCaido_devuelve502() {
        server.expect(requestTo("/samsara/viajes"))
                .andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE).contentType(MediaType.APPLICATION_JSON)
                        .body("{\"error\":\"emisor_deshabilitado\"}"));

        ResponseEntity<Map<String, Object>> r = service.iniciar(ID, inicio("T-1", LocalDateTime.now()));

        assertThat(r.getStatusCode().value()).isEqualTo(502);
        assertThat(r.getBody()).containsEntry("error", "simulador_no_disponible");
    }

    @Test
    void detencion_reenviaElMotivo_yCopiaElEfecto() {
        server.expect(requestTo("/samsara/viajes/T-1/detencion")).andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.vehiculoId").value(ID))
                .andExpect(jsonPath("$.motivo").value("CANCELADO"))
                .andRespond(withStatus(HttpStatus.OK).contentType(MediaType.APPLICATION_JSON)
                        .body("{\"efecto\":\"SIN_SIMULACION_EN_CURSO\"}"));

        ResponseEntity<Map<String, Object>> r = service.detener(ID, "T-1", "CANCELADO");

        assertThat(r.getStatusCode().value()).isEqualTo(200);
        assertThat(r.getBody()).containsEntry("estado", "DETENIDO").containsEntry("efecto", "SIN_SIMULACION_EN_CURSO");
    }
}
