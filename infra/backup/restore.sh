#!/bin/sh
# Restore into a NEW empty database and private volume only.
set -eu
: "${RESTIC_REPOSITORY:?Configure the backup repository}"
: "${RESTIC_PASSWORD:?Set the backup encryption password}"
: "${PGPASSWORD:?Set the database password}"
snapshot=${1:?Pass a snapshot ID shown by restic snapshots}
case "$snapshot" in *[!a-fA-F0-9]*|'') echo 'Use a hexadecimal snapshot ID.' >&2; exit 2;; esac
umask 077
tables=$(psql --host=db --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --command="SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
if [ "$tables" != 0 ] || [ -n "$(find /private -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    echo 'Refusing to overwrite a populated database or private volume. Use a new Compose project.' >&2
    exit 2
fi
mkdir -p /snapshot
trap 'rm -f /snapshot/database.dump' EXIT HUP INT TERM
restic restore "$snapshot" --target / --include /private --include /snapshot/database.dump
test -s /snapshot/database.dump
pg_restore --host=db --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --no-owner --no-acl --single-transaction --exit-on-error /snapshot/database.dump
echo 'Restored. Start migrations and services, then verify books and annotations before switching traffic.'
