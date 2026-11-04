import os
import subprocess
import sys
import time
from pathlib import Path

from port_check import check_port

# Probe only; the real server bind remains authoritative.
check_port(5434)
try:
    os.unlink("/tmp/dashboard-ready")
except FileNotFoundError:
    pass
child = subprocess.Popen(["docker-entrypoint.sh", *sys.argv[1:]])
import signal
for sig in (signal.SIGTERM, signal.SIGINT):
    signal.signal(sig, lambda signum, frame: child.send_signal(signum))
# The image's temporary initialization server uses port 5432, so cannot satisfy
# this Unix-socket readiness check. A foreign TCP listener cannot satisfy it either.
while child.poll() is None:
    pidfile = Path(os.environ.get("PGDATA", "/var/lib/postgresql/data")) / "postmaster.pid"
    try:
        own_server = int(pidfile.read_text().splitlines()[0]) == child.pid
    except (OSError, ValueError, IndexError):
        own_server = False
    if own_server and subprocess.run(["pg_isready", "-h", "/var/run/postgresql", "-p", "5434"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        open("/tmp/dashboard-ready", "w").close()
        break
    time.sleep(0.1)
code = child.wait()
try:
    os.unlink("/tmp/dashboard-ready")
except FileNotFoundError:
    pass
if code:
    print("Dashboard Postgres failed to start: check logs and free 127.0.0.1:5434 if another listener won the startup race.", file=sys.stderr)
sys.exit(code)
