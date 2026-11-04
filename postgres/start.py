import os
import subprocess
import sys
import time
from pathlib import Path

from port_check import check_port
from auth_check import check_auth

# Probe only; the real server bind remains authoritative.
try:
    os.unlink("/tmp/dashboard-ready")
except FileNotFoundError:
    pass
check_port(5434)
child = subprocess.Popen(["docker-entrypoint.sh", *sys.argv[1:]])
import signal
for sig in (signal.SIGTERM, signal.SIGINT):
    signal.signal(sig, lambda signum, frame: child.send_signal(signum))
# During initialization the temporary server has a different PID. Require the
# final child process and its private Unix socket before checking TCP auth.
while child.poll() is None:
    pidfile = Path(os.environ.get("PGDATA", "/var/lib/postgresql/data")) / "postmaster.pid"
    try:
        own_server = int(pidfile.read_text().splitlines()[0]) == child.pid
    except (OSError, ValueError, IndexError):
        own_server = False
    if own_server and subprocess.run(["pg_isready", "-h", "/var/run/postgresql", "-p", "5434"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        try:
            check_auth()
        except RuntimeError as error:
            print(str(error), file=sys.stderr)
            child.terminate()
            child.wait()
            sys.exit(1)
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
