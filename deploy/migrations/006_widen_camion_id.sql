-- Ensancha simulador.camion.id (y su FK simulador.viaje.camion_id) de VARCHAR(6) a
-- VARCHAR(20). El rango reservado 900001-900999 (spec 009) sigue siendo valido y es el
-- caso de uso mas comun, pero algunos camiones simulados necesitan calcar literalmente un
-- iotDeviceId no numerico ya sembrado en AgroLinkBackend (ej. "tra-demo-004") para que ese
-- vehiculo sea consultable sin tocar el seeder del otro repo. Un id no puramente numerico
-- no puede confundirse con un IMEI real (siempre 15 digitos) - ver
-- src/domain/rangoDispositivoSimulado.js, que valida esto en vez de un CHECK de ancho fijo.
--
-- Ensanchar un VARCHAR nunca trunca datos existentes; re-ejecutar esta migracion a mano es
-- un no-op si ya corrio (ALTER ... TYPE VARCHAR(20) sobre una columna ya VARCHAR(20) no
-- falla), aunque el runner de CI/CD (apply-migrations.sh) la corre como maximo una vez.
ALTER TABLE simulador.camion ALTER COLUMN id TYPE VARCHAR(20);
ALTER TABLE simulador.viaje ALTER COLUMN camion_id TYPE VARCHAR(20);
