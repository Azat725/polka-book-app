import io
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from .conftest import init_data

pytestmark = pytest.mark.django_db


def test_both_api_slashes_without_redirects_and_json_object(client):
    assert client.get("/api/v1/me/").status_code == 200
    assert client.get("/api/v1/books/").status_code == 200
    assert client.patch("/api/v1/settings/", {"onboarding_done": True}, format="json").status_code == 200
    assert client.patch("/api/v1/settings/", [], format="json").status_code == 400


def test_auth_type_duplicates_blocking_and_invalid_headers(client, settings):
    from library.models import User

    api = APIClient()
    for raw in [None, {}, init_data() + "&auth_date=123"]:
        assert api.post("/api/v1/auth/telegram", {"init_data": raw}, format="json").status_code == 401
    api.credentials(HTTP_AUTHORIZATION="Basic abc")
    assert api.get("/api/v1/me").status_code == 401
    api.credentials(HTTP_AUTHORIZATION="Bearer wrong")
    assert api.get("/api/v1/me").status_code == 401
    User.objects.filter(telegram_id=123).update(is_active=False)
    assert client.get("/api/v1/me").status_code == 401
    assert api.post("/api/v1/auth/telegram", {"init_data": init_data()}, format="json").status_code == 401
    settings.TELEGRAM_BOT_TOKEN = ""
    assert api.post("/api/v1/auth/telegram", {"init_data": "whatever"}, format="json").status_code == 503


def test_filters_pagination_and_metadata(client, book):
    root = f"/api/v1/books/{book['id']}"
    assert (
        client.patch(
            root, {"title": "Книга", "author": "Автор", "favorite": True, "status": "reading"}, format="json"
        ).status_code
        == 200
    )
    for query in [
        "search=Книга",
        "status=reading",
        "favorite=true",
        "sort=title",
        "sort=-progress",
        "limit=1",
    ]:
        assert len(client.get("/api/v1/books?" + query).data["results"]) == 1
    for query in ["status=invalid", "sort=invalid", "cursor=invalid", "limit=invalid", "folder_id=invalid"]:
        assert client.get("/api/v1/books?" + query).status_code == 400
    assert client.patch(root, {"revision": 0, "title": "Stale"}, format="json").status_code == 409
    assert client.post(root + "/processing-retries").status_code == 409


def test_folder_tree_and_collection_membership(client, book):
    first = client.post("/api/v1/folders", {"name": "One"}, format="json").data
    second = client.post("/api/v1/folders", {"name": "Two", "parent_id": first["id"]}, format="json").data
    assert (
        client.patch(f"/api/v1/folders/{first['id']}", {"parent_id": second["id"]}, format="json").status_code
        == 400
    )
    assert (
        client.patch(f"/api/v1/folders/{second['id']}", {"name": "Three"}, format="json").status_code == 200
    )
    assert (
        client.patch(f"/api/v1/books/{book['id']}", {"folder_id": second["id"]}, format="json").status_code
        == 200
    )
    assert client.get("/api/v1/folders").status_code == 200
    collection = client.post("/api/v1/collections", {"name": "Library"}, format="json").data
    root = f"/api/v1/collections/{collection['id']}"
    assert client.patch(root, {"description": "Books"}, format="json").status_code == 200
    assert client.put(root + f"/books/{book['id']}").status_code == 204
    assert client.get("/api/v1/collections").data["results"][0]["book_count"] == 1
    assert client.get(f"/api/v1/books?collection_id={collection['id']}").status_code == 200
    assert client.delete(root + f"/books/{book['id']}").status_code == 204
    assert client.delete(f"/api/v1/folders/{first['id']}").status_code == 204


def test_annotation_edit_delete_conflict_and_coordinates(client, book, other):
    root = f"/api/v1/books/{book['id']}"
    response = client.post(
        root + "/highlights",
        {"page": 1, "text": "Hello", "quads": [[20, 300, 100, 300, 20, 280, 100, 280]]},
        format="json",
    )
    assert response.status_code == 201
    identifier = response.data["id"]
    url = f"/api/v1/highlights/{identifier}"
    assert client.patch(url, {"text": "New", "revision": 0}, format="json").status_code == 200
    assert client.patch(url, {"text": "Old", "revision": 0}, format="json").status_code == 409
    rows = client.get(f"/api/v1/annotations/?kind=highlight&book_id={book['id']}&search=New").data["results"]
    assert rows[0]["book_title"] == book["title"]
    assert other.get("/api/v1/annotations").data["results"] == []
    for payload in [
        {"page": 0},
        {"page": 1, "position": 2},
        {"page": 1, "color": "evil"},
        {"page": 1, "quads": "evil"},
        {"page": 1, "quads": [[0, 1]]},
    ]:
        assert client.post(root + "/highlights", payload, format="json").status_code == 400
    assert client.get("/api/v1/annotations?book_id=invalid").status_code == 400
    assert client.get("/api/v1/exports/annotations?book_id=invalid").status_code == 400
    assert client.get("/api/v1/exports/annotations?format=xml").status_code == 400
    assert client.get(root + "/highlights?search=New").status_code == 200
    assert client.delete(url).status_code == 204
    assert client.get(root + "/highlights").data["results"] == []


