import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "evaluation"))

from metrics import (  # noqa: E402
    bootstrap_ci, coverage, mean, ndcg_at_k, precision_at_k, recall_at_k, reciprocal_rank,
)

G = {"a": 3, "b": 2, "c": 1, "d": 0}


def test_precision_divides_by_k_even_for_short_list():
    assert precision_at_k(["a"], G, 5) == 0.2
    assert precision_at_k(["a", "b", "d"], G, 3) == 2 / 3


def test_recall_and_undefined_when_nobody_relevant():
    assert recall_at_k(["a", "d"], G, 2) == 0.5
    assert recall_at_k(["a"], {"x": 0, "y": 1}, 1) is None


def test_ndcg_perfect_and_reversed():
    assert math.isclose(ndcg_at_k(["a", "b", "c"], G, 3), 1.0)
    assert ndcg_at_k(["d", "c", "b"], G, 3) < 0.5
    assert ndcg_at_k(["a"], {"a": 0}, 1) is None


def test_reciprocal_rank():
    assert reciprocal_rank(["d", "c", "b"], G) == 1 / 3
    assert reciprocal_rank(["d", "c"], G) == 0.0
    assert reciprocal_rank(["a"], {"a": 1}) is None


def test_coverage_and_mean_skip_none():
    assert coverage([["a", "b"], ["b"]], ["a", "b", "c", "d"]) == 0.5
    assert mean([1.0, None, 3.0]) == 2.0
    assert mean([None]) is None


def test_bootstrap_ci_contains_mean_and_is_deterministic():
    m, lo, hi = bootstrap_ci([0.1, 0.2, 0.0, 0.3, 0.1])
    assert lo <= m <= hi
    assert bootstrap_ci([0.1, 0.2, 0.0, 0.3, 0.1]) == (m, lo, hi)
    assert bootstrap_ci([]) == (0.0, 0.0, 0.0)
