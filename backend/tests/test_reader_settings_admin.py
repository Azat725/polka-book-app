from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command

from library.models import User

pytestmark = pytest.mark.django_db


def test_book_settings_inherit_globals_and_isolate_overrides(client, other, book):
    root = f"/api/v1/books/{book['id']}/reader-settings/"
    assert client.patch("/api/v1/settings", {"brightness": 0.8}, format="json").status_code == 200
    response = client.get(root)
    assert response.status_code == 200
    assert response.data["brightness"] == 0.8
    assert response.data["revision"] == 0
    updated = client.patch(
        root, {"revision": 0, "brightness": 1.2, "zoom": 1.5, "reader_mode": "flip"}, format="json"
    )
    assert updated.status_code == 200
    assert updated.data["zoom"] == 1.5
    assert updated.data["brightness"] == 1.2
    assert updated.data["revision"] == 1
    assert client.get("/api/v1/settings").data["brightness"] == 0.8
    assert other.get(root).status_code == 404
    assert other.patch(root, {"revision": 1, "brightness": 1}, format="json").status_code == 404
    assert client.patch(root, {"revision": 0, "brightness": 1}, format="json").status_code == 409
    assert client.patch(root, {"revision": 1, "theme": "cream"}, format="json").status_code == 400
    assert client.patch(root, {"revision": 1, "zoom": 99}, format="json").status_code == 400
    assert client.patch(root, {"revision": 1, "fit_mode": []}, format="json").status_code == 400


def test_bootstrap_roles_are_idempotent_and_cannot_open_files():
    call_command("bootstrap_admin_roles", verbosity=0)
    call_command("bootstrap_admin_roles", verbosity=0)
    for role in ["Support", "Operator", "Admin"]:
        permissions = set(Group.objects.get(name=role).permissions.values_list("codename", flat=True))
        assert "access_private_content" not in permissions
        assert "change_permission" not in permissions
        assert "change_group" not in permissions
        assert "delete_book" not in permissions
    assert "change_user" in set(
        Group.objects.get(name="Support").permissions.values_list("codename", flat=True)
    )
    assert "change_processingjob" in set(
        Group.objects.get(name="Operator").permissions.values_list("codename", flat=True)
    )
    assert "change_systemsettings" in set(
        Group.objects.get(name="Admin").permissions.values_list("codename", flat=True)
    )


def test_admin_dashboard_aggregates_metadata_without_content(client, book):
    from django.test import Client

    user = User.objects.create_superuser(username="dashboard-admin", password=None)
    browser = Client()
    browser.force_login(user)
    response = browser.get("/admin/")
    assert response.status_code == 200
    summary = response.context["system_statistics"]
    assert summary["users"] >= 1
    assert summary["active_users_7d"] >= 1
    assert summary["books"] == 1
    assert summary["storage_bytes"] == book["size_bytes"]
    assert summary["failed_jobs"] == 0
    assert "/file" not in response.content.decode()


def test_bearer_activity_is_throttled_to_five_minutes(client, monkeypatch):
    user = User.objects.get(telegram_id=123)
    start = user.last_activity
    later = start + timedelta(minutes=6)
    monkeypatch.setattr("library.authentication.timezone.now", lambda: later)
    assert client.get("/api/v1/me").status_code == 200
    user.refresh_from_db()
    assert user.last_activity == later
    monkeypatch.setattr("library.authentication.timezone.now", lambda: later + timedelta(seconds=20))
    assert client.get("/api/v1/me").status_code == 200
    user.refresh_from_db()
    assert user.last_activity == later


def test_opening_a_book_sets_reading_and_updates_last_read_sort(client, book):
    assert client.get(f"/api/v1/books/{book['id']}").data["status"] == "want"
    result = client.post("/api/v1/reading-sessions", {"book_id": book["id"]}, format="json")
    assert result.status_code == 201
    assert client.get(f"/api/v1/books/{book['id']}").data["status"] == "reading"
    assert (
        client.get("/api/v1/books?status=reading&sort=-last_read&limit=1").data["results"][0]["id"]
        == book["id"]
    )
    client.patch(f"/api/v1/books/{book['id']}", {"status": "read"}, format="json")
    client.post("/api/v1/reading-sessions", {"book_id": book["id"]}, format="json")
    assert client.get(f"/api/v1/books/{book['id']}").data["status"] == "read"
