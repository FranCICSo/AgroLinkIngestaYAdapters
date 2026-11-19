package ar.utn.agrolink.ingesta.estado;

import ar.utn.agrolink.ingesta.telemetry.OrigenOdometro;
import java.time.OffsetDateTime;

/**
 * Bloque de CAN bus del contrato EstadoVehiculo (spec, Key Entities). Ya no expone
 * {@code datosCanCrudos}: cada valor CAN soportado tiene nombre propio (spec, FR-008).
 * {@code velocidadRuedaKmh} es el unico campo sin columna propia — se lee a demanda desde
 * {@code datos_can} (research.md D-02, D-04). {@code combustibleConsumidoL} esta en litros
 * (spec, Clarifications). {@code tensionBateriaV} esta reubicado aqui desde
 * {@link DispositivoInfoDto} (spec, Clarifications, sesion 2026-09-13). {@code odometroKm}
 * reemplazo a {@code odometroM} en la feature 004; desde la feature 005 el almacenamiento
 * interno tambien esta en kilometros, asi que este campo se expone sin conversion alguna.
 * {@code bleTemperaturaC} es la temperatura de un sensor BLE de carga (slot 0): no viene
 * del CAN bus del vehiculo sino de un sensor inalambrico externo, ingestada por la
 * feature 008 y expuesta aqui desde la feature 010; {@code null} si no fue reportada.
 *
 * {@code vin}, {@code rpm}, {@code odometroKm}/{@code odometroOrigen},
 * {@code combustibleConsumidoL}, {@code combustiblePct} y {@code temperaturaRefrigeranteC} no
 * salen necesariamente de la ultima lectura: son el ultimo valor no
 * nulo de las 24 h previas a ella, porque muchas tramas llegan sin CAN. Cada uno trae su
 * {@code *Momento}, el momento_evento de la lectura de la que salio, para que el consumidor
 * sepa que tan viejo es (en rpm y temperatura, sobre todo: con el motor apagado pueden ser
 * valores de cuando todavia estaba en marcha). El resto de los campos (presion de aceite,
 * tension, BLE, velocidad de rueda) siguen saliendo solo de la ultima lectura.
 */
public record CanBusDto(
        String vin,
        OffsetDateTime vinMomento,
        Integer rpm,
        OffsetDateTime rpmMomento,
        Integer velocidadRuedaKmh,
        Double odometroKm,
        OrigenOdometro odometroOrigen,
        OffsetDateTime odometroMomento,
        Double combustibleConsumidoL,
        OffsetDateTime combustibleConsumidoLMomento,
        Double combustiblePct,
        OffsetDateTime combustiblePctMomento,
        Integer temperaturaRefrigeranteC,
        OffsetDateTime temperaturaRefrigeranteCMomento,
        Integer presionAceiteKpa,
        Double tensionBateriaV,
        Double bleTemperaturaC) {}
