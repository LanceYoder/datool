# datool

A web tool for **discourse analysis of Greek New Testament passages**:
select a text, DAtool automatically builds definite relationships, then use the DA-specific editor to 
finish your analysis. Much easier than paper or Microsoft Excel!

See [`docs/OVERVIEW.md`](docs/OVERVIEW.md) for the full design. Docs are Claude-speak, not intended for human consumption.

## Running locally

Backend (Django + DRF, Python ≥ 3.11, [uv](https://docs.astral.sh/uv/)):

```bash
uv sync
uv run python manage.py migrate
uv run python manage.py runserver          # http://localhost:8000
```

By default this uses SQLite (zero configuration). For Postgres parity with
production, start the bundled Docker service and point `DATABASE_URL` at it:

```bash
docker compose up -d
export DATABASE_URL=postgres://datool:datool@localhost:5432/datool
```

Frontend (React + Vite, in a second terminal):

```bash
cd frontend
npm install
npm run dev                                 # http://localhost:5173
```

The Vite dev server proxies `/api` to Django on port 8000.

## Tests

```bash
uv run pytest
```

## Corpus data

The Greek text and morphology come from the
[MorphGNT SBLGNT](https://github.com/morphgnt/sblgnt) dataset, bundled under
`da/corpus/data/` — see `ATTRIBUTION.md` there for licensing (SBLGNT EULA for the
text; CC-BY-SA for the morphological analysis).
