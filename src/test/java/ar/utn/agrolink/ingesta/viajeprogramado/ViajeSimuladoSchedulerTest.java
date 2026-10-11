package ar.utn.agrolink.ingesta.viajeprogramado;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ViajeSimuladoSchedulerTest {

    @Mock private ViajeProgramadoRepository repository;
    @Mock private SimuladorViajesClient simuladorViajesClient;

    private ViajeProgramado viajeVencido(String tripCode) {
        return new ViajeProgramado(
                tripCode, "900001", LocalDateTime.now().minusMinutes(1),
                new BigDecimal("-34.6467"), new BigDecimal("-58.4894"),
                new BigDecimal("-34.6037"), new BigDecimal("-58.3816"), "Viaje " + tripCode);
    }

    @Test
    void dispararVencidos_solamenteConsultaFilasPendientesVencidas() {
        when(repository.findByEstadoAndEstimatedStartDateTimeLessThanEqual(eq(ViajeProgramado.PENDIENTE), any()))
                .thenReturn(List.of());

        new ViajeSimuladoScheduler(new ViajeProgramadoService(repository, simuladorViajesClient), repository)
                .dispararVencidos();

        verify(repository).findByEstadoAndEstimatedStartDateTimeLessThanEqual(eq(ViajeProgramado.PENDIENTE), any());
    }

    @Test
    void dispararVencidos_siElSimuladorResponde_marcaDisparado() {
        ViajeProgramado viaje = viajeVencido("SCHED-1");
        when(repository.findByEstadoAndEstimatedStartDateTimeLessThanEqual(eq(ViajeProgramado.PENDIENTE), any()))
                .thenReturn(List.of(viaje));
        when(simuladorViajesClient.arrancarViaje(viaje)).thenReturn(SimulacionResultado.ok());
        when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        new ViajeSimuladoScheduler(new ViajeProgramadoService(repository, simuladorViajesClient), repository)
                .dispararVencidos();

        assertThat(viaje.getEstado()).isEqualTo(ViajeProgramado.DISPARADO);
    }

    @Test
    void dispararVencidos_siElSimuladorFalla_marcaErrorSinLanzarExcepcion() {
        ViajeProgramado viaje = viajeVencido("SCHED-2");
        when(repository.findByEstadoAndEstimatedStartDateTimeLessThanEqual(eq(ViajeProgramado.PENDIENTE), any()))
                .thenReturn(List.of(viaje));
        when(simuladorViajesClient.arrancarViaje(viaje)).thenReturn(SimulacionResultado.fallo("conexion rechazada"));
        when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        ViajeSimuladoScheduler scheduler =
                new ViajeSimuladoScheduler(new ViajeProgramadoService(repository, simuladorViajesClient), repository);

        assertThatCode(scheduler::dispararVencidos).doesNotThrowAnyException();
        assertThat(viaje.getEstado()).isEqualTo(ViajeProgramado.ERROR);
        assertThat(viaje.getUltimoError()).isEqualTo("conexion rechazada");
    }
}
