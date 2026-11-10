#!/usr/bin/env bash
# Smart Costing: build the images from one exact commit and deploy them to the Contabo server over SSH.
# Used from a developer's PC (Linux, macOS, or Git Bash/WSL on Windows) AND by .github/workflows/deploy.yml.
# The server key is bound to sc-deploy-gate, so this script needs no shell on the server.
#
#   deploy/local-deploy.sh plan      checks only, changes nothing
#   deploy/local-deploy.sh build     builds smartcosting-api and smartcosting-web from the commit, then smoke-tests them
#   deploy/local-deploy.sh ship      streams the images to the server (one compressed upload)
#   deploy/local-deploy.sh deploy    dry run on the server, asks you to type the first 7 characters of the SHA,
#                                    then: backup, migrations, switch, health checks, automatic rollback
#   deploy/local-deploy.sh verify    checks https://smartcosting.venoralab.com and the deployed version
#   deploy/local-deploy.sh status    containers and deployed versions on the server
#   deploy/local-deploy.sh logs <api|web|db> [lines]
#
# Rollback: the server keeps the previous images, so `REF=<previous sha> deploy/local-deploy.sh deploy`.
#
# Settings (environment):
#   DEPLOY_SSH   sc-deploy@<server>  (required for ship/deploy/status/logs; no default, so nothing goes to the wrong server)
#   REF          commit, tag or branch (default origin/main); exported with `git archive`, so local edits never ship
#   SERVICES     "api web" (default), "api" or "web"
#   SITE_URL     public address checked by verify (default https://smartcosting.venoralab.com)
#   SMOKE=0      skip the smoke tests        YES=1  skip the SHA confirmation (the GitHub workflow, after its approval)
#   MIN_FREE_GB  refuse to build with less free disk (default 6)
set -Eeuo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO_ROOT"

REF=${REF:-origin/main}
SERVICES=${SERVICES:-api web}
DEPLOY_SSH=${DEPLOY_SSH:-}
SITE_URL=${SITE_URL:-https://smartcosting.venoralab.com}
SMOKE=${SMOKE:-1}
MIN_FREE_GB=${MIN_FREE_GB:-6}
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30)

say() { printf '\n== %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "'$1' is not installed or not on PATH"; }

SHA=$(git rev-parse --verify --quiet "${REF}^{commit}") || die "cannot resolve REF '$REF' to a commit (git fetch first?)"
for s in $SERVICES; do [[ $s == api || $s == web ]] || die "unknown service '$s' (allowed: api web)"; done
image_of() { printf 'smartcosting-%s:%s' "$1" "$SHA"; }

remote() { ssh "${SSH_OPTS[@]}" "$DEPLOY_SSH" "$@"; }
ssh_check() {
  need ssh
  [[ -n $DEPLOY_SSH ]] || die "set DEPLOY_SSH, e.g. export DEPLOY_SSH=sc-deploy@203.0.113.10"
  remote true || die "cannot ssh to $DEPLOY_SSH (key allowed by the server owner? host key accepted?)"
}

free_gb() { local mb; mb=$(df -Pm . | awk 'NR == 2 { print $4 }'); echo $((mb / 1024)); }

WORK=""
cleanup() {
  [[ -n $WORK && -d $WORK ]] && rm -rf "$WORK"
  docker rm -f sc-smoke-db sc-smoke-api sc-smoke-web >/dev/null 2>&1 || true
  docker network rm sc-smoke >/dev/null 2>&1 || true
}
trap cleanup EXIT

cmd_plan() {
  say "Release"
  git --no-pager log -1 --format='commit   %H%nsubject  %s%nauthor   %an, %ad' "$SHA"
  echo "ref      $REF"
  echo "services $SERVICES"
  echo "server   ${DEPLOY_SSH:-<not set: export DEPLOY_SSH=sc-deploy@<server>>}"
  if git merge-base --is-ancestor "$SHA" origin/main 2>/dev/null; then echo "main     on origin/main"; else echo "main     NOT on origin/main"; fi
  local newest
  newest=$(git ls-tree -r --name-only "$SHA" -- prisma/migrations | grep 'migration.sql$' | sort | tail -n 1 || true)
  [[ -n $newest ]] && echo "migrate  newest migration: $(basename "$(dirname "$newest")") (a backup is taken first)"
  say "This machine"
  local t
  for t in git tar gzip docker ssh curl; do command -v "$t" >/dev/null && echo "ok       $t" || echo "MISSING  $t"; done
  docker info >/dev/null 2>&1 && echo "ok       docker daemon" || echo "MISSING  docker daemon not reachable"
  echo "disk     $(free_gb) GB free (need $MIN_FREE_GB)"
  echo; echo "Nothing was changed. Next: $0 build"
}

smoke_test() {
  say "Smoke test (boots the images with a throw-away database)"
  docker network create sc-smoke >/dev/null
  docker run -d --name sc-smoke-db --network sc-smoke -e POSTGRES_USER=costing -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=costing postgres:16 >/dev/null
  local i
  for i in $(seq 1 30); do docker exec sc-smoke-db pg_isready -U costing -d costing >/dev/null 2>&1 && break; sleep 2; done
  local env=(-e NODE_ENV=production -e "DATABASE_URL=postgresql://costing:smoke@sc-smoke-db:5432/costing?schema=public"
    -e "JWT_SECRET=$(head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')" -e WEB_ORIGIN=http://localhost -e DISABLE_MAINTENANCE=true)
  docker run --rm --network sc-smoke "${env[@]}" "$(image_of api)" ./node_modules/.bin/prisma migrate deploy >/dev/null ||
    die "smoke: migrations failed on an empty database"
  docker run --rm --network sc-smoke "${env[@]}" "$(image_of api)" node dist/seed/seed.js >/dev/null || die "smoke: seed failed"
  docker run -d --name sc-smoke-api --network sc-smoke "${env[@]}" "$(image_of api)" >/dev/null
  docker run -d --name sc-smoke-web --network sc-smoke "$(image_of web)" >/dev/null
  local ok=0
  for i in $(seq 1 30); do
    if docker exec sc-smoke-api node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null &&
      docker exec sc-smoke-web node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.status<400?0:1),()=>process.exit(1))" 2>/dev/null; then
      ok=1; break
    fi
    sleep 3
  done
  if ((!ok)); then
    docker logs --tail 30 sc-smoke-api >&2 || true
    docker logs --tail 30 sc-smoke-web >&2 || true
    die "smoke: the images did not become healthy"
  fi
  echo "ok   api /api/health and web /login answer"
}

