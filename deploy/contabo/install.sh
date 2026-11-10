#!/usr/bin/env bash
# Smart Costing (Contabo): one-time setup and later updates of the server side, run by the SERVER OWNER as root from a
# copy of the repository's deploy/contabo folder (e.g. `git archive … deploy/contabo | ssh root@server tar -x`).
# It touches only Smart Costing's own users, files and directories; PrayerTime and other tenants are left alone.
#
#   sudo bash install.sh install                          users, directories, scripts, gates, sudoers, .env, cron
#   sudo bash install.sh update                           re-install scripts, gates, compose file and nginx files only
#   sudo bash install.sh add-key deploy <name> <key.pub>  allow a key to deploy (GitHub workflow, developer PC)
#   sudo bash install.sh add-key dev <name> <key.pub>     allow a key to use sc-admin (developer)
#   sudo bash install.sh remove-key <deploy|dev> <name>   revoke it
#   sudo bash install.sh keys                             list the allowed keys
#
# Accounts:
#   sc-deploy  owns /opt/smartcosting, in the docker group, no password; every key is bound to sc-deploy-gate
#   sc-dev     no docker group, no password; every key is bound to sc-admin-gate (sudo for sc-admin only)
set -Eeuo pipefail

SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APP_DIR=/opt/smartcosting
DEPLOY_USER=sc-deploy
DEV_USER=sc-dev
DEV_GROUP=smartcosting-dev

die() { echo "install.sh: $*" >&2; exit 1; }
say() { printf '\n== %s\n' "$*"; }
[[ $EUID -eq 0 ]] || die "run as root"

install_files() {
  say "Scripts, gates and configuration"
  install -d -o root -g root -m 755 "$APP_DIR" "$APP_DIR/scripts" "$APP_DIR/nginx"
  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 750 "$APP_DIR/state"
  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 750 /var/backups/smartcosting
  install -d -o "$DEPLOY_USER" -g adm -m 750 /var/log/smartcosting
  install -d -m 755 /var/www/certbot
  # root-owned: sc-deploy can run them but not change them, so a deploy key cannot replace deploy.sh
  for f in common.sh compose.sh deploy.sh backup.sh restore.sh; do
    install -o root -g root -m 755 "$SRC/scripts/$f" "$APP_DIR/scripts/$f"
  done
  install -o root -g root -m 644 "$SRC/docker-compose.yml" "$APP_DIR/docker-compose.yml"
  install -o root -g root -m 644 "$SRC/nginx/acme-only.conf" "$SRC/nginx/smartcosting.venoralab.com.conf" "$APP_DIR/nginx/"
  install -o root -g root -m 755 "$SRC/gate/sc-deploy-gate.sh" /usr/local/bin/sc-deploy-gate
  install -o root -g root -m 755 "$SRC/gate/sc-admin-gate.sh" /usr/local/bin/sc-admin-gate
  install -o root -g root -m 755 "$SRC/gate/sc-admin.sh" /usr/local/bin/sc-admin
  install -o root -g root -m 440 "$SRC/sudoers/smartcosting-dev" /etc/sudoers.d/smartcosting-dev
  visudo -cq || { rm -f /etc/sudoers.d/smartcosting-dev; die "sudoers file rejected; removed it"; }
  install -o root -g root -m 644 "$SRC/cron/smartcosting" /etc/cron.d/smartcosting
  install -o root -g root -m 644 "$SRC/cron/logrotate" /etc/logrotate.d/smartcosting
  echo "installed"
}

