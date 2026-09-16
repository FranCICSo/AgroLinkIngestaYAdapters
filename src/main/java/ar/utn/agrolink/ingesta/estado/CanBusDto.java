package ar.utn.agrolink.ingesta.estado;

import ar.utn.agrolink.ingesta.telemetry.OrigenOdometro;

/**
 * Bloque de CAN bus del contrato EstadoVehiculo (spec, Key Entities). Ya no expone
 * {@code datosCanCrudos}: cada valor CAN soportado tiene nombre propio (spec, FR-008).
 * {@code velocidadRuedaKmh} es el unico campo sin columna propia — se lee a demanda desde
 * {@code datos_can} (research.md D-02, D-04). {@code combustibleConsumidoL} esta en litros
 * (spec, Clarifications). {@code tensionBateriaV} esta reubicado aqui desde
 * {@link DispositivoInfoDto} (spec, Clarifications, sesion 2026-09-13). {@code odometroKm}
 * reemplazo a {@code odometroM} en la feature 004; desde la feature 005 el almacenamiento
 * interno tambien esta en kilometros, asi que este campo se expone sin conversion alguna.
 */
public record CanBusDto(
        String vin,
        Integer rpm,
        Integer velocidadRuedaKmh,
        Double odometroKm,
        OrigenOdometro odometroOrigen,
        Double combustibleConsumidoL,
        Double combustiblePct,
        Integer temperaturaRefrigeranteC,
        Integer presionAceiteKpa,
        Double tensionBateriaV) {}
