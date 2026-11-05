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

.PHONY: help dev start stack docker-up docker-down dc-up dc-down db-reset migrate timescaledb receptor ingesta seed-telemetry simulador simulador-schema simulador-local-prep simulador-docker

help:
	@echo "=========================================================="
	@echo " AgroLink Ingesta y Adaptacion - Comandos de Desarrollo ($(DETECTED_OS))"
	@echo "=========================================================="
	@echo "  make dev          - TimescaleDB + receptor en Docker; simulador (segundo plano,"
	@echo "                      logs en SIMULADOR_LOG) e ingesta (Spring Boot) en esta maquina"
	@echo "  make stack        - Levanta el stack COMPLETO en Docker (db + receptor + ingesta)"
	@echo "  make docker-down  - Detiene todos los contenedores Docker"
	@echo "  make db-reset     - Borra los datos de TimescaleDB y reinicia los contenedores"
	@echo "                      (aplica las migraciones al final, ver 'make migrate')"
	@echo "  make migrate      - Aplica las migraciones pendientes de deploy/migrations/ a"
	@echo "                      TimescaleDB local (idempotente, mismo script que el CI/CD)"
	@echo "  make timescaledb  - Levanta solo TimescaleDB (Docker)"
	@echo "  make receptor     - Levanta solo el receptor UDP rinho-receptor (Docker)"
	@echo "  make ingesta      - Inicia agrolink-ingesta localmente (Spring Boot), contra"
	@echo "                      TimescaleDB en Docker; detiene la version dockerizada primero"
	@echo "                      para no chocar de puerto. Apunta al simulador local"
	@echo "                      (localhost:SIMULADOR_PUERTO_HTTP), o a la IP de su contenedor"
	@echo "                      si corre 'make simulador-docker', salvo SIMULADOR_VIAJES_BASE_URL"
	@echo "                      Aplica antes las migraciones pendientes ('make migrate')."
	@echo "  make seed-telemetry - Inserta datos de telemetria de ejemplo (dispositivo"
	@echo "                      860693084873877) en TimescaleDB local. Nunca corre en"
	@echo "                      produccion (no forma parte de deploy/db/)."
	@echo "  make simulador    - Corre el simulador de viajes (feature 009) en esta maquina"
	@echo "                      (node, en primer plano): aplica su schema + camion 1 de"
	@echo "                      referencia si hace falta, y apunta al receptor, TimescaleDB"
	@echo "                      e ingesta locales (nunca produccion por defecto). Incluye el"
	@echo "                      emisor Samsara si SAMSARA_EMISOR_HABILITADO=true (feature 015)."
	@echo "                      Traza rutas con el demo server publico de OSRM (OSRM_BASE_URL)."
	@echo "  make simulador-docker - Igual, pero en Docker (buildea la imagen local, --build)"
	@echo "=========================================================="

# Docker Compose: stack completo (alias docker-up / stack)
docker-up: stack
dc-up: stack
stack:
	@echo "🚀 Levantando el stack completo en Docker (timescaledb + rinho-receptor + agrolink-ingesta)..."
	@cd "$(DEPLOY_DIR)" && docker compose up -d

# `--profile simulador` en los `down`: sin el, simulador-viajes sobrevive pero la
# red deploy_default se borra, y el siguiente `up` falla con "network ... not found" porque
# compose reusa esos contenedores apuntando a la red vieja. En `down` el profile solo amplia
# lo que se baja, nunca levanta nada.
docker-down: dc-down
dc-down:
	@echo "🛑 Deteniendo todos los servicios de Docker..."
	@cd "$(DEPLOY_DIR)" && docker compose --profile simulador down

# Reinicio completo de TimescaleDB (borra el volumen, no hay bind mount que limpiar a mano)
db-reset:
	@echo "⚠️  Borrando datos de TimescaleDB y reiniciando contenedores..."
	@cd "$(DEPLOY_DIR)" && docker compose --profile simulador down --volumes --remove-orphans
	@cd "$(DEPLOY_DIR)" && docker compose up -d --wait timescaledb rinho-receptor
	@$(MAKE) --no-print-directory migrate
	@echo "✅ Base de datos reiniciada correctamente."

