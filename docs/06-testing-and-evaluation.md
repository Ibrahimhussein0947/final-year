# Testing and AI evaluation (Phase 13)

Two different questions are answered here and should not be mixed up:

1. **Does the software work and is it safe?** Automated tests, security tests, performance checks (sections 1 to 2).
2. **Does the matching rank suitable people higher?** A ranking evaluation with standard metrics (sections 3 to 5).

Everything below was produced by the commands shown. Numbers that were not measured are marked "not measured".

## 1. Software testing

### 1.1 What exists

| Layer | Where | Count | How to run |
|---|---|---|---|
| API integration and unit tests (real HTTP, real PostgreSQL test database, real Socket.IO) | `apps/api/src/tests/` | **380** in 23 files (at the last full run, before later additions) | `npm test -w @ethiotalent/api` |
| Frontend unit and component tests (jsdom) | `apps/web/src/**/*.test.ts(x)` | **17** in 4 files | `npm test -w @ethiotalent/web` |
| Security tests | `security.test.ts` | 24 | included above |
| End-to-end journey (worker, employer, match, apply, hire) | `e2e-demo-flow.test.ts` | 1 long scenario | included above |
| Performance tests | `perf.test.ts` | 5 | included above (about 25 s) |
| Ranking evaluation | `apps/api/src/evaluation/` | 11 tests on the metric code and data | `npm run eval -w @ethiotalent/api` |
| AI service tests (fake embedding backend) | `apps/ai/tests/` | 17, all pass (the first run found a real bug, see docs/02) | `python -m pytest` in `apps/ai` |

Tests run against a database whose name must end in `_test`; every file cleans up what it creates (checked: 0 leftover users, jobs, organizations or profiles after the full run).

### 1.2 Coverage (API, v8, `vitest --coverage`)
Statements 93.7%, branches 83.2%, functions 95.0%, lines 96.5%. Lowest files: `server.ts` (0%, the process entry point, only started for real), `lib/audit.ts` (67%), `middleware/common.ts` (79%), `matching/embeddings.ts` (81%, the part that calls the real AI service), `workers/service.ts` (83%).
Coverage shows which lines ran, not that the assertions are meaningful. One example found during this phase: an end-to-end assertion that read a non-existent column and therefore passed without checking anything. It was caught by the type checker, which now covers the test files too.

Frontend coverage is **thin** by design of this phase: the API client (token refresh without duplicate refreshes), formatting helpers, the translation provider and the score indicators are tested. The page components (forms, dashboards, admin console) are **not** covered by automated tests; they were checked by hand in the browser during each phase.

### 1.3 Security tests (what is covered)
- Tokens: missing, malformed, tampered signature, `alg:none`, signed with another secret, expired. A lying `role` claim is ignored (the role is read from the database). Suspended or deleted accounts are refused immediately.
- Sessions: refresh and logout need the CSRF header; the refresh cookie is `HttpOnly`, `SameSite=Lax`, limited to the auth path; login is rate limited; wrong password and unknown phone are indistinguishable; no password hashes in responses.
- Privilege: cannot register as admin or inject internal fields; worker and employer tokens are refused on all sampled admin routes.
- Access to other people's data: another employer cannot read, change or message about someone else's applicants or edit someone else's job; another worker cannot withdraw or read someone else's application or conversation; CVs are downloadable only by the owner (or an employer with an active application); phone numbers are hidden from employers until shortlisting; file-id path traversal gives 404.
- Input: SQL-injection strings in search and login, script text in a job title (stored as text, served as JSON with `nosniff`), oversized and malformed JSON (413 / 400, no stack traces), a fake `.pdf` and a fake image are rejected, spreadsheet formulas are defused in CSV exports, security headers present, CORS does not echo an unknown origin.

**Not covered:** a professional penetration test, dependency-confusion and supply-chain review, denial of service beyond the rate limits, and browser-side XSS (React escapes output, but no automated browser test proves it). No vulnerability in the application code was found by these tests.

