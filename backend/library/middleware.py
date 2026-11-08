class ApiPathMiddleware:
    """Accept both API spellings without redirects or replaying mutating requests."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path_info.startswith("/api/") and request.path_info.endswith("/"):
            request.path_info = request.path_info.rstrip("/")
        if request.path_info.startswith("/api/v1/"):
            from django.core.cache import cache
            from django.http import JsonResponse

            from .models import SystemSettings

            maintenance = cache.get_or_set(
                SystemSettings.MAINTENANCE_CACHE_KEY,
                lambda: SystemSettings.objects.filter(maintenance_mode=True).exists(),
                timeout=5,
            )
            if maintenance:
                return JsonResponse(
                    {
                        "error": {
                            "code": "maintenance",
                            "message": "Service is temporarily unavailable.",
                            "details": {},
                        }
                    },
                    status=503,
                )
        response = self.get_response(request)
        if request.path_info.startswith("/api/"):
            response["Cache-Control"] = "private, no-store"
        return response
