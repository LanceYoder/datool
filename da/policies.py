"""The teaching policy — one place (docs/accounts-spec.md §4, §5).

A policy is a JSON object with a FIXED key set: unknown keys are rejected on
the way in, so a typo in the professor's UI can never become a silently
ignored rule. The default is EVERYTHING ALLOWED — an individual account's
experience — and a professor takes things away from it.

What a professor may take away is SMALL, by ruling (2026-09-12): which
first-pass tiers a student may start from, and which reading aids they see.
The gestures themselves — making, deleting and relabeling relationships,
clearing the tree, splitting and merging propositions, color blocks, the text
flow, notes — are always available to every account. They were policy keys
in the first build; :data:`RETIRED_GROUPS` names them so a stale client
sending one gets a reason rather than "unknown key", and migration 0005
stripped them from what was stored.

Three jobs live here and nowhere else:

* :data:`DEFAULT_POLICY` — the shape and the permissive baseline.
* :func:`validate_policy` — the gate on every write (professor default and
  per-student override alike).
* :func:`effective_policy` — the ONE resolution rule (professor default ⊕
  per-student override, override keys win), used by ``GET /api/auth/me`` and
  by every server-side enforcement point.

A policy is stored as the full object; an OVERRIDE is stored partial (only the
keys the professor pinned for that student), which is what makes the UI's
"uses your default" state representable.
"""

from __future__ import annotations

import copy

#: The first-pass tiers, most to least help. ``none`` is the new one: every
#: proposition a root, no relationships proposed.
TIERS = ("none", "minimal", "full")

#: ``maximal`` was the pre-tier boolean's name for the full analysis and stays
#: accepted on the wire as a deprecated alias (§6).
TIER_ALIASES = {"maximal": "full"}

#: group → the boolean keys it may carry. ``firstPass`` is handled apart: its
#: one key is a list of tiers, not a switch.
BOOLEAN_KEYS: dict[str, tuple[str, ...]] = {
    "aids": ("english", "verses", "verbs", "colorCoding"),
}

#: Everything allowed. Also the exact shape of a stored policy.
DEFAULT_POLICY: dict = {
    "firstPass": {"allowed": list(TIERS)},
    "aids": {"english": True, "verses": True, "verbs": True, "colorCoding": True},
}

GROUPS = tuple(DEFAULT_POLICY)

#: Groups the first build let a professor switch off and the analyst ruled
#: are not theirs to switch: these are always available. Refused with a
#: reason on the way in (a stale tab, an old bookmarked body), dropped on the
#: way out of storage (``merge_policy`` reads defensively anyway).
RETIRED_GROUPS = ("tree", "split", "sections", "textFlow", "notes")


#: How many problems one refusal reports. A policy has a few dozen keys, so a
#: longer list is not a professor being told what to fix — it is a small
#: request buying a large answer, and the rest is summarized instead.
MAX_PROBLEMS = 20


class PolicyError(ValueError):
    """Every problem with a submitted policy at once, like DocumentError —
    capped at :data:`MAX_PROBLEMS`, with the remainder counted."""

    def __init__(self, problems: list[str]):
        problems = list(problems)
        if len(problems) > MAX_PROBLEMS:
            rest = len(problems) - MAX_PROBLEMS
            problems = problems[:MAX_PROBLEMS] + [f"…and {rest} more problems"]
        self.problems = problems
        super().__init__("; ".join(self.problems))


def default_policy() -> dict:
    """A fresh copy of the permissive default (the model field's default)."""
    return copy.deepcopy(DEFAULT_POLICY)


def normalize_tier(raw) -> str:
    """``'maximal'`` → ``'full'``; anything not a tier raises PolicyError."""
    if not isinstance(raw, str):
        raise PolicyError([f"tier must be one of {', '.join(TIERS)}"])
    tier = TIER_ALIASES.get(raw.strip().lower(), raw.strip().lower())
    if tier not in TIERS:
        raise PolicyError([f"tier must be one of {', '.join(TIERS)}"])
    return tier


def validate_policy(policy, *, partial: bool = False) -> dict:
    """Check a submitted policy and return it normalized.

    ``partial=False`` (a professor's default) fills every missing key from
    :data:`DEFAULT_POLICY`, so what is stored is always the whole object.
    ``partial=True`` (a per-student override) keeps ONLY the keys given —
    the rest of the student's rules come from the professor's default.

    Raises :class:`PolicyError` listing every problem found.
    """
    problems: list[str] = []
    if not isinstance(policy, dict):
        raise PolicyError(["policy must be an object"])

    out: dict = {} if partial else default_policy()

    for group, value in policy.items():
        # Nothing is learned from the twenty-first problem, and a body of ten
        # thousand unknown keys must not buy ten thousand error strings.
        if len(problems) > MAX_PROBLEMS:
            break
        if group in RETIRED_GROUPS:
            problems.append(
                f"{group} is no longer a class rule — it is always available"
            )
            continue
        if group not in GROUPS:
            problems.append(f"unknown policy key {group!r}")
            continue
        if not isinstance(value, dict):
            problems.append(f"{group} must be an object")
            continue
        allowed_keys = ("allowed",) if group == "firstPass" else BOOLEAN_KEYS[group]
        for key, setting in value.items():
            if len(problems) > MAX_PROBLEMS:
                break
            if key not in allowed_keys:
                problems.append(f"unknown policy key {group}.{key}")
                continue
            if group == "firstPass":
                tiers = _validate_tiers(setting, problems)
                if tiers is not None:
                    out.setdefault("firstPass", {})["allowed"] = tiers
            elif isinstance(setting, bool):
                out.setdefault(group, {})[key] = setting
            else:
                problems.append(f"{group}.{key} must be true or false")

    if problems:
        raise PolicyError(problems)
    return out


