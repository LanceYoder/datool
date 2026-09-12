"""``manage.py create_org`` — how an organization comes to exist (§2).

Schools reach out; site staff run this with the school's name and the address
of the person who will administer it. That person either already has an
account — and gets an INVITATION to accept on their account page, the same
consent boundary as provisioning by email (§6) — or does not, and gets an
account with a set-password link, exactly as a provisioned professor does.
The app itself offers no way to make an organization (test_accounts.py).
"""

from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from rest_framework.test import APIClient

from da.api.shapes import me_json
from da.models import Membership, Organization

from .conftest import PASSWORD
from .test_accounts import link_in, uid_and_token

pytestmark = pytest.mark.django_db


def run(**options) -> str:
    out = StringIO()
    call_command("create_org", stdout=out, **options)
    return out.getvalue()


class TestCreateOrg:
    def test_a_new_address_gets_a_provisioned_admin_and_a_set_password_link(self):
        out = run(name="Greek 101", admin="Dean@Example.com", admin_name="Dee Ann")

        org = Organization.objects.get()
        assert (org.name, org.slug, org.created_by) == ("Greek 101", "greek-101", None)
        membership = Membership.objects.get()
        assert membership.organization == org
        assert membership.role == Membership.ADMIN
        assert membership.provisioned is True      # the org owns this account
        assert membership.pending is False         # nobody to ask: live at once
        user = membership.user
        assert user.email == "Dean@example.com"    # Django folds the domain only
        assert user.username == "dean@example.com"  # the login of record
        assert user.first_name == "Dee Ann"
        assert not user.has_usable_password()      # the link is how they set one

        # The mail carries the link, and the terminal repeats it for the
        # operator — production has no mail provider yet (§10.1).
        assert len(mail.outbox) == 1
        link = link_in(mail.outbox[0])
        assert link in out
        assert "Greek 101" in out and "greek-101" in out
        assert "also sent by mail" in out

        # …and the link is the working set-password flow.
        uid, token = uid_and_token(link)
        response = APIClient().post(
            "/api/auth/password/reset",
            {"uid": uid, "token": token, "password": "dean-sets-this-9"},
            format="json",
        )
        assert response.status_code == 200
        user.refresh_from_db()
        assert user.check_password("dean-sets-this-9")

    def test_an_existing_account_is_invited_not_taken(self, individual):
        out = run(name="Greek 101", admin=individual.email.upper())

        membership = Membership.objects.get(user=individual)
        assert membership.role == Membership.ADMIN
        assert membership.pending is True          # theirs to accept
        assert membership.provisioned is False     # and theirs to keep
        assert "invitation" in out
        # The mail names the org and points at /account; it carries no link
        # INTO the account, because nothing about the account is changing.
        assert len(mail.outbox) == 1
        assert "Greek 101" in mail.outbox[0].subject
        assert "reset-password" not in mail.outbox[0].body
        individual.refresh_from_db()
        assert individual.check_password(PASSWORD)
        # Until they accept, they hold no role at all — only the invitation.
        me = me_json(individual)
        assert me["memberships"] == []
        assert [i["membershipId"] for i in me["invitations"]] == [membership.id]

    def test_slugs_do_not_collide(self):
        run(name="Greek 101", admin="a@example.com")
        run(name="Greek 101", admin="b@example.com")
        assert sorted(Organization.objects.values_list("slug", flat=True)) == [
            "greek-101", "greek-101-2",
        ]

    @pytest.mark.parametrize("name", ["", "   ", "n" * 201])
    def test_a_bad_name_is_refused_and_nothing_is_made(self, name):
        with pytest.raises(CommandError):
            run(name=name, admin="dean@example.com")
        assert not Organization.objects.exists()
        assert not get_user_model().objects.exists()

    def test_a_bad_address_is_refused_and_nothing_is_made(self):
        with pytest.raises(CommandError, match="does not look like an email"):
            run(name="Greek 101", admin="not-an-address")
        assert not Organization.objects.exists()
        assert not get_user_model().objects.exists()

    def test_when_mail_cannot_go_out_the_link_is_still_printed(self, settings):
        settings.EMAIL_BACKEND = "da.tests.conftest.BrokenEmailBackend"
        out = run(name="Greek 101", admin="dean@example.com")
        assert "/reset-password/" in out
        assert "could not be sent" in out
        assert Membership.objects.get().role == Membership.ADMIN
