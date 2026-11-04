#!/bin/sh
# Compose post_start runs synchronously, making detached up fail on startup errors.
i=0
while [ "$i" -lt 120 ]; do
  if [ -f /tmp/dashboard-ready ]; then exit 0; fi
  i=$((i + 1))
  sleep 1
done
echo "Dashboard Postgres failed to become ready on 127.0.0.1:5434: inspect container logs and free port 5434 if occupied." >&2
exit 1