# Aplica deploy/migrations/ con el mismo script que el CI/CD (trackeado en
# public.schema_migrations, cada archivo corre a lo sumo una vez). Hace falta tras un
# db-reset: deploy/db/ solo recrea el esquema base, no lo agregado por migraciones (p. ej.
# ingesta.viaje_programado, 007).
migrate: timescaledb
	@echo "🗄️  Aplicando migraciones pendientes de $(DEPLOY_DIR)/migrations..."
	@set -a; . ./$(DEPLOY_DIR)/.env; set +a; \
	 $(DEPLOY_DIR)/scripts/apply-migrations.sh $(DEPLOY_DIR)/compose.yaml $(DEPLOY_DIR)/migrations POSTGRES_DB

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

# Simulador de viajes (feature 009-simulador-viajes): camiones ficticios que envian
# telemetria real por UDP al receptor. Vive en profiles: ["simulador"] del compose, asi que
# nunca arranca con `docker compose up`/`make stack` a secas - solo con este target.
# Aplica su schema (deploy/db/03-schema-simulador.sql) y el camion 1 de referencia
# (deploy/seed/simulador-camion-1.sql) si todavia no existen - ambos scripts son
# idempotentes, se pueden re-aplicar sin duplicar nada. La generacion de rutas
# (`npm run crear-ruta`/`POST /rutas`, feature 011) traza sobre calles reales con el demo
# server publico de OSRM (OSRM_BASE_URL), no con un contenedor local.
simulador-schema: timescaledb
	@echo "🚚 Preparando el schema del simulador y el camion 1 de referencia (si hace falta)..."
	@cd "$(DEPLOY_DIR)" && set -a && . ./.env && set +a && \
	 docker compose exec -T -e SIMULADOR_VIAJES_DB_PASSWORD timescaledb \
	   psql -U postgres -d "$${POSTGRES_DB}" -v ON_ERROR_STOP=1 -f - < db/03-schema-simulador.sql && \
	 docker compose exec -T timescaledb \
	   psql -U postgres -d "$${POSTGRES_DB}" -v ON_ERROR_STOP=1 -f - < seed/simulador-camion-1.sql

# Desarrollo local: el simulador corre en esta maquina, no en Docker. Los valores de deploy/.env
# que nombran servicios de compose (rinho-receptor, timescaledb, agrolink-ingesta) se pisan por
# localhost: el receptor publica UDP_PORT, TimescaleDB 127.0.0.1:5432 e ingesta corre local
# ('make ingesta') en REPORTES_HTTP_PORT, que es el puerto que acepta el webhook Samsara.
# Detiene antes el contenedor simulador-viajes, si lo hay, para no duplicar camiones ni chocar
# con el puerto HTTP.
# Comando compartido por `simulador` (primer plano) y `dev` (segundo plano): `exec` hace que el
# PID del subshell sea el de node, asi `dev` puede detenerlo al salir ingesta.
SIMULADOR_LOCAL = set -a; . ./$(DEPLOY_DIR)/.env; set +a; \
	 cd simulador-viajes && \
	 RECEPTOR_HOST=localhost RECEPTOR_PORT=$${UDP_PORT:-5000} \
	 DB_HOST=localhost DB_PORT=5432 \
	 PUERTO_HTTP=$${SIMULADOR_PUERTO_HTTP:-8090} \
	 SAMSARA_WEBHOOK_URL=http://localhost:$${REPORTES_HTTP_PORT:-8080}/api/v1/proveedores/samsara/webhook \
	 exec node src/index.js
SIMULADOR_LOG ?= $${TMPDIR:-/tmp}/agrolink-simulador-viajes.log

simulador-local-prep: simulador-schema receptor
	@cd "$(DEPLOY_DIR)" && docker compose stop simulador-viajes >/dev/null 2>&1 || true
	@[ -d simulador-viajes/node_modules ] || (cd simulador-viajes && npm install)

simulador: simulador-local-prep
	@echo "🚚 Corriendo el simulador de viajes en esta maquina (Ctrl+C lo detiene)..."
	@$(SIMULADOR_LOCAL)

simulador-docker: simulador-schema receptor
	@echo "🚚 Levantando el simulador de viajes en Docker (camion 900001, apunta a local por defecto)..."
	@# --build: sin el, compose reusa la imagen cacheada/pulleada (ghcr ...:latest) aunque
	@# el codigo de simulador-viajes/ haya cambiado. Con cache de capas, sin cambios es rapido.
	@cd "$(DEPLOY_DIR)" && docker compose --profile simulador up -d --build simulador-viajes
	@echo "✅ Simulador corriendo. Logs: cd $(DEPLOY_DIR) && docker compose logs -f simulador-viajes"

