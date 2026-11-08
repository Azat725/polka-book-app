from django.db.models import Sum
from django.shortcuts import get_object_or_404

from .models import Book, BookFile, ReadingSession, SyncChange


def owned_books(user, trash=False):
    rows = Book.objects.filter(owner=user, deleted_at__isnull=not trash)
    if not trash:
        rows = rows.filter(purge_pending=False)
    return rows.select_related("file", "cover", "folder", "file__readingprogress").prefetch_related(
        "collections"
    )


def owned_book(user, book_id, trash=False):
    return get_object_or_404(owned_books(user, trash), pk=book_id)


def changed(user, entity, object_id, deleted=False):
    SyncChange.objects.create(owner=user, entity=entity, object_id=object_id, deleted=deleted)


def profile(user):
    return {
        "id": str(user.id),
        "first_name": user.first_name,
        "username": user.telegram_username or None,
        "avatar_url": user.avatar_url or None,
    }


def statistics(user):
    books = Book.objects.filter(owner=user, deleted_at__isnull=True, purge_pending=False)
    return {
        "books": books.count(),
        "book_count": books.count(),
        "read": books.filter(status="read").count(),
        "reading": books.filter(status="reading").count(),
        "storage_bytes": BookFile.objects.filter(book__owner=user).aggregate(total=Sum("size_bytes"))["total"]
        or 0,
        "reading_seconds": ReadingSession.objects.filter(owner=user).aggregate(total=Sum("active_seconds"))[
            "total"
        ]
        or 0,
    }
