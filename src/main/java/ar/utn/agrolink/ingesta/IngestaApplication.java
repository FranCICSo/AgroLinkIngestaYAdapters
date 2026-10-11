package ar.utn.agrolink.ingesta;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

// @EnableScheduling habilita ViajeSimuladoScheduler (feature 013-autostart-simulacion-viaje).
@SpringBootApplication
@EnableScheduling
public class IngestaApplication {

    public static void main(String[] args) {
        SpringApplication.run(IngestaApplication.class, args);
    }
}
