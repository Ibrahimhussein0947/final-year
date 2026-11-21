# Help for workers finding and judging jobs

## 1. "You meet 4 of 6 requirements" on the job list
A signed-in worker sees, under each job card, how many of that job's requirements they already meet and the first three that are missing. Requirements are the job's required skills (covered exactly or through a related skill) plus its sector requirements. A sector question the worker has not answered counts as "not met yet" and is listed as "Answer in your profile: ...". A job that lists nothing says so instead of "0 of 0".
- `POST /jobs/fit` with `{ jobIds: [up to 30] }` (worker only) returns `{ items: { [jobId]: { met, total, missing[], score, strength, eligibility } } }`. It uses the same calculation as the full "Why this matches you" panel (`modules/matching/fit.ts`), stores nothing.

## 2. What to do after "not selected"
On a rejected application the worker gets up to five suggestions, built from the match stored when they applied (missing skills, unmet must-haves, a low experience, qualification, location or availability component) and from what their profile lacks today (ID not verified, no CV, no photo, fewer than 3 skills, no certificates). Each links to the right page. `modules/applications/tips.ts`; field `notSelectedTips` on `GET /applications/mine`.
They are suggestions about the profile, never the employer's reasons, and the wording never calls anyone unfit.

## 3. What similar jobs pay
On a job page: "Most similar jobs in Adama offer X to Y a month, the middle is about Z", and whether this job is below, within or above that range. `GET /jobs/salary-guide?categoryId=&locationId=`.
- Built from the pay on jobs posted in the same category in the last 12 months, in ETB, using the narrowest area (the place, then up the tree, then the whole country) that has at least 5 jobs. Shows the middle half (25th to 75th percentile) and the median rounded to 50, never one employer's figure, and nothing below 5 jobs.
- Limits: it is what employers offered, not what people were paid; the pay period is not stored, so **monthly is assumed**; a category's pay depends on skills and experience.

## 4. Rating employers
After being interviewed or hired (not for a withdrawn application), a worker can rate the employer once per application: 1 to 5 stars and three yes/no answers (paid on time, treated with respect, job as advertised). `POST /applications/:id/review`; table `EmployerReview`.
- **No free text**, so there is nothing to moderate or to defame anyone with.
- **Anonymous**: the employer sees only totals (`GET /employers/me/rating`), never who rated.
- **Hidden until 3 ratings** (`MIN_PUBLIC`) so one person cannot be identified or define an employer. Workers read the totals on the job page (`GET /organizations/:id/rating`, public).
- Limits: nothing stops a worker who was interviewed from rating unfairly, and nothing checks that the answers are true. One rating per application, and an employer with few applicants will stay hidden for a long time. An employer cannot reply or dispute a rating yet, and an administrator cannot remove one yet.

Tests: `worker-helpers.test.ts` (10). The new screens were not checked in a logged-in browser.

## Not built yet (from the same list)
Skill tests (5), a daily/gig work board (8), voice-first profile in Amharic and Afaan Oromoo (9), a work portfolio with photos (10), training with enrollment links, cost and location (11), and offer and start-date tracking (13).
