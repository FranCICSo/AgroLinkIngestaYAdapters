package ar.utn.agrolink.ingesta.viajeprogramado;

import java.util.Set;

/**
 * Lista cerrada de {@code iotDeviceId} que disparan el arranque automático de simulación
 * (spec 013-autostart-simulacion-viaje, FR-001). Calca, a proposito, los 5 dispositivos que
 * siembra hoy {@code LocalDataSeeder.java} en AgroLinkBackend
 * (AGL001/AGL003/AGL004/AGL005/AGL006) — no es un patron generico ("contiene demo" o
 * "numerico 900001-900999"): un id que solo se parezca a ese patron pero no este en esta
 * lista NO cuenta como simulado para esta feature (Clarifications, 2026-10-11).
 *
 * <p>Si el equipo agrega vehiculos simulados nuevos al seeder, esta lista debe actualizarse
 * junto con el (no se mantiene sola, ver spec.md Assumptions).
 */
public final class DispositivosSimuladosConocidos {

    private static final Set<String> IDS_CONOCIDOS = Set.of(
            "geo-demo-001",
            "tel-demo-003",
            "tra-demo-004",
            "900001",
            "900002");

    private DispositivosSimuladosConocidos() {
    }

    public static boolean esSimulado(String iotDeviceId) {
        return iotDeviceId != null && IDS_CONOCIDOS.contains(iotDeviceId);
    }
}
