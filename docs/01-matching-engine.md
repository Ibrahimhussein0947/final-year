# Matching engine (Phase 8): rule-based baseline

Engine version: `rules-1.0`. Code: `apps/api/src/modules/matching/`.

This is the **deterministic, explainable baseline**. It is baseline #2 in the evaluation plan (keyword vs rule-based weighted vs hybrid semantic). Phase 9 adds semantic similarity on top of the same structure.

> Design note (a change from the first architecture sketch): scoring lives in the TypeScript API, not in the Python service. One implementation serves both the "AI available" and the "AI down" case. The Python service (Phase 9+) will supply what only it can: embeddings / semantic similarity and NLP extraction. It will feed the skills component rather than replace the scorer.

## Score

For a (job, worker) pair each component yields `s_i` in [0, 1] or **null** when it cannot be judged.

```
score      = 100 * sum(w_i * s_i) / sum(w_i)      over components that are not null
confidence = sum(w_i of assessed components) / sum(all w_i)
```

Missing data is left out and the remaining weights are renormalized, so missing information is never counted as zero. `confidence` says how much of the profile the score rests on, and is shown to users. If nothing can be assessed, the result is score 0 with confidence 0 rather than an invented number.

Default weights (from the brief; admin-editable globally and per job category, versioned in `MatchWeights`):

| Component | Weight |
|---|---|
| Skills | 0.308 |
| Experience | 0.176 |
| Location | 0.132 |
| Qualification | 0.088 |
| Availability | 0.088 |
| Salary and preferences | 0.088 |
| Sector requirements | 0.12 |

The first six keep the brief's ratios (35/20/15/10/10/10, scaled by 0.88); **sector requirements** (Phase 15) take 12%. A job with no sector criteria leaves that component out entirely (not applicable, so confidence is not reduced) and scores exactly as before. A known-unmet must-have sector requirement limits the score to 39 and makes the person not eligible: see docs/10-sector-criteria.md.

## Components

**Skills.** Each job skill earns credit: exact skill = 1; a related skill (taxonomy relation, treated as symmetric) = the relation's weight (0.3 to 0.8); none = 0. Credit is multiplied by `min(1, worker level / required level)` when the job states a minimum level. Required skills weigh 1, nice-to-have skills 0.5. Null if the job lists no skills or the worker lists none.

**Experience.** Relevant years = max(work-history years in the job's category, declared years if the worker's category matches else 40% of declared years). No stated minimum: score is `0.7 + 0.3 * min(years/5, 1)`, so inexperienced people are never penalized. With a minimum m: `min(1, years/m)`.

**Location.** Remote job = 1. Both have GPS: distance by haversine against the worker's travel limit L (default 40 km): up to L/2 = 1, falling to 0.5 at L; beyond L: 0.4 if willing to relocate, otherwise decays to 0 at 3L. Otherwise by administrative areas: same woreda 1.0, same zone/city 0.95 (when it covers the shallower side) or 0.8, same region 0.5, other region 0.3 (relocation) or 0.05. Hybrid jobs never score below 0.5. Null if a side has no location. Distances are reported rounded to whole kilometres.

**Qualification.** Null if the job requires none. Otherwise education rank vs required rank: met = 1, each level short = -0.25, a certificate +0.1. **Practical skills can stand in**: skills score >= 0.8 and >= 3 relevant years lifts the result to at least 0.8. A worker who lists no education or certificates and has no such practical evidence is "not assessed" (null), not zero.

**Availability.** Ready date from the availability setting (immediately 0 days, flexible 7, two weeks 14, one month 30) or the worker's available-from date if later. With a job start date: 1 if ready in time, else `max(0.2, 1 - lateDays/30)`. Without one: 1 / 0.9 / 0.85 / 0.7.

**Salary and preferences.** Average of the sub-scores that can be computed: salary (offer meets expectation = 1, otherwise proportional gap), preferred employment type (1 or 0.3), preferred work arrangement (1 or 0.4). Null if none apply.

## Labels and the required-skills gate

Strength: strong >= 80, good >= 60, partial >= 40, weak below. **If the job has required skills and the worker covers none of them (exactly or through a related skill), the label is capped at "partial"**, the explanation says so, and the person is not offered as a recommendation. The number itself still follows the formula. (Found during manual testing: a welder scored 62.8 for a mechanic job on experience, location and availability alone and was labelled "Good".)

## Explanations

`explanation` is assembled from the same component facts that produced the score (for example "2 of 2 required skills, 10 years of relevant experience (job asks for 3), in the same zone or city ..."), followed by what was not assessed and a caution when confidence is below 0.6. The API also returns the per-component scores and weights, matched / related / missing skills, and `requiredCoverage`.

## Recommendations

- Job to workers: visible, available, active workers who share a required or related skill or the job's category, excluding people who already applied. Top N with score >= 25 and at least one required skill covered.
- Worker to jobs: open, unexpired jobs sharing a skill (or related skill) or category, excluding jobs already applied to. Workers with no skills and no category get an explicit "complete your profile" response instead of guesses.
- Each list is stored in `Recommendation` (engine version, weights version, components, explanation) for later evaluation. Re-running replaces old rows but keeps any row that already has feedback.
- On applying, the score is stored in `Application.matchSnapshot`.

## Privacy

Employers never receive workers' coordinates or contact details from the matching endpoints: only the rounded distance and administrative area. Applicant phone numbers follow the shortlisting rule from Phase 7.

## Known limits (honest list)

- Skill similarity is taxonomy-based only (258 skills, 127 hand-written relations). Different words for the same job ("vehicle repair specialist" vs "automotive maintenance technician") are **not** recognized until Phase 9.
- Weights are the brief's suggestion, not tuned or learned. Nothing in the system learns yet.
- Thresholds (0.7 base, 5-year cap, 40 km default travel, 0.25 per education level, and so on) are reasoned defaults, not fitted to data. Phase 13 evaluates the whole engine against human relevance labels.
- Relation weights and the gate are subjective design choices and will be examined in the evaluation, including fairness checks for people without certificates.
