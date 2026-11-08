from django.contrib.admin.apps import AdminConfig


class BookAdminConfig(AdminConfig):
    default_site = "library.admin_site.BookAdminSite"
