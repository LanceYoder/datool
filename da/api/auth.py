"""The public edge of the API (docs/accounts-spec.md §3, §6).

Register, log in, log out, who am I, and the three password endpoints. The
public ones declare ``authentication_classes = []`` as well as ``AllowAny``:
without it DRF's SessionAuthentication would demand a CSRF token from a
visitor who has not been given one yet.

Errors keep the project's shape — ``{"errors": [str, ...]}`` — including the
password validators', which is what the register and reset forms show.
"""

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.utils.decorators import method_decorator
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .mail import reset_link, send_password_reset
from .shapes import me_json
from .throttles import (
    LoginByAccountThrottle,
    LoginByAddressThrottle,
    PasswordChangeThrottle,
    PasswordForgotByAddressThrottle,
    PasswordForgotByTargetThrottle,
    RegisterThrottle,
)

#: The backend a freshly created user is logged in with — login() cannot guess
#: when the user did not come back from authenticate().
LOGIN_BACKEND = "da.auth_backends.EmailBackend"

User = get_user_model()


def errors(problems: list[str], code: int = status.HTTP_400_BAD_REQUEST) -> Response:
    return Response({"errors": problems}, status=code)


def body(request) -> dict:
    return request.data if isinstance(request.data, dict) else {}


#: The column limits an address must fit. An account's address is ALSO its
#: login (``username`` holds it lowercased), so it has to fit the narrower of
#: the two columns — and it has to be refused here, in the project's error
#: shape, rather than 500 on PostgreSQL and silently corrupt on SQLite (which
#: ignores varchar limits).
USERNAME_MAX = User._meta.get_field("username").max_length
EMAIL_MAX = User._meta.get_field("email").max_length
ADDRESS_MAX = min(USERNAME_MAX, EMAIL_MAX)


def clean_email(raw) -> str:
    """A normalized address, or "" — the caller decides whether that is fatal."""
    if not isinstance(raw, str):
        return ""
    email = raw.strip()
    if not email:
        return ""
    validate_email(email)  # raises ValidationError
    return User.objects.normalize_email(email)


def email_taken(email: str) -> bool:
    """An address already in use — as somebody's address OR somebody's login,
    since an account's login IS its address."""
    return (
        User.objects.filter(email__iexact=email).exists()
        or User.objects.filter(username__iexact=email).exists()
    )


def check_password_strength(password, user=None) -> list[str]:
    """The configured validators' complaints, in the project's error shape."""
    if not isinstance(password, str) or not password:
        return ["password must be a non-empty string"]
    try:
        validate_password(password, user)
    except ValidationError as e:
        return list(e.messages)
    return []


def set_name(user, name) -> None:
    """The whole display name lives in ``first_name``: this app asks for one
    name field, and splitting it on a space would mangle half the world's."""
    user.first_name = (name or "").strip()[:150]


class CsrfMixin:
    """A public endpoint: no session is required, so no CSRF token is either."""

    authentication_classes: list = []
    permission_classes = [AllowAny]


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(CsrfMixin, APIView):
    """``GET /api/auth/csrf`` — the SPA's one bootstrap call: it sets the
    csrftoken cookie the app then echoes in ``X-CSRFToken``."""

    def get(self, request):
        return Response({"ok": True})


class RegisterView(CsrfMixin, APIView):
    """``POST /api/auth/register`` — self-registration makes an INDIVIDUAL
    account (§2): an email login, no organization, no policy."""

    throttle_classes = [RegisterThrottle]

    def post(self, request):
        payload = body(request)
        try:
            email = clean_email(payload.get("email"))
        except ValidationError:
            return errors(["that does not look like an email address"])
        if not email:
            return errors(["email is required"])
        if len(email) > ADDRESS_MAX:
            return errors([f"an email address may be at most {ADDRESS_MAX} characters"])
        if email_taken(email):
            return errors(["an account with that email already exists"])

        password = payload.get("password")
        name = payload.get("name")
        if name is not None and not isinstance(name, str):
            return errors(["name must be a string"])
        candidate = User(username=email.lower(), email=email)
        set_name(candidate, name)
        problems = check_password_strength(password, candidate)
        if problems:
            return errors(problems)

        candidate.set_password(password)
        candidate.save()
        login(request, candidate, backend=LOGIN_BACKEND)
        return Response(me_json(candidate), status=status.HTTP_201_CREATED)