cmd_install() {
  say "Checks"
  for t in docker curl flock nginx certbot openssl runuser sha256sum; do
    command -v "$t" >/dev/null || die "$t is not installed"
  done
  docker compose version >/dev/null || die "the docker compose plugin is not installed"
  for p in 3100 4100; do
    if ss -ltnH "( sport = :$p )" | grep -q . && ! docker ps --format '{{.Names}}' | grep -q '^smartcosting-'; then
      die "port $p is already used by something else; pick other ports in $APP_DIR/.env and the nginx site"
    fi
  done

  say "Users"
  id "$DEPLOY_USER" &>/dev/null || useradd --system --create-home --shell /bin/bash "$DEPLOY_USER"
  usermod -aG docker "$DEPLOY_USER"
  getent group "$DEV_GROUP" >/dev/null || groupadd "$DEV_GROUP"
  id "$DEV_USER" &>/dev/null || useradd --create-home --shell /bin/bash -G "$DEV_GROUP" "$DEV_USER"
  usermod -aG "$DEV_GROUP" "$DEV_USER"
  # '*' = no password can ever match, but the account is not "locked" ('!'): sshd without PAM refuses key logins to
  # locked accounts, so `passwd -l` would break the gates on such servers.
  usermod -p '*' "$DEPLOY_USER"
  usermod -p '*' "$DEV_USER"
  for u in "$DEPLOY_USER" "$DEV_USER"; do
    h=$(getent passwd "$u" | cut -d: -f6)
    install -d -o "$u" -g "$u" -m 700 "$h/.ssh"
    [[ -f $h/.ssh/authorized_keys ]] || install -o root -g "$u" -m 640 /dev/null "$h/.ssh/authorized_keys"
    # root-owned keys file: the account itself cannot add keys without the gate
    chown root:"$u" "$h/.ssh/authorized_keys"
    chmod 640 "$h/.ssh/authorized_keys"
  done
  echo "$DEPLOY_USER and $DEV_USER ready (no passwords; keys via add-key)"

  install_files

  say "Settings ($APP_DIR/.env)"
  if [[ -f $APP_DIR/.env ]]; then
    echo "kept the existing .env"
  else
    sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" \
      -e "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 48)|" \
      -e "s|^FILE_URL_SECRET=.*|FILE_URL_SECRET=$(openssl rand -hex 32)|" \
      "$SRC/env.example" >"$APP_DIR/.env"
    echo "created with fresh secrets: keep a copy of $APP_DIR/.env in your password manager (not backed up by any script)"
  fi
  chown root:"$DEPLOY_USER" "$APP_DIR/.env"
  chmod 640 "$APP_DIR/.env"

  say "Done"
  cat <<EOF
Next:
  1. DNS: smartcosting.venoralab.com  A  <this server's IP>
  2. keys:  sudo bash install.sh add-key deploy github  github-deploy.pub
            sudo bash install.sh add-key deploy <developer> <developer>.pub
            sudo bash install.sh add-key dev    <developer> <developer>.pub
  3. first release (GitHub workflow or local-deploy.sh), then:
            ssh sc-dev@<server> site-init && ssh sc-dev@<server> cert && ssh sc-dev@<server> site-install
            ssh -t sc-dev@<server> create-admin you@example.com
EOF
}

cmd_add_key() {
  local role=${1:-} name=${2:-} file=${3:-} user gate opts
  case "$role" in
    deploy) user=$DEPLOY_USER gate=/usr/local/bin/sc-deploy-gate opts=restrict ;;
    dev) user=$DEV_USER gate=/usr/local/bin/sc-admin-gate opts=restrict,pty ;;
    *) die "usage: add-key <deploy|dev> <name> <key.pub>" ;;
  esac
  [[ $name =~ ^[A-Za-z0-9._-]{1,40}$ ]] || die "name may contain letters, digits, . _ - (max 40)"
  [[ -f $file ]] || die "public key file $file not found"
  local key
  key=$(awk 'NF >= 2 && $1 ~ /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh.com)$/ { print $1, $2; exit }' "$file")
  [[ -n $key ]] || die "$file does not contain an SSH public key"
  local ak
  ak=$(getent passwd "$user" | cut -d: -f6)/.ssh/authorized_keys
  grep -qF " ${key} " "$ak" 2>/dev/null && die "this key is already allowed for $user"
  sed -i "/ sc-key:${name}\$/d" "$ak"
  printf '%s,command="%s %s" %s sc-key:%s\n' "$opts" "$gate" "$name" "$key" "$name" >>"$ak"
  echo "allowed key '$name' for $user ($role)"
}

cmd_remove_key() {
  local user
  case "${1:-}" in deploy) user=$DEPLOY_USER ;; dev) user=$DEV_USER ;; *) die "usage: remove-key <deploy|dev> <name>" ;; esac
  [[ ${2:-} =~ ^[A-Za-z0-9._-]{1,40}$ ]] || die "usage: remove-key <deploy|dev> <name>"
  sed -i "/ sc-key:${2}\$/d" "$(getent passwd "$user" | cut -d: -f6)/.ssh/authorized_keys"
  echo "removed key '$2' from $user"
}

cmd_keys() {
  for u in "$DEPLOY_USER" "$DEV_USER"; do
    echo "$u:"
    grep -o 'sc-key:[A-Za-z0-9._-]*$' "$(getent passwd "$u" | cut -d: -f6)/.ssh/authorized_keys" 2>/dev/null | sed 's/^sc-key:/  /' || echo "  (none)"
  done
}

case "${1:-}" in
  install) cmd_install ;;
  update) id "$DEPLOY_USER" &>/dev/null || die "run install first"; install_files ;;
  add-key) shift; cmd_add_key "$@" ;;
  remove-key) shift; cmd_remove_key "$@" ;;
  keys) cmd_keys ;;
  *) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
