"""The Django admin — for site staff (docs/accounts-spec.md §3).

It is also the only place ownerless analyses can be seen until
``assign_orphans`` runs (§7), which is why the analysis list can be filtered
by owner and shows the null.
"""

from django.contrib import admin

from .models import Analysis, Membership, Organization, TeachingPolicy


@admin.register(Analysis)
class AnalysisAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "passage_ref", "owner", "first_pass_tier", "updated_at")
    list_filter = ("owner", "first_pass_tier")
    search_fields = ("title", "passage_ref")
    readonly_fields = ("created_at", "updated_at")


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    """Where staff can make an organization by hand. ``manage.py create_org``
    does the same and adds the first admin account and its mail (§2)."""

    list_display = ("id", "name", "slug", "created_by", "created_at")
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}
    readonly_fields = ("created_at",)


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = (
        "id", "user", "organization", "role", "professor", "active",
        "accepted_at", "provisioned",
    )
    list_filter = ("organization", "role", "active", "provisioned")
    search_fields = ("user__username", "user__email", "organization__name")
    raw_id_fields = ("user", "professor")
    readonly_fields = ("created_at",)


@admin.register(TeachingPolicy)
class TeachingPolicyAdmin(admin.ModelAdmin):
    list_display = ("id", "professor_membership", "updated_at")
    raw_id_fields = ("professor_membership",)
    readonly_fields = ("created_at", "updated_at")
