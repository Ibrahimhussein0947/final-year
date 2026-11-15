# API reference

Generated from the code by `npm run docs:api -w @ethiotalent/api` (a test fails if this file is out of date). Base URL: `/api/v1`. Errors have the shape `{ "error": { "code", "message", "details?" } }`.

**What is and is not here.** Every route, its method, and who may call it come from the running router. Request and response bodies are defined by the Zod schemas in the module files named below (`schema.ts` next to each `routes.ts`); they are not duplicated here, so they cannot go stale. Authentication: send `Authorization: Bearer <access token>` from `POST /auth/login` or `/auth/register`; tokens last 15 minutes and are renewed with `POST /auth/refresh` (cookie + `X-CSRF-Protection: 1` header). Role checks read the role from the database.

Also served outside `/api/v1`: `GET /health` (checks the database), and WebSocket (Socket.IO) at `/socket.io` for live messages and notifications (authenticate with `auth: { token }`).

## auth — `apps/api/src/modules/auth/routes.ts`

| Method | Path | Access |
|---|---|---|
| POST | `/auth/register` | public |
| POST | `/auth/login` | public |
| POST | `/auth/refresh` | public |
| POST | `/auth/logout` | public |
| GET | `/auth/me` | signed in |
| POST | `/auth/verify/request` | signed in |
| POST | `/auth/verify/confirm` | signed in |
| POST | `/auth/password/forgot` | public |
| POST | `/auth/password/reset` | public |
| POST | `/auth/password/change` | signed in |
| POST | `/auth/2fa/setup` | signed in |
| POST | `/auth/2fa/enable` | signed in |
| POST | `/auth/2fa/disable` | signed in |
| GET | `/auth/me/export` | signed in |
| POST | `/auth/me/delete` | signed in |

## taxonomy — `apps/api/src/modules/taxonomy/routes.ts`

| Method | Path | Access |
|---|---|---|
| GET | `/categories` | public |
| GET | `/skills` | public |
| GET | `/locations` | public |

## criteria — `apps/api/src/modules/criteria/routes.ts`

| Method | Path | Access |
|---|---|---|
| GET | `/criteria` | public |

## talent — `apps/api/src/modules/talent/routes.ts`

| Method | Path | Access |
|---|---|---|
| GET | `/talent/search` | signed in, employer only |
| POST | `/jobs/:id/invitations` | signed in, employer only |
| POST | `/jobs/:id/invitations/bulk` | signed in, employer only |
| GET | `/jobs/:id/invitations` | signed in, employer only |
| GET | `/invitations/mine` | signed in, worker only |
| POST | `/invitations/:id/decline` | signed in, worker only |

## organizationTypes — `apps/api/src/modules/hiring/directory.ts`

| Method | Path | Access |
|---|---|---|
| GET | `/organization-types` | public |

## workers — `apps/api/src/modules/workers/routes.ts`

| Method | Path | Access |
|---|---|---|
| GET | `/workers/me` | signed in, worker only |
| PATCH | `/workers/me` | signed in, worker only |
| GET | `/workers/me/views` | signed in, worker only |
| GET | `/workers/me/criteria` | signed in, worker only |
| PUT | `/workers/me/criteria` | signed in, worker only |
| PUT | `/workers/me/skills/:skillId` | signed in, worker only |
| DELETE | `/workers/me/skills/:skillId` | signed in, worker only |
| POST | `/workers/me/education` | signed in, worker only |
| PUT | `/workers/me/education/:id` | signed in, worker only |
| DELETE | `/workers/me/education/:id` | signed in, worker only |
| POST | `/workers/me/education/:id/document` | signed in, worker only |
| POST | `/workers/me/certifications` | signed in, worker only |
| PUT | `/workers/me/certifications/:id` | signed in, worker only |
| DELETE | `/workers/me/certifications/:id` | signed in, worker only |
| POST | `/workers/me/certifications/:id/document` | signed in, worker only |
| POST | `/workers/me/experience` | signed in, worker only |
| PUT | `/workers/me/experience/:id` | signed in, worker only |
| DELETE | `/workers/me/experience/:id` | signed in, worker only |
| POST | `/workers/me/activities` | signed in, worker only |
| PUT | `/workers/me/activities/:id` | signed in, worker only |
| DELETE | `/workers/me/activities/:id` | signed in, worker only |
| POST | `/workers/me/activities/:id/document` | signed in, worker only |
| POST | `/workers/me/photo` | signed in, worker only |
| DELETE | `/workers/me/photo` | signed in, worker only |
| POST | `/workers/me/cv` | signed in, worker only |
| DELETE | `/workers/me/cv` | signed in, worker only |
| GET | `/workers/:id` | signed in, employer or admin only |

