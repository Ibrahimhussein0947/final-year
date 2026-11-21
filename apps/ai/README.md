# ai: embedding service

FastAPI service that turns text into multilingual sentence embeddings (Sentence Transformers) and compares them.
The Node API owns all data; this service only sees short texts and requires a shared token.

## Status
Run and measured on the real model (`paraphrase-multilingual-MiniLM-L12-v2`): 23 tests pass with a fake backend, and the
service answered correctly over HTTP. Good for English; **poor for Amharic and Afaan Oromoo** (probe phrases not yet
reviewed by native speakers). Not yet built as a Docker image. See `docs/02-semantic-matching.md` for numbers and limits.

## Set up (Python 3.11 or 3.12; PyTorch does not support 3.14 yet)
```powershell
cd apps/ai
py -3.12 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt     # large: PyTorch + sentence-transformers
copy .env.example .env                                          # then set AI_SERVICE_TOKEN
.\.venv\Scripts\python -m pytest                                # fast tests, fake backend
.\.venv\Scripts\python evaluation\multilingual_probe.py         # downloads the model (~470 MB) on first run
.\.venv\Scripts\python -m uvicorn app.main:app_factory --factory --host 127.0.0.1 --port 8100
```
Then in `apps/api/.env`: `AI_SERVICE_URL=http://127.0.0.1:8100` and the same `AI_SERVICE_TOKEN`, and run
`npm run embeddings:backfill -w @ethiotalent/api` once to embed existing skills, jobs and workers.

## Endpoints (all but /health need the `X-Service-Token` header)
- `GET /health`
- `POST /v1/embed` `{texts: string[]}` (1 to 64 texts, each up to 2000 characters) returns L2-normalised vectors
- `POST /v1/similarity` `{query, candidates[]}` returns cosine similarities

## Evaluation tools (Python)
- `evaluation/compare_models.py` runs several embedding models through the multilingual probe and writes `evaluation/reports/model_comparison.{json,md,png}` with bootstrap 95% intervals (`--models <names>` to choose models; default is a four-model shortlist, models already in the local Hugging Face cache are used, others are downloaded).
- `evaluation/metrics.py` is the Python port of the API's ranking metrics (Precision/Recall/NDCG@K, MRR, coverage, bootstrap CI), unit-tested in `tests/test_metrics.py`. It is the base for moving the full ranking evaluation (`npm run eval`) into Python.
