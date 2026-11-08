#!/bin/sh
set -eu
: "${RESTIC_REPOSITORY:?Configure an external RESTIC_REPOSITORY}"
: "${RESTIC_PASSWORD:?Set RESTIC_PASSWORD}"
: "${PGPASSWORD:?Set database password}"
umask 077
mkdir -p /snapshot
cleanup() { rm -f /snapshot/database.dump; }
trap cleanup EXIT HUP INT TERM
pg_dump --host=db --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --file=/snapshot/database.dump
restic backup /snapshot/database.dump /private --tag polka --host polka-vps
restic check
restic forget --tag polka --host polka-vps --keep-within 30d --prune
