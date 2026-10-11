# AgroLink Ingesta y Adaptacion - Makefile Multiplataforma (Linux, macOS, Windows)

DEPLOY_DIR ?= deploy

# Feature 011-generar-ruta-simulada (research.md D-08): region de OpenStreetMap (Geofabrik,
# carpeta south-america) que procesa `make osrm`. Pisable con `make osrm OSRM_REGION=otra`.
OSRM_REGION ?= argentina
OSRM_DATA_DIR ?= $(DEPLOY_DIR)/osrm-data

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

.PHONY: help dev start stack docker-up docker-down dc-up dc-down db-reset timescaledb receptor ingesta seed-telemetry simulador osrm

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
	@echo "  make simulador    - Levanta el simulador de viajes (feature 009): aplica su"
	@echo "                      schema + camion 1 de referencia si hace falta, y lo corre"
	@echo "                      contra el receptor local (nunca produccion por defecto)."
	@echo "                      Tambien levanta OSRM (feature 011, ver 'make osrm')."
	@echo "  make osrm         - Levanta el servicio OSRM self-hosted (feature 011): descarga"
	@echo "                      y procesa el extracto de OSRM_REGION (default: argentina) la"
	@echo "                      primera vez (tarda varios minutos y cientos de MB), despues"
	@echo "                      es idempotente. Ya incluido en 'make simulador'."
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

# OSRM self-hosted (feature 011-generar-ruta-simulada, research.md D-08): levantarlo y
# operarlo es parte del alcance de esta feature (proyecto de tesis/PoC, sin otro equipo que
# ya lo opere como infraestructura externa - ver spec.md § Clarifications). Descarga el
# extracto de OSM_REGION desde Geofabrik y lo preprocesa (osrm-extract/partition/customize)
# la primera vez unicamente - ambos pasos son costosos (cientos de MB, varios minutos) pero
# se saltean si los archivos ya existen, mismo principio de idempotencia que el resto de
# este Makefile.
osrm:
	@mkdir -p "$(OSRM_DATA_DIR)"
	@if [ ! -f "$(OSRM_DATA_DIR)/$(OSRM_REGION)-latest.osm.pbf" ]; then \
	  echo "⬇️  Descargando extracto OSM de $(OSRM_REGION) (Geofabrik, puede tardar varios minutos)..."; \
	  curl -fL -o "$(OSRM_DATA_DIR)/$(OSRM_REGION)-latest.osm.pbf" \
	    "https://download.geofabrik.de/south-america/$(OSRM_REGION)-latest.osm.pbf"; \
	else \
	  echo "✅ Extracto OSM de $(OSRM_REGION) ya descargado, se omite."; \
	fi
	@if [ ! -f "$(OSRM_DATA_DIR)/$(OSRM_REGION)-latest.osrm" ]; then \
	  echo "⚙️  Procesando el extracto (osrm-extract/partition/customize, solo la primera vez)..."; \
	  docker run --rm -t -v "$(abspath $(OSRM_DATA_DIR))":/data osrm/osrm-backend \
	    osrm-extract -p /opt/car.lua "/data/$(OSRM_REGION)-latest.osm.pbf" && \
	  docker run --rm -t -v "$(abspath $(OSRM_DATA_DIR))":/data osrm/osrm-backend \
	    osrm-partition "/data/$(OSRM_REGION)-latest.osrm" && \
	  docker run --rm -t -v "$(abspath $(OSRM_DATA_DIR))":/data osrm/osrm-backend \
	    osrm-customize "/data/$(OSRM_REGION)-latest.osrm"; \
	else \
	  echo "✅ Extracto de $(OSRM_REGION) ya procesado, se omite."; \
	fi
	@echo "🗺️  Levantando el servicio OSRM (puerto interno, no publicado al host)..."
	@cd "$(DEPLOY_DIR)" && OSRM_REGION=$(OSRM_REGION) docker compose --profile simulador up -d osrm
	@echo "✅ OSRM corriendo. Logs: cd $(DEPLOY_DIR) && docker compose logs -f osrm"

# Simulador de viajes (feature 009-simulador-viajes): camiones ficticios que envian
# telemetria real por UDP al receptor. Vive en profiles: ["simulador"] del compose, asi que
# nunca arranca con `docker compose up`/`make stack` a secas - solo con este target.
# Aplica su schema (deploy/db/03-schema-simulador.sql) y el camion 1 de referencia
# (deploy/seed/simulador-camion-1.sql) si todavia no existen - ambos scripts son
# idempotentes, se pueden re-aplicar sin duplicar nada. Depende de `osrm` (feature 011):
# la generacion de rutas (`npm run crear-ruta`/`POST /rutas`) la necesita para trazar sobre
# calles reales.
simulador: timescaledb receptor osrm
	@echo "🚚 Preparando el schema del simulador y el camion 1 de referencia (si hace falta)..."
	@cd "$(DEPLOY_DIR)" && set -a && . ./.env && set +a && \
	 docker compose exec -T -e SIMULADOR_VIAJES_DB_PASSWORD timescaledb \
	   psql -U postgres -d "$${POSTGRES_DB}" -v ON_ERROR_STOP=1 -f - < db/03-schema-simulador.sql && \
	 docker compose exec -T timescaledb \
	   psql -U postgres -d "$${POSTGRES_DB}" -v ON_ERROR_STOP=1 -f - < seed/simulador-camion-1.sql
	@echo "🚚 Levantando el simulador de viajes (camion 900001, apunta a local por defecto)..."
	@cd "$(DEPLOY_DIR)" && docker compose --profile simulador up -d simulador-viajes
	@echo "✅ Simulador corriendo. Logs: cd $(DEPLOY_DIR) && docker compose logs -f simulador-viajes"

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

# Infra en Docker (db + receptor + simulador) + ingesta local, para desarrollo iterativo
dev: timescaledb receptor simulador
	@echo "🔥 AgroLink Ingesta: TimescaleDB + receptor + simulador en Docker, agrolink-ingesta local..."
	@echo "ℹ️  Ctrl+C detiene solo ingesta. Los contenedores Docker siguen corriendo"
	@echo "   ('make docker-down' para bajarlos)."
	@$(MAKE) ingesta

start: dev
