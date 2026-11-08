"""OpenAPI contracts for APIViews whose responses are not model serializers."""

from drf_spectacular.extensions import OpenApiAuthenticationExtension
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view, inline_serializer
from rest_framework import serializers

from .preferences import DEFAULTS, ENUMS, RANGES
from .serializers import (
    AnnotationSerializer,
    BookSerializer,
    CollectionSerializer,
    FolderSerializer,
    ThemePresetSerializer,
)


class BearerScheme(OpenApiAuthenticationExtension):
    target_class = "library.authentication.BearerAuthentication"
    name = "Bearer"

    def get_security_definition(self, auto_schema):
        return {
            "type": "http",
            "scheme": "bearer",
            "description": "Opaque short-lived session token. Obtain via verified Telegram initData.",
        }


def object_schema(name, **fields):
    return inline_serializer(name=name, fields=fields)


def page_schema(name, serializer):
    return object_schema(name, results=serializer(many=True), next=serializers.CharField(allow_null=True))


def settings_fields():
    fields = {}
    for key, default in DEFAULTS.items():
        if key in ENUMS:
            fields[key] = serializers.ChoiceField(choices=sorted(ENUMS[key]), required=False)
        elif key in RANGES:
            fields[key] = serializers.FloatField(
                min_value=RANGES[key][0], max_value=RANGES[key][1], required=False
            )
        elif type(default) is bool:
            fields[key] = serializers.BooleanField(required=False)
        else:
            fields[key] = serializers.DictField(
                child=serializers.RegexField(r"^#[0-9a-fA-F]{6}$"), required=False
            )
    fields["revision"] = serializers.IntegerField(min_value=0, required=False)
    return fields


