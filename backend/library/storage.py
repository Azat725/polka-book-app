import hashlib
import math
import os
import shutil
import uuid
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .errors import ApiError
from .models import (
    Book,
    BookFile,
    ProcessingJob,
    StorageReservation,
    SystemSettings,
    UploadChunk,
    UploadSession,
)


def private_path(key):
    root = Path(settings.PRIVATE_ROOT).resolve()
    path = (root / key).resolve()
    if not path.is_relative_to(root):
        raise ApiError("invalid_path", "Invalid storage key.")
    return path


def chunk_path(upload, index):
    return private_path(f"uploads/{upload.id}/{index}.part")


def upload_limit():
    system = SystemSettings.objects.first()
    if system and not system.uploads_enabled:
        raise ApiError("uploads_disabled", "Uploads are temporarily unavailable.", 503)
    return min(settings.MAX_PDF_BYTES, system.max_pdf_bytes if system else settings.MAX_PDF_BYTES)


@transaction.atomic
def create_upload(user, data, idempotency_key=""):
    name, size = data.get("filename"), data.get("size")
    if (
        not isinstance(name, str)
        or not name.lower().endswith(".pdf")
        or len(name) > 255
        or any(char in name for char in ("/", "\\", "\x00"))
        or not name[:-4].strip()
    ):
        raise ValidationError({"filename": "A PDF filename without a path is required."})
    if type(size) is not int or size <= 0:
        raise ValidationError({"size": "Positive integer required."})
    if size > upload_limit():
        raise ApiError("file_too_large", "PDF exceeds the 100 MB limit.", 413)
    if len(idempotency_key) > 100:
        raise ValidationError({"idempotency_key": "Too long."})
    if idempotency_key:
        old = UploadSession.objects.filter(
            owner=user, idempotency_key=idempotency_key, state="uploading", expires_at__gt=timezone.now()
        ).first()
        if old:
            if old.size != size or old.filename != name:
                raise ApiError("idempotency_conflict", "Upload key was already used.", 409)
            return old
    Path(settings.PRIVATE_ROOT).mkdir(parents=True, exist_ok=True)
    StorageReservation.objects.get_or_create(key=1)
    capacity = StorageReservation.objects.select_for_update().get(key=1)
    if idempotency_key:
        # Repeat after the capacity lock to serialize simultaneous retries.
        old = UploadSession.objects.filter(owner=user, idempotency_key=idempotency_key).first()
        if old:
            if old.size != size or old.filename != name:
                raise ApiError("idempotency_conflict", "Upload key was already used.", 409)
            return old
    reservation = size * 3 + 10 * 1024 * 1024
    if (
        shutil.disk_usage(settings.PRIVATE_ROOT).free - capacity.reserved_bytes - reservation
        < settings.STORAGE_RESERVE_BYTES
    ):
        raise ApiError("storage_unavailable", "Not enough available storage.", 507)
    capacity.reserved_bytes += reservation
    capacity.save(update_fields=["reserved_bytes"])
    return UploadSession.objects.create(
        owner=user,
        filename=name,
        size=size,
        reserved_bytes=reservation,
        expires_at=timezone.now() + timedelta(hours=24),
        idempotency_key=idempotency_key,
    )


def assert_open(upload):
    if upload.state != "uploading" or upload.expires_at <= timezone.now():
        raise ApiError("upload_expired", "Upload is closed or expired.", 410)


@transaction.atomic
def store_chunk(upload_id, user, index, body):
    from django.shortcuts import get_object_or_404

    upload = get_object_or_404(UploadSession.objects.select_for_update(), pk=upload_id, owner=user)
    assert_open(upload)
    count = math.ceil(upload.size / settings.UPLOAD_CHUNK_SIZE)
    if not 0 <= index < count:
        raise ValidationError({"chunk": "Invalid chunk index."})
    expected = min(settings.UPLOAD_CHUNK_SIZE, upload.size - index * settings.UPLOAD_CHUNK_SIZE)
    if len(body) != expected:
        raise ValidationError({"chunk": "Chunk size does not match the declared upload."})
    digest = hashlib.sha256(body).hexdigest()
    previous = upload.chunks.filter(index=index).first()
    if previous:
        if previous.sha256 != digest:
            raise ApiError("chunk_conflict", "Chunk already exists with different contents.", 409)
        return
    path = chunk_path(upload, index)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix("." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_bytes(body)
        os.replace(temporary, path)
        UploadChunk.objects.create(upload=upload, index=index, size=len(body), sha256=digest)
    finally:
        temporary.unlink(missing_ok=True)


def release_reservation(upload):
    capacity = StorageReservation.objects.select_for_update().get(key=1)
    capacity.reserved_bytes = max(0, capacity.reserved_bytes - upload.reserved_bytes)
    capacity.save(update_fields=["reserved_bytes"])
    upload.reserved_bytes = 0


@transaction.atomic
def complete_upload(upload_id, user):
    from django.shortcuts import get_object_or_404

    upload = get_object_or_404(UploadSession.objects.select_for_update(), pk=upload_id, owner=user)
    if upload.state == "complete" and upload.book_id:
        return upload.book
    assert_open(upload)
    count = math.ceil(upload.size / settings.UPLOAD_CHUNK_SIZE)
    if list(upload.chunks.order_by("index").values_list("index", flat=True)) != list(range(count)):
        raise ApiError("upload_incomplete", "Some upload chunks are missing.", 409)
    key = f"books/{uuid.uuid4().hex}.pdf"
    target = private_path(key)
    target.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    try:
        with target.open("xb") as output:
            for chunk in upload.chunks.order_by("index"):
                data = chunk_path(upload, chunk.index).read_bytes()
                if hashlib.sha256(data).hexdigest() != chunk.sha256:
                    raise ApiError("chunk_corrupt", "Upload chunk failed integrity verification.", 409)
                digest.update(data)
                size += len(data)
                output.write(data)
        with target.open("rb") as source:
            if not source.read(8).startswith(b"%PDF-"):
                raise ApiError("invalid_pdf", "File is not a PDF.")
        if size != upload.size or size > upload_limit():
            raise ApiError("invalid_size", "Upload size does not match.", 413)
        book = Book.objects.create(owner=user, title=upload.filename[:-4][:300])
        file = BookFile.objects.create(book=book, storage_key=key, sha256=digest.hexdigest(), size_bytes=size)
        ProcessingJob.objects.create(book_file=file)
        upload.state, upload.book = "complete", book
        upload.save(update_fields=["state", "book", "reserved_bytes", "updated_at"])
        transaction.on_commit(lambda: shutil.rmtree(chunk_path(upload, 0).parent, ignore_errors=True))
        from .models import SyncChange

        SyncChange.objects.create(owner=user, entity="book", object_id=book.id)
        return book
    except Exception:
        target.unlink(missing_ok=True)
        raise


@transaction.atomic
def cancel_upload(upload):
    upload = UploadSession.objects.select_for_update().get(pk=upload.pk)
    if upload.state == "complete":
        raise ApiError("upload_complete", "Completed uploads belong to the library.", 409)
    if upload.reserved_bytes:
        release_reservation(upload)
    upload.state = "cancelled"
    upload.save(update_fields=["state", "reserved_bytes", "updated_at"])
    transaction.on_commit(lambda: shutil.rmtree(chunk_path(upload, 0).parent, ignore_errors=True))


def clean_expired_uploads():
    for upload in UploadSession.objects.filter(state="uploading", expires_at__lt=timezone.now()):
        cancel_upload(upload)
