from django.core import signing
from django.db import transaction
from django.db.models import Count, F, Max, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .api_helpers import changed, owned_book, owned_books
from .models import AuditEvent, Book, Collection, CollectionBook, Folder, ProcessingJob, UploadSession
from .serializers import BookSerializer, CollectionSerializer, FolderSerializer
from .storage import private_path, release_reservation


def page_results(queryset, request, serializer):
    try:
        limit = min(max(int(request.query_params.get("limit", "100")), 1), 200)
        token = request.query_params.get("cursor")
        offset = signing.loads(token, salt="library-pagination", max_age=86400) if token else 0
        if type(offset) is not int or offset < 0:
            raise ValueError
    except (ValueError, signing.BadSignature):
        raise ValidationError({"cursor": "Invalid pagination cursor."}) from None
    rows = list(queryset[offset : offset + limit + 1])
    next_cursor = signing.dumps(offset + limit, salt="library-pagination") if len(rows) > limit else None
    return {
        "results": serializer(rows[:limit], many=True, context={"request": request}).data,
        "next": next_cursor,
    }


class Books(APIView):
    def get(self, request):
        rows = owned_books(request.user)
        query = request.query_params.get("search", "")[:300]
        if query:
            rows = rows.filter(Q(title__icontains=query) | Q(author__icontains=query))
        status = request.query_params.get("status")
        if status:
            if status not in {"want", "reading", "read"}:
                raise ValidationError({"status": "Unsupported reading status."})
            rows = rows.filter(status=status)
        if request.query_params.get("favorite") in {"1", "true"}:
            rows = rows.filter(favorite=True)
        for parameter, column in [("folder_id", "folder_id"), ("collection_id", "collections__id")]:
            value = request.query_params.get(parameter)
            if value:
                import uuid

                try:
                    rows = rows.filter(**{column: uuid.UUID(value)})
                except ValueError:
                    raise ValidationError({parameter: "UUID required."}) from None
        sort = request.query_params.get("sort", "recent")
        if sort == "-last_read":
            rows = rows.annotate(last_read_at=Max("file__readingsession__created_at"))
            return Response(
                page_results(
                    rows.order_by(F("last_read_at").desc(nulls_last=True), "id"), request, BookSerializer
                )
            )
        order = {
            "recent": "-created_at",
            "created_at": "-created_at",
            "-created_at": "-created_at",
            "title": "title",
            "progress": "-file__readingprogress__page",
            "-progress": "-file__readingprogress__page",
        }.get(sort)
        if not order:
            raise ValidationError({"sort": "Unsupported sorting."})
        return Response(page_results(rows.order_by(order, "id"), request, BookSerializer))


