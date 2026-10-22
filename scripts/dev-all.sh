#!/bin/sh
# `npm run all`: the API stack (docker compose) and the Angular dev server together.
# Ctrl-C (or SIGTERM) stops both. Plain POSIX sh so the root package.json needs no dependencies.
#
# Background jobs in a non-interactive shell ignore SIGINT, so Ctrl-C reaches only this script;
# the trap forwards SIGTERM to both, which docker compose and npm treat as a clean stop.
set -u
cd "$(dirname "$0")/.."

docker compose up --build &
api=$!
npm --prefix web start &
web=$!

stop() {
  trap - INT TERM
  kill -TERM "$api" "$web" 2>/dev/null
  wait
  exit 130
}
trap stop INT TERM

wait
