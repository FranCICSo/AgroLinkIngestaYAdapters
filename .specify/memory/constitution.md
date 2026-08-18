<!--
Sync Impact Report — Amendment 1.0.0 → 1.1.0 (2026-08-15)
Motivación: hallazgo D1 (CRITICAL) de /speckit-analyze sobre la feature
  001-ingesta-adaptacion-telemetria. El Principio VI exigía TLS sin cláusula de
  excepción, mientras que el tramo dispositivo→receptor es UDP en texto plano porque
  el protocolo lo define el fabricante del Rinho Spider IoT. Un conflicto de
  constitución no se resuelve documentando la excepción en el plan: requiere enmendar
  el principio.
Modified principles:
  - VI. Seguridad como Línea Base — se agrega carve-out acotado para enlaces de
    telemetría dispositivo→servidor sin soporte TLS, condicionado a controles
    compensatorios obligatorios (aislamiento de red + validación de integridad y
    origen) y a su documentación en el Complexity Tracking del plan. Expansión
    material de guía → MINOR.
  - I. Arquitectura Desacoplada por Capas de Adaptación — el paréntesis de ejemplo
    decía "actualmente: Traccar decodificando el protocolo Rinho"; Traccar se eliminó
    del diseño (research.md D-01). Ahora dice "un receptor propio que decodifica el
    protocolo Rinho". Aclaración ilustrativa, no normativa → PATCH por sí sola.
Version bump: MINOR (1.1.0). Se agrega una excepción acotada que amplía la guía sin
  eliminar ni redefinir ningún principio; todo diseño que hoy cumple sigue cumpliendo.
Added sections: none
Removed sections: none
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ sin cambios (Constitution Check genérico)
  - .specify/templates/spec-template.md ✅ sin cambios (principle-agnostic)
  - .specify/templates/tasks-template.md ✅ sin cambios (principle-agnostic)
  - .claude/skills/speckit-*/SKILL.md ✅ sin referencias desactualizadas
  - specs/001-ingesta-adaptacion-telemetria/plan.md ✅ actualizado (Constitution
    Check: Principio VI pasa de ⚠️ a ✅ condicionado; Complexity Tracking reformulado)
  - specs/001-ingesta-adaptacion-telemetria/tasks.md ✅ actualizado (T063 ampliado)
Follow-up TODOs: none

--- Historial ---
Sync Impact Report — Ratificación inicial
Version change: N/A (template) → 1.0.0
Modified principles: N/A — initial ratification
Added sections:
  - Core Principles (9): Arquitectura Desacoplada por Capas de Adaptación,
    Stack Tecnológico del Backend, Mensajería Solo por Necesidad Demostrada,
    Inmutabilidad de los Datos Crudos de Telemetría, Minimización de Datos
    Personales Identificables, Seguridad como Línea Base, Tolerancia a Fallos
    de Conectividad, Testing Mínimo Esperado, Trazabilidad y No Reproceso
    Silencioso
  - Alineación con Entregables Académicos (Section 2)
  - Governance
Removed sections: none (all template placeholders resolved)
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ no change needed (generic Constitution
    Check gate already references "constitution file"; principles will be
    checked against this file at plan time)
  - .specify/templates/spec-template.md ✅ no change needed (generic, principle-agnostic)
  - .specify/templates/tasks-template.md ✅ no change needed (generic, principle-agnostic)
  - .claude/skills/speckit-*/SKILL.md ✅ no outdated agent-specific references found
Follow-up TODOs: none — RATIFICATION_DATE set to adoption date supplied by ratifying action (today).
-->

# AgroLink Constitution

## Core Principles

### I. Arquitectura Desacoplada por Capas de Adaptación

La ingesta de telemetría de hardware IoT (GPS, CAN bus, sensores de frío) NUNCA se
integra directo contra la lógica de negocio. Todo dato crudo proveniente de un
proveedor de telemetría (actualmente: un receptor propio que decodifica el protocolo
Rinho) DEBE pasar por una capa de adaptación que lo normaliza a un modelo de dominio
propio antes de que cualquier otro componente del sistema lo consuma. Esta capa es el
único punto de contacto con el formato específico del proveedor/hardware.

