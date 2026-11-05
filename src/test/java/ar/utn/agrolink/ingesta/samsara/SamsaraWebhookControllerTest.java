package ar.utn.agrolink.ingesta.samsara;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** Contrato de samsara-webhook-http.md y samsara-eventos-consulta-http.md, con el service mockeado. */
@WebMvcTest(SamsaraWebhookController.class)
class SamsaraWebhookControllerTest {

    @Autowired private MockMvc mockMvc;

    @MockBean private SamsaraEventoService service;

    @Test
    void webhook_guardado_devuelve200ConId() throws Exception {
        when(service.recibir(any())).thenReturn(EventoSamsaraDto.RecepcionResponse.guardado(7L));

        mockMvc.perform(post("/api/v1/proveedores/samsara/webhook")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ExtractorEventoSamsaraTest.ENDED_COMPLETO))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("GUARDADO"))
                .andExpect(jsonPath("$.id").value(7));
    }

    @Test
    void webhook_duplicado_devuelve200SinId() throws Exception {
        when(service.recibir(any())).thenReturn(EventoSamsaraDto.RecepcionResponse.duplicado());

        mockMvc.perform(post("/api/v1/proveedores/samsara/webhook")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("DUPLICADO"))
                .andExpect(jsonPath("$.id").doesNotExist());
    }

    @Test
    void webhook_jsonInvalido_devuelve400() throws Exception {
        when(service.recibir(eq("no-es-json"))).thenThrow(new JsonInvalidoException("x"));

        mockMvc.perform(post("/api/v1/proveedores/samsara/webhook")
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("no-es-json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("json_invalido"));
    }

    @Test
    void webhook_cuerpoDemasiadoGrande_devuelve413SinGuardar() throws Exception {
        String grande = "{\"x\":\"" + "a".repeat(SamsaraWebhookController.CUERPO_MAXIMO_BYTES) + "\"}";

        mockMvc.perform(post("/api/v1/proveedores/samsara/webhook")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(grande))
                .andExpect(status().isPayloadTooLarge());
        verify(service, never()).recibir(any());
    }

    @Test
    void webhook_falloDeBase_devuelve500() throws Exception {
        when(service.recibir(any())).thenThrow(new DataAccessResourceFailureException("db caida"));

        mockMvc.perform(post("/api/v1/proveedores/samsara/webhook")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.error").value("error_interno"));
    }

    @Test
    void eventos_conCursor_usaLimiteDefault() throws Exception {
        when(service.consultar(5L, 100)).thenReturn(new EventoSamsaraDto.ConsultaResponse(List.of(), 5L, false));

        mockMvc.perform(get("/api/v1/proveedores/samsara/eventos").param("despuesDe", "5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ultimaPosicion").value(5))
                .andExpect(jsonPath("$.hayMas").value(false));
    }

    @Test
    void eventos_sinDespuesDeOLimiteFueraDeRango_devuelve400() throws Exception {
        mockMvc.perform(get("/api/v1/proveedores/samsara/eventos"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("validacion"));
        mockMvc.perform(get("/api/v1/proveedores/samsara/eventos").param("despuesDe", "-1"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/proveedores/samsara/eventos").param("despuesDe", "0").param("limite", "501"))
                .andExpect(status().isBadRequest());
        verify(service, never()).consultar(anyLong(), anyInt());
    }
}
