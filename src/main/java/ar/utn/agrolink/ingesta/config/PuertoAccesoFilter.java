package ar.utn.agrolink.ingesta.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Restringe que rutas se sirven por cada puerto (research.md D-01, feature 002). El puerto
 * publicado al host ({@code vehiculo-estado.http-port}) solo deja pasar
 * {@code /api/v1/vehiculos/**} y {@code /api/v1/proveedores/samsara/**} (feature 015); cualquier otra ruta por ese puerto responde 404, para que
 * {@code /api/v1/reportes/viaje} (y {@code /health}) sigan siendo alcanzables solo desde la
 * red interna del compose, por el puerto original ({@code server.port}), sin restriccion
 * adicional.
 */
@Component
public class PuertoAccesoFilter extends OncePerRequestFilter {

    // Feature 015-samsara-webhook-exceso-velocidad (research.md D-05): el webhook de Samsara y la
    // consulta de eventos que hace AgroLinkBackend tambien se sirven por el puerto publicado.
    private static final List<String> PREFIJOS_PERMITIDOS = List.of(
            "/api/v1/vehiculos/",
            "/api/v1/proveedores/samsara/");

    private final int vehiculoEstadoHttpPort;

    public PuertoAccesoFilter(@Value("${vehiculo-estado.http-port}") int vehiculoEstadoHttpPort) {
        this.vehiculoEstadoHttpPort = vehiculoEstadoHttpPort;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        boolean entroPorPuertoNuevo = request.getLocalPort() == vehiculoEstadoHttpPort;
        String uri = request.getRequestURI();
        boolean esRutaPermitida = PREFIJOS_PERMITIDOS.stream().anyMatch(uri::startsWith);

        if (entroPorPuertoNuevo && !esRutaPermitida) {
            response.sendError(HttpServletResponse.SC_NOT_FOUND);
            return;
        }

        filterChain.doFilter(request, response);
    }
}
