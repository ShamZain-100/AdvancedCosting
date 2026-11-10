#!/usr/bin/env bash
# Smart Costing (Contabo): switch the running release to <sha>. Run as sc-deploy, normally through the deploy gate
# (`ssh sc-deploy@<server> deploy <sha> [api] [web]`), which local-deploy.sh and the GitHub workflow call.
#
#   deploy.sh <40-hex sha> [api] [web]        default: both services
#   DRY_RUN=1 deploy.sh <sha> [services]      checks and plan only; changes nothing
#
# Steps: lock → images present → database up → pre-deploy backup (database + uploads) → `prisma migrate deploy` and the
# idempotent seed (roles/permissions) with the NEW api image → start the new containers → health checks for up to
# DEPLOY_HEALTH_TIMEOUT seconds → record the tags and prune old images, or roll back to the previous tags.
#
# Exit codes: 0 deployed · 1 failed before the switch (old release untouched) · 2 unhealthy, rolled back ·
#             3 unhealthy and no previous release to go back to, or the rollback is unhealthy too (needs the owner)
#
# Migrations are never rolled back: write them backwards compatible (add nullable columns, drop in a later release).
set -Eeuo pipefail
SC_SCRIPT=deploy
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
trap 'log "unexpected error at line $LINENO (exit $?)"' ERR

SHA=${1:-}
shift || true
is_sha "$SHA" || die "usage: deploy.sh <40-hex sha> [api] [web]"
SVCS=("$@")
((${#SVCS[@]})) || SVCS=(api web)
for s in "${SVCS[@]}"; do is_service "$s" || die "unknown service '$s' (allowed: $SERVICES_ALL)"; done
has() { [[ " ${SVCS[*]} " == *" $1 "* ]]; }
TIMEOUT=${DEPLOY_HEALTH_TIMEOUT:-180}
DRY=${DRY_RUN:-0}

cd "$APP_DIR"
mkdir -p "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock -w 600 9 || die "another deploy or restore is running (waited 600 s)"

PREV_API=$(deployed_tag api)
PREV_WEB=$(deployed_tag web)
NEW_API=$PREV_API
NEW_WEB=$PREV_WEB
has api && NEW_API=$SHA
has web && NEW_WEB=$SHA

log "request: deploy ${SHA:0:12} (${SVCS[*]})$([[ $DRY == 1 ]] && echo ' DRY RUN' || true)"

# ── preflight
[[ -r $ENV_FILE ]] || die "$ENV_FILE is missing or unreadable"
grep -qE '^(POSTGRES_PASSWORD|JWT_SECRET)=.+' "$ENV_FILE" || die "POSTGRES_PASSWORD / JWT_SECRET are not set in $ENV_FILE"
[[ -n $NEW_API && -n $NEW_WEB ]] ||
  die "first release: deploy both services together (nothing is running yet for $([[ -z $NEW_API ]] && echo api || echo web))"
for s in api web; do
  t=$NEW_API
  [[ $s == web ]] && t=$NEW_WEB
  docker image inspect "$(image_of "$s" "$t")" >/dev/null 2>&1 || die "image $(image_of "$s" "$t") is not on this server (ship it first)"
done
compose_with "$NEW_API" "$NEW_WEB" config -q || die "docker compose rejects the configuration"
free_mb=$(df -Pm "$(docker info -f '{{.DockerRootDir}}')" | awk 'NR == 2 { print $4 }')
((free_mb >= ${DEPLOY_MIN_FREE_MB:-2048})) || die "only ${free_mb} MB free for Docker (need ${DEPLOY_MIN_FREE_MB:-2048})"

echo "plan:"
echo "  api  ${PREV_API:-<none>} -> $NEW_API"
echo "  web  ${PREV_WEB:-<none>} -> $NEW_WEB"
if ! has api; then echo "  backup skipped (api unchanged, no migrations)"
elif [[ -z $PREV_API ]]; then echo "  backup skipped (first release, empty database)"
else echo "  backup database + uploads before migrating"; fi
if [[ -n $PREV_API ]]; then
  if healthy api web; then echo "  running stack: healthy"; else echo "  running stack: NOT healthy"; fi
fi
if [[ $DRY == 1 ]]; then
  log "dry run ok, nothing changed"
  exit 0
fi

# ── database, backup, migrations
compose_with "$NEW_API" "$NEW_WEB" up -d db
for _ in $(seq 1 36); do
  [[ $(docker inspect -f '{{.State.Health.Status}}' "$(compose_with "$NEW_API" "$NEW_WEB" ps -q db)" 2>/dev/null) == healthy ]] && break
  sleep 5
done
[[ $(docker inspect -f '{{.State.Health.Status}}' "$(compose_with "$NEW_API" "$NEW_WEB" ps -q db)") == healthy ]] || die "database is not healthy"

if has api; then
  if [[ -n $PREV_API && ${SKIP_BACKUP:-0} != 1 ]]; then
    bash "$APP_DIR/scripts/backup.sh" --kind predeploy --label "${SHA:0:12}" || die "pre-deploy backup failed; nothing changed"
  fi
  log "migrating with $(image_of api "$NEW_API")"
  compose_with "$NEW_API" "$NEW_WEB" run --rm --no-deps -T api ./node_modules/.bin/prisma migrate deploy ||
    die "migration failed; the previous release is still running (check _prisma_migrations before retrying)"
  compose_with "$NEW_API" "$NEW_WEB" run --rm --no-deps -T api node dist/seed/seed.js ||
    die "seed (roles/permissions) failed; the previous release is still running"
fi

# ── switch
log "starting ${SVCS[*]}"
compose_with "$NEW_API" "$NEW_WEB" up -d --no-deps "${SVCS[@]}"

if wait_healthy "$TIMEOUT" api web; then
  write_tags "$NEW_API" "$NEW_WEB"
  log "deployed ${SHA:0:12} (${SVCS[*]}): healthy"
  # keep the newest DEPLOY_KEEP_IMAGES tags per service (always the running and previous ones)
  keep=$(env_get DEPLOY_KEEP_IMAGES 3)
  for s in api web; do
    docker image ls "smartcosting-$s" --format '{{.CreatedAt}}|{{.Tag}}' | sort -r | cut -d'|' -f2 | tail -n +$((keep + 1)) |
      while read -r t; do
        [[ $t == "$NEW_API" || $t == "$NEW_WEB" || $t == "$PREV_API" || $t == "$PREV_WEB" ]] && continue
        docker image rm "smartcosting-$s:$t" >/dev/null 2>&1 && log "pruned smartcosting-$s:$t" || true
      done
  done
  exit 0
fi

# ── rollback
log "new release unhealthy after ${TIMEOUT}s; diagnostics:"
compose_with "$NEW_API" "$NEW_WEB" ps >&2 || true
compose_with "$NEW_API" "$NEW_WEB" logs --no-color --tail 30 "${SVCS[@]}" >&2 || true
if [[ -z $PREV_API || -z $PREV_WEB || ($PREV_API == "$NEW_API" && $PREV_WEB == "$NEW_WEB") ]]; then
  die "no previous release to roll back to; production needs the server owner" 3
fi
log "rolling back to api ${PREV_API:0:12}, web ${PREV_WEB:0:12}"
compose_with "$PREV_API" "$PREV_WEB" up -d --no-deps api web
if wait_healthy "$TIMEOUT" api web; then
  die "rolled back: the previous release is running and healthy" 2
fi
die "the rollback is unhealthy too; production needs the server owner" 3
