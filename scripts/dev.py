"""Run local services. A real Telegram bot token is needed for interactive login."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent


def environment():
    values = dict(os.environ)
    config = ROOT / ".env"
    if config.exists():
        for line in config.read_text(encoding="utf-8").splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                if key.strip() in {"TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME"}:
                    values[key.strip()] = value.strip()
    values["DJANGO_ENV"] = "development"
    values["PDF_PROCESSING_MODE"] = "local"
    values["FILE_X_ACCEL"] = "0"
    values["VITE_TELEGRAM_BOT_USERNAME"] = values.get("TELEGRAM_BOT_USERNAME", "")
    values.pop("POSTGRES_HOST", None)
    return values


def main():
    python = ROOT / "backend/.venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not python.exists() or not npm or not (ROOT / "frontend/node_modules").exists():
        raise SystemExit("Install dependencies using README.md before starting.")
    env = environment()
    subprocess.run([str(python), "manage.py", "migrate", "--noinput"], cwd=ROOT / "backend", env=env, check=True)
    if not env.get("TELEGRAM_BOT_TOKEN"):
        print("Telegram login is unconfigured. Set TELEGRAM_BOT_TOKEN to your own bot token.")
    print("Local app: http://127.0.0.1:5173 ; admin: http://127.0.0.1:8000/admin/ ; Ctrl+C stops services.")
    commands = [([str(python), "manage.py", "runserver", "127.0.0.1:8000", "--noreload"], ROOT / "backend"), ([str(python), "manage.py", "process_jobs"], ROOT / "backend"), ([npm, "run", "dev"], ROOT / "frontend")]
    processes = []
    try:
        for command, cwd in commands:
            processes.append(subprocess.Popen(command, cwd=cwd, env=env))
        while all(process.poll() is None for process in processes):
            time.sleep(.5)
    except KeyboardInterrupt:
        pass
    finally:
        for process in processes:
            if process.poll() is None:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                else:
                    process.terminate()
        for process in processes:
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    main()
