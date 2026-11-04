import os
import secrets
import subprocess


def check_auth(run=subprocess.run):
    """Check the final server without changing initialized roles or HBA rules."""
    command = ["psql", "-X", "-w", "-h", "127.0.0.1", "-p", "5434",
               "-U", os.environ["POSTGRES_USER"], "-d", os.environ["POSTGRES_DB"],
               "-Atc", "SELECT 1"]
    env = {**os.environ, "LC_ALL": "C", "PGCONNECT_TIMEOUT": "5"}
    try:
        correct = run(command, env={**env, "PGPASSWORD": os.environ["POSTGRES_PASSWORD"]},
                      capture_output=True, text=True, timeout=10)
        wrong = run(command, env={**env, "PGPASSWORD": secrets.token_hex(32)},
                    capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("Dashboard Postgres: TCP authentication check could not complete; inspect server logs.") from None
    if correct.returncode != 0 or correct.stdout.strip() != "1":
        raise RuntimeError("Dashboard Postgres: configured TCP credentials failed; review existing roles/passwords and pg_hba.conf. No credentials or rules were changed.")
    if wrong.returncode == 0 or "password authentication failed for user" not in wrong.stderr:
        raise RuntimeError("Dashboard Postgres: TCP must reject an incorrect password with a password-authentication failure; operator review of existing pg_hba.conf is required. No credentials or rules were changed.")
