"""EthioTalent AI service: multilingual sentence embeddings and similarity.

The Node API owns all data and authorisation. This service only turns text into vectors and compares them.
It is meant to be reachable only from the API's network (bound to localhost / an internal Docker network)
and requires a shared service token on every request.
"""

import hmac
import logging
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from .config import Settings, load_settings
from .embeddings import CachedEmbedder, EmbeddingBackend, SentenceTransformerBackend

log = logging.getLogger("ai")


def create_app(settings: Settings | None = None, backend: EmbeddingBackend | None = None) -> FastAPI:
    cfg = settings or load_settings()
    state: dict[str, object] = {}

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        started = time.time()
        b = backend or SentenceTransformerBackend(cfg.model_name)
        state["embedder"] = CachedEmbedder(b, cfg.cache_size)
        state["backend"] = b
        log.info("model %s ready (dim %s) in %.1fs", b.name, b.dim, time.time() - started)
        yield

    app = FastAPI(title="EthioTalent AI service", version="1.0.0", lifespan=lifespan, docs_url=None, redoc_url=None)

    def require_token(x_service_token: str | None = Header(default=None)) -> None:
        if not x_service_token or not hmac.compare_digest(x_service_token, cfg.service_token):
            raise HTTPException(status_code=401, detail="invalid service token")

    class Texts(BaseModel):
        texts: list[str] = Field(min_length=1, max_length=cfg.max_texts)

        @field_validator("texts")
        @classmethod
        def check(cls, v: list[str]) -> list[str]:
            cleaned = [t.strip() for t in v]
            if any(not t for t in cleaned):
                raise ValueError("texts must not be empty")
            if any(len(t) > cfg.max_text_chars for t in cleaned):
                raise ValueError(f"each text must be at most {cfg.max_text_chars} characters")
            return cleaned

    class SimilarityRequest(BaseModel):
        query: str = Field(min_length=1, max_length=cfg.max_text_chars)
        candidates: list[str] = Field(min_length=1, max_length=200)

        @field_validator("candidates")
        @classmethod
        def check(cls, v: list[str]) -> list[str]:
            cleaned = [t.strip() for t in v]
            if any(not t or len(t) > cfg.max_text_chars for t in cleaned):
                raise ValueError("invalid candidate text")
            return cleaned

    @app.get("/health")
    def health():
        b: EmbeddingBackend | None = state.get("backend")  # type: ignore[assignment]
        return {"status": "ok" if b else "starting", "model": b.name if b else None, "dim": b.dim if b else None}

    @app.post("/v1/embed", dependencies=[Depends(require_token)])
    def embed(body: Texts):
        embedder: CachedEmbedder = state["embedder"]  # type: ignore[assignment]
        vecs = embedder.embed(body.texts)
        return {
            "model": embedder.backend.name,
            "dim": embedder.backend.dim,
            "embeddings": [[round(float(x), 6) for x in row] for row in vecs],
        }

    @app.post("/v1/similarity", dependencies=[Depends(require_token)])
    def similarity(body: SimilarityRequest):
        embedder: CachedEmbedder = state["embedder"]  # type: ignore[assignment]
        vecs = embedder.embed([body.query, *body.candidates])
        sims = vecs[1:] @ vecs[0]  # vectors are L2-normalised, so this is cosine similarity
        return {"model": embedder.backend.name, "similarities": [round(float(s), 6) for s in sims]}

    return app


def app_factory() -> FastAPI:  # for `uvicorn app.main:app_factory --factory`
    return create_app()
