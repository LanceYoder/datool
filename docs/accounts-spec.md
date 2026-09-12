# Accounts, organizations, and teaching policies

Status: v1 contract, 2026-09-09. Written from the codebase map; built by
agents in phases against this document; verified end to end in the browser
before being called done. Decisions are made with defaults the analyst can
overrule — each marked **(default)** where a different choice is plausible.

Amended 2026-09-12 (two rulings): organizations are set up by site staff,
never self-serve (§2, §6, §7); and the teaching policy is ONLY the first-pass
tiers and the reading aids — every editing gesture is always available (§5,
§8). The text below is the amended contract; the first build's switches
for the gestures are gone from the code, the wire, and the stored policies
(migration 0005).

## 1. What exists today (the ground)

- Django 5.2 + DRF 3.18; `django.contrib.auth`/`sessions`/`admin` installed
  and their middleware running; DRF configured with NO authentication and
  `AllowAny` ("single-user local mode; auth switches on at first deployment").
- One model, `Analysis`, already carrying `owner = FK(AUTH_USER_MODEL,
  null=True)` — never set. Local DB: 43 analyses, all ownerless, 0 users.
- No email configuration; deployed as one Fly machine (datool.fly.dev,
  SQLite on a volume); frontend is a React SPA served same-origin by
  WhiteNoise, Vite proxies `/api` in dev. `api.ts` sends no credentials or
  CSRF header. Two routes (`/`, `/analysis/:id`), no auth code anywhere.
- The first-pass "tier" is a boolean `maximal` (UI: Minimal / Full, kept in
  localStorage). Every student-facing editor ability has one wiring point
  (mapped in §5).

## 2. Account kinds

- **Individual account** — self-registered with email + password. Belongs
  to no organization. Everything they make is theirs alone.
- **Organization** — set up by SITE STAFF at the school's request, together
  with its first **admin** account (`manage.py create_org`, or the Django
  admin). There is no self-serve creation: a school that wants one reaches
  out, and the app offers no button and no endpoint for it (ruled
  2026-09-12). An org has members with a role:
  - `admin` — manages membership: provisions accounts, assigns students
    to professors, deactivates members. Does NOT read anyone's analyses.
  - `professor` — has students; sets teaching policies; may OPEN (read)
    their students' analyses **(default: read-only; editing a student's
    work stays the student's)**.
  - `student` — a **learning account**: works under a policy set by their
    professor. Assigned to exactly one professor (or none yet).
- **Provisioned accounts.** Admins (and professors, for their own
  students) create accounts two ways:
  - **by email** — an invitation email carries a set-password link (the
    password-reset machinery), or
  - **learning account without email** — a login handle (e.g.
    `greek101-smith`) plus a temporary password the admin/professor hands
    out; the account has no email, so its password is reset BY the
    professor/admin, never by email. This is the "learning account".
- A user may hold memberships in several organizations; the same login
  works everywhere. Individuals may later be added to an org.

## 3. Authentication mechanics

