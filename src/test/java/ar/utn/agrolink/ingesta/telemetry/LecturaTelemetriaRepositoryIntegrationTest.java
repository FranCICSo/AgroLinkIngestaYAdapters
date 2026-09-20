package ar.utn.agrolink.ingesta.telemetry;

import static org.assertj.core.api.Assertions.assertThat;

import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * T068 (FR-012, segunda mitad de T067): verifica que el repositorio de T050 devuelve una
 * lectura llegada tarde ORDENADA por momento_evento, no relegada al final por orden de
 * insercion. Es un test de integracion contra una TimescaleDB real -no se puede verificar
 * con un mock, porque lo que se prueba es el ORDER BY derivado del nombre del metodo-, asi
 * que se salta si no hay variables de conexion (p.ej. `mvn test` sin el stack levantado).
 *
 * La insercion de fixtures usa las credenciales de RINHO_RECEPTOR_DB_USER (via JDBC crudo,
 * no el DataSource de la app): el rol agrolink_ingesta que usa este servicio solo tiene
 * GRANT SELECT (Principio IV), asi que no podria insertar sus propios datos de prueba.
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "DB_HOST", matches = ".+")
class LecturaTelemetriaRepositoryIntegrationTest {

    @Autowired private LecturaTelemetriaRepository repository;

    @Test
    void lecturaLlegadaTarde_quedaOrdenadaPorMomentoEvento_noPorOrdenDeInsercion() throws Exception {
        String dispositivoId = "it" + (System.currentTimeMillis() % 100_000_000L);
        Instant nueva = Instant.parse("2026-08-15T12:00:00Z");
        Instant tardia = Instant.parse("2026-08-15T08:00:00Z"); // anterior, pero insertada despues

        try (Connection conn = openReceptorConnection()) {
            insertarFixture(conn, dispositivoId, nueva, "nueva");
            insertarFixture(conn, dispositivoId, tardia, "tardia");
        }

        List<LecturaTelemetria> resultado =
                repository.findByDispositivoIdAndMomentoEventoBetweenOrderByMomentoEventoAsc(
                        dispositivoId, Instant.parse("2026-08-15T00:00:00Z"), Instant.parse("2026-08-15T23:59:59Z"));

        assertThat(resultado).hasSize(2);
        assertThat(resultado.get(0).getMomentoEvento()).isEqualTo(tardia); // la mas vieja, primera
        assertThat(resultado.get(1).getMomentoEvento()).isEqualTo(nueva);
    }

    private static Connection openReceptorConnection() throws Exception {
        String host = System.getenv("DB_HOST");
        String port = System.getenv("DB_PORT");
        String db = System.getenv("POSTGRES_DB");
        String user = System.getenv("RINHO_RECEPTOR_DB_USER");
        String password = System.getenv("RINHO_RECEPTOR_DB_PASSWORD");
        String url = "jdbc:postgresql://%s:%s/%s?currentSchema=telemetria".formatted(host, port, db);
        return DriverManager.getConnection(url, user, password);
    }

    private static void insertarFixture(Connection conn, String dispositivoId, Instant momentoEvento, String marcador)
            throws Exception {
        String payload = "fixture-java-" + marcador + "-" + System.nanoTime();
        String frameHash = sha256Hex(payload);
        String sql =
                """
                INSERT INTO lectura_telemetria (
                    dispositivo_id, momento_evento, velocidad_kmh, odometro_km, odometro_origen,
                    combustible_pct, estado_interpretacion, payload_crudo, frame_hash
                ) VALUES (?, ?, 42, 1000, 'GPS', 50, 'COMPLETA', ?, ?)
                """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, dispositivoId);
            ps.setTimestamp(2, Timestamp.from(momentoEvento));
            ps.setString(3, payload);
            ps.setString(4, frameHash);
            ps.executeUpdate();
        }
    }

    private static String sha256Hex(String input) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(input.getBytes());
        return HexFormat.of().formatHex(digest);
    }
}
