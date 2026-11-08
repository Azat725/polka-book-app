from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from library.models import AuditEvent, SystemSettings

ROLE_PERMISSIONS = {
    "Support": {"view_user", "change_user", "view_book"},
    "Operator": {"view_book", "view_processingjob", "change_processingjob", "view_auditevent"},
    "Admin": {
        "view_user",
        "change_user",
        "view_book",
        "change_book",
        "view_processingjob",
        "change_processingjob",
        "view_systemsettings",
        "change_systemsettings",
        "view_auditevent",
    },
}


class Command(BaseCommand):
    help = "Create least-privilege admin groups without passwords, staff grants or private file access."

    @transaction.atomic
    def handle(self, *args, **options):
        SystemSettings.objects.get_or_create(pk=1)
        for name, codes in ROLE_PERMISSIONS.items():
            permissions = Permission.objects.filter(content_type__app_label="library", codename__in=codes)
            if permissions.count() != len(codes):
                raise CommandError("Run database migrations before creating administrator groups.")
            group, _ = Group.objects.get_or_create(name=name)
            before = set(group.permissions.values_list("id", flat=True))
            after = set(permissions.values_list("id", flat=True))
            group.permissions.set(permissions)
            if before != after:
                AuditEvent.objects.create(action="admin.role.configured", object_id=str(group.pk))
        self.stdout.write(self.style.SUCCESS("Support, Operator and Admin permission groups are ready."))
