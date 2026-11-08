from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.utils import timezone

from .models import AuditEvent, Book, BookFile, ProcessingJob, SystemSettings, User


@admin.register(User)
class AccountAdmin(UserAdmin):
    list_display = [
        "telegram_id",
        "first_name",
        "telegram_username",
        "date_joined",
        "last_activity",
        "is_active",
    ]
    search_fields = ["telegram_id", "first_name", "telegram_username"]
    fieldsets = UserAdmin.fieldsets + (
        ("Telegram", {"fields": ("telegram_id", "telegram_username", "last_activity")}),
    )
    readonly_fields = ["telegram_id", "telegram_username", "last_activity"]

    def get_readonly_fields(self, request, obj=None):
        fields = list(super().get_readonly_fields(request, obj))
        if not request.user.is_superuser:
            fields.extend(["is_staff", "is_superuser", "groups", "user_permissions", "username", "password"])
        return fields

    def get_queryset(self, request):
        rows = super().get_queryset(request)
        return rows if request.user.is_superuser else rows.filter(is_staff=False, is_superuser=False)

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        AuditEvent.objects.create(actor=request.user, action="admin.user.updated", object_id=str(obj.id))
        if not obj.is_active:
            obj.authsession_set.filter(revoked_at__isnull=True).update(revoked_at=timezone.now())

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Book)
class BookAdmin(admin.ModelAdmin):
    list_display = ["title", "owner", "status", "created_at", "deleted_at"]
    search_fields = ["title", "author", "owner__telegram_id"]
    list_filter = ["status", "deleted_at"]
    readonly_fields = ["owner", "created_at", "updated_at", "revision", "deleted_at", "purge_pending"]
    fields = [
        "title",
        "author",
        "owner",
        "status",
        "created_at",
        "updated_at",
        "revision",
        "deleted_at",
        "purge_pending",
    ]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        obj.revision += 1
        super().save_model(request, obj, form, change)
        from .api_helpers import changed

        changed(obj.owner, "book", obj.id)
        AuditEvent.objects.create(
            actor=request.user, action="admin.book.metadata.updated", object_id=str(obj.id)
        )


@admin.register(BookFile)
class FileAdmin(admin.ModelAdmin):
    list_display = ["id", "book", "size_bytes", "page_count", "processing_status", "error_code"]
    list_filter = ["processing_status"]
    fields = ["book", "size_bytes", "page_count", "processing_status", "error_code", "encrypted"]
    readonly_fields = fields

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(ProcessingJob)
class JobAdmin(admin.ModelAdmin):
    list_display = ["id", "book_file", "status", "attempts", "claimed_at"]
    list_filter = ["status"]
    readonly_fields = [field.name for field in ProcessingJob._meta.fields]
    actions = ["retry_failed"]

    @admin.action(description="Retry failed PDF processing", permissions=["change"])
    def retry_failed(self, request, queryset):
        for job in queryset.filter(status="error"):
            job.status = "pending"
            job.save(update_fields=["status"])
            job.book_file.processing_status = "processing"
            job.book_file.save(update_fields=["processing_status"])
            AuditEvent.objects.create(
                actor=request.user, action="admin.processing.retry", object_id=str(job.id)
            )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(SystemSettings)
class SystemAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return not SystemSettings.objects.exists() and super().has_add_permission(request)

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        AuditEvent.objects.create(actor=request.user, action="admin.system.updated", object_id="1")


@admin.register(AuditEvent)
class AuditAdmin(admin.ModelAdmin):
    list_display = ["created_at", "actor", "action", "object_id"]
    readonly_fields = [field.name for field in AuditEvent._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


admin.site.site_header = "Book App — Administration"
admin.site.site_title = "Book App"
