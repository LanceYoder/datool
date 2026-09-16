"""Rate limits on the endpoints an anonymous stranger can hammer.

Two kinds of abuse, one mechanism:

* MAIL. Provisioning by email (§6) and the forgot-password form both make
  this app send a message, from its own domain, to an address the sender
  chose. That is a useful feature and a spam channel wearing the same coat,
  and the only thing that separates them is volume. So each is limited per
  CALLER (or per client address when there is no caller) AND per TARGET
  address — without the second, a hundred accounts could each mail the same
  person their allowance.
* GUESSING. Login and password-change are the two places a password is
  checked against a submitted string, and a classroom full of first
  passwords is exactly what online guessing suits. Login is limited per
  client address AND per submitted email, so one attacker cannot
  spread guesses over many accounts nor one account be attacked from many
  addresses. Registration is limited per client address, because every new
  account refills every per-caller allowance.

The rates live in ``settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]`` (env-
tunable), and DRF's ``Throttled`` renders through the project's exception
handler in the usual ``{"errors": [...]}`` shape. Targets are hashed before
they become cache keys: the cache is shared and there is no reason to write
somebody's email into it.
"""

from __future__ import annotations

import hashlib

from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle


def _digest(value: str) -> str:
    return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()[:32]


def _submitted(request, field: str) -> str | None:
    data = request.data if isinstance(request.data, dict) else {}
    raw = data.get(field)
    if not isinstance(raw, str) or not raw.strip():
        return None
    return raw


class ScopedRate(SimpleRateThrottle):
    """A throttle whose rate is read from settings when it is CONSTRUCTED.

    DRF binds ``THROTTLE_RATES`` to the settings dict at import time, so a
    deployment that tunes the rate — or a test that lowers it to something it
    can reach — would otherwise be ignored.
    """

    def get_rate(self):
        rates = getattr(settings, "REST_FRAMEWORK", {}).get(
            "DEFAULT_THROTTLE_RATES", {}
        )
        return rates.get(self.scope) or super().get_rate()


class InvitationThrottle(ScopedRate):
    """Per CALLER: how many invitation mails one account may cause."""

    scope = "invitations"

    def get_cache_key(self, request, view):
        if not request.user.is_authenticated:
            return None
        return f"invite-from-{request.user.pk}"


class InvitationTargetThrottle(ScopedRate):
    """Per TARGET ADDRESS, across every caller."""

    scope = "invitations"

    def get_cache_key(self, request, view):
        raw = _submitted(request, "email")
        return None if raw is None else f"invite-to-{_digest(raw)}"


class LoginByAddressThrottle(ScopedRate):
    """Per client address: how fast one place may try passwords at all."""

    scope = "login"

    def get_cache_key(self, request, view):
        return f"login-from-{self.get_ident(request)}"


class LoginByAccountThrottle(ScopedRate):
    """Per submitted email: how fast one account may be guessed at, from
    anywhere. The address is hashed like every other target."""

    scope = "login"

    def get_cache_key(self, request, view):
        raw = _submitted(request, "email")
        return None if raw is None else f"login-for-{_digest(raw)}"


class RegisterThrottle(ScopedRate):
    """Per client address: new accounts are how per-caller allowances get
    refilled, so making them is itself rated."""

    scope = "register"

    def get_cache_key(self, request, view):
        return f"register-from-{self.get_ident(request)}"


class PasswordForgotByAddressThrottle(ScopedRate):
    """Per client address, for the forgot-password form."""

    scope = "password_reset"

    def get_cache_key(self, request, view):
        return f"forgot-from-{self.get_ident(request)}"


class PasswordForgotByTargetThrottle(ScopedRate):
    """Per TARGET inbox, across every caller: nobody's mailbox can be flooded
    from many addresses. The limit is on the REQUEST, not on the outcome, so
    a throttled answer says nothing about whether the account exists."""

    scope = "password_reset"

    def get_cache_key(self, request, view):
        raw = _submitted(request, "email")
        return None if raw is None else f"forgot-to-{_digest(raw)}"


class PasswordChangeThrottle(ScopedRate):
    """Per signed-in user: the current-password check is a password check."""

    scope = "password_change"

    def get_cache_key(self, request, view):
        if not request.user.is_authenticated:
            return None
        return f"password-change-{request.user.pk}"
