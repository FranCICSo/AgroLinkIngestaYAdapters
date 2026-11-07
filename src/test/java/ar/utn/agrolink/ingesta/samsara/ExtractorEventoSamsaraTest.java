package ar.utn.agrolink.ingesta.samsara;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** Principio VIII: datos completos, campos faltantes y datos invalidos. */
class ExtractorEventoSamsaraTest {

    private final ExtractorEventoSamsara extractor = new ExtractorEventoSamsara(new ObjectMapper());

    static final String ENDED_COMPLETO = """
            {
              "eventId": "ev-2",
              "eventTime": "2026-11-04T13:06:40.000Z",
              "eventType": "SevereSpeedingEnded",
              "orgId": 1001,
              "webhookId": "agrolink-poc",
              "data": { "data": {
                "startTime": "2026-11-04T13:05:12.000Z",
                "endTime": "2026-11-04T13:06:40.000Z",
                "tripStartTime": "2026-11-04T12:40:00.000Z",
                "vehicle": { "id": "281474977000101", "name": "Camión AGL007", "licensePlate": "AGL007",
                             "vehicleVin": "8AC906635RE000107", "assetType": "vehicle", "externalIds": {} }
              } }
            }""";

    @Test
    void conDatosCompletos_extraeTodosLosCamposDeConsulta() {
        EventoSamsaraExtraido e = extractor.extraer(ENDED_COMPLETO);

        assertThat(e.eventId()).isEqualTo("ev-2");
        assertThat(e.tipoEvento()).isEqualTo("SevereSpeedingEnded");
        assertThat(e.momentoEvento()).isEqualTo(Instant.parse("2026-11-04T13:06:40Z"));
        assertThat(e.samsaraVehiculoId()).isEqualTo("281474977000101");
        assertThat(e.patente()).isEqualTo("AGL007");
        assertThat(e.inicioExceso()).isEqualTo(Instant.parse("2026-11-04T13:05:12Z"));
        assertThat(e.finExceso()).isEqualTo(Instant.parse("2026-11-04T13:06:40Z"));
        assertThat(e.inicioViaje()).isEqualTo(Instant.parse("2026-11-04T12:40:00Z"));
        assertThat(e.camposFaltantes()).isEmpty();
        assertThat(e.payloadJson()).contains("\"webhookId\":\"agrolink-poc\"");
    }

    @Test
    void startedSinEndTime_noLoCuentaComoFaltante() {
        EventoSamsaraExtraido e = extractor.extraer(ENDED_COMPLETO
                .replace("\"endTime\": \"2026-11-04T13:06:40.000Z\",", "")
                .replace("SevereSpeedingEnded", "SevereSpeedingStarted"));

        assertThat(e.finExceso()).isNull();
        assertThat(e.camposFaltantes()).isEmpty();
    }

    @Test
    void conCamposFaltantes_guardaIgualYLosAnota() {
        EventoSamsaraExtraido e = extractor.extraer("{\"eventType\":\"VehicleCreated\"}");

        assertThat(e.tipoEvento()).isEqualTo("VehicleCreated");
        assertThat(e.eventId()).isNull();
        assertThat(e.momentoEvento()).isNull();
        assertThat(e.samsaraVehiculoId()).isNull();
        assertThat(e.camposFaltantes())
                .contains("eventId", "eventTime", "vehicle.id", "vehicle.licensePlate", "startTime", "tripStartTime");
    }

    @Test
    void conFechaNoRfc3339OIdDeOtroTipo_dejaNullSinRechazar() {
        EventoSamsaraExtraido e = extractor.extraer(ENDED_COMPLETO
                .replace("\"startTime\": \"2026-11-04T13:05:12.000Z\"", "\"startTime\": \"ayer\"")
                .replace("\"id\": \"281474977000101\"", "\"id\": {\"x\": 1}"));

        assertThat(e.inicioExceso()).isNull();
        assertThat(e.samsaraVehiculoId()).isNull();
        assertThat(e.camposFaltantes()).contains("startTime", "vehicle.id");
    }

    @Test
    void conIdNumerico_loAceptaComoTexto() {
        EventoSamsaraExtraido e = extractor.extraer(ENDED_COMPLETO.replace("\"id\": \"281474977000101\"", "\"id\": 281474977000101"));

        assertThat(e.samsaraVehiculoId()).isEqualTo("281474977000101");
    }

    @Test
    void conCuerpoQueNoEsJson_rechaza() {
        assertThatThrownBy(() -> extractor.extraer("no-es-json")).isInstanceOf(JsonInvalidoException.class);
        assertThatThrownBy(() -> extractor.extraer("   ")).isInstanceOf(JsonInvalidoException.class);
        assertThatThrownBy(() -> extractor.extraer(null)).isInstanceOf(JsonInvalidoException.class);
    }
}
