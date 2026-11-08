"""Offline spool worker. Every parser is wrapped in a fresh bubblewrap namespace."""

import json
import os
import resource
import subprocess
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(os.getenv("PDF_JOB_ROOT", "/jobs"))
DISABLE_USERNS = False
ENVIRONMENT = {"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"}


def limits():
    resource.setrlimit(resource.RLIMIT_CPU, (35, 40))
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024**2, 768 * 1024**2))
    resource.setrlimit(resource.RLIMIT_FSIZE, (4 * 1024**2, 4 * 1024**2))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))


def namespace_command():
    command = [
        "bwrap",
        "--unshare-all",
        "--unshare-user",
        "--die-with-parent",
        "--new-session",
        "--ro-bind",
        "/usr",
        "/usr",
        "--ro-bind",
        "/lib",
        "/lib",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--tmpfs",
        "/tmp",
    ]
    if DISABLE_USERNS:
        command.append("--disable-userns")
    if Path("/lib64").exists():
        command.extend(["--ro-bind", "/lib64", "/lib64"])
    return command


def check_startup():
    global DISABLE_USERNS
    marker = ROOT / ".sandbox-ready"
    marker.unlink(missing_ok=True)
    try:
        help_result = subprocess.run(
            ["bwrap", "--help"], check=False, capture_output=True, text=True, timeout=10, env=ENVIRONMENT
        )
        DISABLE_USERNS = "--disable-userns" in help_result.stdout
        command = namespace_command() + ["/usr/local/bin/python", "-I", "-c", "import pypdfium2, PIL"]
        result = subprocess.run(
            command, check=False, capture_output=True, text=True, timeout=15, env=ENVIRONMENT, preexec_fn=limits
        )
        if result.returncode:
            raise RuntimeError(
                "Sandbox namespace startup check failed. Configure the container-specific seccomp/AppArmor user namespace policy; unsafe fallback is disabled. "
                + result.stderr[:500]
            )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(
            "Sandbox namespace startup check could not run; unsafe fallback is disabled."
        ) from exc
    marker.write_text("ready", encoding="utf-8")


def write_error(output, code):
    temporary = output / (".trusted-" + uuid.uuid4().hex + ".tmp")
    with temporary.open("x", encoding="utf-8") as destination:
        json.dump({"status": "error", "error_code": code}, destination)
    temporary.replace(output / "result.json")


def process(job):
    claimed = job / "claimed"
    try:
        descriptor = os.open(claimed, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
    except FileExistsError:
        return
    output = job / "output"
    output.mkdir(exist_ok=True)
    command = namespace_command() + [
        "--ro-bind",
        "/app/parse_pdf.py",
        "/parse_pdf.py",
        "--ro-bind",
        str(job / "input.pdf"),
        "/input.pdf",
        "--bind",
        str(output),
        "/output",
    ]
    try:
        request = json.loads((job / "request.json").read_text())
        kind = request.get("kind", "pdf")
    except (ValueError, OSError):
        kind = "pdf"
    command.extend(
        [
            "/usr/local/bin/python",
            "-I",
            "/parse_pdf.py",
            "/input.pdf",
            "/output",
            "cover" if kind == "cover" else "pdf",
        ]
    )
    try:
        result = subprocess.run(command, check=False, timeout=45, capture_output=True, env=ENVIRONMENT, preexec_fn=limits)
        if result.returncode or not (output / "result.json").exists():
            write_error(output, "sandbox_failed")
    except subprocess.TimeoutExpired:
        write_error(output, "processing_timeout")
    finally:
        # Written outside the child's mounted output only after it has exited.
        marker = job / "completed.tmp"
        marker.write_text("done", encoding="utf-8")
        marker.replace(job / "completed")


if __name__ == "__main__":
    ROOT.mkdir(exist_ok=True)
    try:
        check_startup()
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None
    while True:
        for marker in ROOT.glob("*/request.json"):
            if not (marker.parent / "completed").exists():
                process(marker.parent)
        time.sleep(1)
