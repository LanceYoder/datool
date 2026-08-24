from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404
from django.urls import include, path, re_path
from django.views.decorators.cache import never_cache


@never_cache
def spa_index(request, unused_path=""):
    """The built frontend's entry point, for client-side routes (/analysis/3).

    WhiteNoise serves the build's real files (/, /assets/*); this catch-all
    covers the paths the React router owns. 404s cleanly when the frontend
    has not been built (local dev uses the Vite server instead).
    """
    try:
        return FileResponse(
            open(settings.FRONTEND_DIST / "index.html", "rb"),
            content_type="text/html",
        )
    except FileNotFoundError:
        raise Http404("frontend build not found — run `npm run build` in frontend/")


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("da.urls")),
    re_path(r"^(?!api/|admin/|assets/|static/).*$", spa_index),
]
