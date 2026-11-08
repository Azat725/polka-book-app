import uuid

from django.contrib.auth.models import AbstractUser
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    telegram_id = models.BigIntegerField(null=True, blank=True, unique=True)
    avatar_url = models.URLField(blank=True, max_length=2048)
    telegram_username = models.CharField(max_length=64, blank=True)
    last_activity = models.DateTimeField(null=True, blank=True)


class Owned(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class AuthSession(Owned):
    access_hash = models.CharField(max_length=64, unique=True)
    refresh_hash = models.CharField(max_length=64, unique=True)
    access_expires_at = models.DateTimeField()
    refresh_expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True)


class UserSettings(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, primary_key=True)
    values = models.JSONField(default=dict)
    revision = models.PositiveIntegerField(default=0)


class Folder(Owned):
    name = models.CharField(max_length=120)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL)


class Collection(Owned):
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=500, blank=True)


class Book(Owned):
    title = models.CharField(max_length=300)
    author = models.CharField(max_length=200, blank=True)
    status = models.CharField(
        max_length=10, choices=[("want", "Want"), ("reading", "Reading"), ("read", "Read")], default="want"
    )
    favorite = models.BooleanField(default=False)
    folder = models.ForeignKey(Folder, null=True, blank=True, on_delete=models.SET_NULL)
    collections = models.ManyToManyField(Collection, through="CollectionBook")
    deleted_at = models.DateTimeField(null=True, blank=True)
    purge_pending = models.BooleanField(default=False)
    revision = models.PositiveIntegerField(default=0)

    class Meta:
        indexes = [
            models.Index(fields=["owner", "deleted_at", "-created_at"]),
            models.Index(fields=["owner", "status"]),
        ]
        permissions = [("access_private_content", "Access private content with audit")]


class CollectionBook(models.Model):
    collection = models.ForeignKey(Collection, on_delete=models.CASCADE)
    book = models.ForeignKey(Book, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["collection", "book"], name="unique_collection_book")]


class BookFile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.OneToOneField(Book, on_delete=models.CASCADE, related_name="file")
    storage_key = models.CharField(max_length=200)
    sha256 = models.CharField(max_length=64)
    size_bytes = models.PositiveBigIntegerField()
    page_count = models.PositiveIntegerField(default=0)
    processing_status = models.CharField(max_length=20, default="processing")
    error_code = models.CharField(max_length=64, blank=True)
    encrypted = models.BooleanField(default=False)


class BookCover(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.OneToOneField(Book, on_delete=models.CASCADE, related_name="cover")
    storage_key = models.CharField(max_length=200)
    source = models.CharField(max_length=20, default="generated")


class StorageReservation(models.Model):
    key = models.PositiveSmallIntegerField(primary_key=True, default=1)
    reserved_bytes = models.PositiveBigIntegerField(default=0)


class UploadSession(Owned):
    filename = models.CharField(max_length=255)
    size = models.PositiveBigIntegerField()
    reserved_bytes = models.PositiveBigIntegerField()
    state = models.CharField(max_length=20, default="uploading")
    expires_at = models.DateTimeField()
    book = models.ForeignKey(Book, null=True, on_delete=models.SET_NULL)
    idempotency_key = models.CharField(max_length=100, blank=True)


class UploadChunk(models.Model):
    upload = models.ForeignKey(UploadSession, on_delete=models.CASCADE, related_name="chunks")
    index = models.PositiveIntegerField()
    size = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["upload", "index"], name="unique_upload_chunk")]


class ProcessingJob(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book_file = models.ForeignKey(BookFile, on_delete=models.CASCADE)
    status = models.CharField(max_length=20, default="pending")
    attempts = models.PositiveIntegerField(default=0)
    claimed_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ReadingProgress(models.Model):
    book_file = models.OneToOneField(BookFile, on_delete=models.CASCADE, primary_key=True)
    page = models.PositiveIntegerField(default=1)
    position = models.FloatField(default=0, validators=[MinValueValidator(0), MaxValueValidator(1)])
    revision = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)


class BookReaderSettings(models.Model):
    book_file = models.OneToOneField(BookFile, on_delete=models.CASCADE, primary_key=True)
    values = models.JSONField(default=dict)
    revision = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)


class MutationReceipt(models.Model):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    mutation_id = models.CharField(max_length=100)
    resource_id = models.UUIDField()
    response = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "mutation_id"], name="unique_user_mutation")]


class Annotation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book_file = models.ForeignKey(BookFile, on_delete=models.CASCADE, related_name="annotations")
    kind = models.CharField(
        max_length=12, choices=[("bookmarks", "Bookmark"), ("highlights", "Highlight"), ("notes", "Note")]
    )
    page = models.PositiveIntegerField()
    position = models.FloatField(default=0)
    text = models.TextField(blank=True, max_length=50000)
    color = models.CharField(max_length=20, default="gold")
    quads = models.JSONField(default=list)
    prefix = models.CharField(max_length=200, blank=True)
    suffix = models.CharField(max_length=200, blank=True)
    revision = models.PositiveIntegerField(default=0)
    deleted_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class ReadingSession(Owned):
    book_file = models.ForeignKey(BookFile, on_delete=models.CASCADE)
    last_heartbeat = models.DateTimeField(auto_now_add=True)
    active_seconds = models.PositiveIntegerField(default=0)
    ended_at = models.DateTimeField(null=True)


class ReadingActivity(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, primary_key=True)
    last_counted_at = models.DateTimeField(null=True)


class ThemePreset(Owned):
    name = models.CharField(max_length=120)
    settings = models.JSONField(default=dict)


class SystemSettings(models.Model):
    MAINTENANCE_CACHE_KEY = "book_app:maintenance"
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    max_pdf_bytes = models.PositiveBigIntegerField(
        default=100000000, validators=[MinValueValidator(1), MaxValueValidator(100000000)]
    )
    uploads_enabled = models.BooleanField(default=True)
    maintenance_mode = models.BooleanField(default=False)

    def save(self, *args, **kwargs):
        from django.conf import settings

        self.id = 1
        self.max_pdf_bytes = min(self.max_pdf_bytes, settings.MAX_PDF_BYTES)
        self.full_clean()
        super().save(*args, **kwargs)
        from django.core.cache import cache

        cache.delete(self.MAINTENANCE_CACHE_KEY)


class AuditEvent(models.Model):
    actor = models.ForeignKey(User, null=True, on_delete=models.SET_NULL)
    action = models.CharField(max_length=100)
    object_id = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class SyncChange(models.Model):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    entity = models.CharField(max_length=30)
    object_id = models.UUIDField()
    deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["owner", "id"])]
