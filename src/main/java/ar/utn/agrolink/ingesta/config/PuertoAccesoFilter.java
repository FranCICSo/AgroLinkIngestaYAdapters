package ar.utn.agrolink.ingesta.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Restringe que rutas se sirven por cada puerto (research.md D-01, feature 002). El puerto
 * publicado al host ({@code vehiculo-estado.http-port}) solo deja pasar
 * {@code /api/v1/vehiculos/**}; cualquier otra ruta por ese puerto responde 404, para que
 * {@code /api/v1/reportes/viaje} (y {@code /health}) sigan siendo alcanzables solo desde la
 * red interna del compose, por el puerto original ({@code server.port}), sin restriccion
 * adicional.
 */
@Component
public class PuertoAccesoFilter extends OncePerRequestFilter {

    private static final String PREFIJO_PERMITIDO = "/api/v1/vehiculos/";

    private final int vehiculoEstadoHttpPort;

    public PuertoAccesoFilter(@Value("${vehiculo-estado.http-port}") int vehiculoEstadoHttpPort) {
        this.vehiculoEstadoHttpPort = vehiculoEstadoHttpPort;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        boolean entroPorPuertoNuevo = request.getLocalPort() == vehiculoEstadoHttpPort;
        boolean esRutaPermitida = request.getRequestURI().startsWith(PREFIJO_PERMITIDO);

        if (entroPorPuertoNuevo && !esRutaPermitida) {
            response.sendError(HttpServletResponse.SC_NOT_FOUND);
            return;
        }

        filterChain.doFilter(request, response);
    }
}
