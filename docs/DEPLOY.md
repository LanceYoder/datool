# Deploying datool — one Fly.io app

One app serves everything: Django hosts the JSON API **and** the built React
frontend from a single origin (WhiteNoise serves `frontend/dist`; a catch-all
route covers the React router's paths). No Vercel, no CORS, no second deploy —
the tester just opens `https://<app>.fly.dev`.

The database is SQLite on a Fly volume, so the app must run as exactly ONE
machine. That is the right shape for a single-tester deployment; moving to
Postgres (Supabase) later is a `DATABASE_URL` change.

## One-time setup

1. Install flyctl: https://fly.io/docs/flyctl/install/ and `fly auth login`
   (or `fly auth signup`).
2. From the repo root:

   ```sh
   fly launch --no-deploy      # answer Yes to "copy existing fly.toml";
                               # pick your own app name if "datool" is taken
   fly volumes create data --size 1
   fly secrets set DJANGO_SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))')"
   ```

   If you changed the app name, update `DJANGO_CSRF_TRUSTED_ORIGINS` in
   `fly.toml` to match (`https://<your-app>.fly.dev`).

   The ESV verse-text source (the Verses picker's ESV option) uses the
   Crossway API key committed as the default in `config/settings.py`
   (non-commercial terms — commercial use needs Crossway's permission).
   To use a different key, override it:

   ```sh
   fly secrets set ESV_API_KEY="<your key>"
   ```

   If the key stops working, regenerate one at <https://api.esv.org>.
   Without a working key, ESV requests return 503 and the panel says so;
   BSB always works from local data.

## Deploy (and every update)

```sh
fly deploy
```

The Dockerfile builds the frontend, installs the backend, and starts
gunicorn; migrations run automatically at container start (deliberately not
as a Fly release command — release machines don't mount the volume the
database lives on).

Open `https://<app>.fly.dev` and send that URL to the tester.

## After the first deploy: the first account

The app requires a login (docs/accounts-spec.md). Nothing is visible until an
account exists, and the 43 analyses made in single-user local mode have no
owner, so they belong to nobody yet.

```sh
fly ssh console -C "python manage.py createsuperuser"     # site staff
```

An organization is set up by staff, never from the app (accounts-spec §2):

```sh
fly ssh console -C 'python manage.py create_org --name "Greek 101" --admin dean@example.edu'
```

The command mails the administrator a set-password link — or, for an address
that already has an account, an invitation to accept on their account page —
and prints the link as well, for the days before a mail provider is set.

or simply register at `https://<app>.fly.dev/register`. Then hand the old
analyses to that account — **report first, move second**:

```sh
fly ssh console -C "python da/scripts/orphan_report.py"          # read-only
fly ssh console -C "python manage.py assign_orphans --to you@example.com"
```

`assign_orphans` also takes `--dry-run`; `--to` is the account's email. Until
it runs, ownerless analyses are reachable only through the Django admin at
`/admin/`.

## Environment variables

Every one of these is optional; the default is what a fresh checkout runs
with. Set them as Fly secrets (`fly secrets set NAME=value`).

| Variable | Default | What it does |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | an insecure development key | Signs sessions and password-reset tokens. **Always set in production**; changing it logs everyone out and invalidates every outstanding invitation link. |
| `DJANGO_DEBUG` | `1` | `0` in production. Also the switch on secure cookies (below) and on the mail backend. |
| `DJANGO_ALLOWED_HOSTS` | `127.0.0.1,localhost` | Comma-separated hostnames the app answers to, e.g. `datool.fly.dev`. |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | empty | Comma-separated origins with scheme, e.g. `https://datool.fly.dev` — required for the login form and every write, since the SPA is same-origin. |
| `DATABASE_URL` | SQLite on the volume | A `postgres://…` URL moves the database off SQLite. |
| `ESV_API_KEY` | the project's committed key | Crossway API key for the ESV verse panel; empty disables that source (BSB always works). |
| `FRONTEND_ORIGIN` | `http://localhost:5173` in DEBUG, else `https://datool.fly.dev` | The origin the links in invitation and password-reset mail point at. Set it to your app's URL if you renamed the app, or the links will send people to somebody else's site. |
| `DEFAULT_FROM_EMAIL` | `datool <no-reply@datool.local>` | The From: address on invitation and reset mail. |
| `EMAIL_HOST` | empty | SMTP host. **While it is empty, mail cannot go out** — provisioning still works, and the API hands the invitation link back to the admin who created the account, to pass on by hand. |
| `EMAIL_PORT` | `587` | SMTP port. |
| `EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD` | empty | SMTP credentials. |
| `EMAIL_USE_TLS` | `1` | `0` for a provider that wants a plain connection. |

With `DJANGO_DEBUG=0` the session and CSRF cookies are marked `Secure`, so the
app must be served over HTTPS (Fly does that by default). In DEBUG they are
not, so `http://localhost` works. The CSRF cookie is deliberately readable by
JavaScript — the SPA echoes it in `X-CSRFToken` — which is Django's own
arrangement, not a weakening.

Mail is printed to the log (`fly logs`) whenever `DJANGO_DEBUG=1`, which is
also how invitations are read in local development.

## Things to know

- **One machine only.** SQLite cannot be shared across machines. `fly launch`
  with a volume creates one; if you ever scaled up, `fly scale count 1`.
- **Login required.** Sessions last two weeks and renew on use. Registration
  is open to anyone with the URL — fine for a BA test; close registration
  before wider sharing. Organizations are made only by `create_org`.
- **Machine auto-stops** when idle and wakes on the next request (first hit
  after a pause takes a few seconds). Data persists on the volume.
- **Logs / status:** `fly logs`, `fly status`.
