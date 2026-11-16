# Tasks: Migración del despliegue de producción de OCI a Azure

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

**Nota**: plan retroactivo. Las tareas `[X]` ya se hicieron entre el 15 y el 16 de noviembre de 2026; las `[ ]` están pendientes. Las tareas marcadas **(usuario)** las hace el usuario, porque requieren acceso a la cuenta de Azure, a GitHub, a la VM del backend o al dispositivo.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede hacerse en paralelo (no depende de otra tarea pendiente)
- **[Story]**: historia del spec (US1 a US5)

---

## Phase 1: Setup (provisión)

- [X] T001 Verificar las regiones permitidas por la policy y los tamaños habilitados para la suscripción con `deploy/azure/list-available-sizes.sh`. Resultado: canadacentral, `Standard_B2pls_v2`.
- [X] T002 Escribir `deploy/azure/provision.sh`. Valida región y tamaño antes de crear; crea grupo, NSG, IP estática y VM; elige la imagen según la arquitectura; es re-ejecutable.
- [X] T003 **(usuario)** Crear la VM con `bash provision.sh` en Cloud Shell. Resultado: `agrolink-ingesta`, `20.151.0.131`.

## Phase 2: Foundational

- [X] T004 Adaptar `deploy/vm-setup.sh` a Azure: el firewall lo hace el NSG, se desactiva el login SSH de root y por contraseña, y se crea un swap de 2 GB.
- [X] T005 [P] Bajar los límites de memoria en `deploy/compose.yaml`: TimescaleDB a 1536m, con `TS_TUNE_MEMORY=1GB`.
- [X] T006 [P] Compilar las imágenes para `linux/amd64` y `linux/arm64` en `.github/workflows/ci-cd.yml`, y actualizar el §1 de `deploy/README.md` con los digests de las dos arquitecturas.
- [X] T007 Correr `vm-setup.sh` en la VM: Docker 29.9, swap y `sshd` endurecido.

---

## Phase 3: US1 - Volver a recibir telemetría (P1) 🎯 MVP

- [X] T008 [US1] Copiar `deploy/` y `deploy/.env` a `~/AgroLinkIngestaYAdapters/` en la VM, con las mismas contraseñas (FR-008).
- [X] T009 [US1] Levantar TimescaleDB vacía y aplicar las migraciones 001 a 011 con `deploy/scripts/apply-migrations.sh`. Ver el incidente 1 del plan: la 010 y la 011 se aplicaron después.
- [X] T010 [US1] Levantar `rinho-receptor` y `agrolink-ingesta`. Los dos quedan healthy.
- [X] T011 [US1] Verificar la cadena UDP desde internet hasta la base con una trama de prueba. ⚠️ Esa fila se borró después; ver Complexity Tracking (Principio IV).
- [X] T012 [US1] **(usuario)** Reprogramar el Rinho (`SIP0`) hacia `20.151.0.131/5000`. Llegaron las tramas acumuladas del período de caída (Principio VII).
- [ ] T013 [P] [US1] Documentar en `deploy/README.md` la reprogramación del Rinho (FR-009): comandos `>SIP0<IP>/5000<` y `>SIP4<IP>/5000<`, y que SIP4 apuntaba a una IP privada (`192.168.1.44`) que no se alcanza desde GPRS. Sin la contraseña del WiFi.
- [ ] T014 [US1] **(usuario)** Confirmar que el canal SIP4 (celular) también apunte a `20.151.0.131/5000`, o que esté desactivado.

## Phase 4: US2 - El backend obtiene el estado, y solo él (P2)

- [X] T015 [US2] **(usuario)** Agregar la regla `allow-backend-ingesta` al NSG con `BACKEND_IP=64.181.162.233 bash provision.sh`.
- [X] T016 [US2] Verificar que desde otra red el 8082, el 5432, el 8081 y el 8083 estén cerrados y solo responda el 22.
- [X] T017 [P] [US2] Cambiar la URL de la ingesta a `20.151.0.131:8082` en `AgroLinkBackend/src/main/resources/application-prod.yml` y en su test (commit `61685a1`).
- [X] T018 [US2] **(usuario)** Poner `AGROLINK_INGESTA_BASE_URL=http://20.151.0.131:8082` en el `.env.production` de la VM del backend y recrear el contenedor.
- [ ] T019 [US2] **(usuario)** Verificar desde la VM del backend con `curl -s -m 5 http://20.151.0.131:8082/api/v1/vehiculos/860693084873877/estado` (HTTP 200), y que la web muestre el estado del camión (SC-003).
- [ ] T020 [US2] **(usuario)** Abrir el PR del backend (`bugfix/migrating-ingesta-from-oci-to-azure`) y mergearlo, para que la URL por defecto de prod no dependa solo del `.env.production`.

