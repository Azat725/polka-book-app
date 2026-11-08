"""Launch an isolated, real Django server and PDF job processor for Playwright.

No production credentials or user files are used. Each run keeps its own data
under artifacts/e2e so a failed run can be inspected without deleting anything.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import time


def main() -> int:
    project = Path(__file__).resolve().parent.parent
    backend = project / "backend"
    run_id = os.environ.get("E2E_RUN_ID", "")
    token = os.environ.get("E2E_BOT_TOKEN", "")
    if not re.fullmatch(r"[A-Za-z0-9-]{1,80}", run_id) or not token:
        raise RuntimeError("Invoke this helper through the Playwright configuration")
    run_root = (project / "artifacts" / "e2e" / run_id).resolve()
    if project.resolve() not in run_root.parents:
        raise RuntimeError("E2E data must stay inside the project")
    run_root.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    for key in ("POSTGRES_HOST", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_PORT"):
        environment.pop(key, None)
    environment.update({
        "DJANGO_ENV": "development",
        "BOOK_APP_TESTING": "1",
        "DJANGO_SECRET_KEY": secrets.token_urlsafe(48),
        "DJANGO_ALLOWED_HOSTS": "127.0.0.1,localhost",
        "TELEGRAM_BOT_TOKEN": token,
        "SQLITE_PATH": str(run_root / "database.sqlite3"),
        "PRIVATE_ROOT": str(run_root / "private"),
        "PDF_JOB_ROOT": str(run_root / "pdf-jobs"),
        "PDF_PROCESSING_MODE": "local",
        "FILE_X_ACCEL": "0",
        "STORAGE_RESERVE_BYTES": "0",
        "SECURE_SSL_REDIRECT": "0",
        "PYTHONUNBUFFERED": "1",
    })
    subprocess.run([sys.executable, "manage.py", "migrate", "--noinput"], cwd=backend, env=environment, check=True)
    children: list[subprocess.Popen] = []
    stopped = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        children.append(subprocess.Popen([sys.executable, "manage.py", "process_jobs"], cwd=backend, env=environment))
        children.append(subprocess.Popen([sys.executable, "manage.py", "runserver", "127.0.0.1:8000", "--noreload"], cwd=backend, env=environment))
        while not stopped:
            for child in children:
                if child.poll() is not None:
                    return child.returncode or 1
            time.sleep(0.25)
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
