package ar.utn.agrolink.ingesta.viajeprogramado;

import java.time.LocalDateTime;

/** Respuesta del contrato {@code viajes-simulados-http-api.md}. */
public record ViajeProgramadoDto(String tripCode, String estado, LocalDateTime estimatedStartDateTime) {

    public static ViajeProgramadoDto fromEntity(ViajeProgramado viajeProgramado) {
        return new ViajeProgramadoDto(
                viajeProgramado.getTripCode(),
                viajeProgramado.getEstado(),
                viajeProgramado.getEstimatedStartDateTime());
    }
}
