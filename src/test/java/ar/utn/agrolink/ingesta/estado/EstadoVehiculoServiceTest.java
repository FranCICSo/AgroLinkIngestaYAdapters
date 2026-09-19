package ar.utn.agrolink.ingesta.estado;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import ar.utn.agrolink.ingesta.telemetry.EstadoInterpretacion;
import ar.utn.agrolink.ingesta.telemetry.LecturaTelemetria;
import ar.utn.agrolink.ingesta.telemetry.LecturaTelemetriaRepository;
import ar.utn.agrolink.ingesta.telemetry.OrigenOdometro;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class EstadoVehiculoServiceTest {

    @Mock private LecturaTelemetriaRepository repository;

    // Construye una LecturaTelemetria via reflection: la entidad no tiene constructor
    // publico (es @Immutable, de solo lectura por JPA) y no necesita uno para produccion.
    private static LecturaTelemetria lecturaCompleta(long id, Instant momentoEvento) {
        return lectura(
                id,
                momentoEvento,
                momentoEvento.plusSeconds(1),
                -34.603722,
                -58.381592,
                62.4,
                184,
                184.3,
                OrigenOdometro.ECU,
                76.5,
                "1M8GDM9A_KP042788",
                2200,
                30000.0,
                90,
                340,
                true,
                13.2,
                9,
                EstadoInterpretacion.COMPLETA,
                List.of(),
                "{\"3\":\"45\"}");
    }

    private static LecturaTelemetria lecturaParcialSinFixGps(long id, Instant momentoEvento) {
        return lectura(
                id,
                momentoEvento,
                momentoEvento.plusSeconds(1),
                null,
                null,
                null,
                null,
                184.3,
                OrigenOdometro.ECU,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                0,
                EstadoInterpretacion.PARCIAL,
                List.of("latitud", "longitud", "combustible_pct"),
                "{}");
    }

    private static LecturaTelemetria lectura(
            long id,
            Instant momentoEvento,
            Instant momentoRecepcion,
            Double latitud,
            Double longitud,
            Double velocidadKmh,
            Integer rumboGrados,
            Double odometroKm,
            OrigenOdometro odometroOrigen,
            Double combustiblePct,
            String vin,
            Integer rpm,
            Double combustibleConsumidoL,
            Integer temperaturaRefrigeranteC,
            Integer presionAceiteKpa,
            Boolean ignicion,
            Double tensionBateriaV,
            Integer satelites,
            EstadoInterpretacion estadoInterpretacion,
            List<String> camposFaltantes,
            String datosCan) {
        try {
            var constructor = LecturaTelemetria.class.getDeclaredConstructor();
            constructor.setAccessible(true);
            LecturaTelemetria l = constructor.newInstance();
            set(l, "id", id);
            set(l, "dispositivoId", "2326");
            set(l, "momentoEvento", momentoEvento);
            set(l, "momentoRecepcion", momentoRecepcion);
            set(l, "latitud", latitud);
            set(l, "longitud", longitud);
            set(l, "velocidadKmh", velocidadKmh);
            set(l, "rumboGrados", rumboGrados);
            set(l, "odometroKm", odometroKm);
            set(l, "odometroOrigen", odometroOrigen);
            set(l, "combustiblePct", combustiblePct);
            set(l, "vin", vin);
            set(l, "rpm", rpm);
            set(l, "combustibleConsumidoL", combustibleConsumidoL);
            set(l, "temperaturaRefrigeranteC", temperaturaRefrigeranteC);
            set(l, "presionAceiteKpa", presionAceiteKpa);
            set(l, "ignicion", ignicion);
            set(l, "tensionBateriaV", tensionBateriaV);
            set(l, "satelites", satelites);
            set(l, "estadoInterpretacion", estadoInterpretacion);
            set(l, "camposFaltantes", camposFaltantes);
            set(l, "datosCan", datosCan);
            return l;
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException(e);
        }
    }

    private static void set(Object target, String field, Object value) throws ReflectiveOperationException {
        Field f = LecturaTelemetria.class.getDeclaredField(field);
        f.setAccessible(true);
        f.set(target, value);
    }

    @Test
    void sinLecturas_lanzaVehiculoSinTelemetriaException() {
        when(repository.findFirstByDispositivoIdOrderByMomentoEventoDesc(anyString())).thenReturn(Optional.empty());

        EstadoVehiculoService service = new EstadoVehiculoService(repository);

        assertThatThrownBy(() -> service.obtenerEstado("XYZ999")).isInstanceOf(VehiculoSinTelemetriaException.class);
    }

    @Test
    void lecturaCompleta_devuelveLosTresBloquesPoblados() {
        Instant momentoEvento = Instant.parse("2026-09-09T21:42:10Z");
        when(repository.findFirstByDispositivoIdOrderByMomentoEventoDesc("2326"))
                .thenReturn(Optional.of(lecturaCompleta(1, momentoEvento)));

        EstadoVehiculoDto dto = new EstadoVehiculoService(repository).obtenerEstado("2326");

        assertThat(dto.posicion().latitud()).isEqualTo(-34.603722);
        assertThat(dto.posicion().velocidadKmh()).isEqualTo(62.4);
        assertThat(dto.canBus().vin()).isEqualTo("1M8GDM9A_KP042788");
        assertThat(dto.canBus().rpm()).isEqualTo(2200);
        assertThat(dto.canBus().velocidadRuedaKmh()).isEqualTo(45); // leido a demanda desde datos_can, id "3"
        assertThat(dto.canBus().odometroKm()).isEqualTo(184.3);
        assertThat(dto.canBus().odometroOrigen()).isEqualTo(OrigenOdometro.ECU);
        assertThat(dto.canBus().combustibleConsumidoL()).isEqualTo(30000.0);
        assertThat(dto.canBus().combustiblePct()).isEqualTo(76.5);
        assertThat(dto.canBus().temperaturaRefrigeranteC()).isEqualTo(90);
        assertThat(dto.canBus().presionAceiteKpa()).isEqualTo(340);
        assertThat(dto.canBus().tensionBateriaV()).isEqualTo(13.2); // reubicado desde dispositivo
        assertThat(dto.dispositivo().dispositivoId()).isEqualTo("2326");
        assertThat(dto.dispositivo().estadoInterpretacion()).isEqualTo(EstadoInterpretacion.COMPLETA);
        assertThat(dto.dispositivo().camposFaltantes()).isEmpty();
    }

    @Test
    void lecturaParcialSinFixGps_posicionEnNullPeroLecturaSeDevuelve() {
        Instant momentoEvento = Instant.parse("2026-09-09T21:45:00Z");
        when(repository.findFirstByDispositivoIdOrderByMomentoEventoDesc("2326"))
                .thenReturn(Optional.of(lecturaParcialSinFixGps(1, momentoEvento)));

        EstadoVehiculoDto dto = new EstadoVehiculoService(repository).obtenerEstado("2326");

        assertThat(dto.posicion().latitud()).isNull();
        assertThat(dto.posicion().longitud()).isNull();
        assertThat(dto.canBus().vin()).isNull();
        assertThat(dto.canBus().rpm()).isNull();
        assertThat(dto.canBus().velocidadRuedaKmh()).isNull(); // datos_can = "{}", sin la clave "3"
        assertThat(dto.canBus().combustibleConsumidoL()).isNull();
        assertThat(dto.canBus().temperaturaRefrigeranteC()).isNull();
        assertThat(dto.canBus().presionAceiteKpa()).isNull();
        assertThat(dto.canBus().tensionBateriaV()).isNull();
        assertThat(dto.dispositivo().estadoInterpretacion()).isEqualTo(EstadoInterpretacion.PARCIAL);
        assertThat(dto.dispositivo().camposFaltantes()).contains("latitud", "longitud", "combustible_pct");
    }

    @Test
    void lecturaConOdometroDeOrigenGps_seExponeEnKilometros() {
        Instant momentoEvento = Instant.parse("2026-09-09T21:42:10Z");
        LecturaTelemetria lecturaGps =
                lectura(
                        1,
                        momentoEvento,
                        momentoEvento.plusSeconds(1),
                        -34.603722,
                        -58.381592,
                        62.4,
                        184,
                        150.0,
                        OrigenOdometro.GPS,
                        76.5,
                        "1M8GDM9A_KP042788",
                        2200,
                        30000.0,
                        90,
                        340,
                        true,
                        13.2,
                        9,
                        EstadoInterpretacion.COMPLETA,
                        List.of(),
                        "{\"3\":\"45\"}");
        when(repository.findFirstByDispositivoIdOrderByMomentoEventoDesc("2326")).thenReturn(Optional.of(lecturaGps));

        EstadoVehiculoDto dto = new EstadoVehiculoService(repository).obtenerEstado("2326");

        assertThat(dto.canBus().odometroKm()).isEqualTo(150.0);
        assertThat(dto.canBus().odometroOrigen()).isEqualTo(OrigenOdometro.GPS);
    }

    @Test
    void sinOdometroConocido_devuelveOdometroKmNulo() {
        Instant momentoEvento = Instant.parse("2026-09-09T21:42:10Z");
        LecturaTelemetria lecturaSinOdometro =
                lectura(
                        1,
                        momentoEvento,
                        momentoEvento.plusSeconds(1),
                        -34.603722,
                        -58.381592,
                        62.4,
                        184,
                        null,
                        null,
                        76.5,
                        "1M8GDM9A_KP042788",
                        2200,
                        30000.0,
                        90,
                        340,
                        true,
                        13.2,
                        9,
                        EstadoInterpretacion.COMPLETA,
                        List.of(),
                        "{\"3\":\"45\"}");
        when(repository.findFirstByDispositivoIdOrderByMomentoEventoDesc("2326"))
                .thenReturn(Optional.of(lecturaSinOdometro));

        EstadoVehiculoDto dto = new EstadoVehiculoService(repository).obtenerEstado("2326");

        assertThat(dto.canBus().odometroKm()).isNull(); // no debe informarse como 0.0 (FR-004)
        assertThat(dto.canBus().odometroOrigen()).isNull();
    }

    @Test
    void masReciente_seDeterminaPorMomentoEvento_noPorOrdenDeLlegada() {
        // El repositorio ya ordena por momento_evento DESC (findFirst...OrderByMomentoEventoDesc):
        // este test fija que el service confia en esa fila sin reordenar por su cuenta.
        Instant masReciente = Instant.parse("2026-09-09T21:50:00Z");
        when(repository.findFirstByDispositivoIdOrderByMomentoEventoDesc("2326"))
                .thenReturn(Optional.of(lecturaCompleta(2, masReciente)));

        EstadoVehiculoDto dto = new EstadoVehiculoService(repository).obtenerEstado("2326");

        assertThat(dto.dispositivo().momentoEvento().toInstant()).isEqualTo(masReciente);
    }
}
