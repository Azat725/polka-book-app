import importlib.util
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


def runner_module(monkeypatch):
    if sys.platform == "win32":
        monkeypatch.setitem(sys.modules, "resource", SimpleNamespace())
    path = Path(__file__).resolve().parents[2] / "infra/pdf-sandbox/runner.py"
    spec = importlib.util.spec_from_file_location("sandbox_startup_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_sandbox_readiness_is_removed_if_namespace_check_fails(tmp_path, monkeypatch):
    runner = runner_module(monkeypatch)
    runner.ROOT = tmp_path
    marker = tmp_path / ".sandbox-ready"
    marker.write_text("stale")
    monkeypatch.setattr(
        runner.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args[0], 1, stdout="--disable-userns", stderr="namespace denied"
        ),
    )
    with pytest.raises(RuntimeError, match="namespace"):
        runner.check_startup()
    assert not marker.exists()


def test_sandbox_ready_only_after_successful_namespace_check(tmp_path, monkeypatch):
    runner = runner_module(monkeypatch)
    runner.ROOT = tmp_path
    calls = []

    def success(command, **kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 0, stdout="--disable-userns", stderr="")

    monkeypatch.setattr(runner.subprocess, "run", success)
    runner.check_startup()
    assert (tmp_path / ".sandbox-ready").is_file()
    namespace_command = next(command for command in calls if "--unshare-all" in command)
    assert "--disable-userns" in namespace_command
    assert "--unshare-user" in namespace_command
