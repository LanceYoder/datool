# Deploying

datool runs as one Fly.io app, **datool** (https://datool.fly.dev). Django
serves both the API and the built React frontend from the same origin. The
database is SQLite on a Fly volume mounted at `/data`, so the app must stay
at **one machine**. It stops when idle and wakes on the next request, which
takes a few seconds.

## Deploy

```sh
fly deploy
```

The Dockerfile builds the frontend, installs the backend and starts
gunicorn. Migrations run when the container starts.

`fly deploy` uploads your **working directory**, uncommitted changes
included. To ship exactly a pushed commit, deploy from a clean checkout:

```sh
git worktree add --detach /tmp/datool-deploy <commit>
cd /tmp/datool-deploy && fly deploy
cd - && git worktree remove /tmp/datool-deploy
```

Check it afterwards with `fly status` and `fly logs`.

## First-time setup (only for a new app)

```sh
fly launch --no-deploy          # keep the existing fly.toml
fly volumes create data --size 1
fly secrets set DJANGO_SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))')"
fly deploy
fly ssh console -C "python manage.py createsuperuser"
```

A different app name also needs `DJANGO_CSRF_TRUSTED_ORIGINS` in
`fly.toml` and the `FRONTEND_ORIGIN` secret changed to match. For accounts
and organizations, see [ACCOUNTS.md](ACCOUNTS.md).

## Settings

Set with `fly secrets set NAME=value`. All are optional.

| Variable | Purpose |
| --- | --- |
| `DJANGO_SECRET_KEY` | Signs sessions and reset links. Always set in production; changing it signs everyone out. |
| `DJANGO_DEBUG` | `0` in production (set in `fly.toml`). Turns on secure cookies. |
| `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS` | The app's hostnames and origins (set in `fly.toml`). |
| `DATABASE_URL` | Defaults to SQLite on the volume; a `postgres://` URL switches databases. |
| `ESV_API_KEY` | Crossway key for the ESV verse panel (a default is committed; non-commercial terms). BSB always works. |
| `FRONTEND_ORIGIN` | Where links in emails point (default `https://datool.fly.dev`). |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, `DEFAULT_FROM_EMAIL` | SMTP for invitations and password resets. Unset, no mail goes out and links are shown on screen instead. |
| `DATOOL_*_RATE` | Rate limits for login, registration, resets and invitations. |

Registration is open to anyone with the URL. Close it before sharing the
app widely.
