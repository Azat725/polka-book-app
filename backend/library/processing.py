import json
import os
import shutil
import stat
import subprocess
import sys
import time
import uuid
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import BookCover, ProcessingJob, SyncChange, UploadSession
from .storage import private_path, release_reservation


def parser_script():
    configured = os.getenv("PDF_PARSER_SCRIPT")
    return Path(configured) if configured else settings.BASE_DIR.parent / "infra/pdf-sandbox/parse_pdf.py"


def read_parser_output(path, maximum):
    """Consume untrusted output only after the parser's process namespace has exited."""
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise ValueError("Parser output must be a regular file")
    flags = (
        os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    )
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as source:
        opened = os.fstat(source.fileno())
        if not stat.S_ISREG(opened.st_mode) or opened.st_size > maximum:
            raise ValueError("Invalid parser output size or type")
        if (metadata.st_dev, metadata.st_ino) != (opened.st_dev, opened.st_ino):
            raise ValueError("Parser output changed before opening")
        data = source.read(maximum + 1)
        if len(data) > maximum:
            raise ValueError("Parser output exceeds the limit")
        return data


def execute_parser(file, kind="pdf"):
    root = Path(settings.PDF_JOB_ROOT)
    root.mkdir(parents=True, exist_ok=True)
    job = root / uuid.uuid4().hex
    job.mkdir()
    source, output = job / "input.pdf", job / "output"
    output.mkdir()
    shutil.copyfile(private_path(file.storage_key), source)
    try:
        if settings.PDF_PROCESSING_MODE == "local":
            environment = {
                key: value
                for key, value in os.environ.items()
                if key in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG"}
            }
            subprocess.run(
                [sys.executable, "-I", str(parser_script()), str(source), str(output), kind],
                timeout=settings.PDF_TIMEOUT_SECONDS,
                check=True,
                capture_output=True,
                env=environment,
            )
        elif settings.PDF_PROCESSING_MODE == "sandbox":
            marker = job / "request.tmp"
            marker.write_text(json.dumps({"kind": kind}), encoding="utf-8")
            marker.replace(job / "request.json")
            deadline = time.monotonic() + settings.PDF_TIMEOUT_SECONDS + 10
            # Only the trusted runner can write this marker outside /output.
            # result.json alone is insufficient: the hostile parser may still run.
            while not (job / "completed").exists():
                if time.monotonic() > deadline:
                    raise subprocess.TimeoutExpired("pdf-sandbox", settings.PDF_TIMEOUT_SECONDS)
                time.sleep(0.25)
        else:
            raise ValueError("Unsupported PDF processing mode")
        result = json.loads(read_parser_output(output / "result.json", 8192))
        if not isinstance(result, dict) or result.get("status") not in {"ready", "locked", "error"}:
            raise ValueError("Invalid parser result")
        pages = result.get("page_count", 0)
        if type(pages) is not int or not 0 <= pages <= 1000000:
            raise ValueError("Invalid page count")
        cover_key = None
        cover = output / "cover.jpg"
        if result["status"] == "ready":
            if not pages:
                raise ValueError("Missing preview")
            preview = read_parser_output(cover, 4 * 1024 * 1024)
            if not preview.startswith(b"\xff\xd8\xff") or not preview.endswith(b"\xff\xd9"):
                raise ValueError("Invalid preview encoding")
            cover_key = f"covers/{uuid.uuid4().hex}.jpg"
            destination = private_path(cover_key)
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open("xb") as target:
                target.write(preview)
        return result, cover_key
    finally:
        shutil.rmtree(job, ignore_errors=True)


def process_pending(once=False):
    processed = 0
    while processed < 10:
        cutoff = timezone.now() - timedelta(seconds=settings.PDF_TIMEOUT_SECONDS * 3 + 60)
        with transaction.atomic():
            job = (
                ProcessingJob.objects.select_for_update()
                .filter(Q(status="pending") | Q(status="processing", claimed_at__lt=cutoff))
                .select_related("book_file__book")
                .order_by("created_at")
                .first()
            )
            if not job:
                return processed
            job.status, job.claimed_at = "processing", timezone.now()
            job.attempts += 1
            job.save(update_fields=["status", "claimed_at", "attempts"])
            file = job.book_file
        try:
            result, cover_key = execute_parser(file)
        except subprocess.TimeoutExpired:
            result, cover_key = {"status": "error", "error_code": "processing_timeout"}, None
        except (OSError, ValueError, subprocess.CalledProcessError):
            result, cover_key = {"status": "error", "error_code": "processing_failed"}, None
        with transaction.atomic():
            # A book may have been permanently deleted while its job was running.
            job = (
                ProcessingJob.objects.select_for_update()
                .filter(pk=job.pk)
                .select_related("book_file__book")
                .first()
            )
            if not job:
                if cover_key:
                    private_path(cover_key).unlink(missing_ok=True)
                continue
            file = job.book_file
            file.processing_status = result["status"]
            file.page_count = result.get("page_count", 0)
            file.encrypted = result["status"] == "locked"
            file.error_code = str(result.get("error_code", ""))[:64]
            file.save()
            if cover_key:
                old = BookCover.objects.filter(book=file.book).first()
                if not old or old.source == "generated":
                    previous = old.storage_key if old else None
                    BookCover.objects.update_or_create(
                        book=file.book, defaults={"storage_key": cover_key, "source": "generated"}
                    )
                    if previous:
                        transaction.on_commit(lambda key=previous: private_path(key).unlink(missing_ok=True))
                else:
                    private_path(cover_key).unlink(missing_ok=True)
            if not file.book.author and isinstance(result.get("author"), str):
                file.book.author = result["author"][:200]
                file.book.save(update_fields=["author", "updated_at"])
            job.status = "done" if result["status"] in {"ready", "locked"} else "error"
            job.save(update_fields=["status"])
            for upload in UploadSession.objects.select_for_update().filter(
                book=file.book, reserved_bytes__gt=0
            ):
                release_reservation(upload)
                upload.save(update_fields=["reserved_bytes"])
            SyncChange.objects.create(owner=file.book.owner, entity="book", object_id=file.book_id)
        processed += 1
    return processed
