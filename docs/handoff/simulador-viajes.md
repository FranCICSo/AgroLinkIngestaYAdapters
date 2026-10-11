# Handoff: simulador de viajes con dispositivos ficticios (PoC universitaria)

Contexto traído de una sesión de análisis previa (2026-09-26). Objetivo: simular camiones
(incluidos refrigerados) que recorren rutas y emiten tramas como un Rinho Spider IoT.

> **Actualización (feature 011-generar-ruta-simulada)**: el `simulador.ruta` de abajo ya no se
> carga con un `INSERT` manual. `simulador-viajes` expone un endpoint HTTP interno
> (`POST /rutas`, no publicado al host) y un comando `npm run crear-ruta --` que, dado un
> origen/destino (y paradas opcionales), trazan la ruta sobre calles reales vía OSRM y la
> persisten en una sola llamada. Ver `specs/011-generar-ruta-simulada/quickstart.md` y
> `contracts/` para el detalle de ambos.

> **Actualización (feature 012-velocidad-rpm-verosimil)**: se corrigieron picos de velocidad
> inverosímiles (hasta ~150 km/h en zona urbana) y de RPM saturado al techo configurado. Causa
> raíz: `avanceRuta.js` calculaba la velocidad como distancia cruda entre dos vértices
> consecutivos del trazado sobre un intervalo fijo, sin tope — un trazado con vértices
> espaciados de forma desigual (geometría simplificada de OSRM, o GPS real con intervalos
> irregulares en `camion-1`) producía velocidades físicamente imposibles. Ahora el trazado se
> **densifica una sola vez**, al generar la ruta o cargar el seed (`routeGenerationService.js` /
> `scripts/densificar-seed.js`, vía `densificacionRutaService.js`), insertando puntos
> intermedios para que ningún sub-tramo implique más de 60 km/h en zona urbana o 80 km/h en ruta
> (Ley 24.449 art. 51 — `src/domain/limitesVelocidad.js`). El RPM (`sintesisCan.js`) se
> reparametrizó en conjunto (ralentí 600–800, crucero en ruta ~1500). Ver
> `specs/012-velocidad-rpm-verosimil/` (spec, research, data-model, quickstart).

> **Actualización**: se confirmó que la razón de ser de todo lo anterior —lo que se programa
> para simular— ya es consultable desde AgroLinkBackend sin pasos manuales adicionales. Ver la
> sección ["Consulta desde el backend"](#consulta-desde-el-backend) más abajo y
> `docs/handoff/dispositivos-simulados.md` para el registro de qué `dispositivoId` tienen un
> camión simulado detrás.

> **Actualización (feature 013-autostart-simulacion-viaje)**: dar de alta un viaje en
> AgroLinkBackend para uno de los 5 dispositivos simulados conocidos del seeder (ver
> `docs/handoff/dispositivos-simulados.md`) ya no requiere ningún curl manual contra
> `simulador-viajes`. AgroLinkBackend notifica a `agrolink-ingesta` (este repo, nunca a
> `simulador-viajes` directo); `agrolink-ingesta` guarda la planificación en
> `ingesta.viaje_programado` y, exactamente en el horario de comienzo planificado del viaje
> (`estimatedStartDateTime`), llama internamente al `POST /rutas` de `simulador-viajes` con el
> bloque `camion` ya construido en la feature 011/013. Ver
> `specs/013-autostart-simulacion-viaje/` (spec, plan, contracts, quickstart).
>
> **Pendiente del lado de AgroLinkBackend** (fuera de este repo, ver
> `specs/013-autostart-simulacion-viaje/contracts/agrolink-backend-trip-hook.md`): `Trip`
> todavía guarda origen/destino como texto estructurado (`direccionOrigen`/`localidadOrigen`/
> `provinciaOrigen` y equivalente de destino), no como `lat`/`lon` ya geocodificados. El hook
> nuevo en `TripService` necesita esas coordenadas para armar el payload de
> `POST .../viajes-simulados` — ese geocodificado queda pendiente en el otro repo, fuera del
> alcance de lo construido acá.

## Consulta desde el backend

El endpoint que consume AgroLinkBackend (`GET /api/v1/vehiculos/{dispositivoId}/estado`,
`EstadoVehiculoService` — features 002/006) lee la última fila de
`telemetria.lectura_telemetria` por `dispositivo_id` **sin distinguir si la escribió un
dispositivo real o un camión simulado**: ambos caminos llegan a la misma tabla pasando por el
mismo `rinho-receptor` (UDP, checksum, ACK). No hace falta ningún cambio de código para que un
camión simulado sea consultable — alcanza con que esté `activo` y tenga un viaje `en_curso`.

Para verificar esto, o para diagnosticar por qué un `dispositivoId` no devuelve datos:

- `cd simulador-viajes && npm run listar-camiones` lista cada camión configurado con su
  `dispositivoId`, si está activo, si tiene viaje en curso y si cae en el rango reservado
  (900001-900999).
- `docs/handoff/dispositivos-simulados.md` documenta esa convención de rango, el registro de
  dispositivos conocidos, y los casos de `dispositivoId` sembrados en AgroLinkBackend que
  quedan **fuera de alcance** de esta simulación (proveedor distinto de RINHO1/TAIP) o que
  tienen un desacople de id con el camión simulado que los representa.

## Decisiones ya tomadas

- **Proceso separado** del receptor. Nada de modo "dummy" dentro de rinho-receptor.
- El simulador envía tramas **por UDP al receptor real**, así se ejercita checksum, ACK,
  persistencia y dashboards igual que en producción.
- Dispositivos simulados **distinguibles** de los reales: rango de IDs reservado (que no pueda
  ser un IMEI real) e idealmente un flag `simulado` en el registro del dispositivo.
- Apunta a local/staging por defecto; a la VM de OCI solo por elección explícita.

## Piezas reutilizables

- `rinho-receptor/test/tools/buildFrame.js`: ya arma tramas EQ válidas (66 chars GPS, CAN,
  `#msgNum`, checksum XOR). Hay que sumarle opción `ble` (ver `ble-sensores.md`).
- Contrato de trama: `specs/001-ingesta-adaptacion-telemetria/contracts/rinho-eq-frame.md`.
- `deploy/seed/seed-demo-telemetry.sql` inserta directo en base (saltea el receptor): el
  simulador es otra cosa.

## Alcance propuesto

- **Rutas**: polilíneas reales (OSRM o GPX), p. ej. Mercado Central → Rosario, RN2 → Mar del
  Plata. Avance a velocidad realista con paradas.
- **Estado por camión**: odómetro, combustible que baja, RPM según velocidad, ignición en
  paradas, reintentos si no llega ACK.
- **Modelo de temperatura de carga refrigerada** (segmento BLE, depende de la feature BLE):
  - normal: setpoint (−18 °C congelado / 4 °C refrigerado) + ruido
  - apertura de puerta en entrega: pico y recuperación
  - falla de compresor: subida sostenida que cruza umbral (debe disparar alerta)
  - sensor fuera de rango: valores vacíos → `NULL`
- **Escenarios** en archivo (JSON/YAML: camiones, ruta, tipo de carga, fallas) para demos
  reproducibles.

## Dependencia

El modelo de temperatura necesita que el receptor acepte el segmento BLE opcional
(`ble-sensores.md`). Posición/CAN se pueden simular sin esperar esa feature.

## Siguiente paso sugerido

`/speckit-specify` para la feature "simulador de viajes con dispositivos ficticios".
