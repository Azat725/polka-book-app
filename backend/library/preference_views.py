from django.db import transaction
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .api_helpers import changed
from .errors import ApiError
from .models import SyncChange, ThemePreset, UserSettings
from .preferences import user_settings, validate_settings
from .serializers import ThemePresetSerializer


class Settings(APIView):
    def get(self, request):
        return Response(user_settings(request.user))

    @transaction.atomic
    def patch(self, request):
        UserSettings.objects.get_or_create(user=request.user)
        row = UserSettings.objects.select_for_update().get(user=request.user)
        revision = request.data.get("revision")
        if revision is not None and revision != row.revision:
            raise ApiError(
                "settings_conflict",
                "Settings changed on another device.",
                409,
                {"current": user_settings(request.user)},
            )
        values = validate_settings(request.data)
        row.values = {**row.values, **values}
        row.revision += 1
        row.save(update_fields=["values", "revision"])
        changed(request.user, "settings", request.user.id)
        return Response(user_settings(request.user))


class ThemePresetViewSet(viewsets.ModelViewSet):
    serializer_class = ThemePresetSerializer
    pagination_class = None
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return ThemePreset.objects.filter(owner=self.request.user).order_by("name", "id")

    def list(self, request):
        return Response({"results": self.get_serializer(self.get_queryset(), many=True).data, "next": None})

    def perform_create(self, serializer):
        row = serializer.save(owner=self.request.user)
        changed(self.request.user, "theme_preset", row.id)

    def perform_update(self, serializer):
        row = serializer.save()
        changed(self.request.user, "theme_preset", row.id)

    def perform_destroy(self, instance):
        changed(self.request.user, "theme_preset", instance.id, deleted=True)
        instance.delete()


class Changes(APIView):
    def get(self, request):
        try:
            cursor = int(request.query_params.get("cursor", "0"))
            if cursor < 0:
                raise ValueError
        except ValueError:
            raise ValidationError({"cursor": "Nonnegative cursor required."}) from None
        rows = list(SyncChange.objects.filter(owner=request.user, id__gt=cursor).order_by("id")[:201])
        selected = rows[:200]
        return Response(
            {
                "results": [
                    {"cursor": row.id, "entity": row.entity, "id": str(row.object_id), "deleted": row.deleted}
                    for row in selected
                ],
                "cursor": selected[-1].id if selected else cursor,
                "has_more": len(rows) > 200,
            }
        )
