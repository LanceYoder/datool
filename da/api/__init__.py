"""The accounts half of the HTTP API (docs/accounts-spec.md §6).

Split by subject, because these endpoints have little to do with each other:

* :mod:`da.api.auth` — the public edge: CSRF bootstrap, register, login,
  logout, me, the three password endpoints.
* :mod:`da.api.orgs` — organizations, membership, provisioning, policies, and
  a professor's window onto one student's analyses.
* :mod:`da.api.permissions` — the role checks those views hang off.
* :mod:`da.api.shapes` — the wire JSON (camelCase, like da/serializers.py).
* :mod:`da.api.mail` — invitation and reset mail, and the links inside them.
* :mod:`da.api.authentication` / :mod:`da.api.errors` — the two DRF defaults
  the project overrides.

The analysis and corpus endpoints stay in :mod:`da.views`, where they have
always lived; accounts added ownership to them, not a new home.
"""
