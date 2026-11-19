package ar.utn.agrolink.ingesta.viajeprogramado;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ar.utn.agrolink.ingesta.viajeprogramado.SimuladorViajesClient.Detencion;
import ar.utn.agrolink.ingesta.viajeprogramado.SimuladorViajesClient.DetencionSimulador;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** Feature 014-simulacion-ruta-del-viaje, Historia 3: detencion de la simulacion Rinho. */
@ExtendWith(MockitoExtension.class)
class ViajeProgramadoDetencionTest {

    @Mock private ViajeProgramadoRepository repository;
    @Mock private SimuladorViajesClient simuladorViajesClient;

    private ViajeProgramadoService service() {
        return new ViajeProgramadoService(repository, simuladorViajesClient);
    }

    private ViajeProgramado viaje(String tripCode, String iotDeviceId) {
        return new ViajeProgramado(
                tripCode, iotDeviceId, LocalDateTime.now(),
                new BigDecimal("-34.6467"), new BigDecimal("-58.4894"),
                new BigDecimal("-34.6037"), new BigDecimal("-58.3816"), "Viaje " + tripCode);
    }

    private ViajeProgramado disparado(String tripCode, String iotDeviceId) {
        ViajeProgramado v = viaje(tripCode, iotDeviceId);
        v.marcarDisparado();
        return v;
    }

    @Test
    void disparadoVigente_detieneEnElSimulador_yQuedaDetenido() {
        ViajeProgramado v = disparado("V1", "900001");
        when(repository.findByTripCode("V1")).thenReturn(Optional.of(v));
        when(repository.existsByIotDeviceIdAndEstadoAndActualizadoEnAfter(eq("900001"), eq(ViajeProgramado.DISPARADO), any()))
                .thenReturn(false);
        when(simuladorViajesClient.detener("900001", "V1", "COMPLETADO"))
                .thenReturn(new DetencionSimulador(Detencion.DETENIDA, null));

        DetencionResultado r = service().detener("900001", "V1", "COMPLETADO");

        assertThat(r).isEqualTo(new DetencionResultado("V1", "900001", "DETENIDO", "DETENIDA"));
        assertThat(v.getEstado()).isEqualTo(ViajeProgramado.DETENIDO);
        verify(repository).save(v);
    }

    @Test
    void simuladorSinViajeEnCurso_igualQuedaDetenido_sinSimulacionEnCurso() {
        ViajeProgramado v = disparado("V1", "900001");
        when(repository.findByTripCode("V1")).thenReturn(Optional.of(v));
        when(repository.existsByIotDeviceIdAndEstadoAndActualizadoEnAfter(anyString(), anyString(), any())).thenReturn(false);
        when(simuladorViajesClient.detener("900001", "V1", null))
                .thenReturn(new DetencionSimulador(Detencion.SIN_VIAJE_EN_CURSO, "camion_no_encontrado"));

        DetencionResultado r = service().detener("900001", "V1", null);

        assertThat(r.efecto()).isEqualTo(DetencionResultado.SIN_SIMULACION_EN_CURSO);
        assertThat(v.getEstado()).isEqualTo(ViajeProgramado.DETENIDO);
    }

    @Test
    void segundaDetencion_esIdempotente_yNoLlamaAlSimulador() {
        ViajeProgramado v = disparado("V1", "900001");
        v.marcarDetenido();
        when(repository.findByTripCode("V1")).thenReturn(Optional.of(v));

        DetencionResultado r = service().detener("900001", "V1", "COMPLETADO");

        assertThat(r.efecto()).isEqualTo(DetencionResultado.SIN_SIMULACION_EN_CURSO);
        verify(simuladorViajesClient, never()).detener(anyString(), anyString(), any());
        verify(repository, never()).save(any());
    }

    @Test
    void simulacionReemplazadaPorViajeMasNuevo_noFrenaLaNueva() {
        ViajeProgramado viejo = disparado("V1", "900001");
        when(repository.findByTripCode("V1")).thenReturn(Optional.of(viejo));
        when(repository.existsByIotDeviceIdAndEstadoAndActualizadoEnAfter(
                "900001", ViajeProgramado.DISPARADO, viejo.getActualizadoEn())).thenReturn(true);

        DetencionResultado r = service().detener("900001", "V1", "CANCELADO");

        assertThat(r.efecto()).isEqualTo(DetencionResultado.SIN_SIMULACION_EN_CURSO);
        assertThat(viejo.getEstado()).isEqualTo(ViajeProgramado.DETENIDO);
        verify(simuladorViajesClient, never()).detener(anyString(), anyString(), any());
    }

    @Test
    void pendiente_quedaDetenido_paraQueElPollerNoLaDispare() {
        ViajeProgramado v = viaje("V1", "900001");
        when(repository.findByTripCode("V1")).thenReturn(Optional.of(v));

        DetencionResultado r = service().detener("900001", "V1", "CANCELADO");

        assertThat(r.efecto()).isEqualTo(DetencionResultado.SIN_SIMULACION_EN_CURSO);
        assertThat(v.getEstado()).isEqualTo(ViajeProgramado.DETENIDO);
        verify(simuladorViajesClient, never()).detener(anyString(), anyString(), any());
    }

