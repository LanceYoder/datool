"""Set up an organization and its first administrator (docs/accounts-spec.md §2).

    uv run python manage.py create_org --name "Greek 101" --admin dean@example.edu
    uv run python manage.py create_org --name "Greek 101" --admin dean@example.edu \\
        --admin-name "Dee Ann"

There is no self-serve way to make an organization: a school reaches out, and
site staff run this (ruled 2026-09-12). The ADDRESS decides what the
administrator gets —

* no account yet: one is made for them — owned by the organization, like any
  provisioned account — and the "set your password" mail goes out. The link
  is printed here as well, for the operator to pass on when mail is not
  configured (§10.1);
* an account already: an INVITATION, waiting on their account page until they
  accept it. The account is theirs; nothing about it changes until they say
  so — the same consent boundary as provisioning by email (§6).
"""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from da.api.auth import ADDRESS_MAX, clean_email, email_taken, set_name
from da.api.mail import reset_link, send_invitation, send_org_invitation
from da.models import Membership, Organization

NAME_MAX = Organization._meta.get_field("name").max_length


class Command(BaseCommand):
    help = "Set up an organization with its first administrator (named by email)."

    def add_arguments(self, parser):
        parser.add_argument("--name", required=True, help="the organization's name")
        parser.add_argument(
            "--admin",
            required=True,
            metavar="EMAIL",
            help="the first administrator's email address",
        )
        parser.add_argument(
            "--admin-name",
            default="",
            help="their name, for a NEW account (an existing account keeps its own)",
        )

    def handle(self, *args, **options):
        name = (options["name"] or "").strip()
        if not name:
            raise CommandError("--name must not be empty")
        if len(name) > NAME_MAX:
            raise CommandError(f"a name may be at most {NAME_MAX} characters")
        try:
            email = clean_email(options["admin"])
        except ValidationError:
            email = ""
        if not email:
            raise CommandError(f"{options['admin']!r} does not look like an email address")
        if len(email) > ADDRESS_MAX:
            raise CommandError(f"an email address may be at most {ADDRESS_MAX} characters")

        User = get_user_model()
        with transaction.atomic():
            organization = Organization.objects.create(
                name=name, slug=Organization.unique_slug(name)
            )
            existing = User.objects.filter(email__iexact=email).first()
            if existing is not None:
                membership = Membership.objects.create(
                    user=existing,
                    organization=organization,
                    role=Membership.ADMIN,
                    accepted_at=None,  # PENDING: theirs to accept, not ours to take
                    provisioned=False,
                )
                sent = send_org_invitation(existing, organization_name=organization.name)
                link = None
            else:
                if email_taken(email):
                    raise CommandError(f"{email} is already in use as a login")
                user = User(username=email.lower(), email=email)
                set_name(user, options["admin_name"] or None)
                user.set_unusable_password()  # the link below is how they set one
                user.save()
                membership = Membership.objects.create(
                    user=user,
                    organization=organization,
                    role=Membership.ADMIN,
                    provisioned=True,
                )
                link = reset_link(user)
                sent = send_invitation(user, link, organization_name=organization.name)

        self.stdout.write(
            self.style.SUCCESS(
                f"created {organization.name} (id {organization.id}, slug {organization.slug})"
            )
        )
        if link is None:
            self.stdout.write(
                f"{email} already has an account: an invitation (membership {membership.id}) "
                "is waiting on their account page until they accept it."
            )
            self.stdout.write(
                "The invitation mail went out."
                if sent
                else "The invitation mail could not be sent — tell them to sign in and "
                "look under Invitations on /account."
            )
        else:
            self.stdout.write(
                f"made the administrator account {email} (membership {membership.id}). "
                f"Set-password link:\n{link}"
            )
            self.stdout.write(
                "It was also sent by mail."
                if sent
                else "The mail could not be sent — pass the link on yourself."
            )
