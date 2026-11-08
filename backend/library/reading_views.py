import json
import math
import uuid

from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .api_helpers import changed, owned_book
from .errors import ApiError
from .models import Annotation, MutationReceipt, ReadingActivity, ReadingProgress, ReadingSession
from .serializers import AnnotationSerializer


def progress_data(row):
    return {"page": row.page, "position": row.position, "revision": row.revision}


class Progress(APIView):
    def get(self, request, book_id):
        book = owned_book(request.user, book_id)
        row = ReadingProgress.objects.filter(book_file=book.file).first()
        return Response(progress_data(row) if row else {"page": 1, "position": 0, "revision": 0})

    @transaction.atomic
    def put(self, request, book_id):
        from .models import Book

        get_object_or_404(
            Book.objects.select_for_update(),
            pk=book_id,
            owner=request.user,
            deleted_at__isnull=True,
            purge_pending=False,
        )
        book = owned_book(request.user, book_id)
        mutation_id = request.data.get("client_mutation_id")
        if not isinstance(mutation_id, str) or not 1 <= len(mutation_id) <= 100:
            raise ValidationError({"client_mutation_id": "A mutation identifier is required."})
        previous = MutationReceipt.objects.filter(owner=request.user, mutation_id=mutation_id).first()
        if previous:
            if previous.resource_id != book.id:
                raise ApiError("mutation_conflict", "Mutation key belongs to another resource.", 409)
            return Response(previous.response)
        page, position, revision = (
            request.data.get("page"),
            request.data.get("position", 0),
            request.data.get("revision"),
        )
        if type(page) is not int or not 1 <= page <= (book.file.page_count or 1000000):
            raise ValidationError({"page": "Page is outside the document."})
        if type(position) not in (int, float) or not math.isfinite(position) or not 0 <= position <= 1:
            raise ValidationError({"position": "Position must be between 0 and 1."})
        if type(revision) is not int or revision < 0:
            raise ValidationError({"revision": "Nonnegative revision is required."})
        # The parent row serializes creation of the one-to-one progress record.
        from .models import BookFile

        BookFile.objects.select_for_update().get(pk=book.file.id)
        row, _ = ReadingProgress.objects.get_or_create(book_file=book.file)
        if revision != row.revision:
            raise ApiError(
                "progress_conflict",
                "Position changed on another device.",
                409,
                {"current": progress_data(row)},
            )
        row.page, row.position, row.revision = page, position, row.revision + 1
        row.save()
        response = progress_data(row)
        MutationReceipt.objects.create(
            owner=request.user, mutation_id=mutation_id, resource_id=book.id, response=response
        )
        if book.status == "want":
            book.status = "reading"
            book.revision += 1
            book.save(update_fields=["status", "revision", "updated_at"])
            changed(request.user, "book", book.id)
        changed(request.user, "progress", book.id)
        return Response(response)


class Annotations(APIView):
    def get(self, request, book_id, kind):
        book = owned_book(request.user, book_id)
        rows = Annotation.objects.filter(book_file=book.file, kind=kind, deleted_at__isnull=True)
        query = request.query_params.get("search", "")[:300]
        if query:
            rows = rows.filter(text__icontains=query)
        from .book_views import page_results

        return Response(page_results(rows.order_by("page", "created_at"), request, AnnotationSerializer))

    def post(self, request, book_id, kind):
        book = owned_book(request.user, book_id)
        serializer = AnnotationSerializer(data=request.data, context={"book_file": book.file})
        serializer.is_valid(raise_exception=True)
        row = serializer.save(book_file=book.file, kind=kind)
        changed(request.user, kind, row.id)
        return Response(serializer.data, status=201)


