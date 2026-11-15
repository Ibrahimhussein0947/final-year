"""Embeds a JSON file of {id: text} with the real model and writes {model, dim, vectors: {id: [...]}}.

Used by the ranking evaluation (apps/api: `npm run eval:export` then this script then `npm run eval`).
    python evaluation/embed_texts.py ../api/evaluation/benchmark-texts.json ../api/evaluation/benchmark-embeddings.json
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # make the `app` package importable

os.environ.setdefault("AI_SERVICE_TOKEN", "embed-texts-only-not-a-secret-000")  # the server is not started here

from app.config import load_settings  # noqa: E402
from app.embeddings import CachedEmbedder, SentenceTransformerBackend  # noqa: E402


def main(src: str, dst: str) -> None:
    texts: dict[str, str] = json.load(open(src, encoding="utf-8"))
    cfg = load_settings()
    backend = SentenceTransformerBackend(cfg.model_name)
    embed = CachedEmbedder(backend).embed
    ids = list(texts)
    vecs = embed([texts[i] for i in ids])
    out = {"model": backend.name, "dim": backend.dim, "texts": texts, "vectors": {i: [round(float(x), 6) for x in v] for i, v in zip(ids, vecs)}}
    json.dump(out, open(dst, "w", encoding="utf-8"))
    print(f"embedded {len(ids)} texts with {backend.name} (dim {backend.dim}) -> {dst}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
