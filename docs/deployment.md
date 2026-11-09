# Deployment guide

Target: one Linux server (2 GB RAM or more) with Docker and the Compose plugin, a domain name pointing at it, and ports 80 and 443 open. The stack is PostgreSQL, the API, the web app and a Caddy proxy that obtains and renews HTTPS certificates automatically.

> Status: the files below were written and checked for syntax (compose parses, shell scripts pass `bash -n`, the API and the web standalone build run). The Docker images, the Caddyfile and the backup/restore scripts have **not been run** because the development sandbox cannot reach a Docker daemon. Do the first install on a test server and run the "Verify" and "Restore drill" steps before relying on it.

## 1. First install

```bash
git clone <your repository> /opt/costing && cd /opt/costing
cp .env.production.example .env.production
```

Edit `.env.production`:

| Variable | Meaning |
|---|---|
| `DOMAIN` | the address people will use, e.g. `costing.example.com` |
| `ACME_EMAIL` | contact address for the certificate authority |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` (letters and digits only: it goes inside the database URL, where `/` or `+` would break it) |
| `JWT_SECRET` | `openssl rand -base64 48` (the API will not start in production with less than 32 characters) |
| `FILE_URL_SECRET` | optional, separate secret for signed image links |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | optional, for push notifications on browsers and phones; generate once (command in `.env.production.example`) and keep them. Without them notifications appear under the bell only |
| `VAPID_SUBJECT` | contact for the push services, e.g. `mailto:admin@example.com` |

Start everything (builds the images, applies the database migrations, then starts the services):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Create the roles, units and the first administrator (once):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm \
  -e SEED_ADMIN_EMAIL=you@example.com -e SEED_ADMIN_PASSWORD='a-long-temporary-password' \
  api node dist/seed/seed.js
```

Push notifications need HTTPS (Caddy provides it). On an iPhone a user opens the site in Safari, chooses **Share → Add to Home Screen**, opens it from there and turns notifications on under **My Profile** (iOS 16.4 or later).

Sign in at `https://<DOMAIN>`; you are asked to choose a new password. Optional demo data: `node dist/seed/demo.js` in the same way (do not use on a real installation).

## 2. Verify

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps     # all "healthy" / "running"
./deploy/check.sh https://<DOMAIN>                                           # prints OK
```

`/api/health` answers 200 when the database is reachable and 503 when it is not.

## 3. Updating

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production exec api node dist/seed/seed.js
```

Migrations run automatically before the new API starts (`migrate` service). The seed step is what adds new permissions: without it a new screen answers 403, even for admins. It is safe to repeat and never removes anything you customised. Take a backup first.

## 4. Backups

`./deploy/backup.sh` writes `backups/db-<time>.dump` (PostgreSQL custom format) and `backups/uploads-<time>.tar.gz` (images and logo), keeping the newest 14 of each (`KEEP=30 ./deploy/backup.sh` to change). Schedule it:

```bash
mkdir -p /opt/costing/backups
```

```
0 2 * * *  cd /opt/costing && ./deploy/backup.sh >> backups/backup.log 2>&1
```

Create the folder first: the log file is opened before the script runs, so without it the job fails and no backup is made.

Copy the `backups` folder off the server (another machine or object storage); a backup on the same disk does not survive a disk failure.

**Restore drill** (do this once on a test server): `./deploy/restore.sh backups/db-….dump backups/uploads-….tar.gz`, then sign in and open an old costing and its images.

## 5. Monitoring and logs

- Point an uptime monitor at `https://<DOMAIN>/api/health` (expects 200), or run `./deploy/check.sh` from cron and alert on a non-zero exit.
- Containers restart automatically (`restart: unless-stopped`) and have health checks; logs rotate (5 files of 10 MB each).
- `docker compose -f docker-compose.prod.yml logs -f api` shows the API. Business activity (who changed what) is in the application's audit log, not the container log.
- Password-reset links are written to the API log until a mail service is added: `docker compose … logs api | grep "reset token"`.

## 6. Security notes

- Only the proxy publishes ports (80, 443). The database, API and web are on the internal network.
- HTTPS is automatic; HSTS is sent. The API trusts the proxy for client IPs (`TRUST_PROXY=true`), which is correct only because nothing else can reach it.
- `/api/docs` is off unless `ENABLE_SWAGGER=true`.
- Keep `.env.production` readable by administrators only (`chmod 600`). Rotating `JWT_SECRET` signs everyone out.
- Apply operating-system and Docker updates regularly; rebuild the images (`up -d --build`) to pick up base-image fixes.

## 7. Without Docker

Requirements: Node 20+, pnpm, PostgreSQL 14+ (extension `pg_trgm`), a reverse proxy that serves `/api/*` from the API and everything else from the web app on the same domain.

```bash
pnpm install --frozen-lockfile && pnpm exec prisma generate --schema prisma/schema.prisma
NEXT_PUBLIC_API_URL=/api pnpm build
pnpm --filter @costing/api exec prisma migrate deploy
NODE_ENV=production node apps/api/dist/main.js          # with the variables from .env.example
node apps/web/.next/standalone/apps/web/server.js        # copy .next/static to apps/web/.next/standalone/apps/web/.next/static first
```

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| API container exits at start | `JWT_SECRET` too short, or `WEB_ORIGIN`/`DOMAIN` unset (see `logs api`) |
| `migrate` fails | database not ready or wrong `POSTGRES_PASSWORD` (the password only applies when the volume is first created) |
| Certificate not issued | DNS does not point at the server yet, or ports 80/443 are blocked |
| Sign-in works but you are logged out on reload | the site is opened over plain HTTP, or through a different domain than `DOMAIN` |
| "Too many failed sign-in attempts" | account locked for 15 minutes after 5 wrong passwords |
