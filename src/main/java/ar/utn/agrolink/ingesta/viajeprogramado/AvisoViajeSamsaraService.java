package ar.utn.agrolink.ingesta.viajeprogramado;

import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

/**
 * Aviso de inicio/detencion de viaje para vehiculos Samsara simulados (feature
 * 015-samsara-webhook-exceso-velocidad, research.md D-10; contracts/simulacion-samsara-avisos.md
 * §2). A diferencia del camino Rinho no persiste nada ni exige origen/destino: solo reenvia al
 * emisor Samsara de simulador-viajes y traduce su respuesta al contrato con AgroLinkBackend.
 */
@Service
public class AvisoViajeSamsaraService {

    /** Mismo huso que TripSchedulePolicy.ZONE de AgroLinkBackend: la hora llega local, sin offset. */
    static final ZoneId ZONA_BACKEND = ZoneId.of("America/Argentina/Buenos_Aires");

    private static final int TRIP_CODE_MAX = 64;

    private static final Logger log = LoggerFactory.getLogger(AvisoViajeSamsaraService.class);

    private final SimuladorSamsaraClient client;

    public AvisoViajeSamsaraService(SimuladorSamsaraClient client) {
        this.client = client;
    }

    public ResponseEntity<Map<String, Object>> iniciar(String dispositivoId, ProgramarViajeRequest request) {
        if (request == null || request.tripCode() == null || request.tripCode().isBlank()
                || request.tripCode().length() > TRIP_CODE_MAX || request.estimatedStartDateTime() == null) {
            return error(HttpStatus.BAD_REQUEST, "validacion",
                    "tripCode (1.." + TRIP_CODE_MAX + ") y estimatedStartDateTime son obligatorios");
        }
        OffsetDateTime inicioViaje = request.estimatedStartDateTime().atZone(ZONA_BACKEND).toOffsetDateTime();
        Optional<SimuladorSamsaraClient.Respuesta> respuesta =
                client.iniciar(dispositivoId, request.tripCode(), inicioViaje);

        return traducir(respuesta, dispositivoId, request.tripCode(), "ARRANCADO", "inicio");
    }

    public ResponseEntity<Map<String, Object>> detener(String dispositivoId, String tripCode, String motivo) {
        Optional<SimuladorSamsaraClient.Respuesta> respuesta = client.detener(dispositivoId, tripCode, motivo);
        return traducir(respuesta, dispositivoId, tripCode, "DETENIDO", "detencion");
    }

    private ResponseEntity<Map<String, Object>> traducir(Optional<SimuladorSamsaraClient.Respuesta> respuesta,
                                                         String dispositivoId, String tripCode, String estado,
                                                         String operacion) {
        if (respuesta.isEmpty() || !respuesta.get().exito()) {
            String detalle = respuesta.map(r -> "status=" + r.status() + " cuerpo=" + r.cuerpo())
                    .orElse("sin respuesta");
            log.warn("Aviso de {} Samsara no aceptado por simulador-viajes: tripCode={} dispositivoId={} {}",
                    operacion, tripCode, dispositivoId, detalle);
            return error(HttpStatus.BAD_GATEWAY, "simulador_no_disponible", detalle);
        }
        Object efecto = respuesta.get().cuerpo() == null ? null : respuesta.get().cuerpo().get("efecto");
        log.info("Aviso de {} Samsara reenviado: tripCode={} dispositivoId={} efecto={}",
                operacion, tripCode, dispositivoId, efecto);

        Map<String, Object> cuerpo = new LinkedHashMap<>();
        cuerpo.put("tripCode", tripCode);
        cuerpo.put("dispositivoId", dispositivoId);
        cuerpo.put("estado", estado);
        cuerpo.put("efecto", efecto);
        return ResponseEntity.status(respuesta.get().status()).body(cuerpo);
    }

    private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String codigo, String detalle) {
        Map<String, Object> cuerpo = new LinkedHashMap<>();
        cuerpo.put("error", codigo);
        cuerpo.put("detalle", detalle);
        return ResponseEntity.status(status).body(cuerpo);
    }
}
