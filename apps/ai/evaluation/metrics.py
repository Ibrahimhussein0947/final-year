"""Ranking and retrieval metrics (Python port of apps/api/src/evaluation/metrics.ts, same definitions).

A ranking is a list of candidate ids, best first. `grades` maps candidate id -> graded relevance (0..3).
"Relevant" for precision/recall/MRR means grade >= RELEVANT_GRADE. Metrics that are undefined for a query
(nobody relevant) return None, never 0, so they are skipped by `mean` instead of dragging the average down.
"""
from __future__ import annotations

import math
from typing import Mapping, Sequence

import numpy as np

RELEVANT_GRADE = 2
Grades = Mapping[str, int]


def _grade(g: Grades, cid: str) -> int:
    return g.get(cid, 0)


def total_relevant(g: Grades) -> int:
    return sum(1 for v in g.values() if v >= RELEVANT_GRADE)


def precision_at_k(ranking: Sequence[str], g: Grades, k: int) -> float:
    """Share of the top K that is relevant. Divides by K even if fewer were returned."""
    if k <= 0:
        return 0.0
    return sum(1 for c in ranking[:k] if _grade(g, c) >= RELEVANT_GRADE) / k


def recall_at_k(ranking: Sequence[str], g: Grades, k: int) -> float | None:
    total = total_relevant(g)
    if total == 0:
        return None
    return sum(1 for c in ranking[:k] if _grade(g, c) >= RELEVANT_GRADE) / total


def ndcg_at_k(ranking: Sequence[str], g: Grades, k: int) -> float | None:
    """Gain 2^grade - 1, discounted by log2(rank + 1), divided by the best possible ordering."""
    gain = lambda v: 2**v - 1  # noqa: E731
    dcg = sum(gain(_grade(g, c)) / math.log2(i + 2) for i, c in enumerate(ranking[:k]))
    ideal_grades = sorted((v for v in g.values() if v > 0), reverse=True)[:k]
    ideal = sum(gain(v) / math.log2(i + 2) for i, v in enumerate(ideal_grades))
    return None if ideal == 0 else dcg / ideal


def reciprocal_rank(ranking: Sequence[str], g: Grades) -> float | None:
    if total_relevant(g) == 0:
        return None
    for i, c in enumerate(ranking):
        if _grade(g, c) >= RELEVANT_GRADE:
            return 1.0 / (i + 1)
    return 0.0


def coverage(lists: Sequence[Sequence[str]], universe: Sequence[str]) -> float:
    if not universe:
        return 0.0
    seen = {c for lst in lists for c in lst}
    return sum(1 for c in universe if c in seen) / len(universe)


def mean(xs: Sequence[float | None]) -> float | None:
    vals = [x for x in xs if x is not None]
    return None if not vals else sum(vals) / len(vals)


def bootstrap_ci(values: Sequence[float], iterations: int = 2000, seed: int = 7, alpha: float = 0.05) -> tuple[float, float, float]:
    """(mean, low, high) percentile bootstrap interval. Use on per-query differences (A - B) for a paired
    comparison, so a small gain is not reported as real when the interval includes 0."""
    arr = np.asarray(values, dtype=float)
    if arr.size == 0:
        return 0.0, 0.0, 0.0
    rng = np.random.default_rng(seed)
    means = rng.choice(arr, size=(iterations, arr.size), replace=True).mean(axis=1)
    return float(arr.mean()), float(np.quantile(means, alpha / 2)), float(np.quantile(means, 1 - alpha / 2))
