package ar.utn.agrolink.ingesta.samsara;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Contra una TimescaleDB real con la migracion 009 aplicada (se salta sin DB_HOST, igual que
 * LecturaTelemetriaRepositoryIntegrationTest): lo que se prueba es SQL que un mock no cubre, el
 * {@code ON CONFLICT} sobre el indice unico parcial de la hypertable y el margen de commit.
 */
@SpringBootTest(properties = "agrolink.samsara.margen-commit-ms=0")
@EnabledIfEnvironmentVariable(named = "DB_HOST", matches = ".+")
class EventoSamsaraRepositoryIntegrationTest {

    @Autowired private EventoSamsaraRepository repository;

    private final ExtractorEventoSamsara extractor = new ExtractorEventoSamsara(new ObjectMapper());

    @Test
    void insertaUnaVez_deduplicaElReintento_yLoDevuelveDesdeElCursor() {
        String eventId = "it-" + UUID.randomUUID();
        EventoSamsaraExtraido evento = extractor.extraer(
                ExtractorEventoSamsaraTest.ENDED_COMPLETO.replace("\"ev-2\"", "\"" + eventId + "\""));

        Optional<Long> id = repository.insertar(evento);
        assertThat(id).isPresent();
        assertThat(repository.insertar(evento)).isEmpty();

        List<EventoSamsaraGuardado> filas = repository.buscarPosterioresA(id.get() - 1, 10);
        assertThat(filas).isNotEmpty();
        EventoSamsaraGuardado fila = filas.get(0);
        assertThat(fila.id()).isEqualTo(id.get());
        assertThat(fila.eventId()).isEqualTo(eventId);
        assertThat(fila.inicioExceso()).isEqualTo(Instant.parse("2026-11-04T13:05:12Z"));
        assertThat(fila.finExceso()).isEqualTo(Instant.parse("2026-11-04T13:06:40Z"));
        assertThat(fila.payloadJson()).contains(eventId);
    }

    @Test
    void sinEventIdNiEventTime_seGuardaIgual() {
        assertThat(repository.insertar(extractor.extraer("{\"eventType\":\"VehicleCreated\"}"))).isPresent();
    }
}
