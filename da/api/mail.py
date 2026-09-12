"""Invitation and password-reset mail, and the links inside it (§3).

Both mails carry the SAME thing: a Django password-reset token, aimed at the
SPA's ``/reset-password/<uid>/<token>`` route. An invitation is a reset that
has never been set.

Nothing here raises. When mail cannot go out — no SMTP provider configured
yet, the account has no address — the caller is told so and hands the link (or
a temporary password) to the admin who provisioned the account, which is what
§3 and §10.1 ask for: an unconfigured mailer must never block provisioning.
"""

from __future__ import annotations

import logging
import secrets

from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

log = logging.getLogger(__name__)

#: Characters for a generated temporary password: no l/1/O/0, because these
#: get read aloud and written on whiteboards.
_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def temporary_password(length: int = 12) -> str:
    """A password an admin can hand to a student out loud."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def frontend_url(path: str) -> str:
    """``path`` on the SPA (``settings.FRONTEND_ORIGIN``)."""
    return f"{settings.FRONTEND_ORIGIN.rstrip('/')}{path}"


def reset_link(user) -> str:
    """The set-a-password link for ``user`` — the same token flow for an
    invitation and for "I forgot my password"."""
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return frontend_url(f"/reset-password/{uid}/{token}")


def _send(user, subject: str, body: str) -> bool:
    """True when the mail went out; False (logged, never raised) when it could
    not — no address, or no working mail backend."""
    if not user.email:
        return False
    try:
        sent = send_mail(
            subject,
            body,
            settings.DEFAULT_FROM_EMAIL,
            [user.email],
            fail_silently=False,
        )
    except Exception:  # noqa: BLE001 - any mailer failure is the same answer
        log.exception("could not send %r to %s", subject, user.email)
        return False
    return bool(sent)


#: How much of an organization's name any mail will repeat. Everything
#: interpolated into a message this app sends to a stranger is written by
#: whoever asked for it, so it is truncated to a length that cannot be used to
#: compose a page of prose in datool's voice.
NAME_LIMIT = 80


def _short(text: str, limit: int = NAME_LIMIT) -> str:
    """One line, no longer than ``limit`` — never a newline (a header would
    take it) and never a paragraph of an attacker's choosing."""
    flat = " ".join(str(text or "").split())
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


def send_invitation(user, link: str, *, organization_name: str) -> bool:
    """"An account was made for you — set your password."

    The INVITER is deliberately not named. This mail leaves the app's own
    domain for an address nobody has verified, and every word an attacker
    could choose in it is a word they can put in datool's mouth; the
    organization's name is the one variable worth carrying, and it is cut to
    :data:`NAME_LIMIT`.
    """
    name = (user.get_full_name() or "").strip() or user.username
    organization = _short(organization_name)
    return _send(
        user,
        f"Your datool account for {organization}",
        f"Hello {name},\n\n"
        f"An account has been created for you in {organization} on datool.\n\n"
        f"Set your password to get started:\n\n{link}\n\n"
        f"Your login is {user.email or user.username}.\n\n"
        "If you were not expecting this, you can ignore this message — the "
        "account cannot be used until a password is set.\n",
    )


def send_org_invitation(user, *, organization_name: str) -> bool:
    """"You have been invited to join an organization" — for an address that
    ALREADY has an account.

    It carries no token and no link into the account: the person already has
    one, and nothing about it changes until they sign in as themselves and
    accept. That is the whole difference between joining and being taken over.
    """
    name = (user.get_full_name() or "").strip() or user.username
    organization = _short(organization_name)
    return _send(
        user,
        f"An invitation to join {organization} on datool",
        f"Hello {name},\n\n"
        f"You have been invited to join {organization} on datool.\n\n"
        f"Nothing has changed about your account. Sign in as usual and the "
        f"invitation is waiting on your account page:\n\n"
        f"{frontend_url('/account')}\n\n"
        "If you were not expecting this, ignore this message — an invitation "
        "you never accept does nothing.\n",
    )


def send_password_reset(user, link: str) -> bool:
    """The "I forgot my password" mail, and an admin-triggered reset."""
    name = (user.get_full_name() or "").strip() or user.username
    return _send(
        user,
        "Reset your datool password",
        f"Hello {name},\n\n"
        f"Someone asked to reset the password for your datool account.\n\n"
        f"Choose a new one here:\n\n{link}\n\n"
        "If it was not you, nothing has changed and you can ignore this "
        "message.\n",
    )
