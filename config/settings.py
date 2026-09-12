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

# Login by email OR handle (docs/accounts-spec.md §3): `username` holds the
# handle for a learning account, or the lowercased email for an email account,
# so one backend has to try both columns. ModelBackend stays behind it for the
# Django admin's own username logins.
AUTHENTICATION_BACKENDS = [
    "da.auth_backends.EmailOrHandleBackend",
    "django.contrib.auth.backends.ModelBackend",
]

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

# e.g. "https://datool.fly.dev" — needed in production by the admin's login
# form AND by every mutating API call, since the SPA now signs in with a
# session and sends Django's CSRF token (docs/accounts-spec.md §3).
CSRF_TRUSTED_ORIGINS = [
    origin
    for origin in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",")
    if origin
]

if DEBUG:
    # The Vite dev server, which proxies /api here. Django compares the Origin
    # header against the Host it was reached on, and those two agree only while
    # the proxy forwards the browser's Host unchanged (Vite's default). Trust
    # the dev origins outright, so that a proxy configured with
    # `changeOrigin: true` — the usual Vite idiom, harmless in every other
    # respect — cannot turn every write in local development into an opaque
    # "Origin checking failed" 403.
    CSRF_TRUSTED_ORIGINS += [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    # Session cookies + CSRF, same origin (docs/accounts-spec.md §3). Every
    # endpoint needs a login unless it opts out explicitly (the handful in
    # da/api/auth.py: csrf bootstrap, register, login, password forgot/reset).
    # Our SessionAuthentication subclass answers 401 — not DRF's bare 403 —
    # when nobody is signed in, which is the signal the SPA redirects on.
    "DEFAULT_AUTHENTICATION_CLASSES": ["da.api.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    # One error shape for the whole API: {"errors": [str, ...]}, DRF's own
    # failures (401/403/404/405/throttle) included.
    "EXCEPTION_HANDLER": "da.api.errors.exception_handler",
    # Rate limits (da/api/throttles.py) on the endpoints a stranger can hammer:
    # the two that send mail to an address the caller chose (invitations, the
    # forgot-password form — per caller AND per target), the two that check a
    # submitted password (login — per client address AND per account — and
    # password change), and registration, which refills every per-caller
    # allowance. A class of thirty is a normal day's provisioning; ten wrong
    # passwords a minute is a person, not a script.
    "DEFAULT_THROTTLE_RATES": {
        "invitations": os.environ.get("DATOOL_INVITE_RATE", "40/day"),
        "login": os.environ.get("DATOOL_LOGIN_RATE", "10/min"),
        "register": os.environ.get("DATOOL_REGISTER_RATE", "5/min"),
        "password_reset": os.environ.get("DATOOL_PASSWORD_RESET_RATE", "5/min"),
        "password_change": os.environ.get("DATOOL_PASSWORD_CHANGE_RATE", "10/min"),
    },
}

# ---------------------------------------------------------------------------
# Sessions and cookies (docs/accounts-spec.md §3)
# ---------------------------------------------------------------------------

#: Two weeks, renewed on every request — a class period should never log a
#: student out mid-analysis.
SESSION_COOKIE_AGE = 60 * 60 * 24 * 14
SESSION_SAVE_EVERY_REQUEST = True

SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_HTTPONLY = True
# The SPA READS the CSRF cookie to send X-CSRFToken, so this one cannot be
# HttpOnly — that is Django's documented arrangement, not a weakening.
CSRF_COOKIE_HTTPONLY = False
# Secure cookies everywhere but local development (http://localhost).
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

# ---------------------------------------------------------------------------
# Outgoing mail — invitations and password resets (docs/accounts-spec.md §3)
# ---------------------------------------------------------------------------

#: Where the links in those mails point. Same-origin in production (the SPA is
#: served by this app); the Vite dev server in local development.
FRONTEND_ORIGIN = os.environ.get(
    "FRONTEND_ORIGIN",
    "http://localhost:5173" if DEBUG else "https://datool.fly.dev",
)

DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "datool <no-reply@datool.local>")

if DEBUG:
    # Dev/test: mail is printed to the Django log, so an invitation link is
    # always reachable without an SMTP provider.
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
else:
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
    EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
    EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
    EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
    EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "1") == "1"
    # Until an SMTP host is configured, sending fails and the API hands the
    # link back to the admin who provisioned the account (§3, §10.1) — nothing
    # blocks on the analyst choosing a provider.

# Vite dev server during local development.
CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
