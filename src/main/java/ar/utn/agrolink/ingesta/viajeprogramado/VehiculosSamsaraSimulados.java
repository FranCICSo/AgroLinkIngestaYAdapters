package ar.utn.agrolink.ingesta.viajeprogramado;

import java.util.Set;

/**
 * Lista cerrada de vehiculos Samsara simulados (spec 015-samsara-webhook-exceso-velocidad,
 * FR-014; research.md D-12). Su {@code iotDeviceId} en AgroLinkBackend es su id de vehiculo en
 * Samsara, y con ese id viaja el aviso de viaje. A diferencia de
 * {@link DispositivosSimuladosConocidos}, un vehiculo de esta lista nunca dispara una
 * simulacion de ruta Rinho: el aviso se reenvia al emisor Samsara de simulador-viajes.
 *
 * <p>Las dos listas deben ser disjuntas (lo verifica el test). Mismas copias, mantenidas a
 * mano, en {@code SimulatedDeviceRegistry} de AgroLinkBackend y en
 * {@code simulador-viajes/src/samsara/vehiculosSamsara.js}.
 */
public final class VehiculosSamsaraSimulados {

    private static final Set<String> IDS = Set.of(
            "281474977000101",
            "281474977000102");

    private VehiculosSamsaraSimulados() {
    }

    public static boolean esSamsara(String dispositivoId) {
        return dispositivoId != null && IDS.contains(dispositivoId);
    }

    static Set<String> ids() {
        return IDS;
    }
}
