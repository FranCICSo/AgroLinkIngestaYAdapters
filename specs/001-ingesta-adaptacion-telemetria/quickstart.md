# Phase 1 — Quickstart & Validación: Ingesta y Adaptación de Telemetría

**Feature**: `001-ingesta-adaptacion-telemetria` | **Date**: 2026-08-15

Guía de puesta en marcha y validación end-to-end. Cada escenario mapea a una User Story y a
los criterios de éxito del [spec](./spec.md).

Esta guía **es** el instrumento de medición de **SC-005**: alguien que no participó del
despliegue debe levantar todo el entorno siguiendo solo este documento, en menos de 30
minutos, sin ayuda ad-hoc. Si algo acá no alcanza, es un bug de la documentación.

---

## 0. Prerrequisitos

| Requisito | Detalle |
|-----------|---------|
| VM | Oracle Cloud Always Free, Ampere A1, **linux/arm64** |
| Software | Docker + Docker Compose v2 |
| Red (VCN Security List) | Ingress **UDP** al puerto del receptor. Ver §1.3 — es el error operativo más común |
| Dispositivo | Rinho Spider IoT configurado con `GEQ` apuntando a `<IP_PUBLICA_VM>:<PUERTO_UDP>` |

Comprobación de arquitectura antes de empezar:

```bash
uname -m          # esperado: aarch64
docker --version
docker compose version
```

---

## 1. Levantar el entorno (User Story 1)

### 1.1 Configurar secretos

```bash
cd deploy
cp .env.example .env
$EDITOR .env      # completar contraseñas de base
```

> El `.env` real **no se commitea** (Principio VI). Solo se versiona `.env.example`.

### 1.2 Verificar que las imágenes soportan ARM64

Paso obligatorio antes del primer `up` (decisión D-11). `timescale/timescaledb-ha` **no**
tiene ARM64 y falla en Ampere A1, pese a ser la variante que la documentación de Timescale
recomienda:

```bash
docker manifest inspect timescale/timescaledb:2.17.2-pg16 \
  | grep -A2 '"platform"' | grep -E 'architecture|os'
# esperado: incluye arm64 / linux
```

### 1.3 Abrir el puerto UDP en la VCN

En la Security List de la subred, agregar una regla de ingress con **protocolo UDP** al
puerto del receptor.

> ⚠️ **Trampa**: si se abre solo TCP, el stack queda arriba y aparentemente sano, pero el
> dispositivo nunca logra reportar y no hay ningún error visible en los logs. Si al final de
> esta guía no llega ninguna trama, revisar esto primero.

### 1.4 Arrancar

```bash
docker compose up -d
docker compose ps
```

**Esperado**: tres servicios en `running`, los tres `healthy`:

| Servicio | Rol | Puerto publicado |
|----------|-----|------------------|
| `timescaledb` | Almacenamiento de series temporales | ninguno |
| `rinho-receptor` | Ingesta UDP + parser + ACK | **solo UDP** |
| `agrolink-ingesta` | Reportes (solo lectura) | ninguno |

Que solo se publique el puerto UDP es intencional (Principio VI): base y reportes viven en
la red interna del compose.

`agrolink-ingesta` puede tardar hasta ~2 minutos en pasar a `healthy` (arranque en frío de
JVM con 2 OCPU compartidas; `start_period` está dimensionado para eso).

### 1.5 Verificar el esquema

```bash
docker compose exec timescaledb \
  psql -U postgres -d agrolink_telemetria -c "\d telemetria.lectura_telemetria"

# Confirmar que es hypertable:
docker compose exec timescaledb psql -U postgres -d agrolink_telemetria \
  -c "SELECT hypertable_name FROM timescaledb_information.hypertables;"
# esperado: lectura_telemetria
```

### ✅ Criterio US1 / SC-005

Los tres componentes quedan operativos y comunicados sin pasos manuales fuera de esta guía.

**Verificar también la resiliencia a reinicio** (US1, escenario 2):