def _validate_tiers(value, problems: list[str]) -> list[str] | None:
    """``firstPass.allowed``: a non-empty subset of the tiers, canonically
    ordered so two equivalent policies compare equal."""
    if not isinstance(value, list) or not value or len(value) > len(TIERS):
        # Longer than the three tiers cannot name a subset of them, whatever it
        # holds — refuse it before normalizing a hundred thousand strings.
        problems.append(
            f"firstPass.allowed must be a non-empty list of {', '.join(TIERS)}"
        )
        return None
    chosen: set[str] = set()
    for entry in value:
        try:
            chosen.add(normalize_tier(entry))
        except PolicyError:
            problems.append(f"firstPass.allowed: {entry!r} is not a first-pass tier")
    if not chosen:
        return None
    return [tier for tier in TIERS if tier in chosen]


def strip_retired(policy):
    """``policy`` without :data:`RETIRED_GROUPS` — None when nothing is left,
    so an override that held only retired keys reads as "uses the default".
    Anything that is not an object is handed back untouched."""
    if not isinstance(policy, dict):
        return policy
    kept = {group: value for group, value in policy.items() if group not in RETIRED_GROUPS}
    return kept or None


def merge_policy(base: dict, override) -> dict:
    """``base`` with ``override``'s keys winning, one level into each group.

    Both sides are read DEFENSIVELY (unknown keys dropped, non-objects
    ignored): stored policies were validated on the way in, but a policy read
    back years later must never be able to crash a request.
    """
    merged = default_policy()
    for source in (base, override):
        if not isinstance(source, dict):
            continue
        for group, value in source.items():
            if group not in GROUPS or not isinstance(value, dict):
                continue
            if group == "firstPass":
                tiers = value.get("allowed")
                if isinstance(tiers, list):
                    chosen = {
                        TIER_ALIASES.get(t, t)
                        for t in tiers
                        if isinstance(t, str)
                    }
                    keep = [tier for tier in TIERS if tier in chosen]
                    if keep:
                        merged["firstPass"]["allowed"] = keep
                continue
            for key, setting in value.items():
                if key in BOOLEAN_KEYS[group] and isinstance(setting, bool):
                    merged[group][key] = setting
    return merged


def student_membership(user):
    """The membership that makes this user a STUDENT, or None.

    A user may be a student in several organizations (§2); the policy that
    governs their editor is the first such membership by creation — a
    deliberately simple, deterministic rule, and no UI creates the second one
    today.

    A PENDING invitation is not one of them: until the person accepts it, a
    stranger's classroom cannot decide what their editor may do.

    Nor is a DEACTIVATED one — and that is a ruling, not an accident. Being
    removed from a class means going back to being an individual: a student
    who joined with their OWN account keeps their login and loses the class's
    rules along with the class. An account the org PROVISIONED has no life
    outside it, so deactivating it bars the login itself
    (``da/api/orgs.py``'s ``_sync_account_access``). Either way "inactive"
    never means "unsupervised but still restricted".
    """
    if user is None or not getattr(user, "is_authenticated", False):
        return None
    from .models import Membership

    return (
        Membership.objects.filter(
            user=user,
            role=Membership.STUDENT,
            active=True,
            accepted_at__isnull=False,
        )
        .select_related("professor", "organization")
        .order_by("created_at", "id")
        .first()
    )


def effective_policy(user) -> dict | None:
    """The rules in force for ``user``: their professor's default with their
    own override applied, or None when the user is not a student (individuals,
    admins and professors have no policy — the UI treats None as "everything
    allowed")."""
    membership = student_membership(user)
    if membership is None:
        return None
    return policy_for_membership(membership)


def policy_for_membership(membership) -> dict:
    """The effective policy of one student membership (§4: default ⊕ override)."""
    from .models import TeachingPolicy

    base = DEFAULT_POLICY
    if membership.professor_id is not None:
        stored = TeachingPolicy.objects.filter(
            professor_membership_id=membership.professor_id
        ).first()
        if stored is not None:
            base = stored.policy
    return merge_policy(base, membership.policy_override or {})


def allowed_tiers(policy: dict | None) -> list[str]:
    """The first-pass tiers a policy permits; all of them when there is none."""
    if policy is None:
        return list(TIERS)
    allowed = policy.get("firstPass", {}).get("allowed")
    if not isinstance(allowed, list) or not allowed:
        return list(TIERS)
    return [tier for tier in TIERS if tier in allowed]


def tier_allowed(policy: dict | None, tier: str) -> bool:
    return tier in allowed_tiers(policy)
