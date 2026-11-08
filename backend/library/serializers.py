import hashlib
import math

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import Annotation, Book, Collection, Folder, ReadingProgress, ThemePreset
from .preferences import validate_settings


class BookSerializer(serializers.ModelSerializer):
    page_count = serializers.IntegerField(source="file.page_count", read_only=True)
    size_bytes = serializers.IntegerField(source="file.size_bytes", read_only=True)
    processing_status = serializers.CharField(source="file.processing_status", read_only=True)
    error_code = serializers.CharField(source="file.error_code", read_only=True)
    cover_url = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()
    collection_ids = serializers.SerializerMethodField()
    folder_id = serializers.UUIDField(allow_null=True, required=False)

    class Meta:
        model = Book
        fields = [
            "id",
            "title",
            "author",
            "status",
            "favorite",
            "folder_id",
            "collection_ids",
            "created_at",
            "updated_at",
            "deleted_at",
            "revision",
            "page_count",
            "size_bytes",
            "processing_status",
            "error_code",
            "cover_url",
            "progress",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "deleted_at", "revision"]

    def get_cover_url(self, obj) -> str | None:
        if not hasattr(obj, "cover"):
            return None
        version = hashlib.sha256(obj.cover.storage_key.encode()).hexdigest()[:16]
        return f"/api/v1/books/{obj.id}/cover?v={version}"

    def get_collection_ids(self, obj) -> list[str]:
        return [str(item.id) for item in obj.collections.all()]

    @extend_schema_field(
        {
            "type": "object",
            "properties": {
                "page": {"type": "integer"},
                "position": {"type": "number"},
                "revision": {"type": "integer"},
            },
            "required": ["page", "position", "revision"],
        }
    )
    def get_progress(self, obj):
        try:
            row = obj.file.readingprogress
            return {"page": row.page, "position": row.position, "revision": row.revision}
        except ReadingProgress.DoesNotExist:
            return {"page": 1, "position": 0, "revision": 0}

    def validate_folder_id(self, value):
        if value and not Folder.objects.filter(pk=value, owner=self.context["request"].user).exists():
            raise serializers.ValidationError("Folder does not exist.")
        return value


class FolderSerializer(serializers.ModelSerializer):
    parent_id = serializers.UUIDField(allow_null=True, required=False)

    class Meta:
        model = Folder
        fields = ["id", "name", "parent_id", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_parent_id(self, value):
        if value:
            parent = Folder.objects.filter(pk=value, owner=self.context["request"].user).first()
            if not parent:
                raise serializers.ValidationError("Parent folder does not exist.")
            visited = set()
            while parent:
                if parent.id in visited or (self.instance and parent.id == self.instance.id):
                    raise serializers.ValidationError("Folder hierarchy cannot contain cycles.")
                visited.add(parent.id)
                parent = parent.parent
        return value


class CollectionSerializer(serializers.ModelSerializer):
    book_count = serializers.IntegerField(source="books_count", read_only=True, default=0)

    class Meta:
        model = Collection
        fields = ["id", "name", "description", "book_count", "created_at"]
        read_only_fields = ["id", "created_at"]


class AnnotationSerializer(serializers.ModelSerializer):
    book_id = serializers.UUIDField(source="book_file.book_id", read_only=True)
    book_title = serializers.CharField(source="book_file.book.title", read_only=True)

    class Meta:
        model = Annotation
        fields = [
            "id",
            "book_id",
            "book_title",
            "kind",
            "page",
            "position",
            "text",
            "color",
            "quads",
            "prefix",
            "suffix",
            "revision",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "kind", "revision", "created_at", "updated_at"]

    def validate_page(self, value):
        file = self.context.get("book_file") or self.instance.book_file
        if value < 1 or value > (file.page_count or 1000000):
            raise serializers.ValidationError("Page is outside the document.")
        return value

    def validate_position(self, value):
        if not math.isfinite(value) or not 0 <= value <= 1:
            raise serializers.ValidationError("Position must be between 0 and 1.")
        return value

    def validate_color(self, value):
        if value not in {"gold", "yellow", "green", "blue", "pink", "red", "cream"}:
            raise serializers.ValidationError("Unsupported highlight color.")
        return value

    def validate_quads(self, value):
        if not isinstance(value, list) or len(value) > 500:
            raise serializers.ValidationError("Invalid highlight coordinates.")
        for quad in value:
            if (
                not isinstance(quad, list)
                or len(quad) not in (4, 8)
                or any(
                    type(number) not in (float, int)
                    or not math.isfinite(number)
                    or not -10000000 <= number <= 10000000
                    for number in quad
                )
            ):
                raise serializers.ValidationError("Use finite PDF page coordinates.")
        return value


class ThemePresetSerializer(serializers.ModelSerializer):
    class Meta:
        model = ThemePreset
        fields = ["id", "name", "settings", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_settings(self, value):
        return validate_settings(value)
