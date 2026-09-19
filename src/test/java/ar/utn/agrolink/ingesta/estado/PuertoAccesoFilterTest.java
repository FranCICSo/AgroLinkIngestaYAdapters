package ar.utn.agrolink.ingesta.estado;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * research.md D-01 (feature 002): el puerto nuevo (vehiculo-estado.http-port) solo debe
 * servir /api/v1/vehiculos/**; el puerto original (server.port) sigue sirviendo lo que ya
 * servia (reportes + health), sin restriccion nueva. Levanta el contexto completo (ambos
 * conectores Tomcat), por lo que necesita una base real -se salta si no hay stack levantado,
 * igual que LecturaTelemetriaRepositoryIntegrationTest.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT,
        properties = {"server.port=18080", "vehiculo-estado.http-port=18082"})
@EnabledIfEnvironmentVariable(named = "DB_HOST", matches = ".+")
class PuertoAccesoFilterTest {

    private final TestRestTemplate rest = new TestRestTemplate();

    @Test
    void puertoNuevo_rechazaRutasQueNoSonDeVehiculos() {
        ResponseEntity<String> respuesta =
                rest.getForEntity(
                        "http://localhost:18082/api/v1/reportes/viaje?camionId=2326&desde=2026-08-15T00:00:00Z&hasta=2026-08-15T23:59:59Z",
                        String.class);

        assertThat(respuesta.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void puertoNuevo_sirveLaConsultaDeEstadoDeVehiculo() {
        ResponseEntity<String> respuesta =
                rest.getForEntity("http://localhost:18082/api/v1/vehiculos/no-existe-999/estado", String.class);

        // 404 "Vehiculo sin telemetria" (FR-007/FR-008), no el 404 generico del filtro de
        // puerto: distingue que la ruta SI se dejo pasar y la respondio el controller.
        assertThat(respuesta.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(respuesta.getBody()).contains("Vehiculo sin telemetria");
    }

    @Test
    void puertoOriginal_sigueSirviendoElReporteDeViajeSinRestriccionNueva() {
        ResponseEntity<String> respuesta =
                rest.getForEntity(
                        "http://localhost:18080/api/v1/reportes/viaje?camionId=no-existe-999&desde=2026-08-15T00:00:00Z&hasta=2026-08-15T23:59:59Z",
                        String.class);

        // 404 "Sin datos" del propio ReporteViajeController, no el 404 generico del filtro.
        assertThat(respuesta.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(respuesta.getBody()).contains("Sin datos");
    }
}
