from django.contrib import admin
from django.db import connection
from django.http import JsonResponse
from django.urls import include, path, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerSplitView
from rest_framework.authentication import SessionAuthentication
from rest_framework.routers import SimpleRouter

from library.auth_views import Logout, Me, Refresh, Statistics, TelegramLogin
from library.authentication import BearerAuthentication
from library.book_views import (
    BookDetail,
    Books,
    CollectionMembership,
    CollectionViewSet,
    FolderViewSet,
    ProcessingRetry,
    Purge,
    PurgeTrash,
    Restore,
    Trash,
)
from library.file_views import (
    BookCoverUpload,
    BookCoverView,
    BookFileView,
    CompleteUpload,
    UploadChunkView,
    UploadDetail,
    Uploads,
)
from library.preference_views import Changes, Settings, ThemePresetViewSet
from library.reader_settings import ReaderSettings
from library.reading_views import (
    AllAnnotations,
    AnnotationDetail,
    Annotations,
    ExportAnnotations,
    Heartbeat,
    Progress,
    Sessions,
)
from library.schema import document_api


def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        return JsonResponse({"status": "ok"})
    except Exception:
        return JsonResponse({"status": "unavailable"}, status=503)


router = SimpleRouter(trailing_slash=False)
router.register("folders", FolderViewSet, basename="folder")
router.register("collections", CollectionViewSet, basename="collection")
router.register("theme-presets", ThemePresetViewSet, basename="theme-preset")
document_api()
api = [
    path("auth/telegram", TelegramLogin.as_view()),
    path("auth/refresh", Refresh.as_view()),
    path("auth/logout", Logout.as_view()),
    path("me", Me.as_view()),
    path("statistics", Statistics.as_view()),
    path("settings", Settings.as_view()),
    path("books", Books.as_view()),
    path("books/<uuid:book_id>", BookDetail.as_view()),
    path("books/<uuid:book_id>/file", BookFileView.as_view()),
    path("books/<uuid:book_id>/cover", BookCoverView.as_view()),
    path("books/<uuid:book_id>/covers", BookCoverUpload.as_view()),
    path("books/<uuid:book_id>/progress", Progress.as_view()),
    path("books/<uuid:book_id>/reader-settings", ReaderSettings.as_view()),
    path("books/<uuid:book_id>/processing-retries", ProcessingRetry.as_view()),
    re_path(
        r"^books/(?P<book_id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(?P<kind>bookmarks|highlights|notes)$",
        Annotations.as_view(),
    ),
    re_path(
        r"^(?P<kind>bookmarks|highlights|notes)/(?P<annotation_id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$",
        AnnotationDetail.as_view(),
    ),
    path("annotations", AllAnnotations.as_view()),
    path("uploads", Uploads.as_view()),
    path("uploads/<uuid:upload_id>", UploadDetail.as_view()),
    path("uploads/<uuid:upload_id>/chunks/<int:index>", UploadChunkView.as_view()),
    path("uploads/<uuid:upload_id>/complete", CompleteUpload.as_view()),
    path("collections/<uuid:collection_id>/books/<uuid:book_id>", CollectionMembership.as_view()),
    path("reading-sessions", Sessions.as_view()),
    path("reading-sessions/<uuid:session_id>/heartbeats", Heartbeat.as_view()),
    path("trash", Trash.as_view()),
    path("trash/purge", PurgeTrash.as_view()),
    path("trash/<uuid:book_id>/restore", Restore.as_view()),
    path("trash/<uuid:book_id>", Purge.as_view()),
    path("exports/annotations", ExportAnnotations.as_view()),
    path("sync/changes", Changes.as_view()),
    path("", include(router.urls)),
]
urlpatterns = [
    path("health", health),
    path("admin/", admin.site.urls),
    path("api/v1/", include(api)),
    path(
        "api/schema",
        SpectacularAPIView.as_view(authentication_classes=[SessionAuthentication, BearerAuthentication]),
        name="schema",
    ),
    path(
        "api/docs",
        SpectacularSwaggerSplitView.as_view(
            url_name="schema", authentication_classes=[SessionAuthentication, BearerAuthentication]
        ),
    ),
]
