# Phase 0 — Research: Temperatura del sensor BLE en la consulta de estado

**Feature**: `010-estado-temperatura-ble` | **Date**: 2026-09-29

Las decisiones de negocio están resueltas en `spec.md` (Assumptions): solo temperatura,
cambio aditivo, mismo criterio de "no informado" ya usado por el resto de `canBus`. Este
documento cubre las decisiones **técnicas**.

---

## D-01: Dónde vive el campo en la respuesta

**Decision**: `canBus.bleTemperaturaC`, dentro del bloque `CanBus` ya existente, no un
bloque nuevo.

**Rationale**: `canBus` ya es "todo dato de vehículo/carga que no es posición ni
indicador propio del equipo IoT" (contrato v5.0.0, descripción de `CanBus`): ahí conviven
VIN, RPM y temperatura de refrigerante, que tampoco son literalmente "CAN bus" en sentido
estricto pero son datos del mismo tipo (un sensor del vehículo, valor único, puede faltar
independientemente). Agregar un bloque `sensorBle` para un solo campo sería una capa sin
otro contenido, y un consumidor que ya lee `canBus.temperaturaRefrigeranteC` esperaría
encontrar `canBus.bleTemperaturaC` al lado, no en otro lugar.

**Alternatives considered**:
- *Bloque nuevo `sensorBle`*: más "correcto" conceptualmente (no es CAN), pero es
  complejidad sin necesidad demostrada (Principio III de la constitución aplica también a
  nivel de diseño de API) para un solo campo, y la spec explícitamente dejó humedad/batería
  fuera de alcance, así que el bloque nacería con un solo miembro.
- *Bloque `dispositivo`*: descartado — es para indicadores del equipo IoT (satélites,
  ignición, estado de interpretación), no del vehículo/carga.

## D-02: Cómo se lee el valor desde el dominio

**Decision**: Agregar `bleTemperaturaC` (`Double`, columna `ble_temperatura_c`) a la
entidad JPA `LecturaTelemetria`, igual que los demás campos con columna propia
(`temperaturaRefrigeranteC`, `presionAceiteKpa`). `EstadoVehiculoService.mapearCanBus` lo
pasa directo al DTO, sin resolver nada (a diferencia de `velocidadRuedaKmh`, que se lee a
demanda de `datos_can` porque no tiene columna propia).

**Rationale**: La columna ya existe (`ble_temperatura_c`, feature 008, `NUMERIC` nullable).
Es el mismo patrón que ya sigue el resto de `canBus`: columna propia → campo directo en el
DTO, sin lectura a demanda de JSON. No hace falta ningún `DatosCanCrudoReader`: ese helper
existe únicamente para el caso sin columna propia (`velocidadRuedaKmh`), y la temperatura
BLE no es ese caso.

**Alternatives considered**:
- *Reutilizar `DatosCanCrudoReader` sobre `datos_can`*: no aplica — la temperatura BLE
  nunca se guarda en `datos_can` (feature 008, `lecturaMapper.js`: las claves BLE quedan
  fuera de ese JSON). Sería leer una columna que no existe ahí.

## D-03: Tipo del campo en el DTO

**Decision**: `Double bleTemperaturaC` en `CanBusDto`, igual que `temperaturaRefrigeranteC`
pero `Double` en vez de `Integer` (`ble_temperatura_c` es `NUMERIC` sin escala fija: puede
traer decimales, p. ej. `23.5`, a diferencia de `temperatura_refrigerante_c` que es
`SMALLINT`).

**Rationale**: Mapear a `Integer` truncaría o redondearía un valor que el sensor puede
reportar con decimales (feature 008, research.md D-05: la columna es `NUMERIC` justamente
para no perder precisión). El tipo del DTO debe respetar el tipo de la columna.

## D-04: Compatibilidad del contrato

**Decision**: Versión **6.0.0** del contrato (`agrolink-vehiculo-estado-api.yaml`),
sucesora de la 5.0.0 (feature 005). Cambio **aditivo**: un campo nuevo en `CanBus`, ningún
campo existente cambia de nombre, tipo ni bloque.

**Rationale**: A diferencia de la feature 003 (que reubicó `tensionBateriaV` y por eso
subió de MAJOR a otra versión con ruptura documentada), acá no hay ruptura: un consumidor
que ya deserializa `CanBus` sin conocer `bleTemperaturaC` simplemente lo ignora. Sigue el
versionado ya usado en este proyecto (bump de versión del YAML en cada feature que toca
el contrato, sin un esquema SemVer formal declarado).

## D-05: Alcance de pruebas

**Decision**: Extender `EstadoVehiculoServiceTest` (JUnit 5 + Mockito + AssertJ, mismo
patrón que la feature 003) con los tres casos del Principio VIII: lectura con
`ble_temperatura_c` presente, lectura con el campo en `null`, y — a diferencia de los
demás campos de `canBus`, que no tienen forma de ser "inválidos" una vez que ya pasaron
por el mapper de ingesta — no aplica un tercer caso de "valor inválido" a nivel de este
servicio: la validación de formato ya ocurrió en `rinho-receptor` (feature 008); acá el
valor ya es un `Double` o `null` en la entidad JPA, no hay parseo de texto que pueda
fallar. Los dos casos (presente / ausente) son la cobertura completa de esta capa.

**Rationale**: Repetir la validación de "¿es un número válido?" en el servicio Java sería
duplicar una responsabilidad que la constitución asigna a una sola capa de adaptación
(Principio I): `rinho-receptor` es el único punto de contacto con el formato del
fabricante, y para cuando el dato llega a `agrolink-ingesta` ya es un tipo de dominio
(`Double`/`null`), no texto crudo.
