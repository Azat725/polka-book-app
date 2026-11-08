import hashlib
import hmac
import json
import secrets
import time
from datetime import timedelta
from urllib.parse import parse_qsl

from django.conf import settings
from django.db import models, transaction
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .models import AuthSession, User, UserSettings


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def verify_init_data(raw):
    if not settings.TELEGRAM_BOT_TOKEN:
        from .errors import ApiError

        raise ApiError("telegram_unconfigured", "Telegram bot is not configured.", 503)
    try:
        if not isinstance(raw, str) or not raw or len(raw) > 16384:
            raise ValueError
        pairs = parse_qsl(raw, keep_blank_values=True, strict_parsing=True)
        values = dict(pairs)
        if len(values) != len(pairs):
            raise ValueError
        signature = values.pop("hash")
        secret = hmac.new(b"WebAppData", settings.TELEGRAM_BOT_TOKEN.encode(), hashlib.sha256).digest()
        expected = hmac.new(
            secret,
            "\n".join(f"{key}={value}" for key, value in sorted(values.items())).encode(),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, signature):
            raise ValueError
        age = time.time() - int(values["auth_date"])
        if age < -30 or age > settings.TELEGRAM_AUTH_MAX_AGE:
            raise ValueError
        profile = json.loads(values["user"])
        if type(profile["id"]) is not int or not 0 < profile["id"] < 2**63:
            raise ValueError
        if not isinstance(profile.get("first_name"), str):
            raise ValueError
        return profile
    except (ValueError, KeyError, TypeError):
        raise AuthenticationFailed("Invalid or expired Telegram authorization.") from None


def issue_session(user, existing=None):
    access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    now = timezone.now()
    values = {
        "access_hash": digest(access),
        "refresh_hash": digest(refresh),
        "access_expires_at": now + timedelta(minutes=15),
        "refresh_expires_at": now + timedelta(days=7),
    }
    if existing:
        absolute_expiry = existing.created_at + timedelta(days=7)
        values["refresh_expires_at"] = min(values["refresh_expires_at"], absolute_expiry)
        values["access_expires_at"] = min(values["access_expires_at"], absolute_expiry)
        for key, value in values.items():
            setattr(existing, key, value)
        existing.save(update_fields=[*values, "updated_at"])
    else:
        AuthSession.objects.create(owner=user, **values)
    return {"access_token": access, "refresh_token": refresh, "expires_in": 900}


@transaction.atomic
def telegram_login(raw):
    profile = verify_init_data(raw)
    user, created = User.objects.get_or_create(
        telegram_id=profile["id"], defaults={"username": f"tg_{profile['id']}"}
    )
    if not user.is_active:
        raise AuthenticationFailed("Account is blocked.")
    user.first_name = profile["first_name"][:150]
    user.last_name = str(profile.get("last_name", ""))[:150]
    user.telegram_username = str(profile.get("username", ""))[:64]
    avatar = profile.get("photo_url", "")
    user.avatar_url = avatar[:2048] if isinstance(avatar, str) and avatar.startswith("https://") else ""
    user.last_activity = timezone.now()
    if created:
        user.set_unusable_password()
    user.save()
    UserSettings.objects.get_or_create(
        user=user,
        defaults={
            "values": {"language": "ru" if str(profile.get("language_code", "")).startswith("ru") else "en"}
        },
    )
    return user, issue_session(user)


@transaction.atomic
def refresh_session(raw):
    if not isinstance(raw, str) or len(raw) > 200:
        raise AuthenticationFailed("Invalid session.")
    session = (
        AuthSession.objects.select_for_update()
        .select_related("owner")
        .filter(refresh_hash=digest(raw), revoked_at__isnull=True, refresh_expires_at__gt=timezone.now())
        .first()
    )
    if not session or not session.owner.is_active:
        raise AuthenticationFailed("Session expired.")
    return issue_session(session.owner, existing=session)


class BearerAuthentication(BaseAuthentication):
    def authenticate(self, request):
        header = request.headers.get("Authorization", "")
        if not header:
            return None
        parts = header.split()
        if len(parts) != 2 or parts[0] != "Bearer" or len(parts[1]) > 200:
            raise AuthenticationFailed("Invalid authorization.")
        session = (
            AuthSession.objects.select_related("owner")
            .filter(
                access_hash=digest(parts[1]), revoked_at__isnull=True, access_expires_at__gt=timezone.now()
            )
            .first()
        )
        if not session or not session.owner.is_active:
            raise AuthenticationFailed("Session expired.")
        now = timezone.now()
        cutoff = now - timedelta(minutes=5)
        if not session.owner.last_activity or session.owner.last_activity <= cutoff:
            User.objects.filter(pk=session.owner_id).filter(
                models.Q(last_activity__isnull=True) | models.Q(last_activity__lte=cutoff)
            ).update(last_activity=now)
            session.owner.last_activity = now
        return session.owner, session

    def authenticate_header(self, request):
        return "Bearer"
