import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.embeddings import CachedEmbedder, HashingBackend
from app.main import create_app

TOKEN = "t" * 32
H = {"X-Service-Token": TOKEN}


@pytest.fixture()
def client():
    app = create_app(Settings(model_name="test", service_token=TOKEN), backend=HashingBackend())
    with TestClient(app) as c:
        yield c


def test_health_is_open_and_reports_the_model(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "model": "test-hashing", "dim": 64}


@pytest.mark.parametrize("headers", [{}, {"X-Service-Token": "wrong"}, {"X-Service-Token": ""}])
def test_embedding_requires_the_service_token(client, headers):
    assert client.post("/v1/embed", json={"texts": ["hello"]}, headers=headers).status_code == 401
    assert client.post("/v1/similarity", json={"query": "a", "candidates": ["b"]}, headers=headers).status_code == 401


def test_embed_returns_normalised_vectors_of_the_right_shape(client):
    r = client.post("/v1/embed", json={"texts": ["vehicle repair", "cooking injera"]}, headers=H)
    assert r.status_code == 200
    body = r.json()
    assert body["dim"] == 64 and body["model"] == "test-hashing"
    vecs = np.array(body["embeddings"])
    assert vecs.shape == (2, 64)
    assert np.allclose(np.linalg.norm(vecs, axis=1), 1.0, atol=1e-4)


@pytest.mark.parametrize(
    "payload",
    [
        {"texts": []},
        {"texts": [""]},
        {"texts": ["   "]},
        {"texts": ["x" * 2001]},
        {"texts": ["ok"] * 65},
        {"texts": "not a list"},
        {},
    ],
)
def test_embed_validates_input(client, payload):
    assert client.post("/v1/embed", json=payload, headers=H).status_code == 422


def test_similarity_orders_candidates_and_identical_text_scores_one(client):
    r = client.post(
        "/v1/similarity",
        json={"query": "welding steel gates", "candidates": ["welding steel gates", "baking bread and cakes", "steel gates welding"]},
        headers=H,
    )
    sims = r.json()["similarities"]
    assert sims[0] == pytest.approx(1.0, abs=1e-4)
    assert sims[2] > sims[1]  # shares words with the query
    assert len(sims) == 3


def test_similarity_validates_input(client):
    assert client.post("/v1/similarity", json={"query": "a", "candidates": []}, headers=H).status_code == 422
    assert client.post("/v1/similarity", json={"query": "", "candidates": ["b"]}, headers=H).status_code == 422
    assert client.post("/v1/similarity", json={"query": "a", "candidates": [""]}, headers=H).status_code == 422


def test_cache_embeds_repeated_texts_once():
    calls = []

    class Counting(HashingBackend):
        def encode(self, texts):
            calls.append(list(texts))
            return super().encode(texts)

    cache = CachedEmbedder(Counting(), size=10)
    a = cache.embed(["engine repair", "brakes"])
    b = cache.embed(["engine repair", "welding"])
    assert np.allclose(a[0], b[0])
    assert calls == [["engine repair", "brakes"], ["welding"]]
    assert cache.hits == 1 and cache.misses == 3


def test_cache_evicts_the_oldest_entries():
    cache = CachedEmbedder(HashingBackend(), size=2)
    cache.embed(["a", "b", "c"])
    assert len(cache._cache) == 2


def test_unicode_text_is_accepted(client):
    r = client.post("/v1/embed", json={"texts": ["የተሽከርካሪ ጥገና ባለሙያ", "Ogeessa suphaa konkolaataa"]}, headers=H)
    assert r.status_code == 200
