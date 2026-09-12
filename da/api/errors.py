"""One error shape for the whole API: ``{"errors": [str, ...]}``.

The views have always answered 400 that way (da/views.py). DRF's own failures
— 401, 403, 404, 405, throttling — answered ``{"detail": "..."}`` instead, so
the SPA had nothing to show for them. This handler flattens whatever DRF
produced into the project's list of strings.
"""

from rest_framework.views import exception_handler as drf_exception_handler


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:  # not an API exception: let it 500 loudly
        return None
    response.data = {"errors": flatten(response.data)}
    return response


def flatten(data) -> list[str]:
    """Every message inside a DRF error body, as plain strings."""
    if isinstance(data, dict):
        if isinstance(data.get("errors"), list):  # already ours
            return [str(item) for item in data["errors"]]
        messages: list[str] = []
        for field, value in data.items():
            for message in flatten(value):
                messages.append(
                    message if field == "detail" else f"{field}: {message}"
                )
        return messages
    if isinstance(data, (list, tuple)):
        return [message for item in data for message in flatten(item)]
    return [str(data)]
