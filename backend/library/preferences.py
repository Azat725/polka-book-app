import math
import re

from rest_framework.exceptions import ValidationError

DEFAULTS = {
    "theme": "midnight",
    "mode": "dark",
    "language": "ru",
    "onboarding_done": False,
    "cover_size": "medium",
    "density": "comfortable",
    "reader_mode": "scroll",
    "sound_enabled": False,
    "page_sound": True,
    "ui_sound": False,
    "volume": 0.35,
    "animation_speed": 1.0,
    "brightness": 1.0,
    "contrast": 1.0,
    "night_mode": False,
    "texture": "none",
    "reader_texture": "none",
    "shelf_style": "plain",
    "custom_colors": {},
}
ENUMS = {
    "theme": {
        "obsidian",
        "richesse",
        "terracotta",
        "tuscan",
        "ussr",
        "gdr",
        "eighties",
        "cream",
        "burgundy",
        "midnight",
    },
    "mode": {"light", "dark", "system"},
    "language": {"ru", "en"},
    "cover_size": {"small", "medium", "large"},
    "density": {"compact", "comfortable"},
    "reader_mode": {"scroll", "flip"},
    "texture": {"none", "paper", "linen", "grain"},
    "reader_texture": {"none", "paper", "linen"},
    "shelf_style": {"plain", "wood", "line"},
}
RANGES = {"volume": (0, 1), "animation_speed": (0.5, 2), "brightness": (0.3, 1.5), "contrast": (0.5, 2)}
COLOR_KEYS = {"bg", "background", "surface", "text", "accent", "muted", "border", "reader", "shelf"}


def validate_settings(values):
    if not isinstance(values, dict):
        raise ValidationError({"settings": "Object required."})
    result = {}
    for key, value in values.items():
        if key == "revision":
            continue
        if key not in DEFAULTS:
            raise ValidationError({key: "Unknown preference."})
        if key in ENUMS:
            if not isinstance(value, str) or value.lower() not in ENUMS[key]:
                raise ValidationError({key: "Unsupported value."})
            value = value.lower()
        elif key in RANGES:
            low, high = RANGES[key]
            if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
                raise ValidationError({key: f"Must be between {low} and {high}."})
        elif key == "custom_colors":
            if not isinstance(value, dict) or any(
                k not in COLOR_KEYS or not isinstance(v, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", v)
                for k, v in value.items()
            ):
                raise ValidationError({key: "Only supported colors in #RRGGBB notation are accepted."})
        elif type(value) is not bool:
            raise ValidationError({key: "Boolean required."})
        result[key] = value
    return result


def user_settings(user):
    from .models import UserSettings

    row, _ = UserSettings.objects.get_or_create(user=user)
    return {**DEFAULTS, **row.values, "revision": row.revision}
