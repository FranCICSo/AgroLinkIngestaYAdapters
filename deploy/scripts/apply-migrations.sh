#!/usr/bin/env bash
# Aplica migraciones de esquema (DDL) pendientes contra timescaledb, en orden, trackeadas
# en public.schema_migrations. Ver specs/007-cicd-deploy-ghcr/contracts/migration-script.md
# para el contrato completo.
#
# Uso: ./apply-migrations.sh <compose-file> <migrations-dir> <postgres-db-env-var-name>
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Uso: $0 <compose-file> <migrations-dir> <postgres-db-env-var-name>" >&2
  exit 1
fi

COMPOSE_FILE="$1"
MIGRATIONS_DIR="$2"
POSTGRES_DB_VAR="$3"
POSTGRES_DB_VALUE="${!POSTGRES_DB_VAR:?La variable de entorno $POSTGRES_DB_VAR no está definida}"

DC() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

echo "🗄️  Verificando tabla de tracking de migraciones (public.schema_migrations)..."
DC exec -T timescaledb psql -v ON_ERROR_STOP=1 -U postgres -d "$POSTGRES_DB_VALUE" -c \
  "CREATE TABLE IF NOT EXISTS public.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ℹ️  $MIGRATIONS_DIR no existe — nada que aplicar."
  exit 0
fi

shopt -s nullglob
migration_files=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob

if [ "${#migration_files[@]}" -eq 0 ]; then
  echo "ℹ️  No hay archivos .sql en $MIGRATIONS_DIR — nada que aplicar."
  exit 0
fi

# Orden lexicográfico estable (NNN_descripcion.sql se ordena naturalmente por número).
IFS=$'\n' sorted_files=($(sort <<<"${migration_files[*]}"))
unset IFS

applied_any=false
for file in "${sorted_files[@]}"; do
  version="$(basename "$file")"

  already_applied="$(DC exec -T timescaledb psql -tA -U postgres -d "$POSTGRES_DB_VALUE" -c \
    "SELECT 1 FROM public.schema_migrations WHERE version = '$version';")"

  if [ -n "$already_applied" ]; then
    echo "⏭️  $version ya aplicada — omitiendo."
    continue
  fi

  echo "▶️  Aplicando $version..."
  if ! { cat "$file"; printf "\nINSERT INTO public.schema_migrations (version) VALUES ('%s');\n" "$version"; } \
      | DC exec -T timescaledb psql -v ON_ERROR_STOP=1 -1 -U postgres -d "$POSTGRES_DB_VALUE"; then
    echo "❌ Error aplicando $version. Deteniendo — ninguna migración posterior se intenta," >&2
    echo "   y el servicio en ejecución NO se toca (FR-015)." >&2
    exit 1
  fi

  echo "✅ $version aplicada."
  applied_any=true
done

if [ "$applied_any" = false ]; then
  echo "ℹ️  Todas las migraciones ya estaban aplicadas — no-op."
fi
