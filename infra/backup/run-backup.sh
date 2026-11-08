#!/bin/sh
# Run from the repository root. Pause mutations so database and files agree.
set -eu
restart() { docker compose start api worker beat; }
trap restart EXIT HUP INT TERM
docker compose stop api worker beat
docker compose --profile tools run --rm backup
