#!/usr/bin/env bash
# Restores a backup made by backup.sh. This REPLACES the current database and uploaded images.
#   ./deploy/restore.sh backups/db-20261105-020000.dump backups/uploads-20261105-020000.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."
[ $# -ge 1 ] || { echo "usage: $0 <db-dump> [uploads-archive]"; exit 1; }
DB_DUMP=$1; UPLOADS=${2:-}
[ -f "$DB_DUMP" ] || { echo "not found: $DB_DUMP"; exit 1; }
read -r -p "This replaces ALL current data with $DB_DUMP. Type 'restore' to continue: " ok
[ "$ok" = restore ] || { echo "cancelled"; exit 1; }
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)

"${COMPOSE[@]}" stop api web
"${COMPOSE[@]}" exec -T db pg_restore -U costing -d costing --clean --if-exists --no-owner < "$DB_DUMP"
if [ -n "$UPLOADS" ]; then
  [ -f "$UPLOADS" ] || { echo "not found: $UPLOADS"; exit 1; }
  docker run --rm -v costing_uploads:/data -v "$(cd "$(dirname "$UPLOADS")" && pwd)":/backup alpine \
    sh -c "rm -rf /data/* && tar xzf /backup/$(basename "$UPLOADS") -C /data"
fi
"${COMPOSE[@]}" up -d
echo "Restore finished."
