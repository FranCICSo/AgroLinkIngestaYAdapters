package ar.utn.agrolink.ingesta.viajeprogramado;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class DispositivosSimuladosConocidosTest {

    @Test
    void aceptaLosCincoIdsSembradosPorElSeeder() {
        assertThat(DispositivosSimuladosConocidos.esSimulado("geo-demo-001")).isTrue();
        assertThat(DispositivosSimuladosConocidos.esSimulado("tel-demo-003")).isTrue();
        assertThat(DispositivosSimuladosConocidos.esSimulado("tra-demo-004")).isTrue();
        assertThat(DispositivosSimuladosConocidos.esSimulado("900001")).isTrue();
        assertThat(DispositivosSimuladosConocidos.esSimulado("900002")).isTrue();
    }

    @Test
    void rechazaUnIdQueSoloMatcheaElPatronDemoSinEstarEnLaLista() {
        assertThat(DispositivosSimuladosConocidos.esSimulado("otro-demo-999")).isFalse();
    }

    @Test
    void rechazaUnIdQueSoloMatcheaElRangoNumericoReservadoSinEstarEnLaLista() {
        assertThat(DispositivosSimuladosConocidos.esSimulado("900050")).isFalse();
    }

    @Test
    void rechazaUnIdRealTipoImei() {
        assertThat(DispositivosSimuladosConocidos.esSimulado("860693084873877")).isFalse();
    }

    @Test
    void rechazaNullOVacio() {
        assertThat(DispositivosSimuladosConocidos.esSimulado(null)).isFalse();
        assertThat(DispositivosSimuladosConocidos.esSimulado("")).isFalse();
    }
}