## employers — `apps/api/src/modules/employers/routes.ts`

| Method | Path | Access |
|---|---|---|
| GET | `/employers/me` | signed in, employer only |
| GET | `/employers/me/subscription` | signed in, employer only |
| GET | `/employers/me/hiring-rules` | signed in, employer only |
| PATCH | `/employers/me` | signed in, employer only |
| POST | `/employers/me/verification` | signed in, employer only |
| DELETE | `/employers/me/verification` | signed in, employer only |

## files — `apps/api/src/modules/files/routes.ts`

| Method | Path | Access |
|---|---|---|
| GET | `/files/:id` | signed in |

## interviews — `apps/api/src/modules/applications/interviews.ts`

| Method | Path | Access |
|---|---|---|
| GET | `/interviews/config` | signed in, worker or employer only |
| GET | `/interviews/:id/join` | signed in, worker or employer only |
| GET | `/interviews/mine` | signed in, worker or employer only |
| GET | `/interviews/mine.ics` | signed in, worker or employer only |

## savedSearches — `apps/api/src/modules/jobs/savedSearches.ts`

| Method | Path | Access |
|---|---|---|
| GET | `/saved-searches` | signed in, worker only |
| POST | `/saved-searches` | signed in, worker only |
| PATCH | `/saved-searches/:id` | signed in, worker only |
| DELETE | `/saved-searches/:id` | signed in, worker only |

## jobs — `apps/api/src/modules/jobs/routes.ts`

| Method | Path | Access |
|---|---|---|
| GET | `/jobs/mine` | signed in, employer only |
| POST | `/jobs` | signed in, employer only |
| PATCH | `/jobs/:id` | signed in, employer only |
| POST | `/jobs/:id/publish` | signed in, employer only |
| POST | `/jobs/:id/close` | signed in, employer only |
| POST | `/jobs/:id/feature` | signed in, employer only |
| DELETE | `/jobs/:id` | signed in, employer only |
| GET | `/jobs` | public |
| GET | `/jobs/:id` | public (signed-in users get extra fields) |

## applications — `apps/api/src/modules/applications/routes.ts`

| Method | Path | Access |
|---|---|---|
| POST | `/jobs/:id/apply` | signed in, worker only |
| PUT | `/jobs/:id/save` | signed in, worker only |
| DELETE | `/jobs/:id/save` | signed in, worker only |
| GET | `/saved-jobs` | signed in, worker only |
| GET | `/applications/mine` | signed in, worker only |
| POST | `/applications/:id/withdraw` | signed in, worker only |
| GET | `/applications/summary` | signed in, worker or employer only |
| GET | `/jobs/:id/applications` | signed in, employer only |
| GET | `/applications/compare` | signed in, employer only |
| GET | `/applications/:id` | signed in, employer only |
| PATCH | `/applications/:id/status` | signed in, employer only |
| POST | `/applications/:id/interviews` | signed in, employer only |
| PATCH | `/applications/:id/interviews/:interviewId` | signed in, employer only |
| DELETE | `/applications/:id/interviews/:interviewId` | signed in, employer only |

## matching — `apps/api/src/modules/matching/routes.ts`

| Method | Path | Access |
|---|---|---|
| GET | `/jobs/:id/recommended-workers` | signed in, employer only |
| GET | `/recommendations/jobs` | signed in, worker only |
| GET | `/jobs/:id/match` | signed in, worker only |
| GET | `/admin/match-weights` | signed in, admin only |
| PUT | `/admin/match-weights` | signed in, admin only |
| DELETE | `/admin/match-weights/:id` | signed in, admin only |

## analysis — `apps/api/src/modules/analysis/routes.ts`

| Method | Path | Access |
|---|---|---|
| POST | `/analysis/job` | signed in, employer only |
| POST | `/workers/me/cv/analyze` | signed in, worker only |
| POST | `/workers/me/cv/apply` | signed in, worker only |

## messaging — `apps/api/src/modules/messaging/routes.ts`

