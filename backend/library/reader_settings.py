import math

from django.db import transaction
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .api_helpers import changed, owned_book
from .errors import ApiError
from .models import BookFile, BookReaderSettings
from .preferences import user_settings, validate_settings

BOOK_KEYS = {"reader_mode", "brightness", "contrast", "night_mode", "animation_speed", "zoom", "fit_mode"}


def reader_settings(user, book_file):
    row = BookReaderSettings.objects.filter(book_file=book_file).first()
    return {
        **user_settings(user),
        "zoom": 1.0,
        "fit_mode": "width",
        **(row.values if row else {}),
        "revision": row.revision if row else 0,
    }


def validate_reader_settings(values):
    if not isinstance(values, dict) or set(values) - BOOK_KEYS - {"revision"}:
        raise ValidationError({"settings": "Only reader preferences can be overridden for a book."})
    result = validate_settings(
        {key: value for key, value in values.items() if key not in {"zoom", "fit_mode"}}
    )
    if "zoom" in values:
        value = values["zoom"]
        if type(value) not in (int, float) or not math.isfinite(value) or not 0.25 <= value <= 4:
            raise ValidationError({"zoom": "Zoom must be between 0.25 and 4."})
        result["zoom"] = value
    if "fit_mode" in values:
        if not isinstance(values["fit_mode"], str) or values["fit_mode"] not in {"page", "width"}:
            raise ValidationError({"fit_mode": "Use page or width."})
        result["fit_mode"] = values["fit_mode"]
    return result


class ReaderSettings(APIView):
    def get(self, request, book_id):
        book = owned_book(request.user, book_id)
        return Response(reader_settings(request.user, book.file))

    @transaction.atomic
    def patch(self, request, book_id):
        book = owned_book(request.user, book_id)
        revision = request.data.get("revision")
        if type(revision) is not int or revision < 0:
            raise ValidationError({"revision": "A nonnegative revision is required."})
        values = validate_reader_settings(request.data)
        BookFile.objects.select_for_update().get(pk=book.file.id)
        row, _ = BookReaderSettings.objects.get_or_create(book_file=book.file)
        if row.revision != revision:
            raise ApiError(
                "reader_settings_conflict",
                "Reader settings changed on another device.",
                409,
                {"current": reader_settings(request.user, book.file)},
            )
        row.values = {**row.values, **values}
        row.revision += 1
        row.save(update_fields=["values", "revision", "updated_at"])
        changed(request.user, "reader_settings", book.id)
        return Response(reader_settings(request.user, book.file))
