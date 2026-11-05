package ar.utn.agrolink.ingesta.samsara;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class SamsaraEventoServiceTest {

    private final EventoSamsaraRepository repository = mock(EventoSamsaraRepository.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final SamsaraEventoService service =
            new SamsaraEventoService(new ExtractorEventoSamsara(objectMapper), repository, objectMapper);

    @Test
    void recibir_primeraVez_guardado_yRepetido_duplicado() {
        when(repository.insertar(any())).thenReturn(Optional.of(10L), Optional.empty());

        assertThat(service.recibir(ExtractorEventoSamsaraTest.ENDED_COMPLETO).estado()).isEqualTo("GUARDADO");
        assertThat(service.recibir(ExtractorEventoSamsaraTest.ENDED_COMPLETO).estado()).isEqualTo("DUPLICADO");
    }

    @Test
    void consultar_devuelveUltimaPosicionYHayMasCuandoSeLlenaLaPagina() {
        EventoSamsaraGuardado fila = new EventoSamsaraGuardado(42L, "ev-1", "SevereSpeedingStarted",
                Instant.parse("2026-11-04T13:05:12Z"), Instant.parse("2026-11-04T13:05:13Z"),
                "281474977000101", "AGL007", Instant.parse("2026-11-04T13:05:12Z"), null, null, "{\"a\":1}");
        when(repository.buscarPosterioresA(0L, 1)).thenReturn(List.of(fila));

        EventoSamsaraDto.ConsultaResponse r = service.consultar(0L, 1);

        assertThat(r.ultimaPosicion()).isEqualTo(42L);
        assertThat(r.hayMas()).isTrue();
        assertThat(r.eventos().get(0).payloadCrudo().get("a").asInt()).isEqualTo(1);
    }

    @Test
    void consultar_sinEventos_mantieneElCursor() {
        when(repository.buscarPosterioresA(7L, 100)).thenReturn(List.of());

        EventoSamsaraDto.ConsultaResponse r = service.consultar(7L, 100);

        assertThat(r.ultimaPosicion()).isEqualTo(7L);
        assertThat(r.hayMas()).isFalse();
        assertThat(r.eventos()).isEmpty();
    }
}
