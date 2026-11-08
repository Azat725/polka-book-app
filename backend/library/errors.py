import uuid

from rest_framework.exceptions import APIException
from rest_framework.views import exception_handler as default_handler


class ApiError(APIException):
    def __init__(self, code, message, status=400, details=None):
        self.status_code = status
        self.detail = {"code": code, "message": message, "details": details or {}}


def exception_handler(exc, context):
    response = default_handler(exc, context)
    if response is None:
        return None
    if isinstance(response.data, dict) and "code" in response.data and "message" in response.data:
        error = response.data
    else:
        error = {
            "code": getattr(exc, "default_code", "validation_error"),
            "message": "Request could not be completed.",
            "details": response.data,
        }
    response.data = {"error": {**error, "request_id": str(uuid.uuid4())}}
    response["Cache-Control"] = "no-store"
    return response
