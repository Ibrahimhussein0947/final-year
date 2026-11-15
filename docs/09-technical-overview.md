# Technical overview

For a new developer or an examiner. Per-topic detail lives in the numbered documents; this page is the map and the honest list of what is not finished.

## Documents
| File | Content |
|---|---|
| 00-ARCHITECTURE-AND-PLAN.md | Requirements, original architecture, ER diagram, roadmap |
| 01-matching-engine.md | Scoring formulas, the required-skills gate, limits |
| 02-semantic-matching.md | Embedding integration, what is verified and not, steps to finish |
| 03-cv-and-job-analysis.md | The rule-based CV and job analyzers |
| 04-messaging-and-notifications.md | Realtime design, SMS adapter, limits |
| 05-admin-and-analytics.md | Admin console, privacy rules for statistics |
| 06-testing-and-evaluation.md | Test inventory, security tests, performance, ranking evaluation |
| 07-deployment.md | Docker stack, backups, operations |
| 08-user-guide.md | Using the platform as seeker, employer, administrator |
| 10-sector-criteria.md | Sector-specific requirements and answers, must-have eligibility, the discrimination guard |
| 12-hiring-rules.md | Organization types and the hiring rules enforced per type, with defaults and limits |
| 13-organization-types.md | The grouped type picker, documents to prepare per type, search by kind of employer, the admin organizations list |
| 11-worker-search-and-invitations.md | Employer search for workers, ranking by a job, invitations to apply, privacy and limits |
| 14-responsive-and-pwa.md | Phone/tablet layout rules, installable app, what was and was not verified |
| 15-profile-sections-and-matching-alerts.md | GPA, internships/volunteering/training/apprenticeships/references, documents, match alerts, opt-in auto-apply, "not selected" reasons |
| api-reference.md | Generated list of all routes and their access rules |
| evaluation-results.md | Generated ranking-evaluation report |

## Components
```
apps/web   React 18 + TypeScript + Tailwind 4 + React Router + TanStack Query + React Hook Form/Zod      (Vite build, served by Nginx)
apps/api   Node 22 + Express 5 + TypeScript + Prisma + PostgreSQL 16 (pgvector installed, not used) + Socket.IO
apps/ai    Python FastAPI + Sentence Transformers: embeddings only (run with the real model; English only)
packages   shared (placeholder)
infra      docker-compose (dev DB and production stack), Dockerfiles, Nginx config, backup scripts
```
Backend modules (`apps/api/src/modules/`): auth, workers, employers, files, jobs, applications, matching, analysis, messaging, notifications, trust (reports, verification requests, public data), admin, analytics, taxonomy, criteria (sector criteria and the job-text guard), talent (worker search and invitations), hiring (rules by organization type). Each has `routes.ts` (HTTP + access rules), `service.ts` (logic), `schema.ts` (Zod input validation) where applicable.

## Data
About 30 Prisma models; migrations in `apps/api/prisma/migrations` (generated SQL plus hand-written CHECK constraints and one partial unique index). Seeded reference data: 14 regions with zones/cities, 44 categories, 258 skills with aliases, 127 skill relations, 354 sector criteria. Embeddings are stored as `Float[]` and compared in Node; pgvector is installed for a later move to indexed vector search.

## Decisions worth knowing
- **Scoring is in TypeScript, not Python.** The plan had the AI service compute scores; in the build the Python service only produces embeddings, so scoring stays testable, explainable and available when the AI service is down.
- **Explainability by construction:** every number in an explanation comes from the same calculation as the score. Missing data is excluded and reported (`confidence`, `notAssessed`), never counted as zero.
- **Required-skills gate:** someone who covers none of a job's required skills is not recommended and is labelled at most "partial", whatever their location or experience.
- **Trust labels are earned:** "verified" is set only by an administrator after reviewing evidence; CV and job extraction results are always proposals that a person confirms, and imported skills are always `SELF_REPORTED`.
- **Privacy defaults:** phone numbers revealed only from SHORTLISTED; job-site and home coordinates rounded in public views; aggregates hide groups under 5; recommendations and analytics contain no contact details.
- **Security model:** short-lived access token in memory + rotating httpOnly refresh cookie with reuse detection and CSRF header; roles read from the database on every request (suspension is immediate); uploads typed by magic bytes, stored under random names, served only through authorized routes with `nosniff` and a sandboxing CSP; rate limits at Nginx and in the API; audit log for administrative actions.
- **No fake AI.** Where a capability is not implemented or not measured the interface and docs say so (engine label `rules-1.0` vs `hybrid-1.0`; "not configured" for AI and SMS; hybrid evaluation row left empty).

## Status against the original 14 phases
Phases 1 to 8 and 10 to 17 are done to the extent described in their documents. **Phase 9 is done for English only**: the real model is installed and measured; it works for English, was poor for Amharic and Afaan Oromoo in the probe (Amharic text is therefore not embedded), and the hybrid score shows no measurable ranking gain on the current easy English benchmark (docs/02, docs/06).

## Not finished (consolidated)
**Needed before real use**
1. Finish Phase 9 properly: native speakers review the Amharic and Afaan Oromoo probe phrases and interface text and the probe is rerun (consider another model if Ethiopian-language results stay poor); calibrate `SEMANTIC_LOW/HIGH` on at least 100 held-out pairs; build and deploy the AI Docker image; backfill embeddings on real data.
2. Independent relevance labels for the ranking evaluation (docs/06 section 3) and a harder, multilingual benchmark.
3. TLS and a real server; monitoring, alerting and log collection; a rehearsed restore (including `--in-place`).
4. Upgrade `zod` and `react-router` (production audit findings), then rerun all tests.
5. Sector experts review the 354 starting sector criteria and the 30 sectors added after the first 14 (their skill lists are short: 5 to 10 each); native speakers translate them and the new screens; consider a sector filter in public search. Email and SMS providers; password reset; account deletion and data export; antivirus scanning of uploads.
6. Real-user acceptance testing and an accessibility and mobile audit.

**Scale-out (not needed for a pilot on one server)**
7. Redis adapter for Socket.IO so several API processes can serve live messages.
8. CV/PDF parsing in an isolated worker, and a queue for job-alert fan-out.
9. Use the full-text index (or SQL aggregation) for job search and national analytics, which currently load data in memory or use `contains`.

**Product features from the brief that were not built** (video interviews are built as meeting links only, see docs/18): the training-institution role (administrators list courses instead, see docs/16), AI career/recruiter chat assistant, map view of jobs, mobile app, payments.

## Commands
```bash
npm install
npm run db:up                                   # dev database (Docker), then prisma migrate deploy + db:seed in apps/api
npm run dev -w @ethiotalent/api                 # API on :4100
npm run dev -w @ethiotalent/web                 # web on :5173
npm test -w @ethiotalent/api                    # API tests (needs the *_test database)
npm test -w @ethiotalent/web                    # web tests
npm run eval -w @ethiotalent/api                # ranking evaluation
npm run docs:api -w @ethiotalent/api            # regenerate docs/api-reference.md
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build   # production-style stack
```