# Corre agrolink-ingesta localmente (Spring Boot) contra el TimescaleDB de Docker.
# Detiene el contenedor dockerizado del mismo servicio primero: comparten los mismos
# puertos (REPORTES_HTTP_PORT / VEHICULO_ESTADO_HTTP_PORT) y chocarian si ambos corren.
# El default de SIMULADOR_VIAJES_BASE_URL (http://simulador-viajes:8090) solo resuelve dentro
# de la red de compose, y simulador-viajes no publica puertos (011 research.md D-04). Si no
# viene definida: si el contenedor simulador-viajes esta corriendo ('make simulador-docker'),
# se usa su IP en la red de Docker (alcanzable desde el host solo en Linux; la IP cambia al
# recrearlo, por eso se resuelve en cada `make ingesta`). Si no, se asume el simulador local
# ('make simulador') en http://localhost:SIMULADOR_PUERTO_HTTP.
# Depende de `migrate`: el ORM no toca el DDL (ddl-auto: none), asi que una migracion nueva
# sin aplicar rompe ingesta en runtime (columna inexistente). Es idempotente y rapido.
ingesta: migrate
	@echo "☕ Iniciando agrolink-ingesta (Spring Boot, local)..."
	@cd "$(DEPLOY_DIR)" && docker compose stop agrolink-ingesta >/dev/null 2>&1 || true
	@set -a; . ./$(DEPLOY_DIR)/.env; set +a; \
	 if [ -z "$${SIMULADOR_VIAJES_BASE_URL:-}" ]; then \
	   SIM_IP=$$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' simulador-viajes 2>/dev/null); \
	   if [ -z "$${SIMULADOR_PUERTO_HTTP:-}" ]; then \
	     echo "⚠️  Sin SIMULADOR_PUERTO_HTTP en deploy/.env: los viajes simulados fallaran"; \
	   elif [ -n "$$SIM_IP" ] && [ "$$(docker inspect -f '{{.State.Running}}' simulador-viajes 2>/dev/null)" = "true" ]; then \
	     export SIMULADOR_VIAJES_BASE_URL="http://$$SIM_IP:$${SIMULADOR_PUERTO_HTTP}"; \
	     echo "🚚 simulador-viajes en $$SIMULADOR_VIAJES_BASE_URL (IP del contenedor)"; \
	   else \
	     export SIMULADOR_VIAJES_BASE_URL="http://localhost:$${SIMULADOR_PUERTO_HTTP}"; \
	     echo "🚚 simulador-viajes en $$SIMULADOR_VIAJES_BASE_URL (local, 'make simulador')"; \
	   fi; \
	 fi; \
	 DB_HOST=localhost DB_PORT=5432 \
	 SERVER_PORT=$${REPORTES_HTTP_PORT:-8080} \
	 VEHICULO_ESTADO_HTTP_PORT=$${VEHICULO_ESTADO_HTTP_PORT:-8082} \
	 mvn spring-boot:run

# Infra en Docker (db + receptor + simulador) + ingesta local, para desarrollo iterativo
# Simulador local en segundo plano (logs en SIMULADOR_LOG) + ingesta en primer plano. Al salir
# ingesta (Ctrl+C o error) se detiene tambien el simulador.
dev: timescaledb receptor simulador-local-prep
	@echo "🔥 AgroLink Ingesta: TimescaleDB + receptor en Docker; simulador e ingesta en esta maquina..."
	@echo "🚚 Simulador en segundo plano. Logs: tail -f $(SIMULADOR_LOG)"
	@echo "ℹ️  Ctrl+C detiene ingesta y el simulador. Los contenedores Docker siguen corriendo"
	@echo "   ('make docker-down' para bajarlos)."
	@( $(SIMULADOR_LOCAL) ) > "$(SIMULADOR_LOG)" 2>&1 & SIM_PID=$$!; \
	 trap 'kill $$SIM_PID 2>/dev/null' EXIT INT TERM; \
	 $(MAKE) --no-print-directory ingesta

start: dev
