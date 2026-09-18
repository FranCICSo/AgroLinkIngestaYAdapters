# AgroLink Ingesta y Adaptacion - Makefile Multiplataforma (Linux, macOS, Windows)

DEPLOY_DIR ?= deploy

# Deteccion de Sistema Operativo
ifeq ($(OS),Windows_NT)
    DETECTED_OS := Windows
else
    UNAME_S := $(shell uname -s)
    ifeq ($(UNAME_S),Darwin)
        DETECTED_OS := MacOS
    else
        DETECTED_OS := Linux
    endif
endif

.PHONY: help dev start stack docker-up docker-down dc-up dc-down db-reset timescaledb receptor ingesta seed-telemetry

help:
	@echo "=========================================================="
	@echo " AgroLink Ingesta y Adaptacion - Comandos de Desarrollo ($(DETECTED_OS))"
	@echo "=========================================================="
	@echo "  make dev          - TimescaleDB + receptor en Docker, ingesta local (Spring Boot)"
	@echo "  make stack        - Levanta el stack COMPLETO en Docker (db + receptor + ingesta)"
	@echo "  make docker-down  - Detiene todos los contenedores Docker"
	@echo "  make db-reset     - Borra los datos de TimescaleDB y reinicia los contenedores"
	@echo "  make timescaledb  - Levanta solo TimescaleDB (Docker)"
	@echo "  make receptor     - Levanta solo el receptor UDP rinho-receptor (Docker)"
	@echo "  make ingesta      - Inicia agrolink-ingesta localmente (Spring Boot), contra"
	@echo "                      TimescaleDB en Docker; detiene la version dockerizada primero"
	@echo "                      para no chocar de puerto"
	@echo "  make seed-telemetry - Inserta datos de telemetria de ejemplo (dispositivo"
	@echo "                      860693084873877) en TimescaleDB local. Nunca corre en"
	@echo "                      produccion (no forma parte de deploy/db/)."
	@echo "=========================================================="

# Docker Compose: stack completo (alias docker-up / stack)
docker-up: stack
dc-up: stack
stack:
	@echo "🚀 Levantando el stack completo en Docker (timescaledb + rinho-receptor + agrolink-ingesta)..."
	@cd "$(DEPLOY_DIR)" && docker compose up -d

docker-down: dc-down
dc-down:
	@echo "🛑 Deteniendo todos los servicios de Docker..."
	@cd "$(DEPLOY_DIR)" && docker compose down

# Reinicio completo de TimescaleDB (borra el volumen, no hay bind mount que limpiar a mano)
db-reset:
	@echo "⚠️  Borrando datos de TimescaleDB y reiniciando contenedores..."
	@cd "$(DEPLOY_DIR)" && docker compose down --volumes --remove-orphans
	@cd "$(DEPLOY_DIR)" && docker compose up -d --wait timescaledb rinho-receptor
	@echo "✅ Base de datos reiniciada correctamente."

timescaledb:
	@echo "🐘 Levantando TimescaleDB..."
	@cd "$(DEPLOY_DIR)" && docker compose up -d --wait timescaledb

receptor:
	@echo "📡 Levantando el receptor UDP (rinho-receptor)..."
	@cd "$(DEPLOY_DIR)" && docker compose up -d rinho-receptor

# Inserta datos de telemetria de ejemplo (dispositivo 860693084873877, feature 006) en
# TimescaleDB local. Usa el rol rinho_receptor (unico con INSERT, Principio IV). El script
# vive en deploy/seed/, NUNCA en deploy/db/, para que no corra solo al iniciar el stack de
# produccion (deploy/compose.yaml monta deploy/db/ como docker-entrypoint-initdb.d).
seed-telemetry: timescaledb
	@echo "🌱 Insertando datos de telemetria de ejemplo (dispositivo 860693084873877)..."
	@cd "$(DEPLOY_DIR)" && set -a && . ./.env && set +a && \
	 docker compose exec -T timescaledb \
	   psql "postgresql://$${RINHO_RECEPTOR_DB_USER}:$${RINHO_RECEPTOR_DB_PASSWORD}@localhost:5432/$${POSTGRES_DB}" \
	   -v ON_ERROR_STOP=1 -f - < seed/seed-demo-telemetry.sql
	@echo "✅ Datos de telemetria de ejemplo insertados (o ya existian)."

# Corre agrolink-ingesta localmente (Spring Boot) contra el TimescaleDB de Docker.
# Detiene el contenedor dockerizado del mismo servicio primero: comparten los mismos
# puertos (REPORTES_HTTP_PORT / VEHICULO_ESTADO_HTTP_PORT) y chocarian si ambos corren.
ingesta: timescaledb
	@echo "☕ Iniciando agrolink-ingesta (Spring Boot, local)..."
	@cd "$(DEPLOY_DIR)" && docker compose stop agrolink-ingesta >/dev/null 2>&1 || true
	@set -a; . ./$(DEPLOY_DIR)/.env; set +a; \
	 DB_HOST=localhost DB_PORT=5432 \
	 SERVER_PORT=$${REPORTES_HTTP_PORT:-8080} \
	 VEHICULO_ESTADO_HTTP_PORT=$${VEHICULO_ESTADO_HTTP_PORT:-8082} \
	 mvn spring-boot:run

# Infra en Docker (db + receptor) + ingesta local, para desarrollo iterativo
dev: timescaledb receptor
	@echo "🔥 AgroLink Ingesta: TimescaleDB + receptor en Docker, agrolink-ingesta local..."
	@echo "ℹ️  Ctrl+C detiene solo ingesta. Los contenedores Docker siguen corriendo"
	@echo "   ('make docker-down' para bajarlos)."
	@$(MAKE) ingesta

start: dev
