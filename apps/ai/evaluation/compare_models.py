"""Compare candidate embedding models on the multilingual occupation probe, side by side, with uncertainty.

Reuses the probe data from multilingual_probe.py (16 occupations x 2 wordings x English / Amharic / Afaan Oromo).
For each model and language it reports AUC, top-1 accuracy and MRR, and a bootstrap 95% interval for the AUC
(resampling the 16 occupations) so differences that are just noise are visible as overlapping intervals.

LIMITS: same as the probe. The Amharic and Afaan Oromo phrases are NOT native-reviewed, 16 items is small, and
this measures "same occupation, different wording", not end-to-end ranking quality. Use it to shortlist models,
then confirm on a real, native-labelled ranking set before changing the shipped model.

Usage (from apps/ai):
  .venv\\Scripts\\python evaluation\\compare_models.py                 # default shortlist
  .venv\\Scripts\\python evaluation\\compare_models.py --models sentence-transformers/LaBSE intfloat/multilingual-e5-base
Output: evaluation/reports/model_comparison.json, model_comparison.md and (if matplotlib is installed) model_comparison.png
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from sklearn.metrics import roc_auc_score

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

from multilingual_probe import LANGS, OCCUPATIONS  # noqa: E402

DEFAULT_MODELS = [
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",  # shipped
    "sentence-transformers/paraphrase-multilingual-mpnet-base-v2",
    "intfloat/multilingual-e5-small",
    "sentence-transformers/LaBSE",
]
# Models trained with an instruction prefix. Without it their scores are not representative.
PREFIXES = {"intfloat/multilingual-e5-small": "query: ", "intfloat/multilingual-e5-base": "query: ", "intfloat/multilingual-e5-large": "query: "}
REPORTS = HERE / "reports"


def probe_sets(embed) -> dict[str, tuple[list[str], list[str]]]:
    sets = {name: ([o[i][0] for o in OCCUPATIONS], [o[i][1] for o in OCCUPATIONS]) for name, i in LANGS.items()}
    for other in ("Amharic", "Afaan Oromo"):
        i = LANGS[other]
        sets[f"English -> {other}"] = ([o[0][0] for o in OCCUPATIONS], [o[i][1] for o in OCCUPATIONS])
    return sets


def score(sims: np.ndarray, iterations: int = 1000, seed: int = 7) -> dict:
    n = sims.shape[0]
    eye = np.eye(n, dtype=bool)

    def auc_of(rows: np.ndarray) -> float:
        # positives: the true pair of each chosen row; negatives: that row against every other B
        pos = sims[rows, rows]
        neg = np.concatenate([sims[r, np.arange(n) != r] for r in rows])
        return float(roc_auc_score(np.r_[np.ones(pos.size), np.zeros(neg.size)], np.r_[pos, neg]))

    rows = np.arange(n)
    top1 = float(np.mean([int(np.argmax(sims[i]) == i) for i in rows]))
    mrr = float(np.mean([1.0 / (1 + int((sims[i] > sims[i, i]).sum())) for i in rows]))
    rng = np.random.default_rng(seed)
    boots = []
    for _ in range(iterations):
        pick = rng.integers(0, n, n)
        try:
            boots.append(auc_of(pick))
        except ValueError:  # degenerate resample
            continue
    lo, hi = (float(np.quantile(boots, 0.025)), float(np.quantile(boots, 0.975))) if boots else (float("nan"), float("nan"))
    return {"auc": round(auc_of(rows), 3), "auc_ci": [round(lo, 3), round(hi, 3)], "top1": round(top1, 3), "mrr": round(mrr, 3),
            "mean_same": round(float(sims[eye].mean()), 3), "mean_diff": round(float(sims[~eye].mean()), 3)}


def run_model(name: str) -> dict:
    from sentence_transformers import SentenceTransformer

    t0 = time.time()
    model = SentenceTransformer(name, device="cpu")
    load_s = time.time() - t0
    prefix = PREFIXES.get(name, "")

    def embed(texts: list[str]) -> np.ndarray:
        return model.encode([prefix + t for t in texts], normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)

    result: dict = {"model": name, "dim": int(model.get_sentence_embedding_dimension()), "prefix": prefix, "load_seconds": round(load_s, 1), "sets": {}}
    t1 = time.time()
    n_texts = 0
    for label, (a, b) in probe_sets(embed).items():
        va, vb = embed(a), embed(b)
        n_texts += len(a) + len(b)
        result["sets"][label] = score(va @ vb.T)
    result["ms_per_text"] = round((time.time() - t1) / n_texts * 1000, 1)
    return result


def markdown(results: list[dict]) -> str:
    labels = list(results[0]["sets"])
    lines = ["# Embedding model comparison (multilingual occupation probe)", "",
             "AUC with bootstrap 95% interval over the 16 occupations. **Overlapping intervals mean the difference is not distinguishable from noise.** "
             "Amharic / Afaan Oromo phrases are not native-reviewed; this is a shortlist tool, not a verdict.", "",
             "| Model | dim | ms/text | " + " | ".join(labels) + " |", "|---|---|---|" + "---|" * len(labels)]
    for r in results:
        cells = [f"{r['sets'][l]['auc']:.3f} [{r['sets'][l]['auc_ci'][0]:.2f}-{r['sets'][l]['auc_ci'][1]:.2f}]" for l in labels]
        lines.append(f"| {r['model'].split('/')[-1]} | {r['dim']} | {r['ms_per_text']} | " + " | ".join(cells) + " |")
    lines += ["", "Top-1 accuracy (the true paraphrase is the single closest candidate):", "",
              "| Model | " + " | ".join(labels) + " |", "|---|" + "---|" * len(labels)]
    for r in results:
        lines.append(f"| {r['model'].split('/')[-1]} | " + " | ".join(f"{r['sets'][l]['top1']:.2f}" for l in labels) + " |")
    return "\n".join(lines) + "\n"


def chart(results: list[dict], path: Path) -> bool:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return False
    labels = list(results[0]["sets"])
    width = 0.8 / len(results)
    fig, ax = plt.subplots(figsize=(11, 4.8))
    for k, r in enumerate(results):
        aucs = np.array([r["sets"][l]["auc"] for l in labels])
        err = np.array([[r["sets"][l]["auc"] - r["sets"][l]["auc_ci"][0], r["sets"][l]["auc_ci"][1] - r["sets"][l]["auc"]] for l in labels]).T
        ax.bar(np.arange(len(labels)) + k * width, aucs, width, yerr=np.clip(err, 0, None), capsize=2, label=r["model"].split("/")[-1])
    ax.axhline(0.5, color="grey", lw=0.8, ls="--")
    ax.set_xticks(np.arange(len(labels)) + width * (len(results) - 1) / 2)
    ax.set_xticklabels(labels, rotation=15)
    ax.set_ylabel("AUC (0.5 = chance)")
    ax.set_ylim(0.3, 1.02)
    ax.set_title("Occupation paraphrase probe, by model and language (bars: 95% bootstrap interval)")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="*", default=DEFAULT_MODELS)
    args = ap.parse_args()
    results = []
    for name in args.models:
        print(f"running {name} ...", flush=True)
        try:
            results.append(run_model(name))
        except Exception as exc:  # a model that cannot be downloaded/loaded must not hide the others
            print(f"  skipped {name}: {type(exc).__name__}: {exc}", file=sys.stderr)
    if not results:
        sys.exit("no model could be run")
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "model_comparison.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    md = markdown(results)
    (REPORTS / "model_comparison.md").write_text(md, encoding="utf-8")
    made = chart(results, REPORTS / "model_comparison.png")
    print("\n" + md)
    if not made:
        print("(matplotlib not installed: chart skipped)")


if __name__ == "__main__":
    main()
