package ar.utn.agrolink.ingesta.config;

import org.apache.catalina.connector.Connector;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.stereotype.Component;

/**
 * Agrega un segundo conector Tomcat, ademas del puerto por defecto ({@code server.port}),
 * dedicado a la consulta de estado de vehiculo (research.md D-01, feature 002). El puerto
 * original sigue sin publicarse al host (compose.yaml); este es el unico que Docker Compose
 * publica. {@link PuertoAccesoFilter} es quien impide que rutas ajenas respondan por este
 * puerto nuevo.
 */
@Component
public class VehiculoEstadoConectorConfig
        implements WebServerFactoryCustomizer<TomcatServletWebServerFactory> {

    private final int vehiculoEstadoHttpPort;

    public VehiculoEstadoConectorConfig(
            @Value("${vehiculo-estado.http-port}") int vehiculoEstadoHttpPort) {
        this.vehiculoEstadoHttpPort = vehiculoEstadoHttpPort;
    }

    @Override
    public void customize(TomcatServletWebServerFactory factory) {
        Connector connector = new Connector("org.apache.coyote.http11.Http11NioProtocol");
        connector.setPort(vehiculoEstadoHttpPort);
        factory.addAdditionalTomcatConnectors(connector);
    }
}
