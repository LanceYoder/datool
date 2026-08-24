#!/bin/sh
# Migrations run at container start, NOT as a Fly release command: Fly's
# release machines don't mount volumes, and the SQLite database lives on one.
set -e
python manage.py migrate --noinput
exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-2}"
