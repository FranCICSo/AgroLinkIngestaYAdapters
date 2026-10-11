package ar.utn.agrolink.ingesta.viajeprogramado;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * Mapea ingesta.viaje_programado (spec 013-autostart-simulacion-viaje). A diferencia de
 * {@code LecturaTelemetria} (telemetria, insert-only, Principio IV), esta tabla es
 * deliberadamente mutable: vive en un esquema propio ({@code ingesta}), separado de
 * {@code telemetria} y de {@code simulador} (sin acceso de escritura para este servicio,
 * ver data-model.md).
 */
@Entity
@Table(name = "viaje_programado", schema = "ingesta")
public class ViajeProgramado {

    public static final String PENDIENTE = "PENDIENTE";
    public static final String DISPARADO = "DISPARADO";
    public static final String CANCELADO = "CANCELADO";
    public static final String ERROR = "ERROR";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "trip_code", nullable = false, unique = true)
    private String tripCode;

    @Column(name = "iot_device_id", nullable = false)
    private String iotDeviceId;

    @Column(name = "estimated_start_date_time", nullable = false)
    private LocalDateTime estimatedStartDateTime;

    @Column(name = "origen_lat", nullable = false)
    private BigDecimal origenLat;

    @Column(name = "origen_lon", nullable = false)
    private BigDecimal origenLon;

    @Column(name = "destino_lat", nullable = false)
    private BigDecimal destinoLat;

    @Column(name = "destino_lon", nullable = false)
    private BigDecimal destinoLon;

    @Column(name = "nombre_ruta", nullable = false)
    private String nombreRuta;

    @Column(name = "estado", nullable = false)
    private String estado;

    @Column(name = "ultimo_error")
    private String ultimoError;

    @Column(name = "creado_en", nullable = false)
    private LocalDateTime creadoEn;

    @Column(name = "actualizado_en", nullable = false)
    private LocalDateTime actualizadoEn;

    protected ViajeProgramado() {
        // Requerido por JPA.
    }

    public ViajeProgramado(String tripCode, String iotDeviceId, LocalDateTime estimatedStartDateTime,
            BigDecimal origenLat, BigDecimal origenLon, BigDecimal destinoLat, BigDecimal destinoLon,
            String nombreRuta) {
        this.tripCode = tripCode;
        this.iotDeviceId = iotDeviceId;
        this.estimatedStartDateTime = estimatedStartDateTime;
        this.origenLat = origenLat;
        this.origenLon = origenLon;
        this.destinoLat = destinoLat;
        this.destinoLon = destinoLon;
        this.nombreRuta = nombreRuta;
        this.estado = PENDIENTE;
        LocalDateTime ahora = LocalDateTime.now();
        this.creadoEn = ahora;
        this.actualizadoEn = ahora;
    }

    public Long getId() {
        return id;
    }

    public String getTripCode() {
        return tripCode;
    }

    public String getIotDeviceId() {
        return iotDeviceId;
    }

    public LocalDateTime getEstimatedStartDateTime() {
        return estimatedStartDateTime;
    }

    public void setEstimatedStartDateTime(LocalDateTime estimatedStartDateTime) {
        this.estimatedStartDateTime = estimatedStartDateTime;
        tocarActualizadoEn();
    }

    public BigDecimal getOrigenLat() {
        return origenLat;
    }

    public BigDecimal getOrigenLon() {
        return origenLon;
    }

    public BigDecimal getDestinoLat() {
        return destinoLat;
    }

    public BigDecimal getDestinoLon() {
        return destinoLon;
    }

    public String getNombreRuta() {
        return nombreRuta;
    }

    public String getEstado() {
        return estado;
    }

    public String getUltimoError() {
        return ultimoError;
    }

    public LocalDateTime getCreadoEn() {
        return creadoEn;
    }

    public LocalDateTime getActualizadoEn() {
        return actualizadoEn;
    }

    public boolean estaPendiente() {
        return PENDIENTE.equals(estado);
    }

    public void marcarDisparado() {
        this.estado = DISPARADO;
        this.ultimoError = null;
        tocarActualizadoEn();
    }

    public void marcarCancelado() {
        this.estado = CANCELADO;
        tocarActualizadoEn();
    }

    public void marcarError(String detalle) {
        this.estado = ERROR;
        this.ultimoError = detalle;
        tocarActualizadoEn();
    }

    private void tocarActualizadoEn() {
        this.actualizadoEn = LocalDateTime.now();
    }
}
