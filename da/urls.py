"""Every route under ``/api/`` (docs/DESIGN.md §7, docs/accounts-spec.md §6).

Analyses and corpus data come from :mod:`da.views`; accounts, organizations
and policies from the :mod:`da.api` package. Everything needs a session except
the five public auth routes marked below.
"""

from django.urls import path

from . import views
from .api import auth, orgs

urlpatterns = [
    # --- accounts: the public five (no session required) -------------------
    path("auth/csrf", auth.CsrfView.as_view()),
    path("auth/register", auth.RegisterView.as_view()),
    path("auth/login", auth.LoginView.as_view()),
    path("auth/password/forgot", auth.PasswordForgotView.as_view()),
    path("auth/password/reset", auth.PasswordResetView.as_view()),
    # --- accounts: signed in ----------------------------------------------
    path("auth/logout", auth.LogoutView.as_view()),
    path("auth/me", auth.MeView.as_view()),
    path("auth/password/change", auth.PasswordChangeView.as_view()),
    # --- organizations, membership, policies ------------------------------
    # No ``POST orgs``: an organization is set up by site staff at the
    # school's request (``manage.py create_org``), never self-serve (§2).
    path("orgs/mine", orgs.MyOrgsView.as_view()),
    path("orgs/<int:org_id>/members", orgs.MembersView.as_view()),
    path("orgs/<int:org_id>/members/<int:mid>", orgs.MemberDetailView.as_view()),
    path(
        "orgs/<int:org_id>/members/<int:mid>/reset-password",
        orgs.MemberResetPasswordView.as_view(),
    ),
    # An invitation is answered by the INVITEE, not inside anybody's org.
    path(
        "invitations/<int:mid>/accept",
        orgs.InvitationView.as_view(decision="accept"),
    ),
    path(
        "invitations/<int:mid>/decline",
        orgs.InvitationView.as_view(decision="decline"),
    ),
    path("orgs/<int:org_id>/policy", orgs.OrgPolicyView.as_view()),
    path("orgs/<int:org_id>/members/<int:mid>/policy", orgs.MemberPolicyView.as_view()),
    path(
        "orgs/<int:org_id>/students/<int:mid>/analyses",
        orgs.StudentAnalysesView.as_view(),
    ),
    # --- analyses and corpus ----------------------------------------------
    path("analyses", views.AnalysisListCreateView.as_view()),
    path("analyses/deleted", views.DeletedAnalysisListView.as_view()),
    path("analyses/<int:pk>", views.AnalysisDetailView.as_view()),
    path("analyses/<int:pk>/restore", views.AnalysisRestoreView.as_view()),
    path("first-pass", views.FirstPassView.as_view()),
    path("text-flow", views.TextFlowView.as_view()),
    path("corpus/words", views.CorpusWordsView.as_view()),
    path("corpus/verses", views.CorpusVersesView.as_view()),
    path("taxonomy", views.TaxonomyView.as_view()),
]
