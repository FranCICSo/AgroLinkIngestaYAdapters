#!/usr/bin/env bash
# Crea la VM de produccion de la ingesta en Azure (feature 017-migracion-vm-azure, FR-001/FR-002/FR-004).
#
# Pensado para correr en Azure Cloud Shell (Bash), donde `az` ya esta autenticado. Tambien
# corre en una maquina local con Azure CLI tras `az login`.
#
# Uso (subir junto a este script la clave publica como ssh-key.pub):
#   bash provision.sh
#   BACKEND_IP=203.0.113.10 bash provision.sh      # ademas abre 8082 solo al backend
#   VM_SIZE=Standard_B2als_v2 LOCATION=chilecentral bash provision.sh
# Para elegir VM_SIZE/LOCATION: bash list-available-sizes.sh
#
# Es re-ejecutable: si los recursos ya existen, `az` los actualiza en vez de duplicarlos.
# Para agregar la regla del backend despues, volver a correrlo con BACKEND_IP.
#
# Crear la VM consume credito (~30,6 USD/mes en canadacentral: B2pls_v2 + IPv4 estatica).
set -euo pipefail

LOCATION="${LOCATION:-canadacentral}"
RG="${RG:-agrolink-rg}"
VM_NAME="${VM_NAME:-agrolink-ingesta}"
VM_SIZE="${VM_SIZE:-Standard_B2pls_v2}"
# Ubuntu 24.04 LTS Gen2; si IMAGE queda vacio se elige segun la arquitectura del tamano
# (Arm64 -> server-arm64, x64 -> server). Las imagenes de GHCR son multi-arch (amd64 + arm64).
IMAGE="${IMAGE:-}"
# `ubuntu` mantiene APP_DIR=/home/ubuntu/AgroLinkIngestaYAdapters del pipeline de CI/CD.
ADMIN_USER="${ADMIN_USER:-ubuntu}"
OS_DISK_GB="${OS_DISK_GB:-64}"
UDP_PORT="${UDP_PORT:-5000}"
INGESTA_HTTP_PORT="${INGESTA_HTTP_PORT:-8082}"
BACKEND_IP="${BACKEND_IP:-}"
# Vacio = el default de Azure (Trusted Launch). Si `az vm create` lo rechaza para esta imagen
# o tamano, reintentar con SECURITY_TYPE=Standard.
SECURITY_TYPE="${SECURITY_TYPE:-}"
SSH_PUBKEY="${SSH_PUBKEY:-}"
SSH_PUBKEY_FILE="${SSH_PUBKEY_FILE:-$(dirname "$0")/ssh-key.pub}"

NSG="${VM_NAME}-nsg"
PIP="${VM_NAME}-ip"

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
fail() { printf '\n\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

if [[ -z "$SSH_PUBKEY" && -f "$SSH_PUBKEY_FILE" ]]; then
  SSH_PUBKEY="$(tr -d '\r' < "$SSH_PUBKEY_FILE" | head -n1)"
fi
[[ -n "$SSH_PUBKEY" ]] || fail "falta la clave publica: subir ssh-key.pub junto al script o definir SSH_PUBKEY."
[[ "$SSH_PUBKEY" == ssh-* ]] || fail "SSH_PUBKEY no parece una clave publica (debe empezar con 'ssh-')."

# --- FR-002: validar region y tamano ANTES de crear nada --------------------------------
log "Verificando que la region '$LOCATION' este permitida por la policy de la suscripcion"
ALLOWED="$(az policy assignment list \
  --query "[].parameters.listOfAllowedLocations.value[]" -o tsv 2>/dev/null || true)"
if [[ -n "$ALLOWED" ]] && ! grep -qx "$LOCATION" <<<"$ALLOWED"; then
  fail "la region '$LOCATION' no esta permitida. Regiones permitidas: $(tr '\n' ' ' <<<"$ALLOWED")"
fi

log "Verificando que '$VM_SIZE' exista en '$LOCATION' sin restricciones (puede tardar 1-3 min)"
# Con --all, list-skus incluye los tamanos que la suscripcion NO puede usar (sin --all los
# oculta, y no se distingue "no existe en la region" de "existe pero no para esta cuenta").
SKU_INFO="$(az vm list-skus --location "$LOCATION" --resource-type virtualMachines \
  --size "$VM_SIZE" --all \
  --query "[?name=='$VM_SIZE'] | [0].[restrictions, capabilities[?name=='CpuArchitectureType'].value | [0]]" \
  -o json)"
RESTRICTIONS="$(python3 -c 'import json,sys; d=json.load(sys.stdin); print("null" if d is None else json.dumps(d[0]))' <<<"$SKU_INFO")"
ARCH="$(python3 -c 'import json,sys; d=json.load(sys.stdin); print("" if d is None else (d[1] or ""))' <<<"$SKU_INFO")"
[[ "$RESTRICTIONS" != "null" && -n "$RESTRICTIONS" ]] \
  || fail "'$VM_SIZE' no existe en '$LOCATION'."
[[ "$RESTRICTIONS" == "[]" ]] \
  || fail "'$VM_SIZE' existe en '$LOCATION' pero esta suscripcion no puede usarlo: $RESTRICTIONS"

if [[ -z "$IMAGE" ]]; then
  case "$ARCH" in
    Arm64) IMAGE="Canonical:ubuntu-24_04-lts:server-arm64:latest" ;;
    *)     IMAGE="Canonical:ubuntu-24_04-lts:server:latest" ;;
  esac