    @Test
    void tripCodeDesconocido_sinSimulacionEnCurso_sinRegistrar() {
        when(repository.findByTripCode("X")).thenReturn(Optional.empty());

        DetencionResultado r = service().detener("900001", "X", null);

        assertThat(r.efecto()).isEqualTo(DetencionResultado.SIN_SIMULACION_EN_CURSO);
        verify(repository, never()).save(any());
    }

    @Test
    void viajeDeOtroDispositivo_409_yNoToca() {
        ViajeProgramado v = disparado("V1", "900002");
        when(repository.findByTripCode("V1")).thenReturn(Optional.of(v));

        assertThatThrownBy(() -> service().detener("900001", "V1", null))
                .isInstanceOf(ViajeDeOtroDispositivoException.class);
        assertThat(v.getEstado()).isEqualTo(ViajeProgramado.DISPARADO);
        verify(simuladorViajesClient, never()).detener(anyString(), anyString(), any());
    }

    @Test
    void dispositivoNoSimulado_404() {
        assertThatThrownBy(() -> service().detener("12345", "V1", null))
                .isInstanceOf(DispositivoNoSimuladoException.class);
    }

    @Test
    void falloDelSimulador_502_quedaDisparadoConElDetalle() {
        ViajeProgramado v = disparado("V1", "900001");
        when(repository.findByTripCode("V1")).thenReturn(Optional.of(v));
        when(repository.existsByIotDeviceIdAndEstadoAndActualizadoEnAfter(anyString(), anyString(), any())).thenReturn(false);
        when(simuladorViajesClient.detener("900001", "V1", null))
                .thenReturn(new DetencionSimulador(Detencion.FALLO, "Connection refused"));

        assertThatThrownBy(() -> service().detener("900001", "V1", null))
                .isInstanceOf(SimuladorNoDisponibleException.class);
        assertThat(v.getEstado()).isEqualTo(ViajeProgramado.DISPARADO);
        assertThat(v.getUltimoError()).contains("Connection refused");
    }

    @Test
    void inicioTardioDeUnViajeDetenido_seRechaza() {
        ViajeProgramado v = disparado("V1", "900001");
        v.marcarDetenido();
        when(repository.findByTripCode("V1")).thenReturn(Optional.of(v));
        when(repository.findByTripCodeAndIotDeviceId("V1", "900001")).thenReturn(Optional.of(v));

        ProgramarViajeRequest request = new ProgramarViajeRequest(
                "V1", LocalDateTime.now(),
                new PuntoDto(new BigDecimal("-34.6467"), new BigDecimal("-58.4894")),
                new PuntoDto(new BigDecimal("-34.6037"), new BigDecimal("-58.3816")),
                null);

        assertThatThrownBy(() -> service().programar("900001", request))
                .isInstanceOf(ViajeNoModificableException.class);
        verify(simuladorViajesClient, never()).arrancarViaje(any());
    }

    @Test
    void enError_detencionBestEffort_detieneSiElSimuladorTieneViaje() {
        ViajeProgramado v = viaje("V1", "900001");
        v.marcarError("timeout");
        when(repository.findByTripCode("V1")).thenReturn(Optional.of(v));
        when(repository.existsByIotDeviceIdAndEstadoAndActualizadoEnAfter(anyString(), anyString(), any())).thenReturn(false);
        when(simuladorViajesClient.detener("900001", "V1", null))
                .thenReturn(new DetencionSimulador(Detencion.DETENIDA, null));

        DetencionResultado r = service().detener("900001", "V1", null);

        assertThat(r.efecto()).isEqualTo(DetencionResultado.DETENIDA);
        assertThat(v.getEstado()).isEqualTo(ViajeProgramado.DETENIDO);
    }

    @Test
    void enError_simuladorFalla_quedaDetenido_sin502() {
        ViajeProgramado v = viaje("V1", "900001");
        v.marcarError("timeout");
        when(repository.findByTripCode("V1")).thenReturn(Optional.of(v));
        when(repository.existsByIotDeviceIdAndEstadoAndActualizadoEnAfter(anyString(), anyString(), any())).thenReturn(false);
        when(simuladorViajesClient.detener("900001", "V1", null))
                .thenReturn(new DetencionSimulador(Detencion.FALLO, "Connection refused"));

        DetencionResultado r = service().detener("900001", "V1", null);

        assertThat(r.efecto()).isEqualTo(DetencionResultado.SIN_SIMULACION_EN_CURSO);
        assertThat(v.getEstado()).isEqualTo(ViajeProgramado.DETENIDO);
    }

    @Test
    void cancelado_quedaDetenido_sinLlamarAlSimulador() {
        ViajeProgramado v = viaje("V1", "900001");
        v.marcarCancelado();
        when(repository.findByTripCode("V1")).thenReturn(Optional.of(v));

        DetencionResultado r = service().detener("900001", "V1", null);

        assertThat(r.efecto()).isEqualTo(DetencionResultado.SIN_SIMULACION_EN_CURSO);
        assertThat(v.getEstado()).isEqualTo(ViajeProgramado.DETENIDO);
        verify(simuladorViajesClient, never()).detener(anyString(), anyString(), any());
    }
}
