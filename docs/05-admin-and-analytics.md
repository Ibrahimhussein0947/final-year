# Administration and analytics (Phase 12)

## Administrator console (`/admin`, role ADMIN only)

Administrator accounts are created from the command line (`npm run admin:create`), never through the website. Every admin endpoint requires the ADMIN role, and every state-changing action is written to the audit log with the administrator's id.

| Area | What it does |
|---|---|
| Overview | Total users, workers, employers, jobs, active jobs, applications, successful recruitments, pending verification requests, open reports, jobs waiting for review, suspended accounts; system status (database, AI service, SMS gateway) and last-24-hour activity. |
| Users | Search by name, phone, email; filter by role/status. Suspend (reason required) or reactivate. Suspending revokes all sessions and closes live connections. Administrators cannot suspend themselves or other administrators. |
| Verification | Review queue for employer documents and for worker qualification/skill evidence, with the uploaded file. **A "verified" label is only ever set here**, after approval; rejection requires a note the person can read. |
| Moderation | Reports from users (scam, false information, discrimination, offensive, duplicate, other) with actions: dismiss, resolve, remove the job, or suspend the user. One decision closes all open reports about the same target. Also the queue of jobs held for review (copied text, unverified organization with the review gate on, edited after approval): approve (publishes and sends match alerts) or reject with a reason. |
| Skills and categories | Add, rename, add translations and aliases, move between categories, hide/show. Nothing is hard-deleted, so history stays intact. Changes refresh the matching and CV/JD recognition caches. |
| Sector criteria | Add, edit, translate and hide the sector questions (licences, certificates, shifts, tools) that job forms, worker profiles and matching use; usage counts per criterion. Key, type and sector are fixed once created. See docs/10-sector-criteria.md. |
| Translations | Edit text per language (English, Amharic, Afaan Oromoo) with the built-in text shown as a reference. Overrides are served publicly and take effect without a new release. |
| Matching and AI | Edit the matching weights globally or per job category (must total 100%, versioned). Recommendation performance: how many recommendations were shown and what share led to applying, shortlisting and hiring, by engine version and by score band. |
| Analytics and reports | National, privacy-protected statistics and three CSV reports. |
| Activity log | The audit trail with filters and paging. |

## Analytics

- **Workers** (`/analytics`): profile views, applications by status, interview invitations, successful applications, the skills open jobs ask for most (marking the ones you have), and "skills worth adding": skills required by open jobs in your category that you do not list, ranked by demand, flagged when close to skills you already have.
- **Employers** (`/analytics`): open vacancies, applications, a recruitment funnel (applied, reviewed, shortlisted, interviewed, hired), the match score of applicants when they applied, average days from application to hire and from posting to first hire, and a per-job table.
- **National (admin)** and the public home-page totals: demand and supply by region, category distribution, most requested skills, popular occupations, application success rates.

### Privacy rules for aggregates
Any count below **5** is hidden (null / "<5"): regional job and worker counts, category counts, occupation lists, success rates and recommendation percentages. CSV exports apply the same rule and defuse spreadsheet formulas (values starting with `=`, `+`, `-`, `@` are prefixed). No phone numbers or names appear in analytics or exports. Public totals on the home page appear only when they reach 5.

## Recommendation performance: how to read it
Recommendation outcomes are logged when a recommended person applies, is shortlisted or is hired (each at most once per recommendation). This is **observational**: higher application or hiring rates in higher score bands are encouraging, but they depend on pay, timing and employer preferences too, they only cover recommendations that were actually displayed, and the numbers will be small until the platform has real use. It is not the project's evaluation, which uses labelled relevance judgements and standard ranking metrics (Phase 13).

## Honest limits
- Reports of **users** can be filed through the API, but there is no "report this user" button in the interface yet (only for jobs). Messages cannot be reported or read by administrators.
- Moderation actions do not yet notify the reporter of the outcome.
- Verification is manual and evidence-based; there is no automated document checking.
- National analytics load their data into memory (fine for thousands of records). A materialised summary or SQL aggregation would be needed at national scale.
- The admin screens are English only, and a few worker/employer screens added here (analytics) are not yet in the translation files.
- **Account deletion and data export (built).** Anyone can download their data (`GET /auth/me/export`) and delete their account from `/account/security`. Deletion anonymises the account: profile, applications, messages, files and sign-in details are erased, open vacancies are closed, and the phone number can be registered again. The row itself stays so other people's records and the audit trail do not break. Administrators are removed by another administrator.

## Administrator team (what "who controls the system" means here)
Administrators are the highest role. The console (`/admin`) lets them: suspend and reactivate users; review verification requests; moderate reports and job posts; manage skills, categories, sector criteria, hiring rules per organization type, translations and matching weights; read national analytics and export CSV; and read the activity log.