fi
log "OK: '$VM_SIZE' habilitado (arquitectura ${ARCH:-x64}); imagen $IMAGE"

# --- Recursos ------------------------------------------------------------------------------
log "Grupo de recursos $RG"
az group create --name "$RG" --location "$LOCATION" -o none

log "Network Security Group $NSG (todo lo entrante denegado salvo estas reglas)"
az network nsg create --resource-group "$RG" --name "$NSG" --location "$LOCATION" -o none

# SSH abierto: GitHub Actions despliega desde IPs no fijas. Se compensa con login solo por
# clave (az vm create deshabilita la autenticacion por contrasena al pasar --ssh-key-values).
az network nsg rule create --resource-group "$RG" --nsg-name "$NSG" --name allow-ssh \
  --priority 100 --direction Inbound --access Allow --protocol Tcp \
  --source-address-prefixes '*' --destination-port-ranges 22 -o none

# Receptor UDP: los equipos reportan desde IPs celulares variables. Proteccion = validacion
# de checksum + dispositivo conocido en el receptor (excepcion de TLS, Principio VI).
az network nsg rule create --resource-group "$RG" --nsg-name "$NSG" --name allow-rinho-udp \
  --priority 110 --direction Inbound --access Allow --protocol Udp \
  --source-address-prefixes '*' --destination-port-ranges "$UDP_PORT" -o none

if [[ -n "$BACKEND_IP" ]]; then
  az network nsg rule create --resource-group "$RG" --nsg-name "$NSG" --name allow-backend-ingesta \
    --priority 120 --direction Inbound --access Allow --protocol Tcp \
    --source-address-prefixes "$BACKEND_IP" --destination-port-ranges "$INGESTA_HTTP_PORT" -o none
  log "API de la ingesta ($INGESTA_HTTP_PORT/tcp) abierta solo para $BACKEND_IP"
else
  log "BACKEND_IP vacio: $INGESTA_HTTP_PORT/tcp queda CERRADO. Volver a correr con BACKEND_IP=<ip>."
fi

log "IPv4 publica estatica $PIP"
az network public-ip create --resource-group "$RG" --name "$PIP" --location "$LOCATION" \
  --sku Standard --allocation-method Static --version IPv4 -o none

log "VM $VM_NAME ($VM_SIZE, $IMAGE)"
if az vm show --resource-group "$RG" --name "$VM_NAME" -o none 2>/dev/null; then
  log "La VM ya existe, no se recrea"
else
  az vm create --resource-group "$RG" --name "$VM_NAME" --location "$LOCATION" \
    --size "$VM_SIZE" --image "$IMAGE" ${SECURITY_TYPE:+--security-type "$SECURITY_TYPE"} \
    --admin-username "$ADMIN_USER" --ssh-key-values "$SSH_PUBKEY" \
    --public-ip-address "$PIP" --nsg "$NSG" \
    --os-disk-size-gb "$OS_DISK_GB" --storage-sku Premium_LRS \
    -o none
fi

IP="$(az network public-ip show --resource-group "$RG" --name "$PIP" --query ipAddress -o tsv)"
log "Listo. IP publica: $IP"
cat <<EOF

Siguientes pasos:
  1. ssh -i <clave privada> $ADMIN_USER@$IP
  2. Copiar el repo/deploy y deploy/.env a la VM y correr deploy/vm-setup.sh
  3. Reprogramar el Rinho: >SIP0$IP/$UDP_PORT<  (y SIP4 al mismo destino)
  4. Backend: INGESTA_BASE_URL=http://$IP:$INGESTA_HTTP_PORT
  5. Secrets del repo: DEPLOY_HOST=$IP, DEPLOY_USER=$ADMIN_USER, DEPLOY_SSH_KEY=<clave privada>
EOF
