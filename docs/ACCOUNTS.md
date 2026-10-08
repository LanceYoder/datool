# Accounts and teaching policies

Everything in datool needs a sign-in. Accounts sign in with **email and
password** (any non-empty password; login is rate-limited). Analyses
belong to the account that made them.

## Kinds of account

- **Individual**: anyone can register at `/register`. Belongs to no
  organization and has every feature.
- **Organization**: a school or class group, created by site staff only
  (`manage.py create_org`, below). Its members have one role each:
  - **Administrator**: adds and removes members and assigns students to
    professors. Cannot read analyses.
  - **Professor**: has students, sets their teaching policy, and can open
    their analyses **read-only**.
  - **Student**: works under their professor's policy.

One login can belong to several organizations.

### Adding people

Administrators (and professors, for their own students) add a member by
email. A new address gets an account and a "set your password" email; an
address that already has an account gets an invitation to accept on its
`/account` page. Nobody can set another person's password: an
administrator or professor can only send a reset link. If no mail server
is configured, the link is shown on screen to whoever added the person.

## Teaching policy

A professor sets one default policy for their students and can override it
per student. A policy controls only two things:

- **Auto-analyzer tiers** the student may start from: any of Nothing,
  Minimal, Max. With only one allowed, the picker is hidden.
- **Reading aids** the student may see: the English line, the verse panel,
  verb bolding, relationship color coding. A withheld aid is hidden and a
  "Class rules" line under the toolbar says so.

Editing is never restricted: every student can connect, delete, relabel,
split, merge, use color blocks, the text flow and notes. The policy is
enforced by the server as well as hidden in the UI.

## Pages

| Route | Who | What |
| --- | --- | --- |
| `/login`, `/register`, `/forgot-password`, `/reset-password/…` | anyone | signing in |
| `/account` | everyone | name, password, invitations |
| `/org/:id` | administrators | members and professor assignments |
| `/teach/:id` | professors | students, default policy, per-student overrides |
| `/students/:mid` | professors | one student's analyses (open read-only) |

The skin picker appears only after signing in; the sign-in pages always use
the original design.

## Staff commands

```sh
python manage.py create_org --name "Greek 101" --admin dean@example.edu
python da/scripts/orphan_report.py               # analyses with no owner (read-only)
python manage.py assign_orphans --to you@example.com [--dry-run]
```

`create_org` emails the administrator (and prints the link). The Django
admin at `/admin/` is available to staff accounts
(`manage.py createsuperuser`).

## Code

Models: `da/models.py` (`Organization`, `Membership`, `TeachingPolicy`, and
`Analysis.first_pass_tier` / `policy_snapshot`, recorded at creation).
Effective policy: `da/policies.py`. Endpoints: `da/api/auth.py` and
`da/api/orgs.py`. Frontend: `frontend/src/session.tsx` and
`frontend/src/policy.tsx`.
