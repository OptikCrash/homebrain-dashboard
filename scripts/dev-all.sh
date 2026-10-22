#!/bin/sh
# `npm run all`: the API stack (docker compose) and the Angular dev server together.
# Ctrl-C (or SIGTERM) stops both. Plain POSIX sh so the root package.json needs no dependencies.
#
# Background jobs in a non-interactive shell ignore SIGINT, so Ctrl-C reaches only this script;
# the trap sends SIGTERM to docker compose (a clean stop) and to the whole npm process tree:
# npm does not reliably forward SIGTERM to `ng serve`, which would otherwise keep port 4200.
set -u
cd "$(dirname "$0")/.."

docker compose up --build &
api=$!
npm --prefix web start &
web=$!

# SIGTERM a process and all its descendants, deepest first (pgrep -P works on Linux and macOS).
kill_tree() {
  for child in $(pgrep -P "$1"); do
    kill_tree "$child"
  done
  kill -TERM "$1" 2>/dev/null
}

stop() {
  trap - INT TERM
  kill -TERM "$api" 2>/dev/null
  kill_tree "$web"
  wait
  exit 130
}
trap stop INT TERM

wait
