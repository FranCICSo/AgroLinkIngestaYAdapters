#!/usr/bin/env bash
# Prepara una VM Ubuntu (Oracle Cloud Ampere A1, ARM64) para correr este stack y,
# si deploy/.env ya existe, levanta docker compose. Ver deploy/README.md §2.
#
# Uso:
#   git clone <repo> && cd AgroLinkIngestaAdaptacion/deploy
#   ./vm-setup.sh
#
# Idempotente: puede correrse de nuevo sin romper nada si ya está todo instalado.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UDP_PORT_DEFAULT=5000

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\n\033[1;33m!!\033[0m %s\n' "$1"; }

if [[ "$(uname -m)" != "aarch64" ]]; then
  warn "arquitectura detectada: $(uname -m) (se esperaba aarch64/ARM64)."
  warn "las imágenes fijadas en compose.yaml están verificadas para ARM64 (T005, ver README §1)."
fi

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

# --- 2. Firewall del sistema operativo (además de la Security List/NSG de la VCN) --
#
# Trampa conocida: en las imágenes Ubuntu de Oracle Cloud, iptables viene con reglas
# INPUT que bloquean todo lo que no sea SSH, ADEMÁS de la Security List de la nube.
# Abrir el puerto solo en la VCN no alcanza si esto no se abre también acá.

UDP_PORT="${UDP_PORT:-$UDP_PORT_DEFAULT}"

if command -v ufw &>/dev/null && sudo ufw status | grep -q "Status: active"; then
  log "ufw activo: abriendo UDP/${UDP_PORT}"
  sudo ufw allow "${UDP_PORT}/udp"
else
  log "Abriendo UDP/${UDP_PORT} en iptables (netfilter-persistent)"
  if ! sudo iptables -C INPUT -p udp --dport "${UDP_PORT}" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT -p udp --dport "${UDP_PORT}" -j ACCEPT
  fi
  if command -v netfilter-persistent &>/dev/null; then
    sudo netfilter-persistent save
  else
    warn "netfilter-persistent no está instalado: la regla de iptables NO sobrevive un reboot."
    warn "Instalar con: sudo apt-get install -y iptables-persistent"
  fi
fi

warn "Esto solo abre el puerto EN LA VM. Falta la regla de ingress UDP en la Security List/NSG"
warn "de la VCN (consola de Oracle Cloud) — ver deploy/README.md §2.2. Sin las dos, no entra tráfico."

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
