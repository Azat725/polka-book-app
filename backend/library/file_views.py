import re
import uuid
from types import SimpleNamespace

from django.conf import settings
from django.db import transaction
from django.http import HttpResponse, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils.http import content_disposition_header
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.parsers import BaseParser, FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .api_helpers import changed, owned_book
from .models import Book, BookCover, UploadSession
from .serializers import BookSerializer
from .storage import cancel_upload, complete_upload, create_upload, private_path, store_chunk


def upload_data(upload):
    chunks = list(upload.chunks.order_by("index"))
    return {
        "id": str(upload.id),
        "filename": upload.filename,
        "size": upload.size,
        "state": upload.state,
        "chunk_size": settings.UPLOAD_CHUNK_SIZE,
        "uploaded_chunks": [chunk.index for chunk in chunks],
        "chunk_checksums": {str(chunk.index): chunk.sha256 for chunk in chunks},
        "expires_at": upload.expires_at,
    }


class Uploads(APIView):
    def post(self, request):
        upload = create_upload(request.user, request.data, request.headers.get("Idempotency-Key", ""))
        return Response(upload_data(upload), status=201)


class UploadDetail(APIView):
    def get_upload(self, request, upload_id):
        from django.shortcuts import get_object_or_404

        return get_object_or_404(UploadSession, pk=upload_id, owner=request.user)

    def get(self, request, upload_id):
        upload = self.get_upload(request, upload_id)
        from .storage import assert_open

        if upload.state == "uploading":
            assert_open(upload)
        return Response(upload_data(upload))

    def delete(self, request, upload_id):
        cancel_upload(self.get_upload(request, upload_id))
        return Response(status=204)


class BinaryParser(BaseParser):
    media_type = "application/octet-stream"

    def parse(self, stream, media_type=None, parser_context=None):
        data = stream.read(settings.UPLOAD_CHUNK_SIZE + 1)
        if len(data) > settings.UPLOAD_CHUNK_SIZE:
            from .errors import ApiError

            raise ApiError("chunk_too_large", "Chunk exceeds the permitted size.", 413)
        return data


class UploadChunkView(APIView):
    parser_classes = [BinaryParser]

    def put(self, request, upload_id, index):
        store_chunk(upload_id, request.user, index, request.data)
        return Response(status=204)


class CompleteUpload(APIView):
    def post(self, request, upload_id):
        book = complete_upload(upload_id, request.user)
        return Response(BookSerializer(book, context={"request": request}).data, status=202)


def file_response(request, key, filename, mime, digest=""):
    path = private_path(key)
    if not path.is_file():
        raise NotFound()
    size, start, end, status = path.stat().st_size, 0, path.stat().st_size - 1, 200
    etag = f'"{digest}"' if digest else f'"{path.stat().st_mtime_ns}-{size}"'
    range_header = request.headers.get("Range", "")
    if len(range_header) > 256:
        response = HttpResponse(status=416)
        response["Content-Range"] = f"bytes */{size}"
        return response
    if range_header and request.headers.get("If-Range", etag) == etag:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header)
        if not match or not any(match.groups()):
            response = HttpResponse(status=416)
            response["Content-Range"] = f"bytes */{size}"
            return response
        first, last = match.groups()
        if first:
            start = int(first)
            end = min(int(last), size - 1) if last else size - 1
        else:
            suffix = int(last)
            start = max(0, size - suffix)
        if start >= size or start > end or (not first and int(last) == 0):
            response = HttpResponse(status=416)
            response["Content-Range"] = f"bytes */{size}"
            return response
        status = 206
    length = end - start + 1
    if settings.FILE_X_ACCEL:
        response = HttpResponse(content_type=mime)
        response["X-Accel-Redirect"] = "/_private/" + key
        # Nginx computes Range and Content-Length after the internal redirect.
    elif request.method == "HEAD":
        response = HttpResponse(status=status, content_type=mime)
        response["Content-Length"] = str(length)
    else:

        def contents():
            with path.open("rb") as source:
                source.seek(start)
                remaining = length
                while remaining:
                    data = source.read(min(65536, remaining))
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        response = StreamingHttpResponse(contents(), status=status, content_type=mime)
        response["Content-Length"] = str(length)
    response["Accept-Ranges"] = "bytes"
    response["ETag"] = etag
    response["Cache-Control"] = "private, no-store"
    response["Content-Disposition"] = content_disposition_header(False, filename)
    response["X-Content-Type-Options"] = "nosniff"
    if status == 206 and not settings.FILE_X_ACCEL:
        response["Content-Range"] = f"bytes {start}-{end}/{size}"
    return response


class BookFileView(APIView):
    def get(self, request, book_id):
        book = owned_book(request.user, book_id)
        if book.file.processing_status not in {"ready", "locked"}:
            raise NotFound()
        return file_response(
            request, book.file.storage_key, book.title + ".pdf", "application/pdf", book.file.sha256
        )

    def head(self, request, book_id):
        return self.get(request, book_id)


class BookCoverView(APIView):
    parser_classes = [MultiPartParser, FormParser]
    http_method_names = ["get", "head", "options"]

    def get(self, request, book_id):
        book = owned_book(request.user, book_id)
        if not hasattr(book, "cover"):
            raise NotFound()
        return file_response(request, book.cover.storage_key, "cover.jpg", "image/jpeg")

    def post(self, request, book_id):
        from .processing import execute_parser

        book = owned_book(request.user, book_id)
        upload = request.FILES.get("file")
        if not upload or upload.size > 5 * 1024 * 1024:
            raise ValidationError({"file": "Provide a JPEG, PNG or WebP image up to 5 MB."})
        key = f"temporary/{uuid.uuid4().hex}.image"
        source = private_path(key)
        source.parent.mkdir(parents=True, exist_ok=True)
        cover_key = None
        published = False
        try:
            with source.open("wb") as destination:
                for chunk in upload.chunks():
                    destination.write(chunk)
            result, cover_key = execute_parser(SimpleNamespace(storage_key=key), kind="cover")
            if result.get("status") != "ready" or not cover_key:
                raise ValidationError({"file": "Image could not be decoded safely."})
            with transaction.atomic():
                book = get_object_or_404(
                    Book.objects.select_for_update(),
                    pk=book_id,
                    owner=request.user,
                    deleted_at__isnull=True,
                    purge_pending=False,
                )
                previous_cover = BookCover.objects.select_for_update().filter(book=book).first()
                previous = previous_cover.storage_key if previous_cover else None
                BookCover.objects.update_or_create(
                    book=book, defaults={"storage_key": cover_key, "source": "uploaded"}
                )
                book.revision += 1
                book.save(update_fields=["revision", "updated_at"])
                if previous:
                    transaction.on_commit(lambda: private_path(previous).unlink(missing_ok=True), robust=True)
                changed(request.user, "book", book.id)
            published = True
        finally:
            source.unlink(missing_ok=True)
            if cover_key and not published:
                private_path(cover_key).unlink(missing_ok=True)
        book.refresh_from_db()
        return Response(BookSerializer(book, context={"request": request}).data)


class BookCoverUpload(BookCoverView):
    http_method_names = ["post", "options"]
