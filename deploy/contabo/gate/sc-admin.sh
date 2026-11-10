#!/usr/bin/env bash
# Smart Costing (Contabo): administration commands for the developer (ssh sc-dev@<server> <command>).
#
#   status                         containers, deployed versions, memory use
#   logs <api|web|db> [lines]      last log lines (default 200, at most 2000)
#   restart <api|web>              recreate one container at its deployed version (after `set`)
#   env                            the settings that may be changed here, and whether each is set (values never shown)
#   set <KEY>                      set one of them; the value is read from stdin (one line), never from the command line:
#                                    printf '%s' 'value' | ssh sc-dev@<server> set VAPID_SUBJECT
#   unset <KEY>                    empty one of them
#   create-admin <email>           create a super admin (asked to change the password at first sign-in); the password
#                                  is read from stdin, or prompted for with `ssh -t`. An existing user is left unchanged.
#   backup [label]                 database + uploads backup now (kind "manual")
#   backups                        list the backups on the server
#   restore <kind>/<name> --yes [--with-uploads]
#                                  replace the database (and the uploads) with a backup; a safety backup is taken first
#   deploy-log [lines]             tail of the deploy log
#   site-init                      temporary HTTP site for smartcosting.venoralab.com (before its certificate exists)
#   cert                           Let's Encrypt certificate for smartcosting.venoralab.com (renewed automatically)
#   site-install                   install the full HTTPS site from the owner's copy (/opt/smartcosting/nginx/)
#
# Everything that runs Docker runs as sc-deploy (runuser), never as root. Root runs only nginx -t / reload and certbot,
# for the one domain. Owner-only: secrets, ports, memory/CPU limits, the compose file, scripts and nginx files.
# Installed by install.sh as root:root 755 in /usr/local/bin/sc-admin; granted by sudoers/smartcosting-dev.
set -Eeuo pipefail

APP_DIR=/opt/smartcosting
ENV_FILE=$APP_DIR/.env
DEPLOY_USER=sc-deploy
DOMAIN=smartcosting.venoralab.com
SITE=/etc/nginx/sites-available/$DOMAIN.conf
SETTABLE_KEYS='WEB_ORIGIN ENABLE_SWAGGER DISABLE_MAINTENANCE VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT'

WHO=${SUDO_USER:-$(id -un)}
if [[ ${1:-} == --who ]]; then WHO="${SUDO_USER:-?}/${2:-?}"; shift 2; fi

