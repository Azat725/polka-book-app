import json
import os
import stat
from pathlib import Path
from types import SimpleNamespace

import pytest

from library.processing import execute_parser


def test_parser_symlink_output_is_never_copied(settings, tmp_path, monkeypatch):
    settings.PRIVATE_ROOT = tmp_path / "private"
    settings.PDF_JOB_ROOT = tmp_path / "jobs"
    settings.PDF_PROCESSING_MODE = "local"
    source = settings.PRIVATE_ROOT / "input.pdf"
    source.parent.mkdir()
    source.write_bytes(b"%PDF-1.4 malicious fixture")
    secret = tmp_path / "worker-secret"
    secret.write_bytes(b"\xff\xd8\xffprivate-worker-credential\xff\xd9")

    def malicious_parser(command, **kwargs):
        output = Path(command[4])
        (output / "result.json").write_text(json.dumps({"status": "ready", "page_count": 1}))
        cover = output / "cover.jpg"
        try:
            cover.symlink_to(secret)
        except OSError:
            # Windows without symlink privilege: model the OS symlink metadata,
            # while preserving the same dangerous bytes for the pre-fix copy.
            cover.write_bytes(secret.read_bytes())
            actual_lstat = Path.lstat

            def link_metadata(path, *args, **kwargs):
                if path == cover:
                    return os.stat_result(
                        (stat.S_IFLNK | 0o777, 0, 0, 1, 0, 0, len(secret.read_bytes()), 0, 0, 0)
                    )
                return actual_lstat(path, *args, **kwargs)

            monkeypatch.setattr(Path, "lstat", link_metadata)

    monkeypatch.setattr("library.processing.subprocess.run", malicious_parser)
    with pytest.raises(ValueError):
        execute_parser(SimpleNamespace(storage_key="input.pdf"))
    assert not (settings.PRIVATE_ROOT / "covers").exists()


def test_parser_non_regular_and_oversized_outputs_are_rejected(settings, tmp_path, monkeypatch):
    settings.PRIVATE_ROOT = tmp_path / "private"
    settings.PDF_JOB_ROOT = tmp_path / "jobs"
    settings.PDF_PROCESSING_MODE = "local"
    source = settings.PRIVATE_ROOT / "input.pdf"
    source.parent.mkdir()
    source.write_bytes(b"%PDF-1.4 fixture")

    def malicious_parser(command, **kwargs):
        output = Path(command[4])
        (output / "result.json").write_bytes(b" " * 9000)

    monkeypatch.setattr("library.processing.subprocess.run", malicious_parser)
    with pytest.raises(ValueError):
        execute_parser(SimpleNamespace(storage_key="input.pdf"))
