"""Login by email OR handle (docs/accounts-spec.md §3).

``User.username`` holds the LOGIN: a handle (``greek101-smith``) for a
learning account, or the lowercased email for an account made with one — whose
``email`` field is set as well, so it can be reset by mail. One backend
therefore has to try both columns, case-insensitively, and never leak which of
the two matched.
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend
from django.db.models import Q


class EmailOrHandleBackend(ModelBackend):
    """``login`` (or DRF's ``username``) matched against handle then email."""

    def authenticate(self, request, username=None, password=None, **kwargs):
        User = get_user_model()
        login = username or kwargs.get("login") or kwargs.get(User.USERNAME_FIELD)
        if not login or password is None:
            return None
        login = login.strip()

        candidates = list(
            User.objects.filter(Q(username__iexact=login) | Q(email__iexact=login))
        )
        if not candidates:
            # Same work as a real check, so a missing account and a wrong
            # password cost the same time (ModelBackend's own defence).
            User().set_password(password)
            return None
        # A handle is the login of record: if one account owns this handle and
        # another merely has it as an email address, the handle wins.
        candidates.sort(key=lambda u: (u.username.lower() != login.lower(), u.pk))
        if len(candidates) > 1 and candidates[0].username.lower() != login.lower():
            # Two accounts share the address and neither owns it as a handle:
            # ambiguous, so nobody gets in by it.
            return None
        user = candidates[0]
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
