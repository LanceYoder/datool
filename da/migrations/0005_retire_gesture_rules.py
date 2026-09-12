"""Strip the retired gesture rules from every stored policy.

Ruling 2026-09-12 (docs/accounts-spec.md §5): a professor sets the first-pass
tiers and the reading aids, nothing else — relationships, clearing, splitting
and merging, color blocks, the text flow and notes are always available. The
first build stored those as switches; this drops them so a policy read back
is exactly the shape ``da.policies.DEFAULT_POLICY`` declares, and an override
that named only retired keys becomes "uses your default" (null).

``Analysis.policy_snapshot`` is left alone on purpose: it is the audit trail
of the rules in force when the analysis was made, and rewriting history is
not what a snapshot is for.
"""

from django.db import migrations

RETIRED = ("tree", "split", "sections", "textFlow", "notes")


def _strip(policy):
    if not isinstance(policy, dict):
        return policy
    return {k: v for k, v in policy.items() if k not in RETIRED}


def forwards(apps, schema_editor):
    TeachingPolicy = apps.get_model("da", "TeachingPolicy")
    Membership = apps.get_model("da", "Membership")

    for stored in TeachingPolicy.objects.all():
        cleaned = _strip(stored.policy)
        if cleaned != stored.policy:
            stored.policy = cleaned
            stored.save(update_fields=["policy"])

    for member in Membership.objects.exclude(policy_override=None):
        cleaned = _strip(member.policy_override)
        if not cleaned:
            cleaned = None
        if cleaned != member.policy_override:
            member.policy_override = cleaned
            member.save(update_fields=["policy_override"])


class Migration(migrations.Migration):

    dependencies = [
        ("da", "0004_membership_accepted_at_membership_provisioned"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