**Rationale**: Si cambia el proveedor de telemetría o el hardware de a bordo, la capa
de adaptación se reemplaza sin tocar el dominio ni la lógica de negocio, protegiendo
la inversión en el resto del sistema.

### II. Stack Tecnológico del Backend

Toda nueva feature de backend se implementa en Java con Spring Boot, salvo
justificación explícita en contrario documentada en el plan de la feature. La
persistencia usa PostgreSQL con la extensión TimescaleDB para datos de series
temporales (telemetría, posiciones, lecturas de sensores). El acceso a datos se
realiza mediante Spring Data JPA.

**Rationale**: Un stack consistente reduce la curva de aprendizaje entre módulos,
facilita el mantenimiento por un equipo académico pequeño y aprovecha TimescaleDB
específicamente para la naturaleza de series temporales de los datos de telemetría.

### III. Mensajería Solo por Necesidad Demostrada

La ingesta parte de un modelo directo: endpoint HTTP recibe → persiste. NO se
introduce un broker de mensajería (MQTT, Kafka, RabbitMQ u otro) salvo que exista una
necesidad concreta y demostrada de desacoplar múltiples consumidores, absorber picos
de carga, o reintentar entregas de forma confiable. La incorporación de mensajería
NUNCA se justifica como decisión anticipada "por si escala".

**Rationale**: Introducir infraestructura de mensajería sin una necesidad real agrega
complejidad operativa y de despliegue que no se justifica en el alcance actual del
proyecto, y viola el principio de simplicidad.

### IV. Inmutabilidad de los Datos Crudos de Telemetría

Ninguna interfaz de usuario ni proceso automático puede editar o borrar manualmente
una lectura de telemetría ya persistida (posición, temperatura, odómetro, combustible,
etc.). Los datos ingestados son de solo lectura una vez guardados. Cualquier
corrección a un dato ya persistido se modela como un nuevo registro o como una
anotación asociada — NUNCA como un update destructivo sobre el registro original.

**Rationale**: Preserva la integridad histórica de la telemetría, que es la base para
auditorías, disputas contractuales y análisis de performance; permitir ediciones
destructivas comprometería la confiabilidad de todo el sistema como fuente de verdad.

### V. Minimización de Datos Personales Identificables

El sistema NO almacena nombres, DNI/CUIL ni otros identificadores personales de
choferes en las tablas asociadas a telemetría o performance de conducción. Cuando se
necesita vincular una lectura a un conductor, se usa un token/identificador interno
opaco. La relación entre ese token y la identidad real de la persona queda fuera del
alcance de este sistema y es responsabilidad del cliente en su propio sistema de RRHH.

**Rationale**: Reduce la superficie de exposición de datos sensibles y la carga de
cumplimiento normativo (protección de datos personales) del sistema, delegando la
gestión de identidad a quien ya es responsable de ella.

### VI. Seguridad como Línea Base

Toda comunicación cliente-servidor usa HTTPS/TLS, **salvo enlaces de telemetría
dispositivo→servidor cuyo hardware de campo no soporte TLS**. Esa excepción es
acotada y condicionada: solo aplica al tramo entre el equipo de a bordo y su receptor,
NUNCA a comunicación entre servicios propios ni a APIs consumidas por usuarios, y
exige compensar con (a) **aislamiento de red** — exponer únicamente el puerto del
receptor, manteniendo base de datos y servicios internos fuera del alcance público — y
(b) **validación de integridad y de origen** de cada trama recibida (checksum del
protocolo más identificador de dispositivo conocido), descartando lo que no valide. La
excepción DEBE documentarse en el Complexity Tracking del plan de la feature que la
invoca, junto con sus controles compensatorios concretos.

Las contraseñas se almacenan exclusivamente con hashing (BCrypt o equivalente) —
NUNCA en texto plano. Los tokens de autenticación tienen expiración configurable. No
se commitean credenciales, API keys ni strings de conexión a bases de datos en el
código fuente; estos valores se gestionan mediante variables de entorno o
configuración externa.

**Rationale**: La seguridad no es una feature que se agrega después; es un requisito
de línea base de cualquier sistema que maneja datos de flotas, ubicación y clientes,
y su omisión temprana es costosa de remediar más tarde. La excepción de TLS existe
porque el protocolo de los equipos IoT de campo lo define el fabricante y no es
negociable desde el software: prohibirlo sin más volvería inconstitucional cualquier
ingesta real y empujaría la violación fuera del registro. Acotarla con controles
compensatorios obligatorios mantiene el riesgo visible, contenido y auditable en vez
de tácito.

