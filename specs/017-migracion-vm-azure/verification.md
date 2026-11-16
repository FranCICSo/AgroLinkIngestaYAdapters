# Verificación de punta a punta: migración a Azure (FR-015)

**Servidor**: `agrolink-ingesta`, `20.151.0.131` (Azure, Canada Central, `Standard_B2pls_v2`)
**Fecha**: 2026-11-16, alrededor de las 01:00 UTC
**Verificó**: chequeos ejecutados desde la máquina de desarrollo (red externa) y por SSH en la VM

| # | Chequeo | Cómo | Resultado |
|---|---------|------|-----------|
| 1 | Servicios healthy, sin reinicios ni OOM | `docker ps`; `docker inspect -f '{{.RestartCount}} {{.State.OOMKilled}}'` | ✅ `timescaledb`, `rinho-receptor` y `agrolink-ingesta` healthy; `simulador-viajes` running; 0 reinicios y `OOMKilled=false` en los 4. Memoria: 875 MB usados de 3,8 GB. |
| 2 | Esquema completo | `select count(*) from public.schema_migrations` | ✅ 11 migraciones (001 a 011). Sin errores de SQL de la ingesta desde 2026-11-16 00:51 UTC (antes: incidente 1 del plan). |
| 3 | Llega una trama real del Rinho a la base | Consulta de §2.6 del README sobre el dispositivo `860693084873877` | ✅ 2795 lecturas. Última: `momento_evento` 01:00:22, `momento_recepcion` 01:00:24 UTC (en vivo). Antes llegaron las tramas acumuladas del 15/11 (Principio VII). |
| 4 | La API de estado responde en la VM | `curl http://127.0.0.1:8082/api/v1/vehiculos/860693084873877/estado` | ✅ HTTP 200 |
| 5 | La API de estado **no** responde desde otra IP | TCP 8082 desde una red que no es la del backend | ✅ Cerrado (NSG `allow-backend-ingesta`, origen `64.181.162.233`) |
| 6 | Base y puertos internos no expuestos | TCP 5432, 8081 y 8083 desde una red externa | ✅ Cerrados. Solo responde el 22 (SSH por clave, sin root). |
| 7 | El backend obtiene el estado desde la ingesta nueva | Desde la VM del backend: `curl -s -m 5 http://20.151.0.131:8082/api/v1/vehiculos/860693084873877/estado`; y la web muestra el estado del camión | ⏳ **Pendiente (T019)**. El usuario configuró `AGROLINK_INGESTA_BASE_URL` en la VM del backend, pero no se pudo comprobar desde la VM de la ingesta (no tiene `tcpdump`). |
| 8 | El CI despliega en la VM nueva | Merge a `master` → `migrate-and-deploy` en verde | ⏳ **Pendiente (T024)**. Corre solo después del merge. |
| 9 | 72 h sin reinicios por memoria (SC-005) | Igual que el chequeo 1, más `sudo journalctl -k \| grep -i oom` | ⏳ **Pendiente (T031)**, después del 2026-11-18 23:50 UTC |

## Notas

- La cadena UDP→base también se probó el 2026-11-15 con una trama sintética del fabricante
  (dispositivo `2326`), que después se borró. Eso viola el Principio IV (ver Complexity
  Tracking del plan). **Las próximas verificaciones usan solo el dispositivo real.**
- Los chequeos 7 a 9 se completan en esta tabla cuando se ejecuten; el estado del spec pasa a
  `Implemented` cuando estén los tres en ✅ (T032).
