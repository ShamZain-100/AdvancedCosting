#!/usr/bin/env bash
# Smart Costing (Contabo): helpers shared by the server scripts. Sourced, never run directly.
# Installed root-owned in /opt/smartcosting/scripts/ by install.sh; the deploy user can run but not change them.

APP_DIR=${SC_APP_DIR:-/opt/smartcosting}
ENV_FILE=$APP_DIR/.env
COMPOSE_FILE=$APP_DIR/docker-compose.yml
STATE_DIR=$APP_DIR/state
TAGS_FILE=$STATE_DIR/deployed_tags
LOCK_FILE=$STATE_DIR/deploy.lock
LOG_DIR=${SC_LOG_DIR:-/var/log/smartcosting}
BACKUP_DIR=${SC_BACKUP_DIR:-/var/backups/smartcosting}
SERVICES_ALL='api web'
PROJECT=smartcosting

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() {
  local line
  line=$(printf '%s [%s] %s' "$(ts)" "${SC_SCRIPT:-sc}" "$*")
  printf '%s\n' "$line" >&2
  printf '%s\n' "$line" >>"$LOG_DIR/deploy.log" 2>/dev/null || true
}
die() { log "ERROR: $1"; exit "${2:-1}"; } # die <message> [exit code]

is_service() { [[ " $SERVICES_ALL " == *" ${1:-} "* ]]; }
is_sha() { [[ ${1:-} =~ ^[0-9a-f]{40}$ ]]; }
image_of() { printf 'smartcosting-%s:%s' "$1" "$2"; }

# One value from .env (last assignment wins), without sourcing the file.
env_get() {
  local key=$1 default=${2-} line val
  line=$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 || true)
  val=${line#*=}
  val=${val%$'\r'}
  val=${val#[\'\"]}
  val=${val%[\'\"]}
  printf '%s' "${val:-$default}"
}

# Deployed tag of a service from state/deployed_tags ("api <sha>" lines); empty when never deployed.
deployed_tag() {
  [[ -f $TAGS_FILE ]] || return 0 # first release: nothing deployed yet
  awk -v s="$1" '$1 == s { t = $2 } END { print t }' "$TAGS_FILE"
}

write_tags() { # write_tags <api sha> <web sha>
  local tmp
  tmp=$(mktemp "$STATE_DIR/tags.XXXXXX")
  printf 'api %s\nweb %s\n' "$1" "$2" >"$tmp"
  mv -f "$tmp" "$TAGS_FILE"
}

# docker compose for this project with explicit tags: compose_with <api tag> <web tag> <compose args…>
compose_with() {
  local api=$1 web=$2
  shift 2
  TAG_API=${api:-none} TAG_WEB=${web:-none} docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" \
    --project-directory "$APP_DIR" "$@"
}

# Health of the running stack on the loopback ports. Returns 0 when every given service is healthy.
healthy() { # healthy <service…>
  local s code
  for s in "$@"; do
    case "$s" in
      api) code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$(env_get API_HOST_PORT 4100)/api/health" || true)
        [[ $code == 200 ]] || return 1 ;;
      web) code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$(env_get WEB_HOST_PORT 3100)/login" || true)
        [[ $code =~ ^[23] ]] || return 1 ;;
    esac
  done
}

wait_healthy() { # wait_healthy <seconds> <service…>
  local limit=$1 waited=0
  shift
  while ((waited < limit)); do
    healthy "$@" && return 0
    sleep 5
    waited=$((waited + 5))
  done
  return 1
}
