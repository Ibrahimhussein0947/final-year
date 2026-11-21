"""Embedding backends and a small thread-safe cache."""
from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from typing import Protocol

import numpy as np


class EmbeddingBackend(Protocol):
    name: str
    dim: int

    def encode(self, texts: list[str]) -> np.ndarray:
        """Return an (n, dim) float32 array of L2-normalised vectors, so cosine similarity is a dot product."""
        ...


class SentenceTransformerBackend:
    """Real multilingual sentence embeddings (Sentence Transformers / PyTorch, CPU)."""

    def __init__(self, model_name: str, prefix: str = ""):
        from sentence_transformers import SentenceTransformer  # imported lazily: heavy

        self.name = model_name
        # Some models (the E5 family) must be told what a text is for, by a short prefix such as "query: ".
        self.prefix = prefix
        self._model = SentenceTransformer(model_name, device="cpu")
        self.dim = int(self._model.get_sentence_embedding_dimension())
        self.max_tokens = int(self._model.max_seq_length)
        self._lock = threading.Lock()  # one encode at a time: avoids CPU oversubscription

    def encode(self, texts: list[str]) -> np.ndarray:
        with self._lock:
            vecs = self._model.encode([self.prefix + t for t in texts], normalize_embeddings=True, convert_to_numpy=True, batch_size=32, show_progress_bar=False)
        return vecs.astype(np.float32)


class HashingBackend:
    """Deterministic bag-of-words hashing vectors. FOR TESTS ONLY: it has no notion of meaning."""

    name = "test-hashing"

    def __init__(self, dim: int = 64):
        self.dim = dim

    def encode(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for i, text in enumerate(texts):
            for word in text.lower().split():
                h = int(hashlib.sha1(word.encode()).hexdigest(), 16)
                out[i, h % self.dim] += 1.0 if (h >> 40) % 2 == 0 else -1.0
            norm = np.linalg.norm(out[i])
            if norm > 0:
                out[i] /= norm
        return out


class CachedEmbedder:
    """LRU cache in front of a backend. Identical texts (common for skill names) are embedded once."""

    def __init__(self, backend: EmbeddingBackend, size: int = 5000):
        self.backend = backend
        self.size = size
        self._cache: OrderedDict[str, np.ndarray] = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    @staticmethod
    def _key(text: str) -> str:
        return hashlib.sha1(text.encode("utf-8")).hexdigest()

    def embed(self, texts: list[str]) -> np.ndarray:
        keys = [self._key(t) for t in texts]
        result: list[np.ndarray | None] = [None] * len(texts)
        missing: list[int] = []
        with self._lock:
            for i, k in enumerate(keys):
                if k in self._cache:
                    self._cache.move_to_end(k)
                    result[i] = self._cache[k]
                    self.hits += 1
                else:
                    missing.append(i)
                    self.misses += 1
        if missing:
            fresh = self.backend.encode([texts[i] for i in missing])
            with self._lock:
                for j, i in enumerate(missing):
                    result[i] = fresh[j]
                    self._cache[keys[i]] = fresh[j]
                    self._cache.move_to_end(keys[i])
                while len(self._cache) > self.size:
                    self._cache.popitem(last=False)
        return np.stack(result)  # type: ignore[arg-type]
