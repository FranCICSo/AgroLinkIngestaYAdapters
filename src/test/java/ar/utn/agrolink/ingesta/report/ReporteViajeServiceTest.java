package ar.utn.agrolink.ingesta.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import ar.utn.agrolink.ingesta.telemetry.LecturaTelemetria;
import ar.utn.agrolink.ingesta.telemetry.LecturaTelemetriaRepository;
import ar.utn.agrolink.ingesta.telemetry.OrigenOdometro;
import java.lang.reflect.Field;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ReporteViajeServiceTest {

    @Mock private LecturaTelemetriaRepository repository;

    private static final OffsetDateTime DESDE = OffsetDateTime.parse("2026-08-15T00:00:00Z");
    private static final OffsetDateTime HASTA = OffsetDateTime.parse("2026-08-15T23:59:59Z");

    // Construye una LecturaTelemetria via reflection: la entidad no tiene constructor
    // publico (es @Immutable, de solo lectura por JPA) y no necesita uno para produccion.
    private static LecturaTelemetria lectura(
            long id, Instant momentoEvento, Double velocidadKmh, Double odometroKm,
            OrigenOdometro odometroOrigen, Double combustiblePct) {
        try {
            var constructor = LecturaTelemetria.class.getDeclaredConstructor();
            constructor.setAccessible(true);
            LecturaTelemetria l = constructor.newInstance();
            set(l, "id", id);
            set(l, "dispositivoId", "2326");
            set(l, "momentoEvento", momentoEvento);
            set(l, "velocidadKmh", velocidadKmh);
            set(l, "odometroKm", odometroKm);
            set(l, "odometroOrigen", odometroOrigen);
            set(l, "combustiblePct", combustiblePct);
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
    void sinLecturas_lanzaSinDatosException() {
        when(repository.findByDispositivoIdAndMomentoEventoBetweenOrderByMomentoEventoAsc(
                        anyString(), any(), any()))
                .thenReturn(List.of());

        ReporteViajeService service = new ReporteViajeService(repository);

        assertThatThrownBy(() -> service.calcular("2326", DESDE, HASTA))
                .isInstanceOf(SinDatosException.class);
    }

    @Test
    void cincoMetricas_sobreConjuntoConocido() {
        List<LecturaTelemetria> lecturas =
                List.of(
                        lectura(1, Instant.parse("2026-08-15T08:00:00Z"), 50.0, 100.0, OrigenOdometro.GPS, 80.0),
                        lectura(2, Instant.parse("2026-08-15T10:00:00Z"), 90.0, 150.0, OrigenOdometro.GPS, 60.0),
                        lectura(3, Instant.parse("2026-08-15T12:00:00Z"), 70.0, 200.0, OrigenOdometro.GPS, 50.0));
        when(repository.findByDispositivoIdAndMomentoEventoBetweenOrderByMomentoEventoAsc(
                        anyString(), any(), any()))
                .thenReturn(lecturas);

        ReporteViajeService service = new ReporteViajeService(repository);
        ReporteViajeDto dto = service.calcular("2326", DESDE, HASTA);

        assertThat(dto.distanciaKm()).isEqualTo(100.0); // 200 - 100, en kilometros
        assertThat(dto.combustibleConsumidoPct()).isEqualTo(30.0); // 80 - 50
        assertThat(dto.tasaConsumoPromedio()).isEqualTo(30.0 / 100.0);
        assertThat(dto.tasaConsumoPromedioNoCalculable()).isFalse();
        assertThat(dto.velocidadPromedioKmh()).isEqualTo((50.0 + 90.0 + 70.0) / 3);
        assertThat(dto.velocidadMaximaKmh()).isEqualTo(90.0);
        assertThat(dto.lecturasConsideradas()).isEqualTo(3);
        assertThat(dto.odometroOrigenMixto()).isFalse();
    }

    @Test
    void unaSolaLectura_distanciaYCombustibleCero_tasaNull() {
        List<LecturaTelemetria> lecturas =
                List.of(lectura(1, Instant.parse("2026-08-15T08:00:00Z"), 50.0, 100.0, OrigenOdometro.GPS, 80.0));
        when(repository.findByDispositivoIdAndMomentoEventoBetweenOrderByMomentoEventoAsc(
                        anyString(), any(), any()))
                .thenReturn(lecturas);

        ReporteViajeDto dto = new ReporteViajeService(repository).calcular("2326", DESDE, HASTA);

        assertThat(dto.distanciaKm()).isZero();
        assertThat(dto.combustibleConsumidoPct()).isZero();
        assertThat(dto.tasaConsumoPromedio()).isNull();
        assertThat(dto.tasaConsumoPromedioNoCalculable()).isTrue();
    }

    @Test
    void distanciaCero_conLecturasPresentes_tasaNullYFlagTrue() {
        List<LecturaTelemetria> lecturas =
                List.of(
                        lectura(1, Instant.parse("2026-08-15T08:00:00Z"), 0.0, 100.0, OrigenOdometro.GPS, 80.0),
                        lectura(2, Instant.parse("2026-08-15T09:00:00Z"), 0.0, 100.0, OrigenOdometro.GPS, 79.0));
        when(repository.findByDispositivoIdAndMomentoEventoBetweenOrderByMomentoEventoAsc(
                        anyString(), any(), any()))
                .thenReturn(lecturas);

        ReporteViajeDto dto = new ReporteViajeService(repository).calcular("2326", DESDE, HASTA);

        assertThat(dto.distanciaKm()).isZero();
        assertThat(dto.tasaConsumoPromedio()).isNull();
        assertThat(dto.tasaConsumoPromedioNoCalculable()).isTrue();
    }

    @Test
    void ningunaLecturaConCombustible_combustibleNullYTasaNull() {
        List<LecturaTelemetria> lecturas =
                List.of(
                        lectura(1, Instant.parse("2026-08-15T08:00:00Z"), 50.0, 100.0, OrigenOdometro.GPS, null),
                        lectura(2, Instant.parse("2026-08-15T09:00:00Z"), 60.0, 150.0, OrigenOdometro.GPS, null));
        when(repository.findByDispositivoIdAndMomentoEventoBetweenOrderByMomentoEventoAsc(
                        anyString(), any(), any()))
                .thenReturn(lecturas);

        ReporteViajeDto dto = new ReporteViajeService(repository).calcular("2326", DESDE, HASTA);

        assertThat(dto.combustibleConsumidoPct()).isNull();
        assertThat(dto.tasaConsumoPromedio()).isNull();
        assertThat(dto.tasaConsumoPromedioNoCalculable()).isTrue();
    }

    @Test
    void combustibleConsumidoNegativo_seDevuelveTalCualSinRecortarACero() {
        // Recarga dentro del rango: la ultima lectura tiene MAS combustible que la primera.
        List<LecturaTelemetria> lecturas =
                List.of(
                        lectura(1, Instant.parse("2026-08-15T08:00:00Z"), 50.0, 100.0, OrigenOdometro.GPS, 20.0),
                        lectura(2, Instant.parse("2026-08-15T09:00:00Z"), 50.0, 110.0, OrigenOdometro.GPS, 90.0));
        when(repository.findByDispositivoIdAndMomentoEventoBetweenOrderByMomentoEventoAsc(
                        anyString(), any(), any()))
                .thenReturn(lecturas);

        ReporteViajeDto dto = new ReporteViajeService(repository).calcular("2326", DESDE, HASTA);

        assertThat(dto.combustibleConsumidoPct()).isEqualTo(-70.0);
        assertThat(dto.tasaConsumoPromedioNoCalculable()).isFalse();
    }

    @Test
    void odometroOrigenMixto_true_cuandoElRangoCombinaEcuYGps() {
        List<LecturaTelemetria> lecturas =
                List.of(
                        lectura(1, Instant.parse("2026-08-15T08:00:00Z"), 50.0, 100.0, OrigenOdometro.GPS, 80.0),
                        lectura(2, Instant.parse("2026-08-15T09:00:00Z"), 50.0, 66010.0, OrigenOdometro.ECU, 75.0));
        when(repository.findByDispositivoIdAndMomentoEventoBetweenOrderByMomentoEventoAsc(
                        anyString(), any(), any()))
                .thenReturn(lecturas);

        ReporteViajeDto dto = new ReporteViajeService(repository).calcular("2326", DESDE, HASTA);

        assertThat(dto.odometroOrigenMixto()).isTrue();
    }

    @Test
    void odometroOrigenMixto_false_cuandoTodasSonDelMismoOrigen() {
        List<LecturaTelemetria> lecturas =
                List.of(
                        lectura(1, Instant.parse("2026-08-15T08:00:00Z"), 50.0, 66000.0, OrigenOdometro.ECU, 80.0),
                        lectura(2, Instant.parse("2026-08-15T09:00:00Z"), 50.0, 66010.0, OrigenOdometro.ECU, 75.0));
        when(repository.findByDispositivoIdAndMomentoEventoBetweenOrderByMomentoEventoAsc(
                        anyString(), any(), any()))
                .thenReturn(lecturas);

        ReporteViajeDto dto = new ReporteViajeService(repository).calcular("2326", DESDE, HASTA);

        assertThat(dto.odometroOrigenMixto()).isFalse();
    }
}
