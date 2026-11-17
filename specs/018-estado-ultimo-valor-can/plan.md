# Implementation Plan: Último valor CAN no nulo en la consulta de estado

**Branch**: `feature/estado-ultimo-valor-can-no-nulo` | **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/018-estado-ultimo-valor-can/spec.md`

**Nota**: este plan es **retroactivo**. El cambio se implementó el 2026-11-15 (commit `629d0e8`), y
este documento registra lo decidido y lo hecho.

## Summary

`/estado` sigue tomando `posicion` y `dispositivo` de la última lectura. Seis campos de `canBus`
(`combustiblePct`, `combustibleConsumidoL`, `odometroKm`/`odometroOrigen`, `vin`, `rpm` y
`temperaturaRefrigeranteC`) pasan a tomar su último valor no nulo de las 24 h previas, cada uno con
su `*Momento`. Se resuelve con una consulta agregada con `public.last() FILTER` de TimescaleDB
(research.md D-01 y D-02). El contrato pasa a la versión 7.0.0, con un cambio aditivo.

AgroLinkBackend se adapta en la rama `bugfix/trailers-should-not-have-telemetry`, para no tomar un
valor arrastrado como lectura nueva en la alerta `ENGINE_OVERHEAT` ni en el historial de odómetro
(FR-008 y FR-009).

## Technical Context

| | |
|---|---|
| **Language/Version** | Java 21, Spring Boot 3.3.4 (ingesta y backend) |
| **Primary Dependencies** | Spring Data JPA (consulta nativa con proyección por interfaz), sin dependencias nuevas |
| **Storage** | TimescaleDB 2.17.2 sobre PostgreSQL 16. Sin migraciones |
| **Testing** | JUnit 5 + Mockito (unitarios). Test de integración contra TimescaleDB real (`@EnabledIfEnvironmentVariable DB_HOST`) |
| **Target Platform** | VM de producción de la ingesta (ver feature 017) |
| **Project Type** | Servicio web (API de lectura) |
| **Performance Goals** | Una consulta adicional por pedido a `/estado`, acotada a 24 h de un dispositivo y resuelta con el índice existente |
| **Constraints** | Contrato aditivo; solo lectura (Principio IV) |
| **Scale/Scope** | Unas 1.440 lecturas por dispositivo en 24 h (1 cada 60 s) |

## Constitution Check

*Plan retroactivo: se evalúa una sola vez sobre lo implementado.*

| Principio | Estado | Nota |
|-----------|--------|------|
| I. Capas de adaptación | ✅ | El backend sigue leyendo el modelo normalizado de `/estado`. No conoce los ids CAN. |
| II. Stack del backend | ✅ | `last()` de TimescaleDB, que ya es la base de la ingesta. |
| III. Mensajería solo por necesidad | ✅ | Sin canales nuevos: es el mismo `/estado` que ya se consulta. |
| IV. Inmutabilidad de la telemetría | ✅ | Consulta de solo lectura en un repositorio sin métodos de escritura. |
| V. Datos personales | ✅ | Sin datos nuevos. |
| VI. Seguridad | ✅ | Sin cambios de exposición. |
| VII. Tolerancia a desconexión | ✅ | El orden es por `momento_evento`, así que una trama atrasada no pisa un valor más nuevo. |
| VIII. Testing mínimo | ✅ | Unitarios para arrastre, no arrastre y ventana vacía. Integración contra TimescaleDB real (detectó el problema de D-02). Backend: tests de valor arrastrado y de valor fresco. |
| IX. No descartar en silencio | ✅ | El backend no descarta datos: un valor arrastrado igual llega al mapa. Solo no se toma como lectura nueva. |

## Project Structure

### Documentation (this feature)

```text
specs/018-estado-ultimo-valor-can/
├── spec.md
├── plan.md              # este archivo
├── research.md
├── data-model.md
├── contracts/
│   └── agrolink-vehiculo-estado-api.yaml   # v7.0.0
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code

```text
src/main/java/ar/utn/agrolink/ingesta/
├── telemetry/
│   ├── LecturaTelemetriaRepository.java    # + findUltimosValoresCanNoNulos
│   └── UltimosValoresCan.java              # proyección nueva
└── estado/
    ├── CanBusDto.java                      # + 6 campos *Momento
    └── EstadoVehiculoService.java          # ventana de 24 h y mapeo

src/test/java/ar/utn/agrolink/ingesta/estado/
├── EstadoVehiculoServiceTest.java              # + arrastre, no arrastre, ventana vacía
└── EstadoVehiculoServiceIntegrationTest.java   # nuevo, contra TimescaleDB

AgroLinkBackend (otro repo):
src/main/java/org/example/agrolink/telemetry/
├── ingesta/dto/VehiculoEstadoResponse.java     # + odometroMomento, temperaturaRefrigeranteCMomento, esDeLaUltimaLectura
├── ingesta/IngestaVehiculoEstadoClient.java    # fetchEstado: odómetro arrastrado = sin odómetro
└── ble/BleTemperatureTelemetrySyncService.java # la alerta de motor solo con temperatura de la última lectura
```

## Despliegue

No hay un orden obligatorio, pero conviene desplegar el backend antes o junto con la ingesta:

- **Backend nuevo con ingesta vieja**: no llegan los `*Momento`, todo cuenta como fresco y se
  comporta como hoy.
- **Ingesta nueva con backend viejo**: hasta que se despliegue el backend, una temperatura de motor
  arrastrada puede mantener o reabrir una alerta `ENGINE_OVERHEAT`, y un odómetro arrastrado se
  registra con fecha de ahora.

## Complexity Tracking

Sin violaciones de la constitución.
