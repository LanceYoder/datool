"""Django settings for datool."""

import os
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "django-insecure-change-me-in-production")

DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"

ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost").split(",")

# Crossway ESV API key (https://api.esv.org) — enables ?translation=esv on
# the corpus verses endpoint. The committed default is the project's key
# (non-commercial terms); the env var overrides it, and if the key is ever
# revoked, regenerate at api.esv.org. Empty disables the ESV source.
ESV_API_KEY = os.environ.get(
    "ESV_API_KEY", "fe97933ef980de124f27b27f560cdc376782ed30"
)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "da",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# DATABASE_URL (e.g. postgres://…@localhost:5432/datool via docker-compose, or the
# Supabase connection string in production). Falls back to SQLite so a fresh checkout
# runs with zero configuration.
DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_ROOT = BASE_DIR / "staticfiles"
STATIC_URL = "/static/"
# WhiteNoise warns on every request when STATIC_ROOT is absent (it only
# exists after collectstatic, i.e. in the deployment image) — keep dev quiet.
STATIC_ROOT.mkdir(exist_ok=True)

# Single-app deployment (docs/DEPLOY.md): WhiteNoise serves the BUILT frontend
# at the URL root — /index.html, /assets/* — from the same origin as the API,
# and config.urls adds the SPA catch-all for client-side routes. In local dev
# the Vite server (:5173) is used instead and none of this is exercised.
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
WHITENOISE_ROOT = FRONTEND_DIST if FRONTEND_DIST.exists() else None
WHITENOISE_INDEX_FILE = True

# e.g. "https://datool.fly.dev" — needed by the admin's login form in
# production; the JSON API itself is CSRF-exempt (no session auth).
CSRF_TRUSTED_ORIGINS = [
    origin
    for origin in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",")
    if origin
]

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    # v1 runs in single-user local mode; auth switches on at first deployment.
    # No authentication classes: SessionAuthentication would demand CSRF tokens
    # on every POST, which is pure friction with no login concept.
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "UNAUTHENTICATED_USER": None,
}

# Vite dev server during local development.
CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
