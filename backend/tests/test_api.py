import pytest
from rest_framework.test import APIClient

from .conftest import init_data, pdf_bytes

pytestmark = pytest.mark.django_db


def test_auth_rejects_missing_tampered_old_future():
    api = APIClient()
    for raw in ["", init_data() + "x", init_data(age=301), init_data(age=-90), "user=%7B%7D"]:
        assert api.post("/api/v1/auth/telegram", {"init_data": raw}, format="json").status_code == 401
    assert api.get("/api/v1/books").status_code == 401


def test_refresh_rotation_and_logout(client):
    api = APIClient()
    session = api.post("/api/v1/auth/telegram", {"init_data": init_data(789)}, format="json").data
    refreshed = api.post("/api/v1/auth/refresh", {"refresh_token": session["refresh_token"]}, format="json")
    assert refreshed.status_code == 200
    assert (
        api.post(
            "/api/v1/auth/refresh", {"refresh_token": session["refresh_token"]}, format="json"
        ).status_code
        == 401
    )
    api.credentials(HTTP_AUTHORIZATION="Bearer " + refreshed.data["access_token"])
    assert api.post("/api/v1/auth/logout").status_code == 204
    assert api.get("/api/v1/me").status_code == 401


def test_upload_processing_cover_range_and_isolation(client, other, book):
    assert book["processing_status"] == "ready"
    assert book["page_count"] == 1
    assert book["title"] == "Моя книга"
    url = f"/api/v1/books/{book['id']}/file"
    response = client.get(url, HTTP_RANGE="bytes=0-7")
    assert response.status_code == 206
    assert b"".join(response.streaming_content) == b"%PDF-1.4"
    assert response["Content-Range"].startswith("bytes 0-7/")
    assert client.head(url).status_code == 200
    assert client.get(url, HTTP_RANGE="bytes=999999-").status_code == 416
    assert other.get(url).status_code == 404
    assert other.get(book["cover_url"]).status_code == 404
    assert client.get(book["cover_url"]).status_code == 200
    assert other.get(f"/api/v1/books/{book['id']}").status_code == 404


def test_upload_validation_and_idempotency(client):
    for payload in [
        {"filename": "x.pdf", "size": 100000001},
        {"filename": "x.pdf", "size": -1},
        {"filename": "../../a.pdf", "size": 10},
    ]:
        assert client.post("/api/v1/uploads", payload, format="json").status_code in (400, 413)
    data = pdf_bytes()
    created = client.post("/api/v1/uploads", {"filename": "x.pdf", "size": len(data)}, format="json").data
    url = f"/api/v1/uploads/{created['id']}/chunks/0"
    assert client.put(url, data, content_type="application/octet-stream").status_code == 204
    assert client.put(url, data, content_type="application/octet-stream").status_code == 204
    assert client.put(url, b"z" * len(data), content_type="application/octet-stream").status_code == 409
    assert client.get(f"/api/v1/uploads/{created['id']}").data["uploaded_chunks"] == [0]
    import hashlib

    assert client.get(f"/api/v1/uploads/{created['id']}").data["chunk_checksums"] == {
        "0": hashlib.sha256(data).hexdigest()
    }


def test_corrupt_pdf_processing_reports_error(client):
    from library.processing import process_pending

    data = b"%PDF-1.4\ncorrupt"
    upload = client.post("/api/v1/uploads", {"filename": "x.pdf", "size": len(data)}, format="json").data
    client.put(f"/api/v1/uploads/{upload['id']}/chunks/0", data, content_type="application/octet-stream")
    response = client.post(f"/api/v1/uploads/{upload['id']}/complete", {}, format="json")
    process_pending(once=True)
    assert client.get(f"/api/v1/books/{response.data['id']}").data["processing_status"] == "error"


def test_progress_conflicts_idempotency_and_boundaries(client, book):
    url = f"/api/v1/books/{book['id']}/progress"
    payload = {"page": 1, "position": 0.7, "revision": 0, "client_mutation_id": "reading-1"}
    first = client.put(url, payload, format="json")
    assert first.status_code == 200
    assert first.data["revision"] == 1
    assert client.put(url, payload, format="json").data["revision"] == 1
    assert client.put(url, {**payload, "client_mutation_id": "reading-2"}, format="json").status_code == 409
    assert (
        client.put(
            url, {**payload, "revision": 1, "page": 0, "client_mutation_id": "reading-3"}, format="json"
        ).status_code
        == 400
    )


def test_trash_retains_annotations_and_restores(client, other, book):
    root = f"/api/v1/books/{book['id']}"
    note = client.post(root + "/notes", {"page": 1, "text": "Важная мысль"}, format="json")
    assert note.status_code == 201
    assert other.patch(f"/api/v1/notes/{note.data['id']}", {"text": "hack"}, format="json").status_code == 404
    assert client.delete(root).status_code == 204
    assert client.get(root + "/file").status_code == 404
    assert len(client.get("/api/v1/trash").data["results"]) == 1
    assert client.post(f"/api/v1/trash/{book['id']}/restore").status_code == 200
    assert client.get(root + "/notes").data["results"][0]["text"] == "Важная мысль"
    assert client.delete(root).status_code == 204
    assert client.delete(f"/api/v1/trash/{book['id']}").status_code == 204
    assert client.get("/api/v1/trash").data["results"] == []


def test_collections_and_folder_scope(client, other, book):
    collection = client.post("/api/v1/collections", {"name": "Мысли"}, format="json").data
    root = f"/api/v1/collections/{collection['id']}"
    assert client.put(root + f"/books/{book['id']}").status_code == 204
    assert other.put(root + f"/books/{book['id']}").status_code == 404
    folder = other.post("/api/v1/folders", {"name": "Чужое"}, format="json").data
    assert (
        client.patch(f"/api/v1/books/{book['id']}", {"folder_id": folder["id"]}, format="json").status_code
        == 400
    )
    assert client.delete(root).status_code == 204
    assert client.get(f"/api/v1/books/{book['id']}").status_code == 200


def test_settings_validation_and_presets(client):
    assert client.patch("/api/v1/settings", {"volume": 9}, format="json").status_code == 400
    assert (
        client.patch(
            "/api/v1/settings", {"custom_colors": {"background": "url(evil)"}}, format="json"
        ).status_code
        == 400
    )
    response = client.patch(
        "/api/v1/settings", {"theme": "Burgundy", "language": "en", "onboarding_done": True}, format="json"
    )
    assert response.status_code == 200
    assert response.data["language"] == "en"
    preset = client.post(
        "/api/v1/theme-presets", {"name": "Тихий вечер", "settings": {"theme": "Burgundy"}}, format="json"
    )
    assert preset.status_code == 201
    assert client.get("/api/v1/theme-presets").data["results"][0]["name"] == "Тихий вечер"


def test_annotations_export_and_statistics(client, book):
    root = f"/api/v1/books/{book['id']}"
    for kind in ["bookmarks", "highlights", "notes"]:
        payload = {"page": 1, "text": "Remember", "color": "gold", "quads": [[0.1, 0.1, 0.5, 0.2]]}
        response = client.post(root + "/" + kind, payload, format="json")
        assert response.status_code == 201, response.data
        assert len(client.get(root + "/" + kind).data["results"]) == 1
    assert client.get("/api/v1/exports/annotations?format=json").status_code == 200
    assert client.get("/api/v1/exports/annotations?format=markdown").status_code == 200
    assert client.get("/api/v1/statistics").data["book_count"] == 1
    assert client.get("/api/v1/sync/changes?cursor=0").status_code == 200
