package ar.utn.agrolink.ingesta.telemetry;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.List;
import org.hibernate.annotations.Immutable;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Mapea telemetria.lectura_telemetria. Solo lectura en las tres capas (Principio IV):
 * el motor no otorga UPDATE/DELETE al rol agrolink_ingesta, este repositorio no expone
 * metodos de escritura, y esta entidad esta anotada @Immutable y sin setters.
 *
 * Proyeccion completa de la fila que usan los dos consumidores de este servicio: el reporte
 * de viaje (dispositivoId, momentoEvento, velocidadKmh, odometroKm, odometroOrigen,
 * combustiblePct) y la consulta de estado de vehiculo (feature 002: ademas posicion,
 * indicadores propios del dispositivo y CAN bus crudo). Solo quedan fuera `payload_crudo`
 * y `frame_hash`: siguen sin consumidor, son responsabilidad exclusiva del receptor/auditoria.
 *
 * `campos_faltantes` (TEXT[]) y `datos_can` (JSONB) se mapean con el soporte nativo de
 * Hibernate 6 (@JdbcTypeCode), sin agregar ninguna dependencia nueva al proyecto.
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

    @Column(name = "momento_recepcion", nullable = false)
    private Instant momentoRecepcion;

    @Column(name = "latitud")
    private Double latitud;

    @Column(name = "longitud")
    private Double longitud;

    @Column(name = "velocidad_kmh")
    private Double velocidadKmh;

    @Column(name = "rumbo_grados")
    private Integer rumboGrados;

    @Column(name = "odometro_km")
    private Double odometroKm;

    @Enumerated(EnumType.STRING)
    @Column(name = "odometro_origen")
    private OrigenOdometro odometroOrigen;

    @Column(name = "combustible_pct")
    private Double combustiblePct;

    @Column(name = "vin")
    private String vin;

    @Column(name = "rpm")
    private Integer rpm;

    @Column(name = "combustible_consumido_l")
    private Double combustibleConsumidoL;

    @Column(name = "temperatura_refrigerante_c")
    private Integer temperaturaRefrigeranteC;

    @Column(name = "presion_aceite_kpa")
    private Integer presionAceiteKpa;

    @Column(name = "ignicion")
    private Boolean ignicion;

    @Column(name = "tension_bateria_v")
    private Double tensionBateriaV;

    @Column(name = "satelites")
    private Integer satelites;

    @Enumerated(EnumType.STRING)
    @Column(name = "estado_interpretacion", nullable = false)
    private EstadoInterpretacion estadoInterpretacion;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "campos_faltantes")
    private List<String> camposFaltantes;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "datos_can")
    private String datosCan;

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

    public Instant getMomentoRecepcion() {
        return momentoRecepcion;
    }

    public Double getLatitud() {
        return latitud;
    }

    public Double getLongitud() {
        return longitud;
    }

    public Double getVelocidadKmh() {
        return velocidadKmh;
    }

    public Integer getRumboGrados() {
        return rumboGrados;
    }

    public Double getOdometroKm() {
        return odometroKm;
    }

    public OrigenOdometro getOdometroOrigen() {
        return odometroOrigen;
    }

    public Double getCombustiblePct() {
        return combustiblePct;
    }

    public String getVin() {
        return vin;
    }

    public Integer getRpm() {
        return rpm;
    }

    public Double getCombustibleConsumidoL() {
        return combustibleConsumidoL;
    }

    public Integer getTemperaturaRefrigeranteC() {
        return temperaturaRefrigeranteC;
    }

    public Integer getPresionAceiteKpa() {
        return presionAceiteKpa;
    }

    public Boolean getIgnicion() {
        return ignicion;
    }

    public Double getTensionBateriaV() {
        return tensionBateriaV;
    }

    public Integer getSatelites() {
        return satelites;
    }

    public EstadoInterpretacion getEstadoInterpretacion() {
        return estadoInterpretacion;
    }

    public List<String> getCamposFaltantes() {
        return camposFaltantes;
    }

    public String getDatosCan() {
        return datosCan;
    }
}
