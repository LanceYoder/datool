"""Session authentication that says 401 when nobody is signed in.

DRF's own SessionAuthentication declares no ``WWW-Authenticate`` header, so
its NotAuthenticated comes back as 403 — indistinguishable from "signed in,
but not allowed". The SPA needs to tell those apart: 401 means *log in again*
(docs/accounts-spec.md §8), 403 means *this is not yours*.

CSRF enforcement is unchanged and still Django's: DRF checks the token on
every mutating request that carries a session.
"""

from rest_framework.authentication import SessionAuthentication as DrfSessionAuthentication


class SessionAuthentication(DrfSessionAuthentication):
    def authenticate_header(self, request):  # noqa: D102 - see module docstring
        return "Session"
