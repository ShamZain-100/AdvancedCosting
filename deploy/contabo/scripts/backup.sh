#!/usr/bin/env bash
# Smart Costing (Contabo): back up the database (pg_dump -Fc) and the uploaded files into
# /var/backups/smartcosting/<kind>/<stamp>-<label>/ with a SHA-256 checksum file. Runs as sc-deploy.
#
#   backup.sh --kind nightly                 cron, 02:45 (keeps BACKUP_KEEP_NIGHTLY sets, default 14)
#   backup.sh --kind predeploy --label <x>   deploy.sh, before migrating (keeps BACKUP_KEEP_PREDEPLOY, default 10)
#   backup.sh --kind manual [--label <x>]    sc-admin backup (kept until the owner deletes them)
#
# Only this host has the copies: the owner should copy /var/backups/smartcosting off the server regularly.
set -Eeuo pipefail
SC_SCRIPT=backup
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

kind=manual label=""
while (($#)); do
  case "$1" in
    --kind) kind=${2:-}; shift 2 ;;
    --label) label=${2:-}; shift 2 ;;
    *) die "unknown option $1" ;;
  esac
done
[[ $kind =~ ^(nightly|predeploy|manual)$ ]] || die "--kind must be nightly, predeploy or manual"
[[ -z $label || $label =~ ^[A-Za-z0-9._-]{1,40}$ ]] || die "label may contain letters, digits, . _ - (max 40)"

cd "$APP_DIR"
db=$(bash "$APP_DIR/scripts/compose.sh" ps -q db)
[[ -n $db ]] || die "the database container is not running"

name=$(date -u +%Y%m%dT%H%M%SZ)${label:+-$label}
dest=$BACKUP_DIR/$kind/$name
umask 027
mkdir -p "$dest.partial"

docker exec "$db" pg_dump -U costing -d costing --format=custom >"$dest.partial/db.dump"
# uploads: read the named volume with the postgres image (already on the host, has tar)
docker run --rm --network none -v "${PROJECT}_uploads:/data:ro" postgres:16 tar -czf - -C /data . >"$dest.partial/uploads.tar.gz"
(cd "$dest.partial" && sha256sum db.dump uploads.tar.gz >SHA256SUMS)
mv "$dest.partial" "$dest"
log "backup $kind/$name: db $(du -h "$dest/db.dump" | cut -f1), uploads $(du -h "$dest/uploads.tar.gz" | cut -f1)"

keep=""
[[ $kind == nightly ]] && keep=$(env_get BACKUP_KEEP_NIGHTLY 14)
[[ $kind == predeploy ]] && keep=$(env_get BACKUP_KEEP_PREDEPLOY 10)
if [[ -n $keep ]]; then
  find "$BACKUP_DIR/$kind" -mindepth 1 -maxdepth 1 -type d -name '20*' ! -name '*.partial' | sort -r | tail -n +$((keep + 1)) |
    while read -r old; do rm -rf -- "$old" && log "removed old backup $kind/$(basename "$old")"; done
fi
echo "$kind/$name"
