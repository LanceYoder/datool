# datool

A web tool for **discourse analysis (bracketing) of Greek New Testament passages**:
paste a chunk of Greek text, get an automated first-pass analysis (proposition
segmentation + logical-relationship classification into a bracket tree), then refine
the structure and annotations in an editor built for the method.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the full design: the method being modeled,
the tree data model, the MorphGNT corpus foundation, the first-pass rules, and the
editor architecture.

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
