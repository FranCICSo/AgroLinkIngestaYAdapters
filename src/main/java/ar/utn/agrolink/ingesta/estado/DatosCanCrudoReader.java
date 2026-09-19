package ar.utn.agrolink.ingesta.estado;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;

/**
 * Lee, por identificador CAN, un valor puntual del JSON crudo ya persistido en
 * {@code datos_can} (research.md D-04). Usado hoy solo para {@code velocidadRuedaKmh}
 * (CAN id {@code "3"}) — el unico valor CAN soportado sin columna propia (spec,
 * Clarifications). Nunca lanza: una clave ausente, un JSON vacio/nulo, o un valor no
 * numerico se tratan igual, como "no informado" (FR-010).
 */
final class DatosCanCrudoReader {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private DatosCanCrudoReader() {}

    static Integer leerEntero(String datosCanJson, String id) {
        String raw = leerCrudo(datosCanJson, id);
        if (raw == null) {
            return null;
        }
        try {
            return Integer.valueOf(raw);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    static Double leerDecimal(String datosCanJson, String id) {
        String raw = leerCrudo(datosCanJson, id);
        if (raw == null) {
            return null;
        }
        try {
            return Double.valueOf(raw);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String leerCrudo(String datosCanJson, String id) {
        if (datosCanJson == null || datosCanJson.isBlank()) {
            return null;
        }
        Map<String, String> datosCan;
        try {
            datosCan = OBJECT_MAPPER.readValue(datosCanJson, new TypeReference<Map<String, String>>() {});
        } catch (Exception e) {
            return null;
        }
        String raw = datosCan.get(id);
        if (raw == null || raw.isEmpty()) {
            return null;
        }
        return raw;
    }
}