class BookDetail(APIView):
    def get(self, request, book_id):
        return Response(BookSerializer(owned_book(request.user, book_id), context={"request": request}).data)

    @transaction.atomic
    def patch(self, request, book_id):
        book = get_object_or_404(
            Book.objects.select_for_update(),
            pk=book_id,
            owner=request.user,
            deleted_at__isnull=True,
            purge_pending=False,
        )
        revision = request.data.get("revision")
        if revision is not None and revision != book.revision:
            from .errors import ApiError

            raise ApiError(
                "book_conflict",
                "Book changed on another device.",
                409,
                {"current": BookSerializer(book, context={"request": request}).data},
            )
        serializer = BookSerializer(book, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save(revision=book.revision + 1)
        changed(request.user, "book", book.id)
        return Response(serializer.data)

    @transaction.atomic
    def delete(self, request, book_id):
        book = owned_book(request.user, book_id)
        book.deleted_at = timezone.now()
        book.revision += 1
        book.save(update_fields=["deleted_at", "revision", "updated_at"])
        changed(request.user, "book", book.id, deleted=True)
        return Response(status=204)


class ProcessingRetry(APIView):
    @transaction.atomic
    def post(self, request, book_id):
        book = owned_book(request.user, book_id)
        if book.file.processing_status != "error":
            from .errors import ApiError

            raise ApiError("processing_state_conflict", "Only failed processing can be retried.", 409)
        file = book.file
        file.processing_status, file.error_code = "processing", ""
        file.save(update_fields=["processing_status", "error_code"])
        ProcessingJob.objects.filter(book_file=file, status="error").delete()
        ProcessingJob.objects.create(book_file=file)
        changed(request.user, "book", book.id)
        return Response(BookSerializer(book, context={"request": request}).data, status=202)


class FolderViewSet(viewsets.ModelViewSet):
    serializer_class = FolderSerializer
    pagination_class = None
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return Folder.objects.filter(owner=self.request.user).select_related("parent").order_by("name", "id")

    def list(self, request):
        return Response({"results": self.get_serializer(self.get_queryset(), many=True).data, "next": None})

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        from .models import User

        # Serialize tree edits before validating the parent chain.
        User.objects.select_for_update().get(pk=request.user.pk)
        return super().update(request, *args, **kwargs)

    def perform_create(self, serializer):
        row = serializer.save(owner=self.request.user)
        changed(self.request.user, "folder", row.id)

    def perform_update(self, serializer):
        row = serializer.save()
        changed(self.request.user, "folder", row.id)

    def perform_destroy(self, instance):
        changed(self.request.user, "folder", instance.id, deleted=True)
        instance.delete()


class CollectionViewSet(FolderViewSet):
    serializer_class = CollectionSerializer

    def get_queryset(self):
        return (
            Collection.objects.filter(owner=self.request.user)
            .annotate(
                books_count=Count("collectionbook", filter=Q(collectionbook__book__deleted_at__isnull=True))
            )
            .order_by("name", "id")
        )

    def perform_create(self, serializer):
        row = serializer.save(owner=self.request.user)
        changed(self.request.user, "collection", row.id)

    def perform_update(self, serializer):
        row = serializer.save()
        changed(self.request.user, "collection", row.id)

    def perform_destroy(self, instance):
        changed(self.request.user, "collection", instance.id, deleted=True)
        instance.delete()


class CollectionMembership(APIView):
    def put(self, request, collection_id, book_id):
        collection = get_object_or_404(Collection, pk=collection_id, owner=request.user)
        book = owned_book(request.user, book_id)
        CollectionBook.objects.get_or_create(collection=collection, book=book)
        changed(request.user, "book", book.id)
        return Response(status=204)

    def delete(self, request, collection_id, book_id):
        collection = get_object_or_404(Collection, pk=collection_id, owner=request.user)
        book = owned_book(request.user, book_id)
        CollectionBook.objects.filter(collection=collection, book=book).delete()
        changed(request.user, "book", book.id)
        return Response(status=204)


def purge_book(book, user):
    with transaction.atomic():
        book = Book.objects.select_for_update().get(pk=book.pk)
        if not book.deleted_at:
            from .errors import ApiError

            raise ApiError("not_in_trash", "Book must be moved to trash first.", 409)
        book.purge_pending = True
        book.save(update_fields=["purge_pending"])
    # Keep the database row on storage failure so the deletion can be retried.
    private_path(book.file.storage_key).unlink(missing_ok=True)
    if hasattr(book, "cover"):
        private_path(book.cover.storage_key).unlink(missing_ok=True)
    with transaction.atomic():
        for upload in UploadSession.objects.select_for_update().filter(book=book, reserved_bytes__gt=0):
            release_reservation(upload)
            upload.save(update_fields=["reserved_bytes"])
        changed(user, "book", book.id, deleted=True)
        AuditEvent.objects.create(actor=user, action="book.permanently_deleted", object_id=str(book.id))
        book.delete()


class Trash(APIView):
    def get(self, request):
        return Response(
            page_results(
                owned_books(request.user, trash=True).order_by("-deleted_at", "id"), request, BookSerializer
            )
        )


class Restore(APIView):
    @transaction.atomic
    def post(self, request, book_id):
        book = get_object_or_404(
            Book.objects.select_for_update(),
            pk=book_id,
            owner=request.user,
            deleted_at__isnull=False,
            purge_pending=False,
        )
        book.deleted_at = None
        book.revision += 1
        book.save(update_fields=["deleted_at", "revision", "updated_at"])
        changed(request.user, "book", book.id)
        return Response(BookSerializer(book, context={"request": request}).data)


class Purge(APIView):
    def delete(self, request, book_id):
        book = get_object_or_404(Book, pk=book_id, owner=request.user, deleted_at__isnull=False)
        purge_book(book, request.user)
        return Response(status=204)


class PurgeTrash(APIView):
    def post(self, request):
        for book in Book.objects.filter(owner=request.user, deleted_at__isnull=False):
            purge_book(book, request.user)
        return Response(status=204)
