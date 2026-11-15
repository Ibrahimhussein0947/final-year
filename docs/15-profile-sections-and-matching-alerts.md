# Profile sections, match alerts and automatic applying

## What was added
**Worker profile (formal and informal workers)**
- Education now has *department* and an optional *GPA with its scale* (4, 5, 100 ...). A GPA must be entered with its scale and cannot exceed it; a missing GPA means "not provided", never zero. Vocational, informal and older routes simply leave it empty.
- New section *Internships, volunteering, training, apprenticeships and references* (`ProfileActivity`). Written for people who learned outside a school: an **apprenticeship** (learning a trade from a master) and a **reference** (a person who can vouch for the work) count as background for profile completion and are shown to employers.
- References store only a name and relationship, **no phone or address**: that is a third person's data who never agreed to it. The employer contacts them through the worker.
- Supporting documents (PDF/JPG/PNG up to 5 MB) can be attached to education, certificates and activities. They are readable by the owner, by an administrator, and by an employer **only while the worker has an active application to that employer** (same rule as the CV). Attaching a document does not make anything "verified"; only the administrator review does.
- Not collected: age or date of birth. It is discrimination-prone and is not used in matching. It could be added later only for jobs with a legal minimum age.

**Alerts when a job goes live** (`notifyNewJobMatches`)
1. The employer gets one notification with a *count* of matching candidates (and how many strongly): "7 candidates match ...". No names or contact details.
2. Workers who turned on **automatic applying** and match at or above their own threshold (60 to 90%, default 80) get an application sent for them, marked "Applied automatically" for both sides, and a message: "... your application has been forwarded to the employer."
3. Other strong matches get: "Congratulations! Your qualifications match the requirements of ABC Company for the Software Developer position. Your matching score is 95%." They must apply themselves.

Safeguards: a match requires no missed must-have requirement (`eligibility` not `not_eligible`), score of at least 60, and confidence of at least 0.5. Automatic applying is **off by default**, only for job seekers, at most 5 a day per worker and 20 per job; alerts at most 3 a day and can be switched off. Counting uses the same score as everywhere else: the AI helps, the employer decides.

**"Not selected" and tracking**
- When an employer rejects an application, the worker's notification and application card list where the match fell short (missing required skills, unmet must-have requirements), the employer's own note if any, how many other open jobs fit them, and that the profile stays available. The automatic part is labelled as a summary of the match, not the employer's reasoning.
- Applications show a **Qualified** label (no must-have missed and a match of at least 60) next to the existing statuses (pending, under review, shortlisted, interview scheduled, accepted, rejected, withdrawn). It is a tracking label, not a decision.

## Honest limits
- GPA, apprenticeships, volunteering, training and references are **displayed to employers but not part of the match score**. Changing the score to use them needs real data and a fairness review (a GPA scale is not comparable across institutions).
- References are not contacted or verified by the platform.
- Alert and rejection texts are English only; the "N other jobs fit you" count uses the same recommender and may be 0 when the worker's profile is thin.
- Auto-apply runs once, when a job is first published (or approved). Jobs published earlier are not re-scanned, and workers who join later are not matched to old jobs automatically.
- No email or SMS for the new alert types (SMS text stays generic and only covers status changes and interviews).
- Tests: `profile-matching-alerts.test.ts` (API, 10), `notificationText.test.ts` (web, 4). The new screens were checked in a browser (education with GPA, validation, activities, auto-apply setting) but not on a phone or with real data.

## Worker job search filters
Public job search (`GET /api/v1/jobs`, screen `/jobs`) now filters by: keyword (title, description, employer, skill), category, **region and zone/city**, employment type, work arrangement (on-site, remote, hybrid), **flexible work** (part-time, temporary, daily, seasonal, freelance, remote/hybrid, or a schedule that says "flexible"), **minimum salary**, **only jobs that state a salary**, **schooling I have** (jobs asking for at most that level), **experience I have** (jobs asking for at most N years; 0 = none needed), language, starts within N days, posted within N days, kind of employer, verified employers, and (API only) a list of skill ids. Sort by newest, closing soon or highest salary. All filters combine with AND.

Decisions worth knowing:
- A job that does **not state** a salary, schooling or experience requirement is never treated as paying zero or needing nothing: it is *kept* when filtering by schooling, experience, start date and language ("not stated"), and *excluded* by a minimum-salary or "salary shown" filter (we cannot say it pays enough).
- The schooling and experience filters exist so people with little formal education can find work they can do; they pair with the profile sections for apprenticeships and references.
- **There is no gender or age filter, on purpose.** Jobs here may not exclude people by gender, age, religion, ethnicity or marital status (the discrimination guard rejects such requirements), so there is nothing truthful to filter on. A worker who wants jobs that suit them can use the recommended list, which ranks by skills, place and availability only.
- Skill-id filtering has no screen yet (the keyword box already matches skill names and aliases).
- Tests: `job-search-filters.test.ts` (9). The zone/city list, restoring filters from the address, and the request were checked in a browser; the combined filters on a phone were not.
