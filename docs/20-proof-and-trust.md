# Proof for each job and certificate, trust level, and finding jobs nearby

## What was added
**Proof for each job.** Every entry in *Work history* has a "Get verified" button (and a line under *My documents*). The worker uploads a letter from that employer. The server reads it and compares it with the entry: the worker's name (required), the employer (required when the entry names one), the job title and the years (supporting only; a letter dated in the Ethiopian calendar is accepted, 7 or 8 years behind). An administrator approves or rejects it. Only approval marks **that one job** "Verified". Editing a verified job's title, employer or dates removes the mark. A worker with no job entries can still upload one general experience letter, as before.

**Proof for each certificate.** Each entry under *Certifications and training* (competence/COC, trade licence, training, driving licence...) has the same button. Compared: the worker's name and the certificate name (required), the issuer and the year (supporting). Document type `PROFESSIONAL_CERTIFICATE`; approval marks the entry verified through the existing `CERTIFICATION` review.

Both use the same upload and review flow as education certificates (`POST /workers/me/documents` with `experienceId` or `certificationId`), so the same limits, rate limit, administrator warning signs and "cannot tell a forgery" caveats apply (see `19-identity-documents.md`).

**Trust level** (`modules/workers/trust.ts`). Computed from approved reviews only, never typed by the worker:

| Level | Label | When |
|---|---|---|
| 0 | Not verified | the ID document has not been approved |
| 1 | ID verified | the ID document was approved |
| 2 to 4 | Verified, Trusted, Highly trusted | one more level for each approved area: education, work experience, certificates or skills |

- The worker sees it on *My documents* with a plain list of what to do next (`GET /workers/me/trust`).
- Employers see a badge on search results and on the candidate page. Level 0 shows nothing. Employers can filter by it (`minTrust` 1 to 4 on `GET /talent/search`).
- **It is not part of the match score.** A person without papers is not ranked lower; they simply show fewer checkmarks. Using it in ranking would need real data and a fairness review.

**Jobs near me.** On the jobs page a signed-in worker gets a "Jobs near me" button that fills the place filters from the place saved in their profile (region, zone, woreda).

## What already existed (not rebuilt)
ID and birth certificate upload and comparison, education certificates, the CV check, saved jobs, saved searches with alerts when a matching job is posted, the job filters, recommended jobs, and the "Why this matches you" panel that lists missing skills.

## Honest limits
- Not tested on real Ethiopian experience letters or certificates; layouts vary a lot. Try real ones (with permission) first.
- Employers see only the verified mark, not the uploaded paper (these files are kept as private evidence).
- An experience letter for a job whose entry has no employer name is compared on the worker's name only.
- Trust counts a verified skill as a "certificate" area; the three areas are equal weight on purpose, which a real hiring study might change.
- Not built: SMS alerts for saved searches (no SMS provider is connected), and a one-tap "apply with what I have" beyond the existing apply flow.
- Tests: `proof-and-trust.test.ts` (6, API). The new screens were checked only as far as noted in the hand-over message.
