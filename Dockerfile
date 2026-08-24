# Single-app image: the built frontend is served by Django (WhiteNoise) from
# the same origin as the API. See docs/DEPLOY.md.

# ---- Stage 1: build the frontend -------------------------------------------
FROM node:22-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: the app -------------------------------------------------------
FROM python:3.11-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:$PATH"

COPY manage.py docker-entrypoint.sh ./
COPY config ./config
COPY da ./da
COPY --from=frontend /build/dist ./frontend/dist
RUN python manage.py collectstatic --noinput && chmod +x docker-entrypoint.sh

EXPOSE 8000
CMD ["./docker-entrypoint.sh"]
