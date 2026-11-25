# EthioTalent AI

*Connecting Ethiopian Talent with the Right Opportunities.*

AI-based job matching and recommendation platform for the Ethiopian labor market.

[![CI](https://github.com/Ibrahimhussein0947/final-year/actions/workflows/ci.yml/badge.svg)](https://github.com/Ibrahimhussein0947/final-year/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-React%20%2B%20Express-3178c6)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features
- **Workers:** profile and CV builder, CV reading, job search, explainable match scores, applications, messaging, Telegram alerts, verification of skills.
- **Employers:** job posts with requirement suggestions, applicant ranking and comparison, worker search and invitations, interviews, hiring rules by organization type.
- **Admins:** user and organization management, verification, moderation, matching weights, announcements, analytics, audit log, settings and health.
- **Platform:** English, Amharic and Afaan Oromoo interface (partial), installable PWA, Android app (Capacitor), optional semantic matching service.

## Tech stack
| Part | Technology |
| --- | --- |
| Web (`apps/web`) | React, TypeScript, Vite, PWA |
| API (`apps/api`) | Node 20+, Express, TypeScript, Prisma, Socket.IO, Vitest |
| Database | PostgreSQL 16 with pgvector |
| AI service (`apps/ai`) | Python, FastAPI, multilingual sentence embeddings |
| Mobile (`apps/mobile`) | Capacitor (Android) |
| Infra (`infra`) | Docker Compose, Nginx, GitHub Actions |

## Quick start
```bash
npm install
npm run db:up        # database (see "Run the database and seed it" below for .env setup)
npm run dev:api      # http://localhost:4100
npm run dev:web      # http://localhost:5173
```

## Useful commands
| Command | What it does |
| --- | --- |
| `npm run typecheck` | TypeScript check for all workspaces |
| `npm test` | API and web tests |
| `npm run lint` | ESLint (errors fail CI; warnings are fixed gradually) |
| `npm run format` | Prettier |
| `npm run build` | Production builds |

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and commit style.

## Documentation
- Plan and architecture: [docs/00-ARCHITECTURE-AND-PLAN.md](docs/00-ARCHITECTURE-AND-PLAN.md)
- Technical overview: [docs/09-technical-overview.md](docs/09-technical-overview.md)
- API reference: [docs/api-reference.md](docs/api-reference.md)
- Deployment: [docs/07-deployment.md](docs/07-deployment.md)
- User guide: [docs/08-user-guide.md](docs/08-user-guide.md)

## Status
Phases 1 to 8 and 10 to 17 done, Phase 9 done for English only: scaffold, database, public website, authentication, profiles with secure uploads, job posting and search, the recruitment workflow, a rule-based explainable matching engine, and the semantic-matching integration (real model installed and measured: **works for English, unreliable for Amharic and Afaan Oromoo**, no ranking gain shown yet, see docs/02-semantic-matching.md).

## Prerequisites
Node 20+, Docker Desktop, and Python 3.11 or 3.12 for the AI service (ML wheels such as PyTorch may not yet support 3.14).

## Run the database and seed it
```bash
cp infra/.env.example infra/.env            # then edit the password
cp apps/api/.env.example apps/api/.env      # use the same password
npm install
npm run db:up                               # Postgres 16 + pgvector on localhost:5433
cd apps/api
npx prisma migrate deploy
npm run db:seed
```

The container uses host port **5433** so it does not clash with a Postgres already installed on port 5432.

## Run the website (Phase 3)
```bash
npm run dev --workspace @ethiotalent/web    # http://localhost:5173
```
Public pages only: landing, jobs, workers, categories, how it works, about, help, contact, privacy, terms, login, register. Forms validate but are not connected to a server yet (Phase 4). Jobs and workers lists show empty states until the API exists. UI strings are in `apps/web/src/i18n/` (English complete; Amharic and Afaan Oromo are partial drafts needing native review).

## Run the API (Phase 4)
```bash
cd apps/api
npm run dev            # http://localhost:4100  (4000 is often taken by other projects)
npm test               # 380 tests against the separate ethiotalent_test database
npm run eval           # ranking evaluation (no database needed), writes docs/evaluation-results.md
npm run admin:create -- 0911000000 "a-long-password" "Admin Name"
```
Test database setup (once): `create database ethiotalent_test`, then run `prisma migrate deploy` and the seed with `DATABASE_URL` pointing at it. Tests refuse to run against a database whose name does not end in `_test`.

Auth design: bcrypt, 15-minute JWT access token (kept in memory in the browser), rotating refresh token in an httpOnly SameSite cookie with reuse detection, CSRF header on cookie endpoints, rate limiting, role checks that read the role from the database. Phone/email codes are generated and checked for real, but **SMS and email are optional and off until you set keys** (Africa's Talking or a generic gateway for SMS, Resend for email; see `apps/api/.env.example`). Without keys, messages are only logged: in development the code is returned by the API (`EXPOSE_DEV_OTP=true`) and never in production. Password reset works: a 6-digit code (hashed, 10 minutes, 5 wrong tries) is sent by SMS, and by e-mail when the account has a verified one. The answer is the same whether or not the number is registered, and a reset signs the account out everywhere (`/forgot-password` in the web app, `POST /auth/password/forgot` and `/reset`).

## Profiles and uploads (Phase 5)
- Worker profile: `/profile` in the web app, API under `/api/v1/workers/me`. Skills, education and certifications are always stored as *self-reported*; only an administrator (Phase 12) can mark them verified. Completion % is a transparent checklist (see `apps/api/src/modules/workers/completion.ts`).
- Privacy: employers get `GET /api/v1/workers/:id` with no phone/email, no CV, location only down to woreda and GPS rounded to about 1 km. Workers can hide their profile.
- Uploads (photo, CV, verification documents): file type is detected from the file's first bytes (not its name), size-limited, saved under a random name in `apps/api/uploads/` (git-ignored, never served statically) and downloaded only through authorized routes with `nosniff` and a sandboxing CSP. Antivirus scanning with ClamAV is optional (`CLAMAV_HOST`, see `apps/api/.env.example`); without it only the file type is checked.
- Employer: `/organization` page; verification documents create a pending request. The Verified badge needs admin approval, which arrives in Phase 12.
- Not built yet: CV parsing (Phase 10), employer access to CVs (after applications exist, Phase 7), profile-photo cropping.

## Telegram alerts (optional)
Workers can get short alerts in Telegram (new matching jobs, interviews, offers, application updates). Off until configured:
1. Create a bot with @BotFather and note its token and username.
2. In `apps/api/.env` set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` (any 16+ letters/digits you invent) and `PUBLIC_URL`.
3. With the site reachable over https, run `npm run telegram:webhook -- https://your-public-site` once (inside `apps/api`).
4. A worker presses **Connect Telegram** on the dashboard, then **Start** in Telegram. `/stop` turns alerts off.

The account is linked by a one-time code (stored hashed, valid 15 minutes), never by guessing from a phone number. Alert text is generic and never contains text written by other users; at most 10 a day; a chat that blocks the bot is unlinked automatically. The Amharic and Afaan Oromoo bot replies are drafts needing native review. Not yet tried against the real Telegram service, only against test doubles.

## Jobs (Phase 6)
- Employers: `/employer/jobs` (list, publish, close, mark filled, delete drafts) and a full job form with required/nice-to-have skills, salary, schedule, deadline, location. API: `/api/v1/jobs`.
- Lifecycle: DRAFT -> ACTIVE -> CLOSED or FILLED (CLOSED can be reopened). A job needs at least one required skill, a location (unless remote) and a future deadline to publish. Deadlines count through the end of the day in Ethiopia (UTC+3).
- Public: `/jobs` (search by text, skill, region, category, type, work arrangement, minimum salary, verified employers, sort, pagination) and `/jobs/:id`. Drafts, closed and expired jobs are never public. Employer contact details are never exposed; job-site GPS is rounded publicly.
- Duplicate detection: identical text from the same organization is blocked; near-identical text (word overlap of 85% or more) needs explicit confirmation; text copied from *another* organization is published as `PENDING_REVIEW` and audited for admin review. This is a word-overlap heuristic, not semantic similarity (embeddings arrive in Phase 9).
- Optional review gate: set `REVIEW_UNVERIFIED_JOBS=true` so jobs from unverified organizations wait for admin approval. Off by default because the admin dashboard is not built until Phase 12, so nothing could approve them yet.
- Search uses simple text matching (contains), which is fine for thousands of jobs; a full-text index exists for later.
- Not built yet: applying (Phase 7), saved jobs (Phase 7), job-description AI extraction (Phase 10), map view of jobs.

## Applications and recruitment (Phase 7)
- Workers: apply with an optional message, save jobs, track progress at `/applications` (history and interview details), withdraw, re-apply after withdrawing (not after rejection). Limit of 30 applications per day.
- Employers: `/employer/jobs/:id/applications` (status tabs, shortlist, accept, reject), a candidate page with profile, skill overlap, history, CV and interview scheduling, and a side-by-side compare table for 2 to 4 applicants.
- Status machine (`apps/api/src/modules/applications/transitions.ts`): PENDING -> UNDER_REVIEW / SHORTLISTED / REJECTED, UNDER_REVIEW -> SHORTLISTED / REJECTED, SHORTLISTED -> UNDER_REVIEW / ACCEPTED / REJECTED. INTERVIEW_SCHEDULED is only reached by scheduling an interview (not before review). ACCEPTED, REJECTED and WITHDRAWN are final. Every change is recorded in history.
- Privacy: applying is consent to share the profile and CV with that employer only (CV access ends if the worker withdraws). The phone number is revealed to the employer only from SHORTLISTED onward.
- Notifications are stored in the database and listed on the dashboard (`/api/v1/notifications`). **Real-time push, in-app chat and SMS are not built yet** (Phase 11), so there is no messaging between employer and worker beyond the optional application note.
- The candidate page and compare table show plain facts (such as which required skills a candidate lists). They deliberately show no match score: the scoring engine is Phase 8, and `Application.matchSnapshot` stays empty until then.

## Matching engine (Phase 8)
- Weighted, explainable scoring of skills, experience, location, qualification, availability and salary/preferences, with missing data left out (not zero) and a confidence value. Full formulas and honest limits: [docs/01-matching-engine.md](docs/01-matching-engine.md).
- Workers: "Why this matches you" on each job page, `/recommended` (full list with breakdown), dashboard preview. Employers: match score on applicants (sort by best match), a full analysis on each candidate, a score row in compare, and `/employer/jobs/:id/recommended` for workers who have not applied.
- Administrators can change weights (global or per job category, versioned) through `GET/PUT /api/v1/admin/match-weights`. There is no admin screen for it yet (Phase 12).
- This is the keyword-free *rule-based baseline*. It cannot yet see that differently worded jobs are similar, and nothing learns from data. Both are stated in the UI and docs.

## Semantic AI matching (Phase 9)
The Python service (`apps/ai`), the API client, embedding storage, the hybrid skills score and meaning-based candidate recall are built. The real model (`paraphrase-multilingual-MiniLM-L12-v2`) is installed and was run: 17 service tests pass, the Node client works against it, and it recognises English paraphrases well (AUC 0.98). **For Amharic and Afaan Oromoo it separated different occupations poorly** (AUC about 0.76; the probe phrases were not reviewed by native speakers), so Amharic text is not embedded and Afaan Oromoo is unguarded. On the English benchmark the hybrid score shows no measurable gain over the rules. Without the AI service matching reports `rules-1.0` and falls back safely. Details, numbers and the steps still to do: [docs/02-semantic-matching.md](docs/02-semantic-matching.md).

## CV and job description analysis (Phase 10)
- **Employers:** in the job form, "Suggest requirements from my description" proposes skills (required vs nice-to-have), experience, qualification, employment type, work arrangement, category, languages and salary, each with the sentence it came from and a confidence level. They tick what is right, nothing changes until they press "Use selected", and the job records that it was reviewed.
- **Workers:** after uploading a CV (PDF), "Read my CV" drafts skills, work history, education, certificates, years of experience and a biography for review and correction; only ticked items are saved, always as self-reported.
- It uses keyword and pattern rules plus the skill taxonomy, **not a language model**, and works in English only; scanned PDFs are not supported (no OCR). Details and limits: [docs/03-cv-and-job-analysis.md](docs/03-cv-and-job-analysis.md).

### "Look it over" reviews (rule-based)
- **Worker profile** (`/profile`, "Look over my profile"): checks the headline, biography (length, numbers, capital letters, phone or chat links), skills, work history (undescribed jobs, no achievements, years claimed versus jobs listed, gaps), languages, photo and CV, and ranks what to fix first. Gaps are reported as things to explain, never as faults.
- **Job post** (job form, "Look over my post"): runs before publishing and reuses the bias and scam checks, then suggests clearer titles, a fuller description, skills, pay, place, deadline and schedule.
- **Applicant** (candidate page, "Look over this applicant"): strengths, gaps and questions to ask, built from the stored match, the work history and the cover note. It carries a note that it is not a reason to reject anyone.
- All three are fixed rules (`apps/api/src/modules/review/rules.ts`), **not a language model**, English wording only, read-only and unsaved. A real language model (for example the Claude API) would need an API key, costs money and sends text to a provider, so it is not used; see the "Generative AI assistants" item in docs/00-ARCHITECTURE-AND-PLAN.md.

### More for administrators
- **Announcements** (`/admin/announcements`): notices to everyone, workers or employers, optionally for one region. They show as a dismissible banner while active and can also be added to each person's notifications once when published. Scheduled, ended and withdrawn announcements do not show.
- **One user** (`/admin/users/:id`): profile summary, sessions, reports about and by them, verification requests and recent activity (no passwords, tokens or message text). Account actions each need a reason and are logged: suspend or reactivate, **force a password reset** (ends all sessions, a new password is required at next sign-in), and mark a phone or e-mail verified or not. Administrator accounts and your own cannot be changed this way.
- **Jobs and applications** (`/admin/jobs`): every job and application with search and filters, and three problem lists (past deadline, no applicants after 7 days, waiting for review). An administrator can feature or close a job (closing needs a reason). Removing a job stays in Moderation.
- **Settings and health** (`/admin/settings`): maintenance mode (everyone but administrators gets a 503 with your message; sign-in and the admin area keep working), closing registration, and the daily application limit (1 to 200, default 30), plus a health check of the database, the AI service, SMS, e-mail, Telegram, the upload virus scan and the moderation queues. Settings are stored in the database and other server processes pick up a change within 10 seconds.

## Messaging and notifications (Phase 11)
- Messages between an employer and a worker, tied to an application (`/messages`), delivered live over Socket.IO, with unread badges, "Seen" receipts and a notification bell with toasts. Workers get job-match alerts (opt-out, max 3 a day).
- **SMS is optional and currently off**: no provider is connected, so no text has ever been sent. Set `SMS_GATEWAY_URL` and `SMS_GATEWAY_TOKEN` to enable the generic gateway adapter; real operators need their own adapter. SMS texts are generic by design.
- Design decisions, security model and honest limits (no push to closed browsers, single-server realtime): [docs/04-messaging-and-notifications.md](docs/04-messaging-and-notifications.md).

## Administration and analytics (Phase 12)
- Admin console at `/admin` (create an administrator with `npm run admin:create -w @ethiotalent/api -- <phone> <password> "<name>"`): user management, verification review, moderation of reports and held jobs, skills/categories, translations, matching weights, recommendation performance, national analytics, CSV reports and the audit log.
- Workers and employers get their own analytics at `/analytics`, and workers can request verification of skills and qualifications with evidence and can report jobs.
- Aggregates hide any group smaller than 5, and the home page shows real totals only when they reach that size. Details and honest limits: [docs/05-admin-and-analytics.md](docs/05-admin-and-analytics.md).

## Testing and AI evaluation (Phase 13)
- 380 API tests (including 24 security tests, a worker-to-hire end-to-end journey and performance checks on 3,000 workers / 1,500 jobs) and 17 frontend tests. API line coverage 96%; page components are not covered by automated tests.
- `npm run eval -w @ethiotalent/api` ranks 45 invented workers for 14 invented jobs and reports Precision@K, Recall@K, NDCG@K, MRR, coverage, speed and slices, comparing keyword search, skills-only rules and the shipped engine. **The labels were written by the developer, the data is synthetic and easy, and the engine is not shown to beat keyword search on it.** The hybrid method is measured (no gain shown on this English benchmark); per-language results come from a small probe, not a ranking benchmark (Amharic and Afaan Oromoo measured poor).
- The evaluation found and led to fixing one real defect (profiles with no listed skills were being recommended). `npm audit` reports 3 production vulnerabilities (zod, react-router) that need major upgrades; see the document.
- Everything, with limits and the plan for credible labels: [docs/06-testing-and-evaluation.md](docs/06-testing-and-evaluation.md), generated results in [docs/evaluation-results.md](docs/evaluation-results.md).

## Deployment and documentation (Phase 14)
- Production-style stack (Postgres, migrations + seed, API, Nginx + React build; optional AI service): `docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build`. **Verified locally** (images build, start healthy from an empty database, uploads and data survive restarts); **not** deployed to a real server, no TLS set up, the AI image never built, and the GitHub Actions workflow never run.
- Backup and restore scripts in `infra/backup/` (backup and safe restore verified; in-place restore untested).
- Documents: [deployment](docs/07-deployment.md), [user guide](docs/08-user-guide.md), [technical overview and consolidated list of what is unfinished](docs/09-technical-overview.md), [generated API reference](docs/api-reference.md).

## Sector criteria (Phase 15)
- Different sectors hire on different things: each sector has its own questions (licence class, professional registration, shifts, tools, portfolio...). Employers mark them **must-have** or **preferred** in the job form; workers answer them under "Sector details" and can upload proof for an administrator to verify. Administrators manage the questions at `/admin/criteria`.
- Matching gets a seventh component, "Sector requirements" (12% by default). A person who is **known to lack a must-have** is shown as **Not eligible** (score limited to 39, not recommended, reason shown); unanswered questions are left out of the score, never counted as zero. Jobs without sector criteria score exactly as before.
- Job text that demands a gender, age range, religion, ethnicity or marital status is refused (English explicit phrasings only; a safety net, not a classifier).
- Try it locally: with the API running, `npm run demo:sector -w @ethiotalent/api` creates an employer, a worker who holds the required licence and one who does not, and a truck-driver job with a must-have licence (local API only; the demo password is in the script).
- The 354 starting criteria (44 sectors plus shared ones) were written by the developer, **not** reviewed by sector experts, and have no Amharic or Afaan Oromoo labels yet. Details and limits: [docs/10-sector-criteria.md](docs/10-sector-criteria.md).

## Worker search and invitations (Phase 16)
- Employers search the workers who chose to be visible at `/employer/workers`: by words, sector, skills, region, experience, availability, education, verified evidence and **sector answers** (licence, shifts, tools; an unanswered question never counts as a yes). Choosing one of their open jobs ranks the results by match to it and leaves out people who clearly lack a must-have.
- An employer can **invite** a good fit to apply (optional 300-character message, 20 a day). The worker sees it on their dashboard with the organization and message and decides; an invitation shares nothing about the worker, and contact details stay hidden until they apply and are shortlisted.
- Same privacy as recommendations: no phone, email, exact location, CV or files in results. Text search is simple matching (not semantic), only the best-completed 400 profiles are examined per search, and invitations reach workers in the app only (no SMS or email provider). Details and limits: [docs/11-worker-search-and-invitations.md](docs/11-worker-search-and-invitations.md).

## Hiring rules by organization type (Phase 17)
- An organization's type (private company, public or state-owned enterprise, government office, NGO, agency, cooperative and others) now decides **how it may hire**. Administrators set the rules per type at `/admin/hiring`; the platform enforces them when a vacancy is published or edited while live (verification, closing date, minimum announcement period, stated pay, vacancy reference number) and when a candidate is accepted or rejected (written reason, announcement closed, interview recorded). Private companies decide freely.
- The type cannot be switched to escape the rules once an organization is verified or has published a job (only an administrator can change it, audited). Government and public types must be verified before they can publish.
- **The starting rules (for example 10 days for government) were written by the developer and are not legal advice or checked against Ethiopian regulation.** Details, defaults and limits (no multi-person approval, no exam or quota rules): [docs/12-hiring-rules.md](docs/12-hiring-rules.md).
- **Choosing, finding and administering the types:** a grouped type picker (businesses, government and public bodies, non-profit, individuals and households, agencies, schools) with the documents to prepare for each type, a "Kind of employer" filter in job search, "Government vacancy"-style badges on jobs, a public `GET /organization-types`, and an administrator list of organizations by kind at `/admin/organizations`. Individuals and households can register without pretending to be a company. Details and limits: [docs/13-organization-types.md](docs/13-organization-types.md).

## Database
- Schema: [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma) (30 models)
- Migrations: `init` (generated from the schema) and `constraints` (CHECK constraints and a full-text index Prisma cannot express)
- Seed: 14 regions with zones/cities, 44 job categories (six added in Phase 15 and 24 more later: banking, real estate, telecom, mining and energy, aviation, import-export, food processing, textile and leather, arts, sports, veterinary, environment, water and waste, research, handicrafts, repair services, childcare and elder care, public administration, procurement, marketing and PR, language and interpretation, delivery, human resources, data and analytics), 258 skills with aliases, 127 skill relations, 354 sector criteria, default matching weights. Amharic/Afaan Oromo labels for regions are unreviewed and need native-speaker checking.
