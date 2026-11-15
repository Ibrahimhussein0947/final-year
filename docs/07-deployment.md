# Deployment and operations (Phase 14)

## What was verified, and what was not
| Item | Status |
|---|---|
| `db`, `migrate`, `api`, `web` images build and start from an empty database with `docker-compose.prod.yml` | **Verified** on Windows 11 / Docker Desktop (all four healthy; migrations applied; taxonomy seeded) |
| Registration, login cookies, job listing, WebSocket handshake, CV upload (5 MB API cap and 6 MB Nginx cap), health routes through Nginx | **Verified** by hand with `curl` |
| Re-running migrate+seed is harmless; data and uploads survive `docker compose restart` | **Verified** |
| Admin creation inside the container | **Verified** |
| `backup.sh` and the safe form of `restore.sh` (restore into a scratch database, compare counts) | **Verified** |
| `restore.sh --in-place` | **Not tested** |
| AI service image (`ai.Dockerfile`) | **Never built.** The service itself was run locally (outside Docker) with the real model and passed its tests; the image build was not attempted |
| `.github/workflows/ci.yml` | **Never run on GitHub.** Each command in it was run locally; expect small fixes on the first run |
| TLS / HTTPS, a real domain, a real server, monitoring, log shipping | **Not set up** (instructions below) |
| Linux host | **Not tested** (developed on Windows); the images are Linux images, so it should work, but it has not been shown |

## Architecture of the stack
```
Internet --TLS--> [your TLS proxy / load balancer] --HTTP--> web (Nginx :80)
                                                           |-- static React app
                                                           |-- /api, /socket.io --> api (Node :4000) --> db (Postgres 16 + pgvector)
                                                                                         |-- uploads volume (/data/uploads)
                                                                                         |-- ai (optional, :8100, internal only)
```
Only `web` publishes a port. `db`, `api` and `ai` are reachable only on the internal Docker network. `migrate` runs once before the API starts (migrations, then an idempotent seed of regions, categories, skills and default weights).

## First deployment
Requirements: a Linux server (my estimate, not measured: 2 vCPU / 2 GB RAM for the stack without the AI service, roughly 2 GB more with it), Docker Engine with the compose plugin, a domain name, and TLS.

```bash
git clone <repository> && cd <repository>
cp infra/.env.prod.example infra/.env.prod
# fill in: POSTGRES_PASSWORD (letters+digits), JWT_ACCESS_SECRET (openssl rand -hex 32), PUBLIC_URL=https://your.domain
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod ps      # db, api, web should be healthy
```
Create the first administrator (there is deliberately no sign-up route for admins):
```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod run --rm --entrypoint "" migrate \
  npx tsx src/scripts/create-admin.ts 09XXXXXXXX 'a-long-unique-password' 'Your Name'
```
The compose file refuses to start if a required secret is missing. `.env.prod` is git-ignored; keep it out of backups that leave your control, or encrypt them.

### TLS (required for real use)
The session cookie is `Secure` by default (`COOKIE_SECURE=true`), so browsers only keep it over HTTPS (except on `localhost`). Put a TLS terminator in front of the `web` port: the simplest is Caddy on the host (`your.domain { reverse_proxy localhost:8080 }`, automatic certificates) or Cloudflare in front. Nginx trusts exactly one proxy hop for the client address (`X-Forwarded-For`); if you add a second hop, change `trust proxy` in `apps/api/src/app.ts` and the Nginx header lines, otherwise rate limits will see the wrong address.
Setting `COOKIE_SECURE=false` is for a trial over plain HTTP only: sessions are then exposed on the network.

### Optional services
- **Semantic matching (AI service):** set `AI_SERVICE_TOKEN` (24+ random characters) and `AI_SERVICE_URL=http://ai:8100` in `.env.prod`, then `docker compose ... --profile ai up -d --build`. The image bakes the model in (expect an image of a few GB; not measured). After it is healthy run the embedding backfill once (`docker compose ... run --rm --entrypoint "" migrate npx tsx src/scripts/backfill-embeddings.ts`) and then see docs/02-semantic-matching.md for the measured limits (English only). **Not yet executed in Docker**; the same service was run directly on the development machine. Amharic text is skipped automatically; Afaan Oromoo is not.
- **SMS:** set `SMS_GATEWAY_URL` and `SMS_GATEWAY_TOKEN` for a generic JSON gateway. No provider is integrated; no SMS has ever been sent.

## Updating
```bash
git pull
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
```
`migrate` runs again automatically and applies only new migrations. Migrations are forward-only: to go back, restore the backup taken before the update (below). **Take a backup before every update.**

## Backups and restore
```bash
infra/backup/backup.sh                       # writes infra/backups/<UTC time>/{db.dump, uploads.tar.gz, SHA256SUMS}; keeps the newest 14
infra/backup/restore.sh infra/backups/<dir>  # SAFE: restores into a scratch database "restore_check" and prints row counts
infra/backup/restore.sh infra/backups/<dir> --in-place   # replaces the live data after you type the database name
```
Schedule `backup.sh` with cron (for example `15 2 * * * /srv/app/infra/backup/backup.sh`) **and copy the folder to another machine or storage**: a backup on the same disk is lost with the disk. Run the safe restore regularly; a backup that has never been restored is untested. Backups contain personal data (names, phone numbers, CV files): protect and eventually delete them accordingly.

## Configuration reference
| Variable | Required | Meaning |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | yes | database credentials (password: letters and digits only, it is placed in a URL) |
| `JWT_ACCESS_SECRET` | yes | signs access tokens, 32+ characters; changing it signs everyone out |
| `PUBLIC_URL` | yes | the browser address; used as the allowed CORS origin |
| `WEB_PORT` | no (8080) | host port of the web container |
| `COOKIE_SECURE` | no (true) | see TLS |
| `REVIEW_UNVERIFIED_JOBS` | no (false) | jobs of unverified organizations wait for admin approval |
| `AI_SERVICE_URL`, `AI_SERVICE_TOKEN` | no | semantic matching |
| `SMS_GATEWAY_URL`, `SMS_GATEWAY_TOKEN` | no | SMS |

Set but empty optional variables count as "not set".

## Monitoring
- `GET /api-health` (through Nginx) returns 200 only if the API can query the database; point an uptime monitor at it.
- `docker compose ... ps` shows container health; `docker compose ... logs -f api` shows structured JSON logs (request log, errors).
- The admin console's Overview page shows database, AI service and SMS gateway status.
- **Not provided:** metrics, alerting, log aggregation, error tracking. Add them before relying on the system.

## Known operational limits (be honest with stakeholders)
- **One API process.** Live messaging uses in-memory Socket.IO rooms; running several API containers needs the Redis adapter, which is not built. The 40-concurrent-visitor test (docs/06) ran against the API in-process on a development machine, not against these containers; real capacity is unmeasured.
- **CV parsing and job-alert fan-out run inside the API process.** A flood of large PDFs or a very popular job could slow other requests. An isolated worker and a queue are the planned fixes and are not built.
- **No email delivery.** Password-reset, phone and email verification codes are generated but, without an SMS or email provider, are only visible in development, so users cannot reset a forgotten password in production until a provider is connected.
- **No account deletion or data export** for users (needed for privacy-law compliance in many places); deleting a user who posted jobs is blocked by the database.
- **No antivirus scan** on uploads; type is checked from file bytes only.
- **Docker volumes on one host** hold the database and uploads: the server is a single point of failure until backups are copied elsewhere and a restore has been rehearsed.
- Dependency audit findings (zod, react-router) need major upgrades: docs/06-testing-and-evaluation.md.
