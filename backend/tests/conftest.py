import hashlib
import hmac
import json
import secrets
import time
from urllib.parse import urlencode

import pytest
from django.conf import settings
from rest_framework.test import APIClient


def init_data(user_id=123, age=0, profile=None):
    values = {
        "auth_date": str(int(time.time()) - age),
        "user": json.dumps(
            profile if profile is not None else {"id": user_id, "first_name": "Анна", "language_code": "ru"}
        ),
    }
    secret = hmac.new(b"WebAppData", settings.TELEGRAM_BOT_TOKEN.encode(), hashlib.sha256).digest()
    values["hash"] = hmac.new(
        secret, "\n".join(f"{k}={v}" for k, v in sorted(values.items())).encode(), hashlib.sha256
    ).hexdigest()
    return urlencode(values)


@pytest.fixture(autouse=True)
def environment(settings, tmp_path):
    from django.core.cache import cache

    cache.clear()
    settings.TELEGRAM_BOT_TOKEN = secrets.token_urlsafe(32)
    settings.PRIVATE_ROOT = tmp_path / "private"
    settings.PDF_JOB_ROOT = tmp_path / "jobs"
    settings.STORAGE_RESERVE_BYTES = 0
    settings.REST_FRAMEWORK["DEFAULT_THROTTLE_CLASSES"] = []


@pytest.fixture
def client(db):
    api = APIClient()
    response = api.post("/api/v1/auth/telegram", {"init_data": init_data()}, format="json")
    assert response.status_code == 200, response.data
    api.credentials(HTTP_AUTHORIZATION="Bearer " + response.data["access_token"])
    return api


@pytest.fixture
def other(db):
    api = APIClient()
    response = api.post("/api/v1/auth/telegram", {"init_data": init_data(456)}, format="json")
    api.credentials(HTTP_AUTHORIZATION="Bearer " + response.data["access_token"])
    return api


def pdf_bytes():
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    stream = b"BT /F1 18 Tf 30 350 Td (Hello reading) Tj ET"
    objects.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    data = b"%PDF-1.4\n"
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += f"{index} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(data)
    data += f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode()
    data += b"".join(f"{offset:010} 00000 n \n".encode() for offset in offsets[1:])
    return data + f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()


@pytest.fixture
def book(client):
    from library.processing import process_pending

    data = pdf_bytes()
    upload = client.post(
        "/api/v1/uploads", {"filename": "Моя книга.pdf", "size": len(data)}, format="json"
    ).data
    assert (
        client.put(
            f"/api/v1/uploads/{upload['id']}/chunks/0", data, content_type="application/octet-stream"
        ).status_code
        == 204
    )
    response = client.post(f"/api/v1/uploads/{upload['id']}/complete", {}, format="json")
    assert response.status_code == 202, response.data
    process_pending(once=True)
    return client.get(f"/api/v1/books/{response.data['id']}").data