```bash
docker compose restart rinho-receptor
docker compose ps                       # vuelve a healthy
# y las filas ya persistidas siguen ahí:
docker compose exec timescaledb psql -U postgres -d agrolink_telemetria \
  -c "SELECT count(*) FROM telemetria.lectura_telemetria;"
```

---

## 2. Tests unitarios (Principio VIII)

No requieren el entorno levantado.

```bash
# Parser EQ (los 3 casos obligatorios: completo / campos vacíos / trama corrupta)
cd rinho-receptor && npm test

# Cálculo del reporte de viaje
mvn test  # no se versiona mvnw; requiere Maven instalado localmente
```

Los fixtures del parser incluyen el **ejemplo oficial del fabricante** documentado en
[`contracts/rinho-eq-frame.md`](./contracts/rinho-eq-frame.md) §5, con su decodificación
esperada campo a campo.

---

## 3. Recepción y ACK con trama simulada (User Story 2)

Sin necesidad del dispositivo real. Se envía por UDP la trama oficial del fabricante:

```bash
FRAME='>REQ00000000000000-2780656-064296830000117F00000010836F1130112FFFF1117;1=,2=,3=,B=,14=,15=,2A=,2C=;ID=2326;*01<'

printf '%s' "$FRAME" | nc -u -w2 <IP_VM> <PUERTO_UDP>
```

**Esperado**:

- Una fila nueva en `lectura_telemetria` con `dispositivo_id = '2326'`.
- `estado_interpretacion = 'PARCIAL'` — correcto y esperado: esta trama viene **sin fix de
  hora GPS** y con **todos los campos CAN vacíos** (ver §5 del contrato).
- `campos_faltantes` incluye `momento_evento`, `combustible_pct`, y el odómetro cae a origen
  `GPS`.
- Log JSON en `docker compose logs rinho-receptor` con la trama recibida.
- **No hay ACK**: esta trama no trae `;#msgNum` (decisión D-06). Es el comportamiento
  correcto, no un fallo.

Para ejercitar el camino con ACK, usar una trama con `msgNum` y escuchar la respuesta:

```bash
# El receptor responde >ACK;#<msgNum>;ID=2326;*<cs>< al puerto de origen
nc -u -w3 <IP_VM> <PUERTO_UDP> <<< "$FRAME_CON_MSGNUM"
```

**Verificar el orden ACK-después-de-commit** (US2, escenario 2 — el escenario negativo):

```bash
docker compose stop timescaledb
printf '%s' "$FRAME_CON_MSGNUM" | nc -u -w3 <IP_VM> <PUERTO_UDP>
# esperado: NINGÚN ACK de vuelta, y un log de error de persistencia.
# El silencio es la señal para que el dispositivo reintente.
docker compose start timescaledb
```

### ✅ Criterio US2

El ACK solo se emite después de que el dato está persistido.

---

## 4. Persistencia auditable y payload crudo (User Stories 3 y 4)

```sql
SELECT dispositivo_id, momento_evento, momento_recepcion,
       latitud, longitud, velocidad_kmh,
       odometro_m, odometro_origen, combustible_pct, ignicion,
       estado_interpretacion, campos_faltantes
FROM telemetria.lectura_telemetria
WHERE dispositivo_id = '2326'
ORDER BY momento_evento DESC
LIMIT 10;
```

**Esperado (US3)**: los ocho campos del spec presentes y consultables; la secuencia
reconstruible en orden cronológico.

**Esperado (US4)**: el payload crudo íntegro, asociado a la misma fila:

```sql
SELECT payload_crudo, datos_can
FROM telemetria.lectura_telemetria
WHERE dispositivo_id = '2326'
ORDER BY momento_evento DESC LIMIT 1;
```

`payload_crudo` debe ser **byte por byte** la trama enviada.

### Verificar inmutabilidad (FR-011, Principio IV)

```bash
docker compose exec timescaledb psql -U rinho_receptor -d agrolink_telemetria \
  -c "UPDATE telemetria.lectura_telemetria SET velocidad_kmh = 0;"
# esperado: ERROR: permission denied for table lectura_telemetria
```