class AnnotationDetail(APIView):
    def get_row(self, request, annotation_id, kind, lock=False):
        rows = Annotation.objects.filter(
            book_file__book__owner=request.user,
            book_file__book__deleted_at__isnull=True,
            book_file__book__purge_pending=False,
            deleted_at__isnull=True,
            kind=kind,
        ).select_related("book_file")
        return get_object_or_404(rows.select_for_update() if lock else rows, pk=annotation_id)

    @transaction.atomic
    def patch(self, request, annotation_id, kind):
        row = self.get_row(request, annotation_id, kind, lock=True)
        revision = request.data.get("revision")
        if revision is not None and revision != row.revision:
            raise ApiError(
                "annotation_conflict",
                "Annotation changed on another device.",
                409,
                {"current": AnnotationSerializer(row).data},
            )
        serializer = AnnotationSerializer(row, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(revision=row.revision + 1)
        changed(request.user, kind, row.id)
        return Response(serializer.data)

    @transaction.atomic
    def delete(self, request, annotation_id, kind):
        row = self.get_row(request, annotation_id, kind, lock=True)
        row.deleted_at, row.revision = timezone.now(), row.revision + 1
        row.save(update_fields=["deleted_at", "revision", "updated_at"])
        changed(request.user, kind, row.id, deleted=True)
        return Response(status=204)


class AllAnnotations(APIView):
    def get(self, request):
        rows = Annotation.objects.filter(
            book_file__book__owner=request.user,
            book_file__book__deleted_at__isnull=True,
            deleted_at__isnull=True,
        ).select_related("book_file__book")
        kind = request.query_params.get("kind")
        kind = {"bookmark": "bookmarks", "highlight": "highlights", "note": "notes"}.get(kind, kind)
        if kind in {"bookmarks", "highlights", "notes"}:
            rows = rows.filter(kind=kind)
        book_id = request.query_params.get("book_id")
        if book_id:
            try:
                rows = rows.filter(book_file__book_id=uuid.UUID(book_id))
            except ValueError:
                raise ValidationError({"book_id": "UUID required."}) from None
        query = request.query_params.get("search", "")[:300]
        if query:
            rows = rows.filter(text__icontains=query)
        from .book_views import page_results

        return Response(page_results(rows.order_by("-created_at", "id"), request, AnnotationSerializer))


class Sessions(APIView):
    @transaction.atomic
    def post(self, request):
        try:
            book_id = uuid.UUID(str(request.data.get("book_id")))
        except ValueError:
            raise ValidationError({"book_id": "A valid book ID is required."}) from None
        book = owned_book(request.user, book_id)
        from .models import AuditEvent, Book

        book = get_object_or_404(
            Book.objects.select_for_update(),
            pk=book.id,
            owner=request.user,
            deleted_at__isnull=True,
            purge_pending=False,
        )
        if book.status == "want":
            book.status = "reading"
            book.revision += 1
            book.save(update_fields=["status", "revision", "updated_at"])
            AuditEvent.objects.create(
                actor=request.user, action="book.reading_started", object_id=str(book.id)
            )
        row = ReadingSession.objects.create(owner=request.user, book_file=book.file)
        changed(request.user, "book", book.id)
        return Response({"id": str(row.id), "active_seconds": 0}, status=201)


class Heartbeat(APIView):
    @transaction.atomic
    def post(self, request, session_id):
        row = get_object_or_404(ReadingSession.objects.select_for_update(), pk=session_id, owner=request.user)
        if row.ended_at:
            raise ApiError("session_ended", "Reading session has ended.", 409)
        if not isinstance(request.data.get("active", True), bool):
            raise ValidationError({"active": "Boolean required."})
        now = timezone.now()
        ReadingActivity.objects.get_or_create(user=request.user)
        activity = ReadingActivity.objects.select_for_update().get(user=request.user)
        start = max(row.last_heartbeat, activity.last_counted_at or row.last_heartbeat)
        elapsed = (now - start).total_seconds()
        if request.data.get("active", True) and 0 < elapsed <= 45:
            row.active_seconds += int(min(elapsed, 30))
            activity.last_counted_at = now
            activity.save(update_fields=["last_counted_at"])
        row.last_heartbeat = now
        if request.data.get("closed") is True:
            row.ended_at = now
        row.save(update_fields=["last_heartbeat", "active_seconds", "ended_at"])
        return Response({"id": str(row.id), "active_seconds": row.active_seconds})


class ExportAnnotations(APIView):
    def get(self, request):
        rows = (
            Annotation.objects.filter(
                book_file__book__owner=request.user,
                book_file__book__deleted_at__isnull=True,
                deleted_at__isnull=True,
            )
            .select_related("book_file__book")
            .order_by("book_file__book__title", "page", "created_at")
        )
        book_id = request.query_params.get("book_id")
        if book_id:
            try:
                rows = rows.filter(book_file__book_id=uuid.UUID(book_id))
            except ValueError:
                raise ValidationError({"book_id": "UUID required."}) from None
        format_name = request.query_params.get("format", "markdown")
        if format_name not in {"json", "markdown"}:
            raise ValidationError({"format": "Use json or markdown."})
        if format_name == "json":
            values = [
                {**AnnotationSerializer(row).data, "kind": row.kind, "book_title": row.book_file.book.title}
                for row in rows
            ]
            response = HttpResponse(
                json.dumps(values, ensure_ascii=False), content_type="application/json; charset=utf-8"
            )
            filename = "annotations.json"
        else:
            parts = ["# Reading notes\n"]
            for row in rows:
                parts.extend(
                    [f"## {row.book_file.book.title.replace(chr(10), ' ')} — {row.page}\n", row.text, "\n"]
                )
            response = HttpResponse("\n".join(parts), content_type="text/markdown; charset=utf-8")
            filename = "annotations.md"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        response["Cache-Control"] = "private, no-store"
        return response
