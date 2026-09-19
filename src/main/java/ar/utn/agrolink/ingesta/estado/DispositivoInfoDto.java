package ar.utn.agrolink.ingesta.estado;

import ar.utn.agrolink.ingesta.telemetry.EstadoInterpretacion;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * Bloque de dispositivo del contrato EstadoVehiculo (spec, Key Entities). {@code momentoEvento}
 * y {@code momentoRecepcion} distinguen cuando ocurrio el evento de cuando llego al servidor
 * (Principio VII, FR-006). Ya no incluye {@code tensionBateriaV}: se reubico al bloque
 * {@link CanBusDto} por ser un dato del vehiculo, no del dispositivo IoT en si (spec,
 * Clarifications, sesion 2026-09-13; FR-009).
 */
public record DispositivoInfoDto(
        String dispositivoId,
        OffsetDateTime momentoEvento,
        OffsetDateTime momentoRecepcion,
        Boolean ignicion,
        Integer satelites,
        EstadoInterpretacion estadoInterpretacion,
        List<String> camposFaltantes) {}
