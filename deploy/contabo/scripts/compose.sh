#!/usr/bin/env bash
# Smart Costing (Contabo): `docker compose` for the smartcosting project at the deployed image tags.
#   scripts/compose.sh ps
#   scripts/compose.sh logs --tail 100 api
#   scripts/compose.sh exec db psql -U costing costing          (server owner only)
# Releases go through deploy.sh, never through `compose.sh up` with new tags.
set -Eeuo pipefail
SC_SCRIPT=compose
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "$APP_DIR"
compose_with "$(deployed_tag api)" "$(deployed_tag web)" "$@"
