import io
from datetime import timedelta

import pytest
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.test import RequestFactory
from django.utils import timezone
from pypdf import PdfReader, PdfWriter

from library.models import AuditEvent, Book, ProcessingJob, StorageReservation, SystemSettings, User

from .conftest import init_data, pdf_bytes

pytestmark = pytest.mark.django_db


def test_signed_invalid_profile_and_refresh_type_are_rejected():
    from rest_framework.test import APIClient

    api = APIClient()
    for profile in [
        {"id": True, "first_name": "Name"},
        {"id": 1, "first_name": None},
        {"id": -1, "first_name": "Name"},
    ]:
        assert (
            api.post(
                "/api/v1/auth/telegram", {"init_data": init_data(profile=profile)}, format="json"
            ).status_code
            == 401
        )
    assert api.post("/api/v1/auth/refresh", {"refresh_token": []}, format="json").status_code == 401


def test_maintenance_blocks_api_without_blocking_health(client):
    SystemSettings.objects.create(maintenance_mode=True)
    assert client.get("/api/v1/books").status_code == 503
    assert client.get("/health").status_code == 200


def test_encrypted_pdf_remains_encrypted_and_locked(client):
    writer = PdfWriter()
    writer.append(PdfReader(io.BytesIO(pdf_bytes())))
    writer.encrypt("ephemeral-fixture-password")
    buffer = io.BytesIO()
    writer.write(buffer)
    payload = buffer.getvalue()
    upload = client.post(
        "/api/v1/uploads", {"filename": "locked.pdf", "size": len(payload)}, format="json"
    ).data
    client.put(f"/api/v1/uploads/{upload['id']}/chunks/0", payload, content_type="application/octet-stream")
    response = client.post(f"/api/v1/uploads/{upload['id']}/complete")
    assert response.status_code == 202
    assert StorageReservation.objects.get(key=1).reserved_bytes > 0
    from library.processing import process_pending

    process_pending(once=True)
    book = client.get(f"/api/v1/books/{response.data['id']}").data
    assert book["processing_status"] == "locked"
    assert book["cover_url"] is None
    downloaded = b"".join(client.get(f"/api/v1/books/{book['id']}/file").streaming_content)
    assert downloaded == payload
    assert PdfReader(io.BytesIO(downloaded)).is_encrypted
    assert StorageReservation.objects.get(key=1).reserved_bytes == 0


def test_admin_hard_limits_and_metadata_only(client, book):
    row = SystemSettings(max_pdf_bytes=100000001)
    row.save()
    assert row.max_pdf_bytes == 100000000
    with pytest.raises(ValidationError):
        SystemSettings(max_pdf_bytes=0).save()
    operator = User.objects.create_user(username="operator", is_staff=True)
    request = RequestFactory().get("/admin/")
    request.user = operator
    user_admin = admin.site._registry[User]
    readonly = user_admin.get_readonly_fields(request)
    assert {"is_staff", "is_superuser", "groups", "user_permissions"}.issubset(readonly)
    assert not user_admin.has_delete_permission(request)
    book_admin = admin.site._registry[Book]
    assert "storage_key" not in book_admin.fields
    assert "cover" not in book_admin.fields
    assert not book_admin.has_delete_permission(request)
    assert not book_admin.has_add_permission(request)
    record = Book.objects.get(pk=book["id"])
    initial_revision = record.revision
    record.title = "Changed by an administrator"
    book_admin.save_model(request, record, None, True)
    record.refresh_from_db()
    assert record.revision == initial_revision + 1


def test_failed_processing_can_retry_without_replacing_file(client, book):
    from library.models import BookFile

    file = BookFile.objects.get(book_id=book["id"])
    original_hash = file.sha256
    file.processing_status, file.error_code = "error", "processing_timeout"
    file.save()
    response = client.post(f"/api/v1/books/{book['id']}/processing-retries")
    assert response.status_code == 202
    from library.processing import process_pending

    process_pending(once=True)
    file.refresh_from_db()
    assert file.processing_status == "ready"
    assert file.sha256 == original_hash


def test_system_disable_upload_and_processing_timeout(client, book, monkeypatch):
    import subprocess

    from library.models import BookFile
    from library.processing import process_pending

    SystemSettings.objects.create(uploads_enabled=False)
    assert (
        client.post("/api/v1/uploads", {"filename": "x.pdf", "size": 100}, format="json").status_code == 503
    )
    file = BookFile.objects.get(book_id=book["id"])
    ProcessingJob.objects.create(book_file=file)

    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("test-parser", 1)

    monkeypatch.setattr("library.processing.execute_parser", timeout)
    process_pending(once=True)
    file.refresh_from_db()
    assert file.error_code == "processing_timeout"


def test_admin_block_revokes_sessions(client):
    user = User.objects.get(telegram_id=123)
    actor = User.objects.create_superuser(username="test-admin", password=None)
    request = RequestFactory().post("/admin/")
    request.user = actor
    user.is_active = False
    admin.site._registry[User].save_model(request, user, None, True)
    assert user.authsession_set.filter(revoked_at__isnull=True).count() == 0
    assert AuditEvent.objects.filter(action="admin.user.updated").exists()


def test_overlapping_devices_do_not_double_reading_time(client, book, monkeypatch):
    from library.models import ReadingSession

    first = client.post("/api/v1/reading-sessions", {"book_id": book["id"]}, format="json").data["id"]
    second = client.post("/api/v1/reading-sessions", {"book_id": book["id"]}, format="json").data["id"]
    now = timezone.now() + timedelta(seconds=15)
    monkeypatch.setattr("library.reading_views.timezone.now", lambda: now)
    assert (
        client.post(
            f"/api/v1/reading-sessions/{first}/heartbeats", {"active": True}, format="json"
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/v1/reading-sessions/{second}/heartbeats", {"active": True}, format="json"
        ).status_code
        == 200
    )
    total = sum(ReadingSession.objects.values_list("active_seconds", flat=True))
    assert 14 <= total <= 15