Que esto falle **es** el criterio de aceptación: la inmutabilidad la garantiza el motor, no
la buena conducta del código.

### Verificar deduplicación (edge case de reintento)

```bash
# Enviar la MISMA trama dos veces
printf '%s' "$FRAME" | nc -u -w2 <IP_VM> <PUERTO_UDP>
printf '%s' "$FRAME" | nc -u -w2 <IP_VM> <PUERTO_UDP>
```

```sql
SELECT count(*) FROM telemetria.lectura_telemetria WHERE frame_hash = <hash>;
-- esperado: 1
```

> Con esta trama en particular (sin fix de hora GPS) la deduplicación la resuelve la caché en
> memoria del receptor, no el índice único — ver la limitación conocida en D-07. Si las dos
> tramas se envían separadas por más que el TTL de la caché, se duplicará: es el riesgo R-3,
> conocido y aceptado para el piloto.

---

## 5. Reporte de viaje (User Story 5)

Desde dentro de la red del compose (el puerto no se publica). La imagen `eclipse-temurin:
21-jre-alpine` no trae `curl` ni `jq` (imagen minimal a propósito); `wget` sí está
disponible (es lo que usa el healthcheck del propio servicio):

```bash
docker compose exec agrolink-ingesta \
  wget -qO- "http://localhost:8080/api/v1/reportes/viaje?camionId=2326&desde=2026-08-15T00:00:00-03:00&hasta=2026-08-15T23:59:59-03:00"
```

Alternativa con formato legible, desde un contenedor temporal en la misma red (no requiere
`curl`/`jq` en la imagen de producción):

```bash
docker run --rm --network deploy_default curlimages/curl -s -G \
  "http://agrolink-ingesta:8080/api/v1/reportes/viaje" \
  --data-urlencode "camionId=2326" \
  --data-urlencode "desde=2026-08-15T00:00:00-03:00" \
  --data-urlencode "hasta=2026-08-15T23:59:59-03:00"
```

> El nombre de red `deploy_default` asume que Compose se invocó desde el directorio
> `deploy/` (nombre de proyecto = nombre de directorio). Verificar con `docker network ls`
> si se invocó de otra forma.

**Esperado**: las cinco métricas de FR-005. Contrato completo en
[`contracts/agrolink-reportes-api.yaml`](./contracts/agrolink-reportes-api.yaml).

Casos que hay que ejercitar explícitamente:

| Caso | Cómo provocarlo | Respuesta esperada |
|------|-----------------|--------------------|
| Sin datos (FR-006) | `camionId` inexistente | **404** `application/problem+json` con mensaje explícito, **nunca** 200 con ceros |
| Distancia cero (FR-005) | Rango donde el camión estuvo detenido | **200** con `tasaConsumoPromedio: null` y `tasaConsumoPromedioNoCalculable: true` |
| Odómetro mixto (D-05) | Rango que combine lecturas con origen `ECU` y `GPS` | **200** con `odometroOrigenMixto: true` |
| Rango inválido | `hasta` anterior a `desde` | **400** |

### ✅ Criterio US5 / SC-003 / SC-006

Contrastar los valores devueltos contra el cálculo manual sobre las mismas filas (SC-006).

---

## 6. Validación end-to-end con el dispositivo real (User Story 6)

**Este es el criterio definitivo de la feature.** Todo lo anterior usa tramas simuladas.

### 6.1 Antes de creerle a ninguna fila: verificar el layout (riesgo R-1)

El layout de la trama está verificado contra la documentación del fabricante, **no contra el
equipo físico**. Un ancho de campo distinto en el firmware instalado desplazaría todo el
parseo en silencio, produciendo filas que parecen válidas y no lo son.

```bash
# Capturar tramas crudas reales:
docker compose logs -f rinho-receptor | grep payload_crudo
```

Tomar una trama real y decodificarla **a mano** contra la tabla de
[`contracts/rinho-eq-frame.md`](./contracts/rinho-eq-frame.md) §3. Verificar en particular:

