package ar.utn.agrolink.ingesta.estado;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import ar.utn.agrolink.ingesta.telemetry.EstadoInterpretacion;
import ar.utn.agrolink.ingesta.telemetry.LecturaTelemetria;
import ar.utn.agrolink.ingesta.telemetry.LecturaTelemetriaRepository;
import ar.utn.agrolink.ingesta.telemetry.OrigenOdometro;
import ar.utn.agrolink.ingesta.telemetry.UltimosValoresCan;
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
                4.2,
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
            Double bleTemperaturaC,
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
            set(l, "bleTemperaturaC", bleTemperaturaC);
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

    /** Implementacion de prueba de la proyeccion que devuelve la consulta agregada. */
    private record Ultimos(
            Double getCombustiblePct,
            Instant getCombustiblePctMomento,
            Double getCombustibleConsumidoL,
            Instant getCombustibleConsumidoLMomento,
            Double getOdometroKm,
            String getOdometroOrigen,
            Instant getOdometroMomento,
            String getVin,
            Instant getVinMomento,
            Integer getRpm,
            Instant getRpmMomento,
            Integer getTemperaturaRefrigeranteC,
            Instant getTemperaturaRefrigeranteCMomento)
            implements UltimosValoresCan {}

    // Lo que devolveria la base si la ultima lectura fuera la unica de la ventana: cada campo
    // no nulo sale de ella, con su momento_evento; cada campo nulo queda nulo y sin momento.
    private static UltimosValoresCan ultimosDe(LecturaTelemetria l) {
        Instant m = l.getMomentoEvento();
        return new Ultimos(
                l.getCombustiblePct(),
                l.getCombustiblePct() == null ? null : m,
                l.getCombustibleConsumidoL(),
                l.getCombustibleConsumidoL() == null ? null : m,
                l.getOdometroKm(),
                l.getOdometroKm() == null ? null : l.getOdometroOrigen().name(),
                l.getOdometroKm() == null ? null : m,
                l.getVin(),
                l.getVin() == null ? null : m,
                l.getRpm(),
                l.getRpm() == null ? null : m,
                l.getTemperaturaRefrigeranteC(),
                l.getTemperaturaRefrigeranteC() == null ? null : m);
    }

    private void stubUltimaLectura(LecturaTelemetria l) {
        when(repository.findFirstByDispositivoIdOrderByMomentoEventoDesc("2326")).thenReturn(Optional.of(l));
        when(repository.findUltimosValoresCanNoNulos(
                        "2326", l.getMomentoEvento().minus(EstadoVehiculoService.VENTANA_ULTIMO_VALOR_CAN), l.getMomentoEvento()))
                .thenReturn(ultimosDe(l));
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
        stubUltimaLectura(lecturaCompleta(1, momentoEvento));

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
        assertThat(dto.canBus().bleTemperaturaC()).isEqualTo(4.2);
        assertThat(dto.dispositivo().dispositivoId()).isEqualTo("2326");
        assertThat(dto.dispositivo().estadoInterpretacion()).isEqualTo(EstadoInterpretacion.COMPLETA);
        assertThat(dto.dispositivo().camposFaltantes()).isEmpty();
    }

    @Test
    void lecturaParcialSinFixGps_posicionEnNullPeroLecturaSeDevuelve() {
        Instant momentoEvento = Instant.parse("2026-09-09T21:45:00Z");
        stubUltimaLectura(lecturaParcialSinFixGps(1, momentoEvento));

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
        assertThat(dto.canBus().bleTemperaturaC()).isNull();
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
                        4.2,
                        9,
                        EstadoInterpretacion.COMPLETA,
                        List.of(),
                        "{\"3\":\"45\"}");
        stubUltimaLectura(lecturaGps);

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
                        4.2,
                        9,
                        EstadoInterpretacion.COMPLETA,
                        List.of(),
                        "{\"3\":\"45\"}");
        stubUltimaLectura(lecturaSinOdometro);

        EstadoVehiculoDto dto = new EstadoVehiculoService(repository).obtenerEstado("2326");

        assertThat(dto.canBus().odometroKm()).isNull(); // no debe informarse como 0.0 (FR-004)
        assertThat(dto.canBus().odometroOrigen()).isNull();
    }

    @Test
    void masReciente_seDeterminaPorMomentoEvento_noPorOrdenDeLlegada() {
        // El repositorio ya ordena por momento_evento DESC (findFirst...OrderByMomentoEventoDesc):
        // este test fija que el service confia en esa fila sin reordenar por su cuenta.
        Instant masReciente = Instant.parse("2026-09-09T21:50:00Z");
        stubUltimaLectura(lecturaCompleta(2, masReciente));

        EstadoVehiculoDto dto = new EstadoVehiculoService(repository).obtenerEstado("2326");

        assertThat(dto.dispositivo().momentoEvento().toInstant()).isEqualTo(masReciente);
    }

    @Test
    void ultimaLecturaSinCan_completaCamposLentosConUltimoValorNoNuloYSuMomento() {
        // La ultima trama trae posicion pero no CAN; la base informa los ultimos valores no
        // nulos de las 24 h previas, que salen de lecturas mas viejas.
        Instant ultima = Instant.parse("2026-09-09T22:00:00Z");
        Instant conCombustible = Instant.parse("2026-09-09T21:30:00Z");
        Instant conVin = Instant.parse("2026-09-09T08:00:00Z");
        LecturaTelemetria sinCan =
                lectura(
                        7, ultima, ultima.plusSeconds(1), -34.61, -58.39, 55.0, 90, null, null, null, null, null,
                        null, null, null, true, null, null, 10, EstadoInterpretacion.PARCIAL,
                        List.of("combustible_pct"), "{}");
        when(repository.findFirstByDispositivoIdOrderByMomentoEventoDesc("2326")).thenReturn(Optional.of(sinCan));
        when(repository.findUltimosValoresCanNoNulos(
                        eq("2326"), eq(ultima.minus(EstadoVehiculoService.VENTANA_ULTIMO_VALOR_CAN)), eq(ultima)))
                .thenReturn(new Ultimos(
                        61.5, conCombustible, 29_950.0, conCombustible, 183.9, "ECU", conCombustible,
                        "1M8GDM9A_KP042788", conVin, 1800, conCombustible, 88, conCombustible));

        EstadoVehiculoDto dto = new EstadoVehiculoService(repository).obtenerEstado("2326");

        // La posicion y el dispositivo siguen siendo los de la ultima lectura.
        assertThat(dto.posicion().latitud()).isEqualTo(-34.61);
        assertThat(dto.posicion().velocidadKmh()).isEqualTo(55.0);
        assertThat(dto.dispositivo().momentoEvento().toInstant()).isEqualTo(ultima);
        // Los campos lentos se arrastran, cada uno con el momento de la lectura de origen.
        assertThat(dto.canBus().combustiblePct()).isEqualTo(61.5);
        assertThat(dto.canBus().combustiblePctMomento().toInstant()).isEqualTo(conCombustible);
        assertThat(dto.canBus().combustibleConsumidoL()).isEqualTo(29_950.0);
        assertThat(dto.canBus().combustibleConsumidoLMomento().toInstant()).isEqualTo(conCombustible);
        assertThat(dto.canBus().odometroKm()).isEqualTo(183.9);
        assertThat(dto.canBus().odometroOrigen()).isEqualTo(OrigenOdometro.ECU);
        assertThat(dto.canBus().odometroMomento().toInstant()).isEqualTo(conCombustible);
        assertThat(dto.canBus().vin()).isEqualTo("1M8GDM9A_KP042788");
        assertThat(dto.canBus().vinMomento().toInstant()).isEqualTo(conVin);
        assertThat(dto.canBus().rpm()).isEqualTo(1800);
        assertThat(dto.canBus().rpmMomento().toInstant()).isEqualTo(conCombustible);
        assertThat(dto.canBus().temperaturaRefrigeranteC()).isEqualTo(88);
        assertThat(dto.canBus().temperaturaRefrigeranteCMomento().toInstant()).isEqualTo(conCombustible);
    }

    @Test
    void ultimaLecturaSinCan_noArrastraCamposNoArrastrables() {
        // Presion, tension, BLE y velocidad de rueda salen solo de la ultima lectura: aunque
        // haya valores viejos, si la ultima no los trae quedan en null.
        Instant ultima = Instant.parse("2026-09-09T22:00:00Z");
        LecturaTelemetria sinCan =
                lectura(
                        7, ultima, ultima.plusSeconds(1), -34.61, -58.39, 0.0, 90, null, null, null, null, null,
                        null, null, null, false, null, null, 10, EstadoInterpretacion.PARCIAL, List.of(), "{}");
        when(repository.findFirstByDispositivoIdOrderByMomentoEventoDesc("2326")).thenReturn(Optional.of(sinCan));
        when(repository.findUltimosValoresCanNoNulos(eq("2326"), eq(ultima.minus(EstadoVehiculoService.VENTANA_ULTIMO_VALOR_CAN)), eq(ultima)))
                .thenReturn(new Ultimos(
                        61.5, ultima.minusSeconds(600), null, null, null, null, null, null, null, null, null, null,
                        null));

        EstadoVehiculoDto dto = new EstadoVehiculoService(repository).obtenerEstado("2326");

        assertThat(dto.canBus().combustiblePct()).isEqualTo(61.5);
        assertThat(dto.canBus().presionAceiteKpa()).isNull();
        assertThat(dto.canBus().tensionBateriaV()).isNull();
        assertThat(dto.canBus().bleTemperaturaC()).isNull();
        assertThat(dto.canBus().velocidadRuedaKmh()).isNull();
    }

    @Test
    void sinValorEnLaVentana_campoYMomentoQuedanEnNull() {
        Instant ultima = Instant.parse("2026-09-09T22:00:00Z");
        LecturaTelemetria sinCan =
                lectura(
                        7, ultima, ultima.plusSeconds(1), -34.61, -58.39, 0.0, 90, null, null, null, null, null,
                        null, null, null, false, null, null, 10, EstadoInterpretacion.PARCIAL, List.of(), "{}");
        stubUltimaLectura(sinCan);

        EstadoVehiculoDto dto = new EstadoVehiculoService(repository).obtenerEstado("2326");

        assertThat(dto.canBus().combustiblePct()).isNull();
        assertThat(dto.canBus().combustiblePctMomento()).isNull();
        assertThat(dto.canBus().odometroKm()).isNull();
        assertThat(dto.canBus().odometroOrigen()).isNull();
        assertThat(dto.canBus().odometroMomento()).isNull();
        assertThat(dto.canBus().vin()).isNull();
        assertThat(dto.canBus().vinMomento()).isNull();
        assertThat(dto.canBus().rpm()).isNull();
        assertThat(dto.canBus().rpmMomento()).isNull();
        assertThat(dto.canBus().temperaturaRefrigeranteC()).isNull();
        assertThat(dto.canBus().temperaturaRefrigeranteCMomento()).isNull();
    }
}
