#!/usr/bin/env bash
# Creates a throw-away super admin (default "smoke@example.com", or $SMOKE_EMAIL) for smoke testing and saves its generated password in
# .smoke-credentials (owner-readable, git-ignored). Delete the user in the app (Users) when testing is finished.
set -euo pipefail
EMAIL="${SMOKE_EMAIL:-smoke@example.com}"
cd "$(dirname "$0")/.."
PW="Smk$(openssl rand -hex 8)1"
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm \
  -e SEED_ADMIN_EMAIL="$EMAIL" -e SEED_ADMIN_PASSWORD="$PW" api node dist/seed/seed.js
umask 077
printf 'email=%s\npassword=%s\n' "$EMAIL" "$PW" > .smoke-credentials
echo "Smoke admin ready; credentials saved in .smoke-credentials"