alog() { printf '%s [sc-admin] %s: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$WHO" "$*" >>/var/log/smartcosting/admin.log 2>/dev/null || true; }
die() { echo "sc-admin: $*" >&2; alog "FAILED: $*"; exit 1; }
usage() { awk 'NR > 2 && /^#/ { sub(/^# ?/, ""); print; next } NR > 2 { exit }' "${BASH_SOURCE[0]}"; exit 2; }

[[ $EUID -eq 0 ]] || die "run through sudo"
as_deploy() { (cd "$APP_DIR" && runuser -u "$DEPLOY_USER" -- "$@"); }
compose() { as_deploy bash "$APP_DIR/scripts/compose.sh" "$@"; }
need_key() { [[ " $SETTABLE_KEYS " == *" ${1:-} "* ]] || die "${1:-<none>} cannot be changed here (see: env)"; }
lines_arg() { local n=${1:-$2}; [[ $n =~ ^[0-9]{1,4}$ ]] || die "lines must be a number"; ((n <= 2000)) || n=2000; echo "$n"; }

write_env() { # KEY value — replace or append, keep owner/mode, previous file kept as .env.prev
  local tmp
  tmp=$(mktemp "$APP_DIR/.env.XXXXXX")
  grep -vE "^[[:space:]]*${1}=" "$ENV_FILE" >"$tmp" || true
  printf '%s=%s\n' "$1" "$2" >>"$tmp"
  chown --reference="$ENV_FILE" "$tmp"
  chmod --reference="$ENV_FILE" "$tmp"
  cp -p "$ENV_FILE" "$ENV_FILE.prev"
  mv -f "$tmp" "$ENV_FILE"
}

nginx_reload() { nginx -t && systemctl reload nginx; }

cmd=${1:-}
[[ -n $cmd ]] || usage
shift
alog "$cmd $*"

case "$cmd" in
  status)
    compose ps
    echo; echo "deployed:"; sed 's/^/  /' "$APP_DIR/state/deployed_tags" 2>/dev/null || echo "  nothing yet"
    echo; docker stats --no-stream --format '  {{.Name}}  mem {{.MemUsage}}  cpu {{.CPUPerc}}' $(compose ps -q) 2>/dev/null || true ;;

  logs)
    [[ ${1:-} =~ ^(api|web|db)$ ]] || die "usage: logs <api|web|db> [lines]"
    compose logs --no-color --tail "$(lines_arg "${2:-}" 200)" "$1" ;;

  restart)
    [[ ${1:-} =~ ^(api|web)$ ]] || die "usage: restart <api|web>"
    compose up -d --no-deps --force-recreate "$1"
    echo "recreated $1; check with: status" ;;

  env)
    for k in $SETTABLE_KEYS; do
      v=$(grep -E "^[[:space:]]*${k}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)
      printf '%-22s %s\n' "$k" "$([[ -n $v ]] && echo set || echo empty)"
    done
    echo "change with: printf '%s' 'value' | ssh sc-dev@<server> set KEY   then: restart api" ;;

  set)
    need_key "${1:-}"
    IFS= read -r val || [[ -n ${val:-} ]] || die "no value on stdin (printf '%s' 'value' | ssh sc-dev@<server> set $1)"
    val=${val%$'\r'}
    [[ ${#val} -le 4096 ]] || die "value longer than 4096 characters"
    bad_re="[[:space:]'\"\$\`\\\\]"
    [[ ! $val =~ $bad_re ]] || die "the value must not contain spaces, quotes, \$, \` or \\"
    case "$1" in
      ENABLE_SWAGGER | DISABLE_MAINTENANCE) [[ $val =~ ^(true|false)$ ]] || die "$1 must be true or false" ;;
      WEB_ORIGIN) [[ $val =~ ^https://[a-z0-9.-]+(,https://[a-z0-9.-]+)*$ ]] || die "WEB_ORIGIN must be https://host[,https://host]" ;;
    esac
    write_env "$1" "$val"
    alog "set $1 (${#val} characters)"
    echo "$1 set. Takes effect after: restart api" ;;

  unset)
    need_key "${1:-}"
    write_env "$1" ""
    echo "$1 emptied. Takes effect after: restart api" ;;

  create-admin)
    email=${1:-}
    [[ $email =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "usage: create-admin <email>"
    if [[ -t 0 ]]; then
      read -rsp "Temporary password for $email (12+ characters): " pw; echo
      read -rsp "Again: " pw2; echo
      [[ $pw == "$pw2" ]] || die "the passwords differ"
    else
      IFS= read -r pw || [[ -n ${pw:-} ]] || die "no password on stdin (or use ssh -t for a prompt)"
      pw=${pw%$'\r'}
    fi
    [[ ${#pw} -ge 12 ]] || die "the password must have at least 12 characters"
    # passed through the environment only (not visible in process arguments)
    export SEED_ADMIN_EMAIL=$email SEED_ADMIN_PASSWORD=$pw
    compose run --rm --no-deps -T -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD api node dist/seed/seed.js
    alog "create-admin $email" ;;

  backup)
    label=${1:-manual}
    as_deploy bash "$APP_DIR/scripts/backup.sh" --kind manual --label "$label" ;;

  backups)
    for k in nightly predeploy manual; do
      echo "$k:"
      find "/var/backups/smartcosting/$k" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' -printf '%f\n' 2>/dev/null | sort -r |
        while read -r b; do printf '  %s/%-40s %s\n' "$k" "$b" "$(du -sh "/var/backups/smartcosting/$k/$b" | cut -f1)"; done
    done ;;

  restore)
    [[ ${1:-} =~ ^(nightly|predeploy|manual)/[A-Za-z0-9._-]+$ ]] || die "usage: restore <kind>/<name> --yes [--with-uploads]  (see: backups)"
    for f in "${@:2}"; do [[ $f == --yes || $f == --with-uploads ]] || die "unknown option $f"; done
    as_deploy bash "$APP_DIR/scripts/restore.sh" "$@" ;;

  deploy-log)
    tail -n "$(lines_arg "${1:-}" 100)" /var/log/smartcosting/deploy.log ;;

  site-init)
    [[ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]] || die "$DOMAIN already has a certificate; run site-install"
    install -o root -g root -m 644 "$APP_DIR/nginx/acme-only.conf" "$SITE"
    ln -sfn "$SITE" "/etc/nginx/sites-enabled/$DOMAIN.conf"
    nginx_reload || { rm -f "/etc/nginx/sites-enabled/$DOMAIN.conf"; die "nginx rejected the temporary site; disabled again"; }
    echo "temporary HTTP site enabled; next: cert" ;;

  cert)
    certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --cert-name "$DOMAIN" \
      --agree-tos --no-eff-email --non-interactive --keep-until-expiring --register-unsafely-without-email
    echo "certificate ready; next: site-install" ;;

  site-install)
    [[ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]] || die "no certificate yet: run site-init, then cert"
    prev=$(mktemp)
    [[ -f $SITE ]] && cp -p "$SITE" "$prev"
    install -o root -g root -m 644 "$APP_DIR/nginx/$DOMAIN.conf" "$SITE"
    ln -sfn "$SITE" "/etc/nginx/sites-enabled/$DOMAIN.conf"
    if ! nginx_reload; then
      if [[ -s $prev ]]; then cp -p "$prev" "$SITE"; else rm -f "/etc/nginx/sites-enabled/$DOMAIN.conf"; fi
      rm -f "$prev"; nginx_reload || true
      die "nginx rejected the site; the previous state was restored"
    fi
    rm -f "$prev"
    echo "https://$DOMAIN is served" ;;

  *) usage ;;
esac
