#!/usr/bin/env bash
# Smart Costing (Contabo): forced command for every key of the sc-deploy user (the GitHub workflow's key and the
# developer's PC key). One line per key in ~sc-deploy/.ssh/authorized_keys, written by `install.sh add-key deploy`:
#
#   restrict,command="/usr/local/bin/sc-deploy-gate <name>" ssh-ed25519 AAAA… <name>
#
# `restrict` turns off shells' PTYs, port/agent/X11 forwarding and ~/.ssh/rc. sshd runs this script instead of what the
# client asked for (SSH_ORIGINAL_COMMAND), and only these requests are carried out:
#
#   true                          connection check
#   disk                          free disk space for Docker and the number of running containers
#   load                          stdin: `docker save … | gzip`; only smartcosting-{api,web}:<40-hex sha> images are kept
#   dry-run <sha> [api] [web]     deploy.sh with DRY_RUN=1 (checks and plan, changes nothing)
#   deploy <sha> [api] [web]      deploy.sh (backup, migrate, switch, health checks, automatic rollback)
#   status                        containers of the smartcosting project, and the deployed tags
#   logs <api|web|db> [lines]     last lines (default 200, at most 2000)
#
# No shell, no file upload, no compose or script changes (those come only from the server owner via install.sh).
# Every request is logged to /var/log/smartcosting/gate.log with the key's name.
# Installed by install.sh as root:root 755 in /usr/local/bin/sc-deploy-gate.
set -Eeuo pipefail

WHO=${1:-unknown}
APP_DIR=/opt/smartcosting
CMD=${SSH_ORIGINAL_COMMAND:-}
MAX_UPLOAD=$((3 * 1024 * 1024 * 1024)) # compressed bytes accepted by `load`

glog() { printf '%s [gate] %s: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$WHO" "$*" >>/var/log/smartcosting/gate.log 2>/dev/null || true; }
deny() {
  glog "DENIED: ${CMD:-<interactive login>}"
  echo "sc-deploy-gate: not allowed: ${CMD:-<interactive login>}" >&2
  echo "allowed: true | disk | load | dry-run <sha> [api] [web] | deploy <sha> [api] [web] | status | logs <api|web|db> [lines]" >&2
  exit 126
}

load_images() {
  local out line img bad=0
  out=$(head -c "$MAX_UPLOAD" | gunzip | docker load) || { printf '%s\n' "$out" >&2; exit 1; }
  printf '%s\n' "$out"
  # docker load cannot be told what to accept, so check afterwards and remove whatever does not belong
  # (a crafted archive could retag e.g. postgres:16; removing the tag makes the next start pull the real image).
  while IFS= read -r line; do
    case "$line" in
      "Loaded image: "*)
        img=${line#Loaded image: }
        if [[ $img =~ ^smartcosting-(api|web):[0-9a-f]{40}$ ]]; then
          glog "loaded $img"
        else
          docker image rm "$img" >/dev/null 2>&1 || true
          glog "REMOVED foreign image $img"
          echo "removed $img: only smartcosting-<api|web>:<40-hex sha> may be loaded" >&2
          bad=1
        fi ;;
      "Loaded image ID: "*)
        docker image rm "${line#Loaded image ID: }" >/dev/null 2>&1 || true
        glog "REMOVED untagged image ${line#Loaded image ID: }"
        bad=1 ;;
    esac
  done <<<"$out"
  exit "$bad"
}

glog "request: ${CMD:-<interactive login>}"
cd "$APP_DIR"
read -ra a <<<"$CMD"

case "${a[0]:-}" in
  true) [[ ${#a[@]} -eq 1 ]] || deny; exit 0 ;;
  disk)
    df -h "$(docker info -f '{{.DockerRootDir}}')" | tail -n 1
    echo "running containers: $(docker ps -q | wc -l)"
    exit 0 ;;
  load) [[ ${#a[@]} -eq 1 ]] || deny; load_images ;;
  status)
    bash "$APP_DIR/scripts/compose.sh" ps
    echo "deployed:"; sed 's/^/  /' "$APP_DIR/state/deployed_tags" 2>/dev/null || echo "  nothing yet"
    exit 0 ;;
  logs)
    [[ ${a[1]:-} =~ ^(api|web|db)$ ]] || deny
    n=${a[2]:-200}
    [[ $n =~ ^[0-9]{1,4}$ && ${#a[@]} -le 3 ]] || deny
    ((n <= 2000)) || n=2000
    exec bash "$APP_DIR/scripts/compose.sh" logs --no-color --tail "$n" "${a[1]}" ;;
  deploy | dry-run)
    [[ ${a[1]:-} =~ ^[0-9a-f]{40}$ ]] || deny
    for s in "${a[@]:2}"; do [[ $s =~ ^(api|web)$ ]] || deny; done
    if [[ ${a[0]} == dry-run ]]; then export DRY_RUN=1; else unset DRY_RUN; fi
    unset SKIP_BACKUP DEPLOY_HEALTH_TIMEOUT DEPLOY_MIN_FREE_MB
    glog "${a[0]} ${a[1]} ${a[*]:2}"
    exec bash "$APP_DIR/scripts/deploy.sh" "${a[@]:1}" ;;
esac
deny
