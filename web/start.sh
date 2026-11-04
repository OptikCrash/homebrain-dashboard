#!/bin/sh
# Container entrypoint: run nginx and mark readiness only once this nginx owns
# 127.0.0.1:8080. nginx writes its pid file after binding its listeners, so the
# readiness request below never reaches another process holding the port.
rm -f /tmp/dashboard-ready /tmp/nginx.pid
nginx -g 'daemon off;' &
child=$!
trap 'kill -TERM "$child" 2>/dev/null' TERM INT
while kill -0 "$child" 2>/dev/null; do
  if [ -s /tmp/nginx.pid ] && wget -qO- http://127.0.0.1:8080/healthz 2>/dev/null | grep -q 'dashboard-web ok'; then
    touch /tmp/dashboard-ready
    break
  fi
  sleep 0.2
done
# The first wait returns early if a signal arrives; the second collects the exit code.
wait "$child"
code=$?
kill -0 "$child" 2>/dev/null && { wait "$child"; code=$?; }
rm -f /tmp/dashboard-ready
# nginx exits 0 on a SIGTERM stop; a bind failure ("Address in use") exits nonzero.
if [ "$code" -ne 0 ]; then
  echo "Dashboard web failed: 127.0.0.1:8080 may be unavailable; free the port or stop the other listener." >&2
fi
exit "$code"
