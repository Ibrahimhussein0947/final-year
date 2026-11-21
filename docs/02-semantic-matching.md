# Semantic matching (Phase 9)

## Status: model installed and run; English works, Amharic and Afaan Oromoo do not (measured)

| Part | State |
|---|---|
| Python FastAPI embedding service (`apps/ai`) | **Run.** 17 tests pass (fake backend). The first real run found and fixed a bug that made every valid request return 422 (the request models could not be resolved under `from __future__ import annotations`). Served over HTTP with the real model and called successfully from the Node client. |
| Does the model recognise "vehicle repair specialist" = "automotive maintenance technician"? | **Yes, for English.** Cosine 0.82, against 0.65 for "car engine mechanic" and -0.13 for "baking bread and cakes". |
| English occupation paraphrases (16 occupations, 2 wordings each) | top-1 0.875, MRR 0.922, AUC 0.983; mean cosine same occupation 0.69, different 0.19. |
| **Amharic** | **Poor.** top-1 0.25, AUC 0.77; different occupations score 0.585 on average against 0.691 for the same occupation: the model barely separates them. |
| **Afaan Oromoo** | **Poor.** top-1 0.375, AUC 0.76; different 0.56 vs same 0.73. |
| Cross-language (English text vs Amharic / Afaan Oromoo text) | English to Amharic: top-1 0.56, AUC 0.83 (moderate). English to Afaan Oromoo: AUC 0.57, close to chance. |
| Effect on ranking (hybrid vs rules, English benchmark) | **No measurable gain**: NDCG@5 0.969 vs 0.961, difference +0.008 (95% interval -0.007 to +0.024), so still not established. The benchmark is easy and English (docs/06). |
| Calibration bounds (cosine 0.25 -> 0, 0.70 -> 1) | **Checked against a small English sample, left unchanged.** Unrelated pairs: median 0.23, 90th percentile 0.35, max 0.42 (n=50). Related pairs: 10th percentile 0.55, median 0.69, min 0.27 (n=10). The bounds fit those numbers, but 10 related pairs is far too few to call them tuned. |
| Amharic and Afaan Oromoo probe phrases | Written without native-speaker review: the poor Amharic / Afaan Oromoo scores could partly be unnatural phrases, not only model weakness. **Needs review before the numbers are quoted as model quality.** |

**What the system does about it.** Text written mostly in Ethiopic script (Amharic) is **not embedded**; such profiles and jobs are matched by the rules alone, so unreliable similarities never raise a score (`isMostlyEthiopic`, tested). Afaan Oromoo is written in Latin letters and cannot be told apart from English by script, so it is **not guarded**: while Afaan Oromoo profiles are common, run without the AI service or accept that wording similarity for those profiles is unreliable. The interface and documents must not claim multilingual semantic matching.

Environment note: the install needed several attempts because DNS lookups for `files.pythonhosted.org` failed intermittently on this network; pip's cache made retries cheap. Python 3.12 is used (3.14 cannot run PyTorch yet). Nothing was faked: results carry `rules-1.0` whenever semantic information is absent and `hybrid-1.0` only when real vectors were used.

## Other models tried (November 2026): none fixes Amharic

The same 16-occupation probe (`evaluation/multilingual_probe.py`, run per model with `AI_MODEL` and, for E5, `AI_TEXT_PREFIX="query: "`; reports in `apps/ai/evaluation/reports/`) on three models. AUC is the chance that two wordings of the same occupation score higher than two different occupations (1.0 perfect, 0.5 chance); top-1 is how often the right partner ranks first.

| Model (dim) | English AUC / top-1 | Amharic AUC / top-1 | Afaan Oromoo AUC / top-1 | Note |
|---|---|---|---|---|
| paraphrase-multilingual-MiniLM-L12 (384), **current** | 0.983 / 0.875 | 0.77 / 0.25 | 0.76 / 0.375 | |
| multilingual-e5-small (384) | 0.936 / 0.875 | 0.72 / 0.44 | 0.80 / 0.875 | all cosines squeezed into 0.80 to 0.93 (same 0.88-0.93, different 0.81-0.88), so the current calibration bounds (0.25 to 0.70) would have to be redone |
| paraphrase-multilingual-mpnet-base-v2 (768) | 0.998 / 1.0 | 0.68 / 0.19 | 0.77 / 0.56 | larger, slower, needs re-embedding everything |
| LaBSE (768) | 0.995 / 0.94 | 0.93 / 0.62 | 0.92 / 0.81 | the strongest on Amharic and Afaan Oromoo in the probe, but about 2.5x slower per text (154 ms vs 60 ms); English to Afaan Oromoo is still weak (0.57) |
| multilingual-e5-base (768) | 0.923 / 0.88 | 0.72 / 0.50 | 0.79 / 0.62 | no better than e5-small |

**Update (`evaluation/compare_models.py`, with bootstrap 95% intervals, `reports/model_comparison.md`):** LaBSE was measured at last. Its Amharic AUC is 0.93 [0.83-0.99] against 0.77 [0.62-0.89] for the current model, and its Afaan Oromoo AUC is 0.92 [0.83-0.98] against 0.76 [0.62-0.88]. The Amharic intervals barely overlap, so LaBSE is the best candidate, but the probe has only 16 non-native-reviewed phrases, so this is a shortlist result, not proof. Switching would mean re-embedding all data and redoing the score calibration, and the hybrid ranking has not been re-evaluated with it. **Not switched yet.**

