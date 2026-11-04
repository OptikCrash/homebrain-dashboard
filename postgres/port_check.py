import socket
import sys


def check_port(port):
    try:
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(("127.0.0.1", port))
    except OSError:
        sys.exit(f"Dashboard Postgres: 127.0.0.1:{port} is unavailable; free the port or stop the other listener. No database was contacted.")
