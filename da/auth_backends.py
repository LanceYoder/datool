"""Login by email (docs/accounts-spec.md §3).

Every account is made with an email address and signs in with it (ruled
2026-09-16). ``User.username`` holds the lowercased address — the login of
record — and ``email`` holds it as typed, so the match below is on the
``email`` column, case-insensitively, and never on anything else.
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend


class EmailBackend(ModelBackend):
    """``email`` (or DRF's ``username``) matched against ``email__iexact``."""

    def authenticate(self, request, username=None, password=None, **kwargs):
        User = get_user_model()
        email = username or kwargs.get("email") or kwargs.get(User.USERNAME_FIELD)
        if not email or password is None:
            return None
        email = email.strip()

        candidates = list(User.objects.filter(email__iexact=email))
        if not candidates:
            # Same work as a real check, so a missing account and a wrong
            # password cost the same time (ModelBackend's own defence).
            User().set_password(password)
            return None
        if len(candidates) > 1:
            # Two accounts share the address: ambiguous, so nobody gets in
            # by it.
            return None
        user = candidates[0]
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