### 1.4 Dependency audit (`npm audit`, run in this phase)
| Package | Where | Severity | Issue | Assessment |
|---|---|---|---|---|
| `zod` < 4.6.6 | API and web (production) | high | memory exhaustion when validating very large constrained collections | Bodies are limited to 100 kB and arrays have maximum lengths, which limits the impact. Fix is a **major upgrade (zod 4)**; not done blindly. |
| `react-router` 6.x | web (production) | moderate | open redirect via backslash in `<Link>`/`navigate`; deserialization issue in SSR hydration | The site never builds links from user input and has no SSR. Fix is a major upgrade (v7). |
| `tinypool` (via vitest), `esbuild` dev server, `deepmerge-ts`, `@vitest/mocker` | development tools only | critical / high / moderate | affect the test runner and dev server, not the deployed app | Do not run the dev server or tests on untrusted networks or untrusted input. Upgrade vitest. |

Upgrading zod and react-router to current majors is recommended before deployment (Phase 14) as its own change with regression runs. Not done in this phase.

### 1.5 Performance (local machine, Docker PostgreSQL, one Node process)
Loaded with 3,000 workers (about 10,000 skill rows) and 1,500 open jobs. Times in milliseconds.

| Operation | Median | 95th percentile |
|---|---|---|
| Job list (page of 12) | 22 | 25 |
| Job list with category + region filters | 26 | 38 |
| Job free-text search | 354 | 390 |
| Recommended jobs for a worker | 90 | 107 |
| Recommended workers for a job (scores up to 400 candidates) | 567 | 701 |
| Admin national analytics | 64 | 70 |
| 40 simultaneous job-list requests | 276 ms for all 40 | |

Scoring step alone, in memory: 45 workers ranked in 0.3 ms; 10,000 workers scored and ranked in about 45 ms.
**What this does not show:** behaviour on production hardware, more than 40 concurrent users, a cold database cache, or the AI service in the loop (embedding a CV or job takes additional time that is not measured). Free-text search is the slowest operation; it uses a plain `contains` match (the full-text index exists but is not used by the query yet) and should be revisited if the job count grows past a few thousand.

### 1.6 User acceptance checklist (to be run by real people)
Not run: no real users have used the system. Suggested script for a session with 3 to 5 job seekers and 2 to 3 employers, recording whether each task is completed without help and the time taken:
1. Register as a worker, add skills and a work experience, upload a CV and import from it, set availability.
2. Find a job by category and region, read why it matches you, apply, withdraw, apply again.
3. Switch the interface to Amharic and Afaan Oromoo and note any unclear or wrong text (native speakers).
4. Register as an employer, paste a job description, review the suggested requirements, publish.
5. Find recommended candidates, open one, read the explanation, shortlist, send a message, schedule an interview, mark hired.
6. Report a job; as an administrator, handle the report, review a verification request.
7. Use the site on a low-end phone and a slow connection.
Questions after each session: Was any score or explanation confusing or felt unfair? Did anything look verified that should not? What was missing?

## 2. Defects found in this phase
- **Fixed:** a worker with *no skills listed* counted as covering all of a job's required skills, so profiles with an empty skills list could appear in the top 3 recommendations for unrelated jobs (found by the evaluation: a "mechanical engineering graduate" ranked 2nd for a primary-school teacher job). Now such a profile is not recommended for jobs with required skills (unless semantic evidence is strong) and has a regression test. The benchmark is the thing that exposed this; the unit tests had not.
- Corrected a vacuous end-to-end assertion (see 1.2).
- The remaining known limits are listed in each earlier document and in section 6.

## 3. Ranking evaluation: design

**Task.** For each job, rank a pool of workers; compare the ranking with human relevance grades.

**Data.** `apps/api/src/evaluation/dataset.ts`: 14 invented jobs (two of them, truck driver and nurse, carry must-have sector criteria from Phase 15: the labels follow the same rule the scorer applies, so these two test consistency, not correctness of the rule) (10 categories, 6 regions) and 45 invented worker profiles (including people without certificates, people without listed skills, a currently unavailable expert, and graduates with no experience). 630 job-worker pairs.