class LoginView(CsrfMixin, APIView):
    """``POST /api/auth/login {email, password}`` — whether the address is
    known is never disclosed. Every attempt counts against the rate, right or
    wrong: the bucket is what stands between a classroom's passwords and a
    script."""

    throttle_classes = [LoginByAddressThrottle, LoginByAccountThrottle]

    def post(self, request):
        payload = body(request)
        email = payload.get("email")
        password = payload.get("password")
        if not isinstance(email, str) or not email.strip():
            return errors(["email is required"])
        if not isinstance(password, str) or not password:
            return errors(["password is required"])
        user = authenticate(request, username=email.strip(), password=password)
        if user is None:
            return errors(
                ["that email and password do not match an account"],
                status.HTTP_400_BAD_REQUEST,
            )
        login(request, user)
        return Response(me_json(user))


class LogoutView(APIView):
    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    """``GET /api/auth/me`` — the session, memberships and effective policy.

    PATCH is beyond §6 and deliberately small: the /account page lets a person
    fix their own display name, and nothing else about themselves.
    """

    def get(self, request):
        return Response(me_json(request.user))

    def patch(self, request):
        payload = body(request)
        if "name" in payload:
            if not isinstance(payload["name"], str):
                return errors(["name must be a string"])
            set_name(request.user, payload["name"])
            request.user.save(update_fields=["first_name"])
        return Response(me_json(request.user))


class PasswordForgotView(CsrfMixin, APIView):
    """``POST /api/auth/password/forgot {email}`` — ALWAYS 200, so the form
    cannot be used to discover who holds an account. Rated per client address
    and per target inbox; a 429 is about the request, never the account."""

    throttle_classes = [PasswordForgotByAddressThrottle, PasswordForgotByTargetThrottle]

    def post(self, request):
        raw = body(request).get("email")
        try:
            email = clean_email(raw)
        except ValidationError:
            email = ""
        if email:
            for user in User.objects.filter(email__iexact=email, is_active=True):
                send_password_reset(user, reset_link(user))
        return Response({"ok": True})


class PasswordResetView(CsrfMixin, APIView):
    """``POST /api/auth/password/reset {uid, token, password}`` — the end of
    both flows, a forgotten password and an invitation."""

    def post(self, request):
        payload = body(request)
        user = _user_from_uid(payload.get("uid"))
        token = payload.get("token")
        if (
            user is None
            # A disabled account's outstanding token is a dead letter, exactly
            # as Django's own PasswordResetForm treats it (and as the forgot
            # endpoint above already does): a token minted before the account
            # was switched off must not be a way back in.
            or not user.is_active
            or not isinstance(token, str)
            or not default_token_generator.check_token(user, token)
        ):
            return errors(["that reset link is invalid or has expired"])
        problems = check_password_strength(payload.get("password"), user)
        if problems:
            return errors(problems)
        user.set_password(payload["password"])
        user.save(update_fields=["password"])
        return Response({"ok": True})


class PasswordChangeView(APIView):
    """``POST /api/auth/password/change {current, password}`` — signed in.
    The current-password check is a password check, so it is rated too."""

    throttle_classes = [PasswordChangeThrottle]

    def post(self, request):
        payload = body(request)
        current = payload.get("current")
        if not isinstance(current, str) or not request.user.check_password(current):
            return errors(["your current password is not right"])
        problems = check_password_strength(payload.get("password"), request.user)
        if problems:
            return errors(problems)
        request.user.set_password(payload["password"])
        request.user.save(update_fields=["password"])
        # Changing a password rotates the session hash; without this the user
        # who just changed it would be logged out by their own success.
        from django.contrib.auth import update_session_auth_hash

        update_session_auth_hash(request, request.user)
        return Response({"ok": True})


def _user_from_uid(uid):
    if not isinstance(uid, str):
        return None
    try:
        return User.objects.get(pk=force_str(urlsafe_base64_decode(uid)))
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        return None
