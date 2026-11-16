#!/usr/bin/env bash
# Prepara una VM Ubuntu (x86_64 o ARM64; produccion: Azure, ver deploy/azure/) para correr este stack y,
# si deploy/.env ya existe, levanta docker compose. Ver deploy/README.md §2.
#
# Uso (en la VM, con el repo o al menos deploy/ copiado en ~/AgroLinkIngestaYAdapters):
#   cd ~/AgroLinkIngestaYAdapters/deploy && ./vm-setup.sh
#
# Idempotente: puede correrse de nuevo sin romper nada si ya está todo instalado.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UDP_PORT_DEFAULT=5000

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\n\033[1;33m!!\033[0m %s\n' "$1"; }

case "$(uname -m)" in
  x86_64|aarch64) log "arquitectura: $(uname -m) (las imágenes del stack publican amd64 y arm64, README §1)" ;;
  *) warn "arquitectura no soportada: $(uname -m). Las imágenes solo existen para amd64 y arm64 (README §1)." ;;
esac

# --- 1. Paquetes base y Docker Engine + Compose plugin -----------------------

if ! command -v docker &>/dev/null; then
  log "Instalando Docker Engine (repositorio oficial docker.com)"
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  log "Docker ya está instalado ($(docker --version))"
fi

sudo systemctl enable --now docker

if ! groups "$USER" | grep -q '\bdocker\b'; then
  log "Agregando $USER al grupo docker (hace falta cerrar sesión y volver a entrar para que aplique)"
  sudo usermod -aG docker "$USER"
  warn "Cerrá la sesión SSH y volvé a entrar antes de correr 'docker compose' sin sudo."
fi

# --- 2. Firewall: lo hace el NSG de Azure, no el sistema operativo ------------
#
# En Azure el filtrado de entrada lo hace el Network Security Group (deploy/azure/provision.sh:
# SSH, UDP del receptor, 8082 solo desde el backend). Las imagenes Ubuntu de Azure traen
# iptables con politica ACCEPT y ufw inactivo, asi que no hace falta abrir nada aca. (En la
# VM de Oracle Cloud anterior si: su imagen traia iptables bloqueando todo salvo SSH.)
# Si el host tuviera ufw activo, se abre el puerto UDP igual para no bloquear las tramas.

UDP_PORT="${UDP_PORT:-$UDP_PORT_DEFAULT}"

if command -v ufw &>/dev/null && sudo ufw status | grep -q "Status: active"; then
  log "ufw activo: abriendo UDP/${UDP_PORT}"
  sudo ufw allow "${UDP_PORT}/udp"
elif sudo iptables -S INPUT 2>/dev/null | grep -q -- '-P INPUT ACCEPT'; then
  log "iptables con politica ACCEPT: el filtrado lo hace el NSG de Azure"
else
  warn "iptables INPUT no es ACCEPT: abriendo UDP/${UDP_PORT} (no persiste sin iptables-persistent)"
  sudo iptables -C INPUT -p udp --dport "${UDP_PORT}" -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT -p udp --dport "${UDP_PORT}" -j ACCEPT
fi

# --- 2.1 SSH: sin login de root (FR-004) --------------------------------------

SSHD_DROPIN=/etc/ssh/sshd_config.d/60-agrolink.conf
if [[ ! -f "$SSHD_DROPIN" ]]; then
  log "Deshabilitando login SSH de root y autenticacion por contrasena"
  printf 'PermitRootLogin no\nPasswordAuthentication no\n' | sudo tee "$SSHD_DROPIN" > /dev/null
  sudo sshd -t && sudo systemctl reload ssh
fi

# --- 2.2 Swap de respaldo -----------------------------------------------------
#
# La VM tiene 4 GB sin swap. Un swapfile de 2 GB evita que el kernel mate procesos ante un
# pico (p. ej. arranque en frio de la JVM mientras TimescaleDB hace checkpoint).

if ! swapon --show | grep -q .; then
  log "Creando swapfile de 2 GB"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile > /dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/60-agrolink-swap.conf > /dev/null
  sudo sysctl -q -p /etc/sysctl.d/60-agrolink-swap.conf
fi

# --- 3. Levantar el stack, solo si ya existe deploy/.env ---------------------

ENV_FILE="$SCRIPT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  log "Encontrado $ENV_FILE — levantando el stack"
  (cd "$SCRIPT_DIR" && docker compose up -d)
  (cd "$SCRIPT_DIR" && docker compose ps)
else
  warn "$ENV_FILE no existe todavía. No se levanta el stack."
  warn "Copiá deploy/.env.example a deploy/.env, completá las contraseñas (ver README §2.3)"
  warn "y volvé a correr este script, o directamente: cd deploy && docker compose up -d"
fi