| Method | Path | Access |
|---|---|---|
| POST | `/applications/:id/conversation` | signed in, worker or employer only |
| POST | `/invitations/:id/conversation` | signed in, worker or employer only |
| GET | `/conversations` | signed in, worker or employer only |
| GET | `/conversations/unread-count` | signed in, worker or employer only |
| GET | `/conversations/:id/messages` | signed in, worker or employer only |
| POST | `/conversations/:id/messages` | signed in, worker or employer only |
| POST | `/conversations/:id/read` | signed in, worker or employer only |

## trust — `apps/api/src/modules/trust/routes.ts`

| Method | Path | Access |
|---|---|---|
| POST | `/reports` | signed in |
| POST | `/workers/me/verification` | signed in, worker only |
| GET | `/workers/me/verifications` | signed in, worker only |
| DELETE | `/workers/me/verifications/:id` | signed in, worker only |
| GET | `/translations/:locale` | public |
| GET | `/public/stats` | public |
| GET | `/analytics/worker` | signed in, worker only |
| GET | `/analytics/employer` | signed in, employer only |

## trainingAdmin — ``

| Method | Path | Access |
|---|---|---|
| GET | `/admin/training` | signed in, admin only |
| POST | `/admin/training` | signed in, admin only |
| PATCH | `/admin/training/:id` | signed in, admin only |
| DELETE | `/admin/training/:id` | signed in, admin only |

## training — ``

| Method | Path | Access |
|---|---|---|
| GET | `/training/suggestions` | signed in, worker only |

## admin — `apps/api/src/modules/admin/routes.ts`

| Method | Path | Access |
|---|---|---|
| GET | `/admin/stats` | signed in, admin only |
| GET | `/admin/system` | signed in, admin only |
| GET | `/admin/users` | signed in, admin only |
| PATCH | `/admin/users/:id/status` | signed in, admin only |
| GET | `/admin/admins` | signed in, admin only |
| POST | `/admin/admins` | signed in, admin only |
| PATCH | `/admin/admins/:id/status` | signed in, admin only |
| GET | `/admin/plans` | signed in, admin only |
| POST | `/admin/plans` | signed in, admin only |
| PATCH | `/admin/plans/:id` | signed in, admin only |
| GET | `/admin/subscriptions` | signed in, admin only |
| POST | `/admin/organizations/:id/subscription` | signed in, admin only |
| DELETE | `/admin/organizations/:id/subscription` | signed in, admin only |
| GET | `/admin/verifications` | signed in, admin only |
| POST | `/admin/verifications/:id/review` | signed in, admin only |
| GET | `/admin/moderation/reports` | signed in, admin only |
| POST | `/admin/moderation/reports/:id/resolve` | signed in, admin only |
| GET | `/admin/moderation/jobs` | signed in, admin only |
| POST | `/admin/moderation/jobs/:id/review` | signed in, admin only |
| POST | `/admin/moderation/jobs/:id/remove` | signed in, admin only |
| GET | `/admin/organizations` | signed in, admin only |
| PATCH | `/admin/organizations/:id/type` | signed in, admin only |
| GET | `/admin/hiring-policies` | signed in, admin only |
| PATCH | `/admin/hiring-policies/:type` | signed in, admin only |
| GET | `/admin/criteria` | signed in, admin only |
| POST | `/admin/criteria` | signed in, admin only |
| PATCH | `/admin/criteria/:id` | signed in, admin only |
| GET | `/admin/categories` | signed in, admin only |
| POST | `/admin/categories` | signed in, admin only |
| PATCH | `/admin/categories/:id` | signed in, admin only |
| GET | `/admin/skills` | signed in, admin only |
| POST | `/admin/skills` | signed in, admin only |
| PATCH | `/admin/skills/:id` | signed in, admin only |
| GET | `/admin/translations` | signed in, admin only |
| PUT | `/admin/translations` | signed in, admin only |
| DELETE | `/admin/translations/:locale/:key` | signed in, admin only |
| GET | `/admin/audit` | signed in, admin only |
| GET | `/admin/analytics/national` | signed in, admin only |
| GET | `/admin/analytics/recommendations` | signed in, admin only |
| GET | `/admin/export/:kind` | signed in, admin only |

## notifications — `apps/api/src/modules/notifications/routes.ts`

| Method | Path | Access |
|---|---|---|
| GET | `/notifications` | signed in |
| GET | `/notifications/settings` | signed in |
| PATCH | `/notifications/settings` | signed in |
| POST | `/notifications/read-all` | signed in |
| POST | `/notifications/:id/read` | signed in |

Total: 165 routes.
