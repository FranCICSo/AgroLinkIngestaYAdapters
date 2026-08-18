package ar.utn.agrolink.ingesta.telemetry;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.Immutable;

/**
 * Mapea telemetria.lectura_telemetria. Solo lectura en las tres capas (Principio IV):
 * el motor no otorga UPDATE/DELETE al rol agrolink_ingesta, este repositorio no expone
 * metodos de escritura, y esta entidad esta anotada @Immutable y sin setters.
 *
 * Se mapean solo las columnas que el calculo del reporte de viaje necesita: el resto
 * (datos_can, payload_crudo, campos_faltantes, etc.) es responsabilidad exclusiva del
 * receptor y no tiene consumidor en este servicio.
 */
@Entity
@Immutable
@Table(name = "lectura_telemetria", schema = "telemetria")
public class LecturaTelemetria {

    @Id
    private Long id;

    @Column(name = "dispositivo_id", nullable = false)
    private String dispositivoId;

    @Column(name = "momento_evento", nullable = false)
    private Instant momentoEvento;

    @Column(name = "velocidad_kmh")
    private Double velocidadKmh;

    @Column(name = "odometro_m")
    private Long odometroM;

    @Enumerated(EnumType.STRING)
    @Column(name = "odometro_origen")
    private OrigenOdometro odometroOrigen;

    @Column(name = "combustible_pct")
    private Double combustiblePct;

    protected LecturaTelemetria() {
        // Requerido por JPA.
    }

    public Long getId() {
        return id;
    }

    public String getDispositivoId() {
        return dispositivoId;
    }

    public Instant getMomentoEvento() {
        return momentoEvento;
    }

    public Double getVelocidadKmh() {
        return velocidadKmh;
    }

    public Long getOdometroM() {
        return odometroM;
    }

    public OrigenOdometro getOdometroOrigen() {
        return odometroOrigen;
    }

    public Double getCombustiblePct() {
        return combustiblePct;
    }
}