def document_api():
    from . import auth_views as auth
    from . import book_views as books
    from . import file_views as files
    from . import preference_views as prefs
    from . import reading_views as reading
    from .reader_settings import ReaderSettings

    settings = object_schema("Preferences", **settings_fields())
    book_preferences = object_schema(
        "BookReaderPreferences",
        **settings_fields(),
        zoom=serializers.FloatField(min_value=0.25, max_value=4, required=False),
        fit_mode=serializers.ChoiceField(choices=["page", "width"], required=False),
    )
    reader_preferences_input = object_schema(
        "BookReaderPreferencesInput",
        **{
            key: field
            for key, field in settings_fields().items()
            if key in {"reader_mode", "brightness", "contrast", "night_mode", "animation_speed", "revision"}
        },
        zoom=serializers.FloatField(min_value=0.25, max_value=4, required=False),
        fit_mode=serializers.ChoiceField(choices=["page", "width"], required=False),
    )
    user = object_schema(
        "TelegramUser",
        id=serializers.UUIDField(),
        first_name=serializers.CharField(),
        username=serializers.CharField(allow_null=True),
        avatar_url=serializers.URLField(allow_null=True),
    )
    stats = object_schema(
        "ReadingStatistics",
        **{
            key: serializers.IntegerField(min_value=0)
            for key in ["books", "book_count", "read", "reading", "storage_bytes", "reading_seconds"]
        },
    )
    token = object_schema(
        "SessionTokens",
        access_token=serializers.CharField(),
        refresh_token=serializers.CharField(),
        expires_in=serializers.IntegerField(),
    )
    login = object_schema(
        "TelegramSession",
        access_token=serializers.CharField(),
        refresh_token=serializers.CharField(),
        expires_in=serializers.IntegerField(),
        user=user,
        settings=settings,
    )
    me = object_schema("CurrentUser", user=user, settings=settings, statistics=stats)
    progress = object_schema(
        "ReadingProgress",
        page=serializers.IntegerField(min_value=1),
        position=serializers.FloatField(min_value=0, max_value=1),
        revision=serializers.IntegerField(min_value=0),
    )
    progress_input = object_schema(
        "ReadingProgressUpdate",
        page=serializers.IntegerField(min_value=1),
        position=serializers.FloatField(min_value=0, max_value=1),
        revision=serializers.IntegerField(min_value=0),
        client_mutation_id=serializers.CharField(max_length=100),
    )
    upload = object_schema(
        "UploadSession",
        id=serializers.UUIDField(),
        filename=serializers.CharField(),
        size=serializers.IntegerField(),
        state=serializers.CharField(),
        chunk_size=serializers.IntegerField(),
        uploaded_chunks=serializers.ListField(child=serializers.IntegerField()),
        chunk_checksums=serializers.DictField(child=serializers.CharField()),
        expires_at=serializers.DateTimeField(),
    )
    session = object_schema(
        "ReadingSession", id=serializers.UUIDField(), active_seconds=serializers.IntegerField(min_value=0)
    )
    changes = object_schema(
        "SyncChanges",
        results=serializers.ListField(child=serializers.DictField()),
        cursor=serializers.IntegerField(),
        has_more=serializers.BooleanField(),
    )
    book_page, annotation_page = (
        page_schema("BookPage", BookSerializer),
        page_schema("AnnotationPage", AnnotationSerializer),
    )
    pagination = [OpenApiParameter("cursor", str), OpenApiParameter("limit", int)]
    annotation_filters = [
        OpenApiParameter("kind", str, enum=["bookmarks", "highlights", "notes"]),
        OpenApiParameter("book_id", OpenApiTypes.UUID),
        OpenApiParameter("search", str),
    ]
    error = object_schema("ApiError", error=serializers.DictField())

    def action(request=None, response=None, status=200, **kwargs):
        return extend_schema(
            request=request,
            responses={status: response, 400: error, 401: error, 404: error, 409: error},
            **kwargs,
        )

    contracts = {
        auth.TelegramLogin: {
            "post": action(
                object_schema("TelegramLoginInput", init_data=serializers.CharField(max_length=16384)),
                login,
                description="Verify HMAC, timestamp and profile; never trust initDataUnsafe.",
            )
        },
        auth.Refresh: {
            "post": action(object_schema("RefreshInput", refresh_token=serializers.CharField()), token)
        },
        auth.Logout: {"post": action(status=204)},
        auth.Me: {"get": action(response=me)},
        auth.Statistics: {"get": action(response=stats)},
        books.Books: {
            "get": action(
                response=book_page,
                operation_id="books_list",
                parameters=pagination
                + [
                    OpenApiParameter(name, str)
                    for name in ["search", "status", "sort", "favorite", "folder_id", "collection_id"]
                ],
            )
        },
        books.BookDetail: {
            "get": action(response=BookSerializer, operation_id="book_retrieve"),
            "patch": action(BookSerializer, BookSerializer),
            "delete": action(status=204),
        },
        books.ProcessingRetry: {"post": action(response=BookSerializer, status=202)},
        books.CollectionMembership: {"put": action(status=204), "delete": action(status=204)},
        books.Trash: {"get": action(response=book_page, parameters=pagination)},
        books.Restore: {"post": action(response=BookSerializer)},
        books.Purge: {"delete": action(status=204)},
        books.PurgeTrash: {"post": action(status=204)},
        files.Uploads: {
            "post": action(
                object_schema(
                    "UploadInput",
                    filename=serializers.CharField(max_length=255),
                    size=serializers.IntegerField(min_value=1, max_value=100000000),
                ),
                upload,
                status=201,
                parameters=[OpenApiParameter("Idempotency-Key", str, location=OpenApiParameter.HEADER)],
            )
        },
        files.UploadDetail: {"get": action(response=upload), "delete": action(status=204)},
        files.UploadChunkView: {"put": action({"application/octet-stream": OpenApiTypes.BINARY}, status=204)},
        files.CompleteUpload: {"post": action(response=BookSerializer, status=202)},
        files.BookFileView: {
            "get": extend_schema(
                responses={200: OpenApiTypes.BINARY, 206: OpenApiTypes.BINARY, 416: None},
                parameters=[
                    OpenApiParameter("Range", str, location=OpenApiParameter.HEADER),
                    OpenApiParameter("If-Range", str, location=OpenApiParameter.HEADER),
                ],
            )
        },
        files.BookCoverView: {"get": extend_schema(responses={(200, "image/jpeg"): OpenApiTypes.BINARY})},
        files.BookCoverUpload: {
            "post": action(object_schema("CoverUpload", file=serializers.ImageField()), BookSerializer)
        },
        reading.Progress: {"get": action(response=progress), "put": action(progress_input, progress)},
        ReaderSettings: {
            "get": action(response=book_preferences),
            "patch": action(reader_preferences_input, book_preferences),
        },
        reading.Annotations: {
            "get": action(
                response=annotation_page,
                operation_id="book_annotations_list",
                parameters=pagination + [OpenApiParameter("search", str)],
            ),
            "post": action(AnnotationSerializer, AnnotationSerializer, status=201),
        },
        reading.AnnotationDetail: {
            "patch": action(AnnotationSerializer, AnnotationSerializer),
            "delete": action(status=204),
        },
        reading.AllAnnotations: {
            "get": action(response=annotation_page, parameters=pagination + annotation_filters)
        },
        reading.Sessions: {
            "post": action(
                object_schema("ReadingSessionInput", book_id=serializers.UUIDField()), session, status=201
            )
        },
        reading.Heartbeat: {
            "post": action(
                object_schema(
                    "HeartbeatInput",
                    active=serializers.BooleanField(),
                    closed=serializers.BooleanField(required=False),
                ),
                session,
            )
        },
        reading.ExportAnnotations: {
            "get": extend_schema(
                responses={
                    (200, "application/json"): AnnotationSerializer(many=True),
                    (200, "text/markdown"): str,
                },
                parameters=[
                    OpenApiParameter("format", str, enum=["json", "markdown"]),
                    OpenApiParameter("book_id", OpenApiTypes.UUID),
                ],
            )
        },
        prefs.Settings: {"get": action(response=settings), "patch": action(settings, settings)},
        prefs.Changes: {"get": action(response=changes, parameters=[OpenApiParameter("cursor", int)])},
        books.FolderViewSet: {"list": action(response=page_schema("FolderPage", FolderSerializer))},
        books.CollectionViewSet: {
            "list": action(response=page_schema("CollectionPage", CollectionSerializer))
        },
        prefs.ThemePresetViewSet: {
            "list": action(response=page_schema("ThemePresetPage", ThemePresetSerializer))
        },
    }
    for view, methods in contracts.items():
        extend_schema_view(**methods)(view)
