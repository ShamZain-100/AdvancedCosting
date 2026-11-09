#!/usr/bin/env bash
# Backs up the database and the uploaded images into ./backups, keeping the newest $KEEP sets (default 14).
# Run from the project folder; schedule it with cron, e.g.  0 2 * * *  cd /opt/costing && ./deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)
OUT=${BACKUP_DIR:-backups}
KEEP=${KEEP:-14}
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT"

"${COMPOSE[@]}" exec -T db pg_dump -U costing -d costing --format=custom > "$OUT/db-$STAMP.dump.partial"
mv "$OUT/db-$STAMP.dump.partial" "$OUT/db-$STAMP.dump"

docker run --rm -v costing_uploads:/data:ro -v "$(cd "$OUT" && pwd)":/backup alpine \
  tar czf "/backup/uploads-$STAMP.tar.gz" -C /data .

# keep the newest $KEEP of each kind
for kind in db uploads; do
  ls -1t "$OUT"/$kind-* 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
done
echo "Backup written: $OUT/db-$STAMP.dump and $OUT/uploads-$STAMP.tar.gz"
