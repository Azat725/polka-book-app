from datetime import timedelta

from django.contrib.admin import AdminSite
from django.db.models import Sum
from django.utils import timezone


class BookAdminSite(AdminSite):
    site_header = "Book App — Administration"
    site_title = "Book App"
    index_template = "admin/book_index.html"

    def index(self, request, extra_context=None):
        from .models import Book, BookFile, ProcessingJob, User

        context = dict(extra_context or {})
        context["system_statistics"] = {
            "users": User.objects.filter(telegram_id__isnull=False).count(),
            "active_users_7d": User.objects.filter(
                is_active=True, last_activity__gte=timezone.now() - timedelta(days=7)
            ).count(),
            "books": Book.objects.count(),
            "storage_bytes": BookFile.objects.aggregate(total=Sum("size_bytes"))["total"] or 0,
            "failed_jobs": ProcessingJob.objects.filter(status="error").count(),
        }
        return super().index(request, extra_context=context)
