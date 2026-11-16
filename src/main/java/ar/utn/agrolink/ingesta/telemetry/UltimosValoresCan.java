package ar.utn.agrolink.ingesta.telemetry;

import java.time.Instant;

/**
 * Proyeccion de la consulta {@link LecturaTelemetriaRepository#findUltimosValoresCanNoNulos}:
 * para cada campo CAN arrastrable (combustible %, combustible consumido, odometro, VIN, rpm y
 * temperatura de refrigerante), su ultimo valor no nulo dentro de una ventana y el {@code momento_evento} de la lectura
 * de la que salio. Todo es nullable: si en la ventana ninguna lectura trajo el campo, valor y
 * momento vienen ambos en {@code null}.
 *
 * {@code odometroOrigen} se toma con el mismo filtro que {@code odometroKm} (lecturas con
 * odometro informado), para que el origen corresponda al valor y no a otra lectura.
 */
public interface UltimosValoresCan {

    Double getCombustiblePct();

    Instant getCombustiblePctMomento();

    Double getCombustibleConsumidoL();

    Instant getCombustibleConsumidoLMomento();

    Double getOdometroKm();

    String getOdometroOrigen();

    Instant getOdometroMomento();

    String getVin();

    Instant getVinMomento();

    Integer getRpm();

    Instant getRpmMomento();

    Integer getTemperaturaRefrigeranteC();

    Instant getTemperaturaRefrigeranteCMomento();
}
