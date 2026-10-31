#!/bin/sh
# Runs once on first database boot (docker-entrypoint-initdb.d). Creates the
# restricted runtime role; db-migrate.mjs grants it table/function access.
set -e
psql -v ON_ERROR_STOP=1 -v pw="$GRM_APP_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE grm_app LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
SQL
