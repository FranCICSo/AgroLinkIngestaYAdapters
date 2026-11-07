package ar.utn.agrolink.ingesta.viajeprogramado;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class VehiculosSamsaraSimuladosTest {

    @Test
    void aceptaLosDosVehiculosSamsaraSimulados() {
        assertThat(VehiculosSamsaraSimulados.esSamsara("281474977000101")).isTrue();
        assertThat(VehiculosSamsaraSimulados.esSamsara("281474977000102")).isTrue();
    }

    @Test
    void rechazaIdsFueraDeLaListaYNulos() {
        assertThat(VehiculosSamsaraSimulados.esSamsara("281474977000199")).isFalse();
        assertThat(VehiculosSamsaraSimulados.esSamsara(null)).isFalse();
    }

    @Test
    void esDisjuntaDeLaListaDeDispositivosRinhoSimulados() {
        assertThat(VehiculosSamsaraSimulados.ids()).doesNotContainAnyElementsOf(DispositivosSimuladosConocidos.ids());
        VehiculosSamsaraSimulados.ids().forEach(id ->
                assertThat(DispositivosSimuladosConocidos.esSimulado(id)).isFalse());
    }
}
