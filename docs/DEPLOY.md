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

## Deploy (and every update)

```sh
fly deploy
```

The Dockerfile builds the frontend, installs the backend, and starts
gunicorn; migrations run automatically at container start (deliberately not
as a Fly release command — release machines don't mount the volume the
database lives on).

Open `https://<app>.fly.dev` and send that URL to the tester.

## Things to know

- **One machine only.** SQLite cannot be shared across machines. `fly launch`
  with a volume creates one; if you ever scaled up, `fly scale count 1`.
- **No login.** Anyone with the URL can view and edit analyses — fine for a
  BA test, not for the public. Auth is the first thing to add before wider
  sharing.
- **Machine auto-stops** when idle and wakes on the next request (first hit
  after a pause takes a few seconds). Data persists on the volume.
- **Logs / status:** `fly logs`, `fly status`.