def test_upload_missing_chunks_cancel_expiration_and_capacity(client, other, settings, monkeypatch):
    from library.models import UploadSession
    from library.storage import clean_expired_uploads

    upload = client.post("/api/v1/uploads", {"filename": "x.pdf", "size": 20}, format="json").data
    root = f"/api/v1/uploads/{upload['id']}"
    assert client.post(root + "/complete").status_code == 409
    assert other.get(root).status_code == 404
    assert client.put(root + "/chunks/1", b"123", content_type="application/octet-stream").status_code == 400
    assert client.put(root + "/chunks/0", b"123", content_type="application/octet-stream").status_code == 400
    assert client.delete(root).status_code == 204
    assert (
        client.put(root + "/chunks/0", b"0" * 20, content_type="application/octet-stream").status_code == 410
    )
    second = client.post("/api/v1/uploads", {"filename": "x.pdf", "size": 20}, format="json").data
    UploadSession.objects.filter(pk=second["id"]).update(expires_at=timezone.now() - timedelta(seconds=1))
    assert client.get(f"/api/v1/uploads/{second['id']}").status_code == 410
    clean_expired_uploads()
    assert UploadSession.objects.get(pk=second["id"]).state == "cancelled"
    settings.STORAGE_RESERVE_BYTES = 2**62
    assert client.post("/api/v1/uploads", {"filename": "x.pdf", "size": 20}, format="json").status_code == 507


def test_upload_idempotency_key_and_nonpdf_rejected(client):
    payload = {"filename": "x.pdf", "size": 10}
    first = client.post("/api/v1/uploads", payload, format="json", HTTP_IDEMPOTENCY_KEY="same").data
    assert (
        client.post("/api/v1/uploads", payload, format="json", HTTP_IDEMPOTENCY_KEY="same").data["id"]
        == first["id"]
    )
    assert (
        client.post(
            "/api/v1/uploads", {**payload, "size": 20}, format="json", HTTP_IDEMPOTENCY_KEY="same"
        ).status_code
        == 409
    )
    client.put(
        f"/api/v1/uploads/{first['id']}/chunks/0", b"Not a PDF!", content_type="application/octet-stream"
    )
    assert client.post(f"/api/v1/uploads/{first['id']}/complete").status_code == 400


def test_settings_conflicts_and_invalid_types(client):
    current = client.get("/api/v1/settings").data
    assert (
        client.patch(
            "/api/v1/settings",
            {"revision": current["revision"], "custom_colors": {"bg": "#112233"}},
            format="json",
        ).status_code
        == 200
    )
    assert (
        client.patch(
            "/api/v1/settings", {"revision": current["revision"], "language": "en"}, format="json"
        ).status_code
        == 409
    )
    for payload in [{"bad": 1}, {"theme": "invalid"}, {"volume": True}, {"onboarding_done": "yes"}]:
        assert client.patch("/api/v1/settings", payload, format="json").status_code == 400
    preset = client.post(
        "/api/v1/theme-presets", {"name": "Custom", "settings": {"theme": "cream"}}, format="json"
    ).data
    assert (
        client.patch(f"/api/v1/theme-presets/{preset['id']}", {"name": "Evening"}, format="json").status_code
        == 200
    )
    assert client.delete(f"/api/v1/theme-presets/{preset['id']}").status_code == 204
    assert client.get("/api/v1/sync/changes?cursor=invalid").status_code == 400


def test_reading_session_server_intervals_and_background(client, other, book, monkeypatch):
    from library.models import ReadingSession

    assert client.post("/api/v1/reading-sessions", {"book_id": "invalid"}, format="json").status_code == 400
    session = client.post("/api/v1/reading-sessions", {"book_id": book["id"]}, format="json").data
    row = ReadingSession.objects.get(pk=session["id"])
    tick = row.last_heartbeat + timedelta(seconds=15)
    monkeypatch.setattr("library.reading_views.timezone.now", lambda: tick)
    root = f"/api/v1/reading-sessions/{session['id']}/heartbeats"
    assert client.post(root, {"active": True}, format="json").data["active_seconds"] == 15
    tick += timedelta(seconds=15)
    assert client.post(root, {"active": False}, format="json").data["active_seconds"] == 15
    assert other.post(root, {"active": True}, format="json").status_code == 404
    assert client.post(root, {"active": "yes"}, format="json").status_code == 400
    assert client.post(root, {"active": False, "closed": True}, format="json").status_code == 200
    assert client.post(root, {"active": True}, format="json").status_code == 409


def test_cover_upload_safe_reencoding_and_range_variants(client, book, settings):
    buffer = io.BytesIO()
    Image.new("RGB", (60, 90), "#7c202d").save(buffer, "PNG")
    response = client.post(
        f"/api/v1/books/{book['id']}/covers/",
        {"file": SimpleUploadedFile("cover.png", buffer.getvalue(), content_type="image/png")},
    )
    assert response.status_code == 200
    assert (
        client.post(
            f"/api/v1/books/{book['id']}/covers/",
            {"file": SimpleUploadedFile("bad.png", b"not image", content_type="image/png")},
        ).status_code
        == 400
    )
    root = f"/api/v1/books/{book['id']}/file"
    assert client.get(root, HTTP_RANGE="bytes=-7").status_code == 206
    assert client.get(root, HTTP_RANGE="bytes=-0").status_code == 416
    assert client.get(root, HTTP_RANGE="bytes=0-1,4-5").status_code == 416
    assert client.get(root, HTTP_RANGE="garbage").status_code == 416
    assert client.get(root, HTTP_RANGE="bytes=0-7", HTTP_IF_RANGE="outdated").status_code == 200
    settings.FILE_X_ACCEL = True
    response = client.get(root)
    assert response.status_code == 200
    assert response["X-Accel-Redirect"].startswith("/_private/books/")


def test_health_and_purge_all(client, book):
    assert client.get("/health").status_code == 200
    assert client.delete(f"/api/v1/books/{book['id']}").status_code == 204
    assert client.post("/api/v1/trash/purge").status_code == 204
    assert client.get("/api/v1/trash").data["results"] == []
