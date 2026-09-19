package ar.utn.agrolink.ingesta.estado;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class DatosCanCrudoReaderTest {

    @Test
    void leerEntero_claveExistenteYNumerica_devuelveElValor() {
        assertThat(DatosCanCrudoReader.leerEntero("{\"3\":\"45\"}", "3")).isEqualTo(45);
    }

    @Test
    void leerEntero_claveAusente_devuelveNull() {
        assertThat(DatosCanCrudoReader.leerEntero("{\"3\":\"45\"}", "99")).isNull();
    }

    @Test
    void leerEntero_datosCanNuloOVacio_devuelveNull() {
        assertThat(DatosCanCrudoReader.leerEntero(null, "3")).isNull();
        assertThat(DatosCanCrudoReader.leerEntero("", "3")).isNull();
        assertThat(DatosCanCrudoReader.leerEntero("{}", "3")).isNull();
    }

    @Test
    void leerEntero_valorNoNumerico_devuelveNullSinLanzar() {
        assertThat(DatosCanCrudoReader.leerEntero("{\"3\":\"ABC\"}", "3")).isNull();
    }

    @Test
    void leerEntero_valorVacio_devuelveNull() {
        assertThat(DatosCanCrudoReader.leerEntero("{\"3\":\"\"}", "3")).isNull();
    }

    @Test
    void leerDecimal_claveExistenteYNumerica_devuelveElValor() {
        assertThat(DatosCanCrudoReader.leerDecimal("{\"14\":\"30000.5\"}", "14")).isEqualTo(30000.5);
    }

    @Test
    void leerDecimal_claveAusente_devuelveNull() {
        assertThat(DatosCanCrudoReader.leerDecimal("{\"14\":\"30000.5\"}", "99")).isNull();
    }

    @Test
    void leerDecimal_valorNoNumerico_devuelveNullSinLanzar() {
        assertThat(DatosCanCrudoReader.leerDecimal("{\"14\":\"ABC\"}", "14")).isNull();
    }

    @Test
    void leerEntero_jsonMalformado_devuelveNullSinLanzar() {
        assertThat(DatosCanCrudoReader.leerEntero("no es json", "3")).isNull();
    }
}
