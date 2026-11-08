from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .api_helpers import profile, statistics
from .authentication import refresh_session, telegram_login
from .preferences import user_settings


class TelegramLogin(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def get_authenticate_header(self, request):
        return "Bearer"

    def post(self, request):
        user, tokens = telegram_login(request.data.get("init_data"))
        return Response({**tokens, "user": profile(user), "settings": user_settings(user)})


class Refresh(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def get_authenticate_header(self, request):
        return "Bearer"

    def post(self, request):
        return Response(refresh_session(request.data.get("refresh_token")))


class Logout(APIView):
    def post(self, request):
        request.auth.revoked_at = timezone.now()
        request.auth.save(update_fields=["revoked_at"])
        return Response(status=204)


class Me(APIView):
    def get(self, request):
        return Response(
            {
                "user": profile(request.user),
                "settings": user_settings(request.user),
                "statistics": statistics(request.user),
            }
        )


class Statistics(APIView):
    def get(self, request):
        return Response(statistics(request.user))
