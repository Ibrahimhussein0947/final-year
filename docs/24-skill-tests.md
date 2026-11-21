# Skill tests ("Tested" mark)

## What it does
A worker can take a short multiple-choice test for a skill that is on their profile. Passing puts a **Tested 85%** mark on that skill, shown to the worker and to employers. Screen: *Skill tests* (`/skill-tests`, linked from the Skills section of the profile).

| | |
|---|---|
| Questions | a random 8 (set per test, 3 to 30) from a larger pool, in a random order, with the options shuffled for each attempt |
| Pass mark | set per test (the starters use 70 to 75%) |
| Time | 30 minutes from the start; a hand-in after that (plus a minute of grace) does not count |
| Attempts | 3 per test per rolling 24 hours; closing the page and coming back continues the same attempt, it does not cost another |
| After a pass | the mark stays 90 days; the test can be taken again after that |

API: `GET /skill-tests`, `POST /skill-tests/:id/start`, `POST /skill-test-attempts/:id/submit` (worker). Administrators: `GET/POST/PATCH/DELETE /admin/skill-tests`. Code: `modules/skilltests/`.

## Fair and safe by design
- **The answers never reach the browser.** The server picks the questions, stores which options were shown in which order, and grades. A start returns the question text and options only.
- Shuffling the options per attempt means "the answer is C" cannot be passed along.
- It is a separate thing from **Verified** (an administrator looked at a document) and the screens say so. It is **not** used in the match score, the trust level or profile completion, and a worker with no test is never ranked lower.
- A worker must already list the skill: a test never adds a skill to a profile.

## Starter tests
`prisma/seed/skillTests.ts` seeds three, created only if the skill has no test yet: Microsoft Office basics, Cashier basics, Food safety basics (12 questions each, 8 asked). **They were written by the developer, not by someone who does the work.** Have a subject expert check them before the Tested mark is relied on. More tests are added through the admin API (there is no admin screen for them yet).

## Honest limits
- **It can be cheated.** Nobody watches the person: a friend can answer for them, or they can search the answers. With a pool of 12 and 3 attempts a day, a determined person could also learn the pool. A bigger pool, timed per question and proctoring would be the next steps. Treat the mark as a hint, never as proof.
- Multiple choice measures knowledge of facts, not whether someone can do the work. It suits some skills (office software, handling money, food safety) far better than others (carpentry, driving).
- Only text questions, in English. No Amharic or Afaan Oromoo versions, which is a real fairness gap for the workers this is meant to help.
- No admin screen: tests are managed through the API. There is no statistics view of which questions are always missed.
- Tests: `skilltests.test.ts` (11, API). The new screens were not checked in a logged-in browser.