**LaBSE in the ranking evaluation (November 2026).** The 59 English benchmark texts were re-embedded with LaBSE (`AI_MODEL=sentence-transformers/LaBSE`, `evaluation/embed_texts.py`) and `npm run eval` was run with the calibration bounds unchanged. Hybrid NDCG@5 is 0.971 with LaBSE against 0.969 with the current model (shipped rules 0.961, keyword 0.946). Hybrid minus shipped rules is +0.010 (95% interval -0.004 to 0.026), so the interval includes zero: **no ranking gain is established with either model, and LaBSE is not distinguishable from the current model on this benchmark.** "Semantic only" improves from NDCG@5 0.926 to 0.941. Fairness rates by education and experience were 1.00 in every group for LaBSE hybrid (small groups). LaBSE's cosines sit higher (median 0.42, 10th to 90th percentile 0.34 to 0.55) than the current model's (median 0.30, 0.18 to 0.48), so the 0.25 to 0.70 calibration bounds would have to be re-tuned before a switch. What this does **not** test: the benchmark is English and near its ceiling, while LaBSE's advantage is on Amharic and Afaan Oromoo, which no ranking benchmark here covers. **Conclusion: LaBSE does no harm on English and is the best measured candidate for Amharic and Afaan Oromoo, but the model was still not switched.** Deciding needs a ranking benchmark with native-reviewed Amharic and Afaan Oromoo text.

**Reading it honestly:** no tested model separates Amharic occupations reliably (AUC 0.68 to 0.77 for all three, top-1 at most 0.44). Afaan Oromoo moves around (E5 top-1 0.875, MPNet 0.56, current 0.375) but with 16 phrases written without a native speaker a difference of a few phrases is noise, and E5 pays for it with worse English and a squeezed score range. **So the model was not changed**: there is no measured gain worth a re-embedding, a recalibration and a slower service. `AI_TEXT_PREFIX` support was added so a model that needs a prefix can be evaluated or adopted without code changes.

**What was changed instead:** text that is clearly Afaan Oromoo is now kept out of the embedding like Amharic (`isLikelyAfaanOromoo`, a check for very common Afaan Oromoo words: at least 6 words, 3 hits and 12 percent of the words), so unreliable similarities cannot raise an Afaan Oromoo worker's or job's score; they are matched by the rules alone. Limits: it is a word list, not a language model; a short title alone is not flagged; Afaan Oromoo that is mostly English skill names can slip through; an English text that happens to contain several of the words could be flagged (it then only loses the optional meaning boost).

## How it works

```
Express API ---- text ----> Python service ---- 384-d vector ----> Express API
(owns all data)   (names, phones and ids are never sent)           stored in Job / WorkerProfile.embedding
```

- **What is embedded.** Worker: headline, occupation, "Skills: ...", bio. Job: title, "Skills: ..." (required first), description. Most informative parts first, clipped to 1500 characters, because the model reads only about 128 word pieces.
- **When.** After any profile or job change (debounced 1.5 s), plus `npm run embeddings:backfill`. If the service is down, nothing is written and matching silently uses the rule-based score. After a failure the client skips calls for 30 s so requests stay fast.
- **Skills component.** `taxonomy` score as in Phase 8, then `score = taxonomy + 0.5 * (1 - taxonomy) * semantic`, where `semantic` is the calibrated cosine in [0, 1]. Semantic evidence fills part of the remaining gap and **never lowers** a score, so a worker with the right skills is not penalised for different wording. A worker with no listed skills gets at most half credit from wording alone, and the note says so.
- **Gate.** The Phase 8 rule "no required skill covered caps the label at partial" is lifted when the calibrated semantic score is at least 0.5 (the text clearly describes this work).
- **Recall.** Besides the SQL candidates (shared skill, related skill, same category), the API adds the nearest workers/jobs by embedding (cosine >= 0.45, up to 100). Cosine is computed in Node over up to 3000 rows: fine for a prototype; pgvector is the scale path.
- **Version labels.** Results carry `engineVersion` `rules-1.0` or `hybrid-1.0`, stored with every recommendation so the Phase 13 evaluation can compare the baselines honestly.

## Security
Service reachable only from the API (bind 127.0.0.1 / internal network), shared secret in `X-Service-Token` (constant-time comparison), input limits (64 texts, 2000 characters), no personal identifiers in requests.

## What is still to do
1. Native speakers review the Amharic and Afaan Oromoo probe phrases (and the interface translations); rerun `python evaluation/multilingual_probe.py` and compare. If the numbers stay poor, consider a model with better Ethiopian-language coverage and rerun the probe on it before adopting it.
2. Calibrate `SEMANTIC_LOW/HIGH` on a larger set of related and unrelated pairs (at least 100 each, including hard paraphrases), held out from the evaluation pairs.
3. A harder, paraphrase-heavy benchmark where embeddings could matter (docs/06 section 5), labelled by independent annotators.
4. Deploy the AI service in Docker (`infra/docker/ai.Dockerfile` has still never been built) and run `npm run embeddings:backfill` against real data.

## Reproducing the numbers
```bash
cd apps/ai
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install --extra-index-url https://download.pytorch.org/whl/cpu torch -r requirements.txt
.venv/Scripts/python -m pytest                                  # 17 tests
.venv/Scripts/python evaluation/multilingual_probe.py           # writes evaluation/reports/multilingual_probe.json
npm run eval:export -w @ethiotalent/api                         # writes the benchmark texts
.venv/Scripts/python evaluation/embed_texts.py ../api/evaluation/benchmark-texts.json ../api/evaluation/benchmark-embeddings.json
npm run eval -w @ethiotalent/api                                # adds the hybrid rows to docs/evaluation-results.md
```

## Known limits
- The API tests use hand-made vectors; they prove the plumbing and arithmetic, not language understanding. Language quality is measured by the probe and the evaluation, above.
- One small model, CPU only; ~128-token window truncates long descriptions.
- Afaan Oromoo and Amharic quality was measured as poor for this model (above); only English is supported for meaning-based matching.
