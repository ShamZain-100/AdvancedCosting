#!/usr/bin/env bash
# Smart Costing (Contabo): replace the database (and optionally the uploaded files) with a backup made by backup.sh.
# Runs as sc-deploy; the developer calls it through `sc-admin restore <kind>/<name> --yes [--with-uploads]`.
#
#   restore.sh <kind>/<name> --yes [--with-uploads]
#
# A manual safety backup of the current state is always taken first, so a restore can itself be undone.
# The app is stopped during the restore and started again at the deployed tags. Uses the same lock as deploy.sh.
set -Eeuo pipefail
SC_SCRIPT=restore
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

ref=${1:-}
shift || true
yes=0 uploads=0
for a in "$@"; do
  case "$a" in
    --yes) yes=1 ;;
    --with-uploads) uploads=1 ;;
    *) die "unknown option $a" ;;
  esac
done
[[ $ref =~ ^(nightly|predeploy|manual)/[A-Za-z0-9._-]+$ ]] || die "usage: restore.sh <kind>/<name> --yes [--with-uploads]  (see: sc-admin backups)"
src=$BACKUP_DIR/$ref
[[ -f $src/db.dump && -f $src/SHA256SUMS ]] || die "no backup at $src"
((yes)) || die "this replaces the live database with $ref; add --yes to confirm"
(cd "$src" && sha256sum -c --quiet SHA256SUMS) || die "checksum mismatch in $ref; refusing to restore"

cd "$APP_DIR"
exec 9>"$LOCK_FILE"
flock -w 600 9 || die "a deploy or restore is running"

safety=$(bash "$APP_DIR/scripts/backup.sh" --kind manual --label before-restore) || die "safety backup failed; nothing changed"
log "restore $ref (with uploads: $uploads); safety backup $safety"

bash "$APP_DIR/scripts/compose.sh" stop api web
db=$(bash "$APP_DIR/scripts/compose.sh" ps -q db)
docker exec -i "$db" pg_restore -U costing -d costing --clean --if-exists --no-owner --single-transaction <"$src/db.dump" ||
  { bash "$APP_DIR/scripts/compose.sh" up -d api web; die "pg_restore failed (single transaction: the database is unchanged); app restarted"; }
if ((uploads)); then
  docker run --rm --network none -i -v "${PROJECT}_uploads:/data" postgres:16 \
    sh -c 'find /data -mindepth 1 -delete && tar -xzf - -C /data' <"$src/uploads.tar.gz"
fi
# bring the schema up to the deployed release in case the backup is older
bash "$APP_DIR/scripts/compose.sh" run --rm --no-deps -T api ./node_modules/.bin/prisma migrate deploy
bash "$APP_DIR/scripts/compose.sh" up -d api web
wait_healthy 180 api web || die "restored, but the app is not healthy; check: sc-admin logs api"
log "restored $ref; app healthy (undo with: sc-admin restore $safety --yes)"
