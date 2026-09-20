# Migraciones de esquema (DDL) — aplicadas automáticamente en cada deploy

A diferencia de `deploy/db/` (que solo corre **una vez**, vía `docker-entrypoint-initdb.d`,
la primera vez que arranca un volumen vacío de `timescaledb` — ver `deploy/README.md`
§2.5), los archivos de este directorio se aplican en **cada** deploy del pipeline de CI/CD
(`.github/workflows/ci-cd.yml`), trackeados en la tabla `public.schema_migrations` para que
cada uno se ejecute como máximo una vez. Ver
`specs/007-cicd-deploy-ghcr/contracts/migration-script.md` para el contrato completo del
script que los aplica (`deploy/scripts/apply-migrations.sh`).

Este directorio arranca vacío a propósito (ver
`specs/007-cicd-deploy-ghcr/research.md` D-05): el esquema ya entregado vía `deploy/db/`
no se retroactivea acá. Solo los cambios de esquema posteriores a la feature
`007-cicd-deploy-ghcr` se agregan como archivos nuevos en este directorio.

## Cómo agregar una migración nueva

1. Crear un archivo `NNN_descripcion-corta.sql`, donde `NNN` es el siguiente número de
   secuencia de 3 dígitos con ceros a la izquierda (`001`, `002`, ...), mayor que cualquier
   archivo ya existente en este directorio.
2. Nunca renombrar ni editar un archivo ya *shippeado* (ya mergeado a `master`) — un cambio
   de idea se agrega como un archivo nuevo, nunca sobreescribiendo uno anterior. El nombre
   del archivo es su identidad en `schema_migrations`; renombrarlo hace que se reaplique.
3. Escribir el archivo para que corra de punta a punta dentro de una sola transacción (el
   runner usa `psql -1`) — evitar sentencias que Postgres no permite dentro de una
   transacción, como `CREATE INDEX CONCURRENTLY`.
4. **Nunca** incluir un `UPDATE`/`DELETE` sobre filas ya persistidas de
   `telemetria.lectura_telemetria` (o cualquier otra tabla de telemetría ya ingestada) —
   viola el Principio IV de la constitución (inmutabilidad de los datos crudos). Una
   migración solo puede tocar estructura (columnas, índices, constraints, roles), nunca
   los valores de una lectura ya guardada.
5. Ver `specs/007-cicd-deploy-ghcr/data-model.md` para el detalle completo de las reglas de
   validación de un archivo de migración.
