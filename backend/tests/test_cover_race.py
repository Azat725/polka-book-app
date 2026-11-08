import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from library.models import Book
from library.storage import private_path

pytestmark = pytest.mark.django_db


def test_cover_processing_does_not_publish_after_book_moves_to_trash(client, book, monkeypatch):
    key = "covers/concurrent-cover.jpg"
    target = private_path(key)
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(b"\xff\xd8\xfffixture\xff\xd9")

    def concurrent_parser(file, kind="pdf"):
        Book.objects.filter(pk=book["id"]).update(deleted_at=timezone.now())
        return {"status": "ready", "page_count": 1}, key

    monkeypatch.setattr("library.processing.execute_parser", concurrent_parser)
    response = client.post(
        f"/api/v1/books/{book['id']}/covers",
        {"file": SimpleUploadedFile("cover.png", b"fixture", content_type="image/png")},
    )
    assert response.status_code == 404
    assert not target.exists()
