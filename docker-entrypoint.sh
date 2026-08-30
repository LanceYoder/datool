#!/bin/sh
# Migrations run at container start, NOT as a Fly release command: Fly's
# release machines don't mount volumes, and the SQLite database lives on one.
set -e
python manage.py migrate --noinput
# --preload: the corpus tables (~560ms to load, ~all of first-request latency)
# are read once in the master and shared copy-on-write by the workers.
exec gunicorn config.wsgi:application \
  --preload \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-2}"
