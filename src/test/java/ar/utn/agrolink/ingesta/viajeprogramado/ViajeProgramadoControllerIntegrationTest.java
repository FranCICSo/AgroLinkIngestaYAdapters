package ar.utn.agrolink.ingesta.viajeprogramado;

import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Contract test (FR-001/FR-003/FR-004, contrato viajes-simulados-http-api.md): slice de
 * controller con el service mockeado — no requiere la base real levantada (a diferencia de
 * PuertoAccesoFilterTest), consistente con que esta feature no agrega una ruta nueva al
 * allowlist de puertos (research.md D-03).
 */
@WebMvcTest(ViajeProgramadoController.class)
class ViajeProgramadoControllerIntegrationTest {

    @Autowired private MockMvc mockMvc;

    @MockBean private ViajeProgramadoService service;

    private static final String BODY_ALTA = """
            {
              "tripCode": "T-1",
              "estimatedStartDateTime": "2026-10-12T08:00:00",
              "origen": { "lat": -34.6467, "lon": -58.4894 },
              "destino": { "lat": -34.6037, "lon": -58.3816 }
            }""";

    @Test
    void post_conIdDeLaListaCerrada_devuelve202() throws Exception {
        when(service.programar(eq("900001"), any()))
                .thenReturn(new ViajeProgramadoDto("T-1", ViajeProgramado.PENDIENTE, LocalDateTime.now()));

        mockMvc.perform(post("/api/v1/vehiculos/900001/viajes-simulados")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY_ALTA))
                .andExpect(status().isAccepted());
    }

    @Test
    void post_conIdFueraDeLaListaCerrada_devuelve404() throws Exception {
        when(service.programar(eq("12345"), any())).thenThrow(new DispositivoNoSimuladoException("12345"));

        mockMvc.perform(post("/api/v1/vehiculos/12345/viajes-simulados")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY_ALTA))
                .andExpect(status().isNotFound());
    }

    @Test
    void post_nuncaDevuelve5xxPorUnaFallaDelSimulador() throws Exception {
        // El service absorbe la falla del simulador (dispara de inmediato y marca ERROR) y
        // devuelve igual un resultado valido: el alta en si nunca falla por eso (FR-004).
        when(service.programar(eq("900001"), any()))
                .thenReturn(new ViajeProgramadoDto("T-1", ViajeProgramado.ERROR, LocalDateTime.now()));

        mockMvc.perform(post("/api/v1/vehiculos/900001/viajes-simulados")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY_ALTA))
                .andExpect(status().isAccepted());
    }

    @Test
    void put_filaPendiente_devuelve200() throws Exception {
        when(service.reprogramar(eq("900001"), eq("T-1"), any()))
                .thenReturn(new ViajeProgramadoDto("T-1", ViajeProgramado.PENDIENTE, LocalDateTime.now()));

        mockMvc.perform(put("/api/v1/vehiculos/900001/viajes-simulados/T-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"estimatedStartDateTime\": \"2026-10-12T10:30:00\"}"))
                .andExpect(status().isOk());
    }

    @Test
    void put_tripCodeInexistente_devuelve404() throws Exception {
        when(service.reprogramar(eq("900001"), eq("NO-EXISTE"), any()))
                .thenThrow(new ViajeProgramadoNoEncontradoException("NO-EXISTE"));

        mockMvc.perform(put("/api/v1/vehiculos/900001/viajes-simulados/NO-EXISTE")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"estimatedStartDateTime\": \"2026-10-12T10:30:00\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void put_filaYaDisparada_devuelve409() throws Exception {
        when(service.reprogramar(eq("900001"), eq("T-1"), any()))
                .thenThrow(new ViajeNoModificableException("T-1", ViajeProgramado.DISPARADO));

        mockMvc.perform(put("/api/v1/vehiculos/900001/viajes-simulados/T-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"estimatedStartDateTime\": \"2026-10-12T10:30:00\"}"))
                .andExpect(status().isConflict())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.estadoActual")
                        .value(containsString(ViajeProgramado.DISPARADO)));
    }

    @Test
    void put_dispositivoDelPathNoCoincideConElDueño_devuelve404() throws Exception {
        // IDOR: T-1 es de 900001; pedirlo con 900002 en el path no debe encontrarlo.
        when(service.reprogramar(eq("900002"), eq("T-1"), any()))
                .thenThrow(new ViajeProgramadoNoEncontradoException("T-1"));

        mockMvc.perform(put("/api/v1/vehiculos/900002/viajes-simulados/T-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"estimatedStartDateTime\": \"2026-10-12T10:30:00\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void delete_filaPendiente_devuelve204() throws Exception {
        mockMvc.perform(delete("/api/v1/vehiculos/900001/viajes-simulados/T-1"))
                .andExpect(status().isNoContent());
    }

    @Test
    void delete_tripCodeInexistente_devuelve404() throws Exception {
        org.mockito.Mockito.doThrow(new ViajeProgramadoNoEncontradoException("NO-EXISTE"))
                .when(service).cancelar("900001", "NO-EXISTE");

        mockMvc.perform(delete("/api/v1/vehiculos/900001/viajes-simulados/NO-EXISTE"))
                .andExpect(status().isNotFound());
    }

    @Test
    void delete_filaYaCancelada_devuelve409() throws Exception {
        org.mockito.Mockito.doThrow(new ViajeNoModificableException("T-1", ViajeProgramado.CANCELADO))
                .when(service).cancelar("900001", "T-1");

        mockMvc.perform(delete("/api/v1/vehiculos/900001/viajes-simulados/T-1"))
                .andExpect(status().isConflict());
    }

    @Test
    void delete_dispositivoDelPathNoCoincideConElDueño_devuelve404() throws Exception {
        org.mockito.Mockito.doThrow(new ViajeProgramadoNoEncontradoException("T-1"))
                .when(service).cancelar("900002", "T-1");

        mockMvc.perform(delete("/api/v1/vehiculos/900002/viajes-simulados/T-1"))
                .andExpect(status().isNotFound());
    }
}