- La latitud/longitud caen donde el camión realmente está.
- La velocidad es plausible **en km/h** (si parece ~1.85× alta, alguien reintrodujo la
  conversión de nudos que este diseño eliminó).
- El odómetro crece de forma monótona entre lecturas sucesivas.

Si el layout real difiere, `payload_crudo` permite reprocesar todo el histórico sin haber
perdido nada (ése es el propósito de la User Story 4).

### 6.2 Confirmar qué publica realmente el ECU de este camión

```sql
SELECT
  count(*) AS total,
  count(combustible_pct) AS con_combustible,
  count(*) FILTER (WHERE odometro_origen = 'ECU') AS odometro_ecu,
  count(*) FILTER (WHERE estado_interpretacion = 'PARCIAL') AS parciales
FROM telemetria.lectura_telemetria
WHERE dispositivo_id = '<ID_REAL>';
```

> **Si `con_combustible` es 0**, el ECU del camión piloto no publica nivel de combustible por
> OBD-II. El ejemplo oficial del fabricante viene justamente con todos los campos CAN vacíos,
> así que es un desenlace plausible. No es un bug del parser: deja sin fuente al "combustible
> consumido" del reporte y obliga a replantear el alcance de SC-006 con la cátedra. Es el
> riesgo de mayor impacto de la feature — chequearlo **temprano**.

### 6.3 Medir la latencia end-to-end (SC-001)

```sql
SELECT dispositivo_id,
       momento_evento,
       momento_recepcion,
       momento_recepcion - momento_evento AS latencia
FROM telemetria.lectura_telemetria
WHERE dispositivo_id = '<ID_REAL>'
  AND NOT ('momento_evento' = ANY(coalesce(campos_faltantes, '{}')))
ORDER BY momento_evento DESC
LIMIT 20;
```

**Esperado**: latencia < 2 minutos (SC-001). El filtro excluye las filas sin fix de hora GPS,
donde `momento_evento` es la hora de recepción y la resta daría cero de forma engañosa.

### ✅ Criterio US6 / SC-001

Una lectura del dispositivo real recorre dispositivo → parser → TimescaleDB, correctamente
interpretada, sin intervención manual.

---

## 7. Concurrencia multi-camión (SC-004)

Con el dispositivo real hay un solo camión. Para validar SC-004 se envían tramas simuladas
con `ID` distintos en paralelo, generadas con el CLI `test/tools/buildFrame.js` (tarea T069),
que arma la trama EQ y **recalcula el checksum XOR** sobre el contenido final — un checksum
copiado a mano de otra trama haría que el receptor la descarte y el test daría un falso
negativo:

```bash
cd rinho-receptor
for id in 1001 1002 1003 1004 1005; do
  # buildFrame.js emite la trama completa >REQ...;ID=<id>;*<checksum>< por stdout
  printf '%s' "$(node test/tools/buildFrame.js --device-id "$id")" \
    | nc -u -w1 <IP_VM> <PUERTO_UDP> &
done
wait
```

```sql
SELECT dispositivo_id, count(*)
FROM telemetria.lectura_telemetria
WHERE dispositivo_id IN ('1001','1002','1003','1004','1005')
GROUP BY dispositivo_id;
-- esperado: cada camión con sus propias lecturas, ninguna cruzada
```

> El checksum debe recalcularse por trama: cambiar el `ID` cambia el XOR. Una trama con
> checksum viejo será rechazada — correctamente — y el test no probaría nada.

### ✅ Criterio SC-004

---

## Resumen de trazabilidad

| Escenario | User Story | Criterios |
|-----------|-----------|-----------|
| §1 Levantar entorno | US1 | SC-005, FR-008 |
| §2 Tests unitarios | — | Principio VIII |
| §3 Recepción y ACK | US2 | FR-001 |
| §4 Persistencia y payload crudo | US3, US4 | FR-002, FR-003, FR-004, FR-011, SC-002 |
| §5 Reporte de viaje | US5 | FR-005, FR-006, SC-003, SC-006 |
| §6 Dispositivo real | US6 | FR-009, SC-001 |
| §7 Concurrencia | — | FR-007, SC-004 |
