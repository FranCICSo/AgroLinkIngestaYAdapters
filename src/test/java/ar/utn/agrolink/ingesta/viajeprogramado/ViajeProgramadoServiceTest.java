package ar.utn.agrolink.ingesta.viajeprogramado;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ViajeProgramadoServiceTest {

    @Mock private ViajeProgramadoRepository repository;
    @Mock private SimuladorViajesClient simuladorViajesClient;

    private ViajeProgramadoService service() {
        return new ViajeProgramadoService(repository, simuladorViajesClient);
    }

    private ProgramarViajeRequest requestConHorario(String tripCode, LocalDateTime horario) {
        return new ProgramarViajeRequest(
                tripCode,
                horario,
                new PuntoDto(new BigDecimal("-34.6467"), new BigDecimal("-58.4894")),
                new PuntoDto(new BigDecimal("-34.6037"), new BigDecimal("-58.3816")));
    }

    private ViajeProgramado viajeDe(String tripCode, String iotDeviceId, LocalDateTime horario) {
        return new ViajeProgramado(
                tripCode, iotDeviceId, horario,
                new BigDecimal("-34.6467"), new BigDecimal("-58.4894"),
                new BigDecimal("-34.6037"), new BigDecimal("-58.3816"), "Viaje " + tripCode);
    }

    @Test
    void programar_conHorarioFuturo_quedaPendienteSinLlamarAlSimulador() {
        when(repository.findByTripCode("V1")).thenReturn(Optional.empty());
        when(repository.findByTripCodeAndIotDeviceId("V1", "900001")).thenReturn(Optional.empty());
        when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        ViajeProgramadoDto resultado =
                service().programar("900001", requestConHorario("V1", LocalDateTime.now().plusDays(1)));

        assertThat(resultado.estado()).isEqualTo(ViajeProgramado.PENDIENTE);
        verify(simuladorViajesClient, never()).arrancarViaje(any());
    }

    @Test
    void programar_conHorarioYaPasado_disparaDeInmediato() {
        when(repository.findByTripCode("V2")).thenReturn(Optional.empty());
        when(repository.findByTripCodeAndIotDeviceId("V2", "900001")).thenReturn(Optional.empty());
        when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(simuladorViajesClient.arrancarViaje(any())).thenReturn(SimulacionResultado.ok());

        ViajeProgramadoDto resultado =
                service().programar("900001", requestConHorario("V2", LocalDateTime.now().minusMinutes(5)));

        assertThat(resultado.estado()).isEqualTo(ViajeProgramado.DISPARADO);
        verify(simuladorViajesClient).arrancarViaje(any());
    }

    @Test
    void programar_conDispositivoFueraDeLaListaCerrada_lanzaExcepcion() {
        assertThatThrownBy(() -> service().programar("12345", requestConHorario("V3", LocalDateTime.now())))
                .isInstanceOf(DispositivoNoSimuladoException.class);
    }

    @Test
    void programar_mismoTripCodeYaDeOtroDispositivo_noLoReasigna() {
        // IDOR: un tripCode que ya existe para 900001 nunca debe poder "robarse" llamando con
        // 900002 en el path, aunque ambos esten en la lista cerrada.
        ViajeProgramado deOtroDispositivo = viajeDe("V-COMPARTIDO", "900001", LocalDateTime.now().plusDays(1));
        when(repository.findByTripCode("V-COMPARTIDO")).thenReturn(Optional.of(deOtroDispositivo));

        assertThatThrownBy(() ->
                        service().programar("900002", requestConHorario("V-COMPARTIDO", LocalDateTime.now().plusDays(1))))
                .isInstanceOf(ViajeNoModificableException.class);
    }

    @Test
    void reprogramar_filaPendiente_actualizaElHorario() {
        ViajeProgramado existente = viajeDe("V4", "900001", LocalDateTime.now().plusDays(1));
        when(repository.findByTripCodeAndIotDeviceId("V4", "900001")).thenReturn(Optional.of(existente));
        when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        LocalDateTime nuevoHorario = LocalDateTime.now().plusDays(2);
        ViajeProgramadoDto resultado =
                service().reprogramar("900001", "V4", new ReprogramarViajeRequest(nuevoHorario));

        assertThat(resultado.estimatedStartDateTime()).isEqualTo(nuevoHorario);
        assertThat(resultado.estado()).isEqualTo(ViajeProgramado.PENDIENTE);
    }

    @Test
    void reprogramar_filaYaDisparada_lanzaConflicto() {
        ViajeProgramado disparado = viajeDe("V5", "900001", LocalDateTime.now().minusHours(1));
        disparado.marcarDisparado();
        when(repository.findByTripCodeAndIotDeviceId("V5", "900001")).thenReturn(Optional.of(disparado));

        assertThatThrownBy(() ->
                        service().reprogramar("900001", "V5", new ReprogramarViajeRequest(LocalDateTime.now())))
                .isInstanceOf(ViajeNoModificableException.class);
    }

    @Test
    void reprogramar_dispositivoDelPathNoCoincideConElDueño_lanzaNoEncontrado() {
        // IDOR: V4 existe, pero es de 900001 — pedirlo con 900002 en el path no debe
        // encontrar ni modificar nada (se trata igual que "no existe").
        when(repository.findByTripCodeAndIotDeviceId("V4", "900002")).thenReturn(Optional.empty());

        assertThatThrownBy(() ->
                        service().reprogramar("900002", "V4", new ReprogramarViajeRequest(LocalDateTime.now())))
                .isInstanceOf(ViajeProgramadoNoEncontradoException.class);
    }

    @Test
    void cancelar_filaPendiente_quedaCancelada() {
        ViajeProgramado existente = viajeDe("V6", "900001", LocalDateTime.now().plusDays(1));
        when(repository.findByTripCodeAndIotDeviceId("V6", "900001")).thenReturn(Optional.of(existente));
        when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service().cancelar("900001", "V6");

        assertThat(existente.getEstado()).isEqualTo(ViajeProgramado.CANCELADO);
    }

    @Test
    void cancelar_filaYaCancelada_lanzaConflicto() {
        ViajeProgramado cancelado = viajeDe("V7", "900001", LocalDateTime.now().plusDays(1));
        cancelado.marcarCancelado();
        when(repository.findByTripCodeAndIotDeviceId("V7", "900001")).thenReturn(Optional.of(cancelado));

        assertThatThrownBy(() -> service().cancelar("900001", "V7")).isInstanceOf(ViajeNoModificableException.class);
    }

    @Test
    void cancelar_tripCodeInexistente_lanzaNoEncontrado() {
        when(repository.findByTripCodeAndIotDeviceId("NO-EXISTE", "900001")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service().cancelar("900001", "NO-EXISTE"))
                .isInstanceOf(ViajeProgramadoNoEncontradoException.class);
    }

    @Test
    void cancelar_dispositivoDelPathNoCoincideConElDueño_lanzaNoEncontrado() {
        when(repository.findByTripCodeAndIotDeviceId("V6", "900002")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service().cancelar("900002", "V6"))
                .isInstanceOf(ViajeProgramadoNoEncontradoException.class);
    }
}
