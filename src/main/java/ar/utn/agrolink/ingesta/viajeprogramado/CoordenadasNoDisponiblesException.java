package ar.utn.agrolink.ingesta.viajeprogramado;

/**
 * El request de alta llego sin origen y/o destino geocodificados (AgroLinkBackend no pudo
 * resolverlos, ej. falla de geocoding). Edge case documentado en spec.md: "no debe poder
 * arrancar una simulacion sin un recorrido que trazar" — se trata como un 400 explicito, nunca
 * como un NullPointerException/500 (FR-004: tampoco debe tumbar el alta de AgroLinkBackend, que
 * ya trata cualquier respuesta no-2xx de este endpoint como un rechazo tolerado).
 */
public class CoordenadasNoDisponiblesException extends RuntimeException {

    public CoordenadasNoDisponiblesException(String tripCode) {
        super("El viaje " + tripCode + " no tiene origen y/o destino geocodificados disponibles");
    }
}