- **Session cookies + CSRF** (Django's own), same-origin. DRF gets
  `SessionAuthentication` and `IsAuthenticated` by default; the handful of
  public endpoints (login, register, password reset, CSRF bootstrap,
  taxonomy?) opt out explicitly. The SPA fetches `/api/auth/csrf` once,
  then sends `X-CSRFToken` on every mutating request; `api.ts` learns
  `credentials: 'same-origin'` and the header.
- **Login by email OR handle** + password (custom backend; `username`
  stores the handle, or the email for email accounts).
- **Password reset by email**: Django's token flow — `POST
  /api/auth/password/forgot {email}` always answers 200; the mail links to
  `/reset-password/<uid>/<token>`; `POST /api/auth/password/reset` sets it.
  Invitations reuse the same tokens with a "set your password" mail.
- **Email delivery**: `EMAIL_URL`-style env config. Dev/test: console
  backend (mail printed to the Django log). Production: SMTP via env
  (`EMAIL_HOST/PORT/USER/PASSWORD/USE_TLS`, `DEFAULT_FROM_EMAIL`) — the
  analyst chooses the provider; until then, prod invitations show the link
  on screen to the admin who provisioned the account, so nothing blocks.
- Session length: 2 weeks, renewed on use **(default)**. Logout endpoint.
- The Django admin stays for site staff.

## 4. Data model (`da/models.py` additions)

```
Organization   id, name, slug (unique), created_by, created_at
Membership     id, user, organization, role ∈ {admin, professor, student},
               professor → Membership (nullable; only for students; same org;
               target must be a professor), active (bool), created_at,
               unique (user, organization)
TeachingPolicy id, professor_membership (unique) — the professor's DEFAULT
               policy for all their students: policy JSON (§5)
               + per-student override: Membership.policy_override JSON
               (nullable). Effective policy = default ⊕ override (override
               keys win).
Analysis       owner becomes REQUIRED for new rows (existing rows keep null
               until reassigned; see §7).
```

Effective-policy resolution lives in ONE function
(`da/policies.py: effective_policy(user) -> Policy | None`), used by the
API to serve `/api/auth/me` and by the enforcement points.

## 5. The teaching policy — what a professor can set

The policy is a JSON object with a fixed key set (unknown keys rejected).
Defaults = everything allowed, i.e. an individual's experience.

**First pass (the auto-analysis)**

- `firstPass.allowed`: subset of `["none", "minimal", "full"]` — which
  tiers the student may choose when creating an analysis. `none` is NEW:
  every proposition a root, no relationships proposed (the student builds
  the whole tree). If exactly one is allowed, the picker is hidden and that
  tier is used. Server-enforced on `POST /api/first-pass` and on
  `POST /api/analyses` (the stored tier is recorded on the analysis).

**Always available — NOT a class rule** (ruled 2026-09-12; the first
build had a switch for each of these, and they are gone):

- making, deleting and relabeling relationships, moving the star, and the
  Clear tree button;
- splitting a proposition after a word and merging it with the next (tree
  and text flow alike);
- color-block section breaks;
- the text-flow panel, always shown and always editable;
- the notes editor.

A professor has nothing to say about how a student EDITS; only about where
the auto-analysis may start and which helps are on the page. The one place
these gestures are withheld is a professor's read-only view of a student's
work (§8), and that is a page mode, not a policy.

**Reading aids** (a professor may withhold helps)

- `aids.english` — the interlinear English toggle (false = hidden and off).
- `aids.verses` — the BSB/ESV verse panel.
- `aids.verbs` — verb highlighting.
- `aids.colorCoding` — relationship color coding.

The professor UI presents these as grouped switches with plain labels
("Show students: the English line / the verse panel / verb highlighting /
relationship color coding", "Auto-analysis students may start from:
nothing / minimal / full"). Per-student overrides show as "uses your
default" with an override switch. The server refuses a retired key
(`tree`, `split`, `sections`, `textFlow`, `notes`) with the reason —
"… is no longer a class rule — it is always available" — rather than
"unknown key", and migration 0005 stripped them from stored policies.

## 6. API (all under `/api/`, JSON; errors as today `{errors: [..]}`)

Auth (public unless noted):
- `GET auth/csrf` → sets csrftoken cookie, `{ok:true}`.
- `POST auth/register {email, password, name?}` → creates individual, logs
  in, returns `me`.
- `POST auth/login {login, password}` (login = email or handle) → `me`.
- `POST auth/logout` (auth) → 204.
- `GET auth/me` (auth) → `{id, email, handle, name, memberships:[{
  membershipId, org:{id,name,slug}, role, professor?:{id,name}, active}],
  invitations:[{membershipId, org, role}], policy: Policy|null, isStaff}` —
  `memberships` holds only ACCEPTED memberships; `invitations` the pending
  ones (deliberately without the inviter's identity — an unverified address
  must not learn who typed it in); `policy` is the effective policy for a
  student, else null.
- `POST invitations/<membershipId>/accept` / `…/decline` (auth; the
  invitee only) — the consent step: an invitation to an EXISTING account
  grants nothing (no role, no policy, no professor access) until accepted.
- `POST auth/password/forgot {email}` → 200 always.
- `POST auth/password/reset {uid, token, password}` → 200 / 400.
- `POST auth/password/change {current, password}` (auth).

Organizations (auth):
- No `POST orgs`. An organization is made by site staff:
  `manage.py create_org --name "Greek 101" --admin dean@example.edu
  [--admin-name "Dee Ann"]`. A NEW address gets a provisioned admin account
  and the set-password mail (the link is printed for the operator as well);
  an address that ALREADY has an account gets a PENDING invitation to accept
  on `/account`, exactly as provisioning by email does.
- `GET orgs/mine` → memberships with roles.
- `GET orgs/<id>/members` (admin, or professor: only their students +
  themselves) → `[{membershipId, user:{id,email,handle,name}, role,
  professor, active, hasEmail}]`.
- `POST orgs/<id>/members {role, email?|handle?, name?, password?,
  professor?}` (admin; professor may create students assigned to
  themselves). With a HANDLE → the member row + `temporaryPassword`. With
  an EMAIL → `{invited: true, membershipId, inviteLink, temporaryPassword:
  null}` — the SAME shape whether the address already had an account (a
  pending invitation was created) or not (a new account; `inviteLink` is
  non-null only when mail could not be sent), so the form cannot be used to
  discover who holds an account. The roster does show `pending` /
  `provisioned` per row (the teaching page needs them); the per-caller and
  per-target invitation throttles are what keep that from being a lookup
  service.
- Rate limits: login 10/min per client address AND per submitted login;
  register 5/min; password/forgot 5/min per address and per target inbox;
  password/change 10/min per user; invitations 40/day per caller and per
  target. All env-tunable (`DATOOL_*_RATE`), all answering 429 `{errors}`.
- `PATCH orgs/<id>/members/<mid> {role?, professor?, active?}` (admin).
- `POST orgs/<id>/members/<mid>/reset-password {password?}` (admin, or the
  student's professor) — branches on the TARGET, never on the caller: an
  account WITH an email only ever gets a reset MAIL (the caller can never
  set its password); only a handle account gets a temporary password.
  Deactivating (`active: false`) a PROVISIONED account bars its login; a
  member who joined with their own account simply leaves the class and its
  rules (they are an individual again). No change may leave an organization
  without an active admin.

Policies (auth):
- `GET orgs/<id>/policy` (professor) → their default policy.
- `PUT orgs/<id>/policy {policy}` (professor).
- `PUT orgs/<id>/members/<mid>/policy {override|null}` (the student's
  professor).

Analyses (auth) — ownership added to the existing endpoints:
- list/create/get/update/delete are scoped to `owner = request.user`;
  `GET analyses/<id>` also allowed for the owner's professor (read-only:
  PUT/DELETE remain owner-only); `GET orgs/<id>/students/<mid>/analyses`
  lists a student's analyses for their professor.
- `POST first-pass {text, tier: 'none'|'minimal'|'full'}` — `maximal` kept
  as a deprecated alias; tier checked against the caller's policy.
- `POST analyses` records `first_pass_tier` and `policy_snapshot` (the
  effective policy at creation) on the row.

## 7. Migration of existing data

- New migration adds Organization/Membership/TeachingPolicy and the two
  Analysis columns; `owner` stays nullable at the DB level so existing
  rows keep loading for staff.
- Management command `assign_orphans --to <email|handle>` gives every
  ownerless analysis to that user (the analyst's own account, once it
  exists). Until run, ownerless analyses are visible only to staff via the
  Django admin. The check-script pattern (`da/scripts/`) is reused for a
  read-only report first.

## 8. Frontend

Routes added to `App.tsx` (all covered by the SPA catch-all already):
`/login`, `/register`, `/forgot-password`, `/reset-password/:uid/:token`,
`/account` (name, change password, memberships), `/org/:id` (admin:
members, provisioning, assignments), `/teach/:id` (professor: students,
default policy, per-student overrides, open a student's analysis),
`/students/:mid` (professor: that student's analyses). Existing `/` and
`/analysis/:id` require login (redirect to `/login?next=`).

- A `SessionProvider` (context) loads `/api/auth/me` once, exposes `user`,
  `policy`, `refresh()`, `logout()`. Header shows the user's name, an
  Account link, org/teaching links by role, and Sign out.
- `api.ts`: `credentials: 'same-origin'`, CSRF header from the cookie, a
  401 anywhere triggers a session refresh + redirect to `/login`.
- **Policy enforcement** (student): one `usePolicy()` hook returns the
  effective policy (or "everything allowed"); the two things it governs
  are the HomePage tier picker (filter/hide) and the reading aids — a
  withheld aid is forced off in ViewSettings and its toolbar switch is
  hidden. A small "Class rules" line under the toolbar tells the student
  what is withheld, so nothing feels broken. No gesture is gated by
  policy (§5).
- **Read-only** (a professor reading a student's work) is a PAGE MODE, not
  a policy: AnalysisPage wraps its content in `ReadOnlyScope`, and every
  gesture handler in the editor, the text flow and the notes reads
  `useReadOnly()` — controls gone, keyboard side-channels closed, reading
  aids all present. It is the one place the gestures are withheld.
- Styling: new pages use the existing card/form/button classes so all four
  skins apply; forms are plain and short (email, password, one button).
  The site design (skin) is a SIGNED-IN reader's choice (ruled 2026-09-12):
  the public pages — sign-in, register, forgot/reset password — always wear
  the original design, the picker is not shown until someone is signed in,
  and a stored choice waits for them behind the sign-in (`theme.tsx`).
- Tests: page tests for login/register/reset with a mocked `api`; policy
  gating tests on AnalysisEditor/HomePage/TextFlowPanel; api.ts CSRF
  header test; backend tests for every endpoint, role permission, policy
  resolution, and tier enforcement.

## 9. Verification (the A7 standard)

Not done until driven in the real browser: register → staff run
`create_org` with that address → accept the invitation on /account →
provision a professor (email, console-mail link) and a handle-based
student with a temp password → assign the student → set a policy
(`firstPass: [minimal]`, `aids.english: false`) → sign in as the student →
New analysis shows no tier picker and proposes minimal → the editor hides
English, and every gesture (connect, delete, relabel, split, blocks, flow,
notes) still works → professor opens the student's analysis read-only →
student changes their own password → password-reset mail round-trip for
the professor account.

## 10. Open choices for the analyst (defaults in force until overruled)

1. Email provider for production (SMTP host + credentials as Fly secrets).
   Until set, invitations show the link on screen to the provisioner, and
   `create_org` prints its link on the operator's terminal.
2. ~~Self-serve organization creation (default) vs. staff-only.~~ RULED
   2026-09-12: staff-only (§2).
3. Professors read students' analyses (default) vs. full edit access.
4. ~~Whether gesture locks should ALSO be enforced server-side.~~ Moot since
   2026-09-12: there are no gesture locks. The policy snapshot on each
   analysis stays, as the record of the tiers and aids in force.