cmd_build() {
  need git; need tar; need docker
  docker info >/dev/null 2>&1 || die "cannot reach the Docker daemon"
  (($(free_gb) >= MIN_FREE_GB)) || die "only $(free_gb) GB free (need $MIN_FREE_GB): docker builder prune / docker image prune"
  say "Exporting ${SHA:0:12}"
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/scdeploy.XXXXXX")
  # core.autocrlf=false: Git for Windows would export CRLF line endings into the images otherwise
  git -c core.autocrlf=false archive "$SHA" | tar -x -C "$WORK"
  local s
  # both images come from the same build stage, so building api and web back to back reuses its cache
  for s in api web; do
    say "Building $(image_of "$s")"
    DOCKER_BUILDKIT=1 docker build --platform linux/amd64 --target "$s" --build-arg NEXT_PUBLIC_API_URL=/api \
      --label "org.opencontainers.image.revision=$SHA" --label "org.opencontainers.image.title=smartcosting-$s" \
      -t "$(image_of "$s")" "$WORK"
  done
  if [[ $SMOKE == 1 ]]; then smoke_test; else echo "SMOKE=0: smoke test skipped"; fi
  say "Built"
  for s in api web; do docker image ls --format '{{.Repository}}:{{.Tag}}  {{.Size}}' "$(image_of "$s")"; done
  echo; echo "Next: $0 ship"
}

cmd_ship() {
  need docker; need gzip
  local s list=()
  for s in $SERVICES; do
    docker image inspect "$(image_of "$s")" >/dev/null 2>&1 || die "$(image_of "$s") is not built here: run '$0 build' first"
    list+=("$(image_of "$s")")
  done
  ssh_check
  remote disk
  say "Sending ${list[*]}"
  docker save "${list[@]}" | gzip -1 | remote load
  echo; echo "Shipped; nothing runs the new images yet. Next: $0 deploy"
}

cmd_deploy() {
  ssh_check
  say "Dry run on the server (changes nothing)"
  # shellcheck disable=SC2086
  remote dry-run "$SHA" $SERVICES || die "the dry run failed (images shipped? '$0 ship'); nothing was changed"
  echo
  echo "About to deploy ${SHA:0:12} ($SERVICES) to PRODUCTION ($DEPLOY_SSH):"
  echo "database + uploads backup, migrations, restart, automatic rollback if unhealthy."
  if [[ ${YES:-0} != 1 ]]; then
    read -r -p "Type the first 7 characters of the SHA (${SHA:0:7}) to continue: " answer
    [[ $answer == "${SHA:0:7}" ]] || die "not confirmed; nothing deployed"
  fi
  local rc=0
  # shellcheck disable=SC2086
  remote deploy "$SHA" $SERVICES || rc=$?
  case $rc in
    0) echo; echo "Deployed. Next: $0 verify" ;;
    1) die "deploy failed before switching; the previous release is still serving" ;;
    2) die "the new release was unhealthy and was rolled back; see: $0 logs api" ;;
    3) die "deploy could not roll back; production needs the server owner now" ;;
    255) die "SSH connection failed or was interrupted; check '$0 status' before retrying" ;;
    *) die "deploy exited with code $rc" ;;
  esac
}

cmd_verify() {
  need curl
  local ok=1 code url
  say "Public site"
  for url in "$SITE_URL/api/health" "$SITE_URL/login"; do
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url" || true)
    if [[ $code == 200 ]]; then echo "ok   $url"; else echo "FAIL $url -> HTTP ${code:-none}"; ok=0; fi
  done
  if [[ -n $DEPLOY_SSH ]]; then
    say "Deployed version"
    local st
    st=$(remote status) || st=""
    printf '%s\n' "$st" | sed -n '/^deployed:/,$p'
    for s in $SERVICES; do
      grep -q "$s $SHA" <<<"$st" && echo "ok   $s runs ${SHA:0:12}" || { echo "FAIL $s does not run ${SHA:0:12}"; ok=0; }
    done
  fi
  echo
  ((ok)) && echo "Verified." || { echo "Verification FAILED."; exit 1; }
}

case "${1:-}" in
  plan) cmd_plan ;;
  build) cmd_build ;;
  ship) cmd_ship ;;
  deploy) cmd_deploy ;;
  verify) cmd_verify ;;
  status) ssh_check; remote status ;;
  logs) [[ ${2:-} =~ ^(api|web|db)$ ]] || die "usage: $0 logs <api|web|db> [lines]"; ssh_check; remote logs "$2" "${3:-200}" ;;
  *) sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