## Phase 5: US3 - CI/CD hacia el servidor nuevo (P3)

- [X] T021 [US3] Renombrar los secrets a `DEPLOY_HOST`, `DEPLOY_USER` y `DEPLOY_SSH_KEY` en `ci-cd.yml` y en el §7 de `deploy/README.md`, y quitar las referencias a OCI del workflow.
- [X] T022 [US3] **(usuario)** Cargar en GitHub `DEPLOY_HOST=20.151.0.131`, `DEPLOY_USER=ubuntu` y `DEPLOY_SSH_KEY` (la clave privada `ssh-key-2026-08-11`).
- [X] T023 [US3] Rebasear la rama sobre `origin/master` (incidente 1) y levantar `simulador-viajes` a mano con los mismos pasos que el job `deploy-simulador`.
- [ ] T024 [US3] **(usuario)** Push, PR y merge de `bugfix/migrating-from-oci-to-azure` a `master`. Confirmar que `migrate-and-deploy` termine en verde contra la VM nueva (FR-011, escenario 1 de US3).
- [ ] T025 [US3] **(usuario)** Después del merge, correr una vez el workflow manual con "Desplegar simulador-viajes" para confirmar que también funciona (escenario 3 de US3).
- [ ] T026 [US3] **(usuario)** Borrar de GitHub los secrets viejos `OCI_HOST`, `OCI_USERNAME` y `OCI_SSH_KEY`.

## Phase 6: US4 - Aviso antes de que se termine el crédito (P4)

- [ ] T027 [US4] **(usuario)** Crear un presupuesto con avisos por correo al 50, 75 y 90 % de 100 USD (FR-013), en Portal → Cost Management → Presupuestos, sobre la suscripción de Azure for Students. Si el tipo de suscripción no permite presupuestos, documentar en `deploy/README.md` dónde se ve el saldo del crédito y anotar en el calendario una revisión cada 2 semanas.

## Phase 7: US5 - Rehacer el servidor desde cero (P5)

- [ ] T028 [US5] Reescribir el §2 de `deploy/README.md` (Puesta en marcha) para Azure (FR-012): `list-available-sizes.sh` → `provision.sh` → copiar `deploy/` y `.env` → `vm-setup.sh` → migraciones → simulador. Hoy todavía describe Shape A1 y Security List de OCI.
- [ ] T029 [US5] Documentar el procedimiento de salida en `deploy/README.md` (FR-014): recrear el servidor en otro proveedor o suscripción, reapuntar el Rinho y el backend, volver a programar los viajes pendientes, y apagar o borrar `agrolink-rg`. Antes del **15/02/2027** (SC-007).

## Phase 8: Polish y verificación

- [ ] T030 Registrar la verificación de punta a punta en `specs/017-migracion-vm-azure/verification.md` (FR-015): salud de los servicios, trama real del Rinho en la base, estado consultado desde el backend, 8082 rechazado desde otra IP, 5432 no expuesto. No mandar tramas sintéticas a producción (ver Complexity Tracking).
- [ ] T031 Después del **2026-11-18 23:50 UTC** (72 h), verificar SC-005: `docker inspect -f '{{.Name}} {{.RestartCount}} {{.State.OOMKilled}}' $(docker ps -aq)` y `sudo journalctl -k | grep -i oom` sin eventos.
- [ ] T032 Cuando estén cerradas T019 a T031, cambiar el estado de `spec.md` de `Draft` a `Implemented`.

---

## Dependencies & Execution Order

- **Bloquean la entrega del 26/11:** T019 (la web muestra el estado), T024 (el CI despliega en la VM nueva) y T013 + T014 (los dos canales del Rinho).
- **T025 y T026** dependen de T024.
- **T028 y T029** se pueden hacer en paralelo con el resto: solo tocan `deploy/README.md`, en secciones distintas.
- **T029** tiene que estar antes del 15/02/2027.
- **T030** depende de T019. **T031** depende solo del paso del tiempo.
