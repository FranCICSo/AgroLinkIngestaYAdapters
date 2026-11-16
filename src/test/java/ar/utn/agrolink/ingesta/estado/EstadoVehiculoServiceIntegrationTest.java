package ar.utn.agrolink.ingesta.estado;

import static org.assertj.core.api.Assertions.assertThat;

import ar.utn.agrolink.ingesta.telemetry.OrigenOdometro;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Verifica contra una TimescaleDB real la consulta de ultimo valor no nulo por campo CAN
 * ({@code last() FILTER}) y su mapeo hasta {@link EstadoVehiculoDto}: tipos NUMERIC/SMALLINT/
 * TIMESTAMPTZ de la proyeccion nativa, alias camelCase y la ventana de 24 h anclada a la ultima
 * lectura. No se puede verificar con un mock, asi que se salta sin variables de conexion (igual
 * que LecturaTelemetriaRepositoryIntegrationTest, de donde sale el patron de fixtures).
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "DB_HOST", matches = ".+")
class EstadoVehiculoServiceIntegrationTest {

    @Autowired private EstadoVehiculoService service;

    private record Fila(
            Instant momento,
            Double latitud,
            Double combustiblePct,
            Double combustibleConsumidoL,
            Double odometroKm,
            String odometroOrigen,
            String vin,
            Integer rpm,
            Integer temperaturaRefrigeranteC,
            Integer presionAceiteKpa) {}

    @Test
    void ultimaLecturaSinCan_posicionActualYCamposArrastradosConSuMomento() throws Exception {
        String dispositivoId = "ite" + (System.currentTimeMillis() % 100_000_000L);
        Instant ultima = Instant.parse("2026-08-20T12:00:00Z");
        Instant conCan = ultima.minus(Duration.ofMinutes(30));
        Instant conVin = ultima.minus(Duration.ofHours(20));
        Instant fueraDeVentana = ultima.minus(Duration.ofHours(25));

        try (Connection conn = openReceptorConnection()) {
            // Fuera de la ventana de 24 h: su combustible (10%) no debe aparecer aunque sea el
            // unico valor no nulo de presion de aceite.
            insertar(conn, dispositivoId, new Fila(fueraDeVentana, -34.0, 10.0, null, null, null, null, null, null, 400));
            insertar(conn, dispositivoId, new Fila(conVin, -34.1, 40.0, null, 150.0, "GPS", "VIN-ITEST-1", null, null, null));
            insertar(conn, dispositivoId, new Fila(conCan, -34.2, 61.5, 29_950.25, 183.9, "ECU", null, 1800, 88, null));
            // Ultima lectura: solo posicion, ningun dato CAN.
            insertar(conn, dispositivoId, new Fila(ultima, -34.3, null, null, null, null, null, null, null, null));
        }

        EstadoVehiculoDto dto = service.obtenerEstado(dispositivoId);

        assertThat(dto.posicion().latitud()).isEqualTo(-34.3);
        assertThat(dto.dispositivo().momentoEvento().toInstant()).isEqualTo(ultima);

        CanBusDto can = dto.canBus();
        assertThat(can.combustiblePct()).isEqualTo(61.5);
        assertThat(can.combustiblePctMomento().toInstant()).isEqualTo(conCan);
        assertThat(can.combustibleConsumidoL()).isEqualTo(29_950.25);
        assertThat(can.combustibleConsumidoLMomento().toInstant()).isEqualTo(conCan);
        assertThat(can.odometroKm()).isEqualTo(183.9);
        assertThat(can.odometroOrigen()).isEqualTo(OrigenOdometro.ECU);
        assertThat(can.odometroMomento().toInstant()).isEqualTo(conCan);
        assertThat(can.vin()).isEqualTo("VIN-ITEST-1");
        assertThat(can.vinMomento().toInstant()).isEqualTo(conVin);
        assertThat(can.rpm()).isEqualTo(1800);
        assertThat(can.rpmMomento().toInstant()).isEqualTo(conCan);
        assertThat(can.temperaturaRefrigeranteC()).isEqualTo(88);
        assertThat(can.temperaturaRefrigeranteCMomento().toInstant()).isEqualTo(conCan);
        // No arrastrable: sale solo de la ultima lectura.
        assertThat(can.presionAceiteKpa()).isNull();
    }

    @Test
    void sinValoresEnLaVentana_camposYMomentosEnNull() throws Exception {
        String dispositivoId = "itf" + (System.currentTimeMillis() % 100_000_000L);
        Instant ultima = Instant.parse("2026-08-20T12:00:00Z");

        try (Connection conn = openReceptorConnection()) {
            insertar(conn, dispositivoId, new Fila(ultima.minus(Duration.ofHours(30)), -34.0, 50.0, 100.0, 10.0, "ECU", "VIN-VIEJO", 900, 70, null));
            insertar(conn, dispositivoId, new Fila(ultima, -34.3, null, null, null, null, null, null, null, null));
        }

        CanBusDto can = service.obtenerEstado(dispositivoId).canBus();

        assertThat(can.combustiblePct()).isNull();
        assertThat(can.combustiblePctMomento()).isNull();
        assertThat(can.odometroKm()).isNull();
        assertThat(can.odometroOrigen()).isNull();
        assertThat(can.vin()).isNull();
        assertThat(can.rpm()).isNull();
        assertThat(can.temperaturaRefrigeranteC()).isNull();
        assertThat(can.temperaturaRefrigeranteCMomento()).isNull();
    }

    private static Connection openReceptorConnection() throws Exception {
        String url = "jdbc:postgresql://%s:%s/%s?currentSchema=telemetria"
                .formatted(System.getenv("DB_HOST"), System.getenv("DB_PORT"), System.getenv("POSTGRES_DB"));
        return DriverManager.getConnection(
                url, System.getenv("RINHO_RECEPTOR_DB_USER"), System.getenv("RINHO_RECEPTOR_DB_PASSWORD"));
    }

    private static void insertar(Connection conn, String dispositivoId, Fila f) throws Exception {
        String payload = "fixture-estado-" + f.momento() + "-" + System.nanoTime();
        String sql =
                """
                INSERT INTO lectura_telemetria (
                    dispositivo_id, momento_evento, latitud, longitud, combustible_pct,
                    combustible_consumido_l, odometro_km, odometro_origen, vin, rpm,
                    temperatura_refrigerante_c, presion_aceite_kpa, estado_interpretacion,
                    payload_crudo, frame_hash
                ) VALUES (?, ?, ?, -58.4, ?, ?, ?, ?, ?, ?, ?, ?, 'PARCIAL', ?, ?)
                """;
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, dispositivoId);
            ps.setTimestamp(2, Timestamp.from(f.momento()));
            ps.setObject(3, f.latitud(), Types.NUMERIC);
            ps.setObject(4, f.combustiblePct(), Types.NUMERIC);
            ps.setObject(5, f.combustibleConsumidoL(), Types.NUMERIC);
            ps.setObject(6, f.odometroKm(), Types.DOUBLE);
            ps.setObject(7, f.odometroOrigen(), Types.VARCHAR);
            ps.setObject(8, f.vin(), Types.VARCHAR);
            ps.setObject(9, f.rpm(), Types.SMALLINT);
            ps.setObject(10, f.temperaturaRefrigeranteC(), Types.SMALLINT);
            ps.setObject(11, f.presionAceiteKpa(), Types.SMALLINT);
            ps.setString(12, payload);
            ps.setString(13, HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(payload.getBytes())));
            ps.executeUpdate();
        }
    }
}