New: the **Administrators** tab (`/admin/team`, `GET/POST /admin/admins`, `PATCH /admin/admins/:id/status`).
- Lists administrators and lets one administrator add another (full name, a phone number with no existing account, and a password of 10+ characters with a letter and a number) or suspend/reactivate another administrator.
- **Safeguards:** the acting administrator must type their own password again for each change (a stolen session alone cannot mint administrators); you cannot suspend or change yourself, so one active administrator always remains; an existing account is never silently promoted (the phone number must be new); suspending ends all of that person's sessions at once; every action is in the activity log.
- The very first administrator is still created on the command line: `npm run admin:create -w @ethiotalent/api -- <phone> <password> "<name>"`.

Built: administrator two-factor login with an authenticator app (TOTP, setup key entered by hand; no QR code, no backup codes: a lost authenticator is recovered by re-running `npm run admin:create`, which switches it off), forced password change for administrators created by another administrator, and password reset by a 6-digit code. Not built: separate administrator levels (for example a read-only auditor or a moderator who cannot edit rules), and the authenticator secret is stored unencrypted in the database. The code is only delivered if an SMS provider is configured. All administrators have the same powers.

## Subscriptions (plans and limits)
Administrators manage employer plans in the **Subscriptions** tab (`/admin/plans`; API: `GET/POST /admin/plans`, `PATCH /admin/plans/:id`, `GET /admin/subscriptions`, `POST/DELETE /admin/organizations/:id/subscription`).
- A **plan** has a name, a monthly price (shown only), and limits: open jobs at one time, invitations to apply per calendar month, and whether worker search is included. An empty limit means unlimited. Exactly one plan is the **default**: employers without a subscription get it. Starting plans (Free: 10 jobs and 30 invitations, Standard: 30 and 200, Premium: unlimited) are developer-written placeholders; the prices are made up for the administrator to replace. Seeding creates them only when no plan exists, so edits are never overwritten.
- The administrator **assigns** a plan to an employer organization from now, with an optional end date and a payment note (for example "paid by bank transfer, ref 1234"). Only one subscription is in force at a time; when it ends or is cancelled the organization returns to the default plan. Plans that are switched off cannot be newly assigned.
- **Enforcement:** publishing a job fails with a plain message (HTTP 402, code `PLAN_LIMIT`) when the open-jobs limit is reached; inviting a worker and searching workers are refused the same way. Employers see their plan and usage on the Organization page. Every plan change and assignment is in the activity log.

- **Featured jobs** (plan limit "featured jobs at a time"; 0 = not included, empty = unlimited): an employer can press "Feature this job" on a live job in My jobs. Featured jobs are listed first in the public job search (default sort) and carry a clear "Featured" label, so the paid placement is never disguised. It does not change match scores, recommendations or alerts. Closing a job removes its feature, so reopening it can never silently exceed the cap. API: `POST /jobs/:id/feature {featured}`.
- **Applications reviewed per month**: the first decision on each application (moving it out of "pending", including rejecting) counts against the plan's monthly allowance. Further moves on an application already in progress are never blocked, so a shortlisted candidate can always be taken forward or answered; applications beyond the allowance simply stay pending until next month or a plan change. Usage shows on the employer's plan card.
- Starting limits: Free = 0 featured and 100 reviews a month, Standard = 3 featured and 1000 reviews, Premium = unlimited (placeholders for the administrator to change). Plans created before this feature keep unlimited for both unless set.

Not built: online payment (Telebirr, bank, card), invoices and receipts, automatic renewal and reminders, and different limits for workers.

**Upgrade requests (no payment):** on the Organization page the plan card has a "Need more?" section where an employer picks another active plan, sees its limits, adds an optional note (for example how they will pay) and sends a request (`GET /employers/me/plans`, `POST /employers/me/plan-requests`, `DELETE /employers/me/plan-requests/:id`). One request can be open at a time; they cannot ask for the plan they are on or a switched-off plan. Administrators see waiting requests at the top of the Subscriptions tab (`GET /admin/plan-requests`) and press "Approve and assign" (puts the organization on the plan from now, with the optional end date and payment note, exactly like assigning by hand) or "Decline" with an optional message (`POST /admin/plan-requests/:id/approve|decline`). The employer gets an in-app notification either way, and both decisions are in the activity log. **The system takes no payment**: the administrator agrees payment outside it before approving.

Also added: administrators manage places in the **Places** tab (`/admin/places`): add a zone, woreda or kebele under any place and edit the Amharic and Afaan Oromoo labels (`POST /admin/locations`, `PATCH /admin/locations/:id`). Regions, zones and woredas come from the OCHA/HDX Ethiopia admin boundaries (`npm run locations:import-admin`), in English only; labels typed here need a native speaker's review.

Limits note: limits are checked only when an action is attempted, so jobs that are already open stay open. **The starting Free plan does limit employers who have more than 10 open jobs from publishing more**: raise the Free plan's limits (or assign Premium) in the Subscriptions tab before real employers use it.