**Labels and their weakness.** Grades 0 to 3 follow the written rubric at the top of `dataset.ts` ("would a reasonable employer shortlist this person today?"). **They were written by the project developer, not by independent annotators, and not by the scoring formula.** This avoids circularity but is a single person's opinion, written knowing how the system works. The file `apps/api/evaluation/annotation-template.csv` (generated by `npm run eval`) lists all 630 pairs with empty columns for two independent annotators. To make the evaluation defensible:
1. Give two annotators (employers, recruiters or TVET instructors) the rubric and the profiles; do not show them the system's scores.
2. Compute agreement (Cohen's weighted kappa); below 0.6, clarify the rubric and repeat.
3. Resolve disagreements by discussion, replace the grades in `dataset.ts`, and rerun `npm run eval`.

**Methods compared.**
| Method | What it is |
|---|---|
| Keyword (BM25) | Text search of the job text against each profile's headline and bio; knows nothing about skills, locations or education. |
| Rule-based, skills only | The shipped engine with only the skills component. |
| Rule-based weighted | The shipped engine (default weights), including its "recommendable" filter. |
| Hybrid (rules + embeddings) | The shipped scorer with real embeddings from `paraphrase-multilingual-MiniLM-L12-v2` on English text; calibration bounds unchanged and provisional. |
| Semantic only | Rank by raw cosine similarity of the two texts; a diagnostic of the model, not a product mode. |
| Random | Floor, mean of 30 shuffles. |

**Metrics.** Precision@3/5, Recall@5, NDCG@3/5 (gain 2^grade - 1), MRR, coverage, response time. "Relevant" means grade 2 or 3. A paired bootstrap interval (2,000 resamples) is reported for the difference between methods. All metric functions have hand-computed unit tests.

## 4. Results

Full generated report, including per-job, per-category, per-region and fairness tables: [evaluation-results.md](evaluation-results.md). Headline numbers (14 jobs):

| Method | P@5 | R@5 | NDCG@5 | MRR |
|---|---|---|---|---|
| Random | 0.050 | n/a | 0.079 | 0.156 |
| Keyword (BM25) | 0.414 | 0.976 | 0.946 | 1.000 |
| Rule-based, skills only | 0.429 | 1.000 | 0.961 | 1.000 |
| Rule-based weighted (shipped) | 0.429 | 1.000 | 0.961 | 1.000 |
| Hybrid (rules + embeddings) | 0.429 | 1.000 | 0.969 | 1.000 |
| Semantic only (cosine) | 0.429 | 1.000 | 0.926 | 1.000 |

Shipped engine minus keyword, NDCG@5: +0.015, 95% interval -0.016 to +0.047. **The interval includes zero: on this data the engine is not shown to be better than keyword search.** Hybrid minus shipped rules: +0.008 (-0.007 to +0.024): **no gain from embeddings is shown either**, on an English, easy, near-ceiling benchmark that cannot show what embeddings add for differently worded text.

### How to read this honestly
- Both methods are far above random, and the engine finds every relevant person within the top 5 on this set. That says the ranking is sensible, not that it is accurate on real people.
- **The benchmark is easy.** The invented profiles and postings use the same vocabulary as the skill taxonomy, with few relevant people per job (about 2), so almost any method reaches the ceiling and cannot be told apart. P@5 cannot exceed about 0.43 because there are only about 2 relevant people per job. Differences between methods are therefore small and not statistically established.
- **The benchmark does not test the thing semantic matching is for** (profiles worded differently from the job, Amharic or Afaan Oromo text, misspellings). The hybrid arm is now measured and shows no gain here, which says more about the benchmark than about embeddings; it is not a reason to claim or to dismiss them.
- 14 jobs and 45 workers, one labeller, synthetic text: no result here should be quoted as the platform's real accuracy. Slices with one or two jobs (all category and region rows) are anecdotes.
- Coverage: the shipped engine surfaces 84% of the workers in some job's top 5, 7 points below keyword; the rest are people who are not relevant to any of the 14 jobs, so this is not a defect, but it shows coverage must be read together with relevance.
- Where the engine disagrees with the labels: after the fix in section 2, one case remains: for the shop-assistant job a barista (graded 0) takes rank 3. The profile shares the nice-to-have customer-service skill and the shop is in a different region from the barista; the cause was not investigated further.

### Fairness check
For every relevant pair, was the worker in the top 5? Grouped by education (no formal education / primary or secondary / vocational / diploma+) and experience (0-2 / 3-5 / 6+ years). The shipped engine surfaced **all** relevant workers in every group (rates 1.00), keyword search missed 1 of 4 vocational-certificate pairs. Groups contain 4 to 13 pairs, so **no conclusion about fairness can be drawn**, only that no gap appeared on these examples. The rubric deliberately does not downgrade trades workers for missing certificates, and the engine's practical-skills allowance (strong skills + 3 years can stand in for a certificate) is the design intent being checked. Gender, age, ethnicity and disability are not collected and **not evaluated**; a real fairness audit needs real outcome data and a decision on which attributes may be collected at all.

### Multilingual evaluation
**Measured with a probe, not a ranking benchmark.** 16 occupations written two ways in each language (`apps/ai/evaluation/multilingual_probe.py`, results in `apps/ai/evaluation/reports/multilingual_probe.json`): English top-1 0.875 / AUC 0.98; Amharic 0.25 / 0.77; Afaan Oromoo 0.375 / 0.76; English to Afaan Oromoo AUC 0.57 (near chance). In Amharic and Afaan Oromoo, different occupations score 0.56 to 0.59 similar versus 0.69 to 0.73 for the same occupation. **The phrases were not reviewed by native speakers**, so part of the weakness may be unnatural wording. There is no Amharic or Afaan Oromoo ranking benchmark. Consequence in the product: Ethiopic-script text is not embedded; the platform must not claim multilingual semantic matching (docs/02).

## 5. What would make this evaluation credible
1. Independent annotation of the existing 630 pairs (section 3), or better, of pairs from real anonymised applications.
2. A harder benchmark: paraphrased postings and profiles, misspellings, Amharic / Afaan Oromoo text, unlisted skills, more candidates per job (50 or more) and more relevant ones per job.
3. Calibrate `SEMANTIC_LOW/HIGH` on at least 100 held-out related and unrelated pairs (not the evaluation pairs); the hybrid row and the probe now exist but use provisional bounds.
4. Tune weights only on a separate training split; report on a held-out split.
5. After launch: use the recorded recommendation outcomes (observational) and an A/B comparison, and report them separately from this offline evaluation.

## 6. Not done in this phase
Browser end-to-end tests (Playwright), automated accessibility audit, mobile-device testing, a multilingual ranking benchmark, native-speaker review of the probe phrases, load testing beyond 40 concurrent requests, real-user acceptance testing, and the dependency upgrades listed in 1.4.

## 7. Sector criteria (Phase 15)
Tests added: 15 unit tests (`criteria.test.ts`), 24 API tests (`criteria-api.test.ts`, including a writer, a security guard and a teacher with their own must-haves) and 9 data-quality tests on the seeded list (`criteria-data.test.ts`: unique keys, valid options, every sector covered, no wording about gender, age, religion, ethnicity or marital status) covering definitions, worker answers, job requirements, must-have eligibility, unanswered criteria, verification, administrator management and the job-text guard. Details and limits: docs/10-sector-criteria.md.

## 8. Worker search and invitations (Phase 16)
17 API tests (`talent-api.test.ts`): access control, every filter, hidden and suspended workers never listed, no contact details or coordinates in results, paging, ranking by a job with must-have exclusion, and invitations (refusal cases, daily limit, decline, marked applied, roles). The screens were checked by hand; no automated UI test covers them. Details and limits: docs/11-worker-search-and-invitations.md.

## 9. Hiring rules by organization type (Phase 17)
17 API tests (`hiring-api.test.ts`): every rule for government, public enterprise and NGO, private companies unaffected, live-vacancy edits, written reasons, announcement period, interview requirement, reference numbers, administrator edits applying immediately, the organization-type lock, and access control. The screens were checked by hand. **Testing note:** all API test files share one PostgreSQL test database and must not run at the same time as another test run or another session; two concurrent runs corrupt each other's data and produce random-looking failures. The administrator test resets the cooperative policy itself so an interrupted run cannot leave it changed. Details: docs/12-hiring-rules.md.