### VII. Tolerancia a Fallos de Conectividad

El hardware de campo opera en rutas con cobertura celular intermitente. Cualquier
componente de ingesta DEBE aceptar datos que lleguen con timestamp retrasado
(sincronización posterior a una desconexión) sin generar inconsistencias ni
sobrescribir datos más recientes ya almacenados. El orden de llegada de los datos NO
puede asumirse igual al orden cronológico real de los eventos.

**Rationale**: El dominio de operación (rutas de transporte de carga en Argentina)
tiene cobertura celular no garantizada; diseñar para conectividad perfecta produciría
pérdida o corrupción silenciosa de datos en el escenario más común de uso real.

### VIII. Testing Mínimo Esperado

Toda lógica de parseo/adaptación de datos externos (decodificación de payloads,
mapeo de campos crudos a campos de dominio) DEBE tener tests unitarios que cubran, como
mínimo: (a) el caso con datos completos, (b) el caso con campos faltantes o nulos, y
(c) un caso de dato inválido o fuera de rango.

**Rationale**: La capa de adaptación (Principio I) es el punto de mayor riesgo de
corrupción silenciosa de datos porque traduce formatos externos no controlados por el
equipo; un mínimo de cobertura de tests en sus tres casos críticos es la red de
seguridad más costo-efectiva para esa capa.

### IX. Trazabilidad y No Reproceso Silencioso

Cuando el sistema recibe un dato que no puede interpretar completamente, lo registra
igual con lo que sí pudo interpretar, y deja evidencia del problema (log o campo de
estado) en vez de descartarlo sin dejar rastro. Ningún dato de ingesta se descarta de
forma silenciosa.

**Rationale**: Descartar datos sin dejar evidencia oculta fallas de integración del
hardware o del proveedor de telemetría hasta que ya es tarde para diagnosticarlas;
dejar rastro permite detectar y corregir problemas de origen a tiempo.

## Alineación con Entregables Académicos

Este proyecto es un trabajo final de carrera (UTN) con entregables versionados y ya
aprobados por la cátedra: WBS, DER (Diagrama de Entidad-Relación), Historias de
Usuario y Gestión de Riesgos. Toda decisión técnica derivada de esta constitución
DEBE ser consistente con esos documentos. Si una decisión de diseño entra en
conflicto con un entregable ya aprobado, el conflicto se resuelve actualizando
formalmente el entregable correspondiente (con el proceso académico que corresponda)
antes de implementar — nunca contradiciendo el entregable de forma silenciosa en el
código.

## Governance

Esta constitución prevalece sobre cualquier otra práctica, convención de equipo o
preferencia individual de implementación. En caso de conflicto entre esta
constitución y cualquier otro documento técnico del proyecto (excepto los entregables
académicos ya aprobados por la cátedra, ver sección anterior), esta constitución
prevalece.

**Enmiendas**: Cualquier cambio a esta constitución requiere: (1) documentar el
cambio propuesto y su motivación, (2) verificar que no contradiga los entregables
académicos aprobados (WBS, DER, Historias de Usuario, Gestión de Riesgos) sin antes
actualizarlos, y (3) actualizar el número de versión según las reglas de versionado
semántico siguientes:
- **MAJOR**: eliminación o redefinición incompatible de un principio existente.
- **MINOR**: adición de un nuevo principio o expansión material de guía existente.
- **PATCH**: aclaraciones, correcciones de redacción o refinamientos no semánticos.

**Cumplimiento**: Todo plan de implementación (`plan.md`) generado para una feature
DEBE incluir una verificación explícita contra los principios de esta constitución
("Constitution Check") antes de la fase de diseño y nuevamente después de ella.
Cualquier violación debe justificarse en la sección de Complexity Tracking del plan o
debe resolverse rediseñando el enfoque. La complejidad no justificada (por ejemplo,
introducir mensajería sin necesidad demostrada, o acoplar lógica de negocio
directamente al formato de un proveedor de telemetría) se rechaza en revisión.

**Version**: 1.1.0 | **Ratified**: 2026-08-11 | **Last Amended**: 2026-08-15
