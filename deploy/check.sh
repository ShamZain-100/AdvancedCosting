#!/usr/bin/env bash
# Exit code 0 when the site and the database answer, 1 otherwise. Use from cron or any uptime monitor.
#   ./deploy/check.sh https://costing.example.com
set -uo pipefail
URL=${1:?usage: $0 https://your-domain}
body=$(curl -fsS --max-time 10 "$URL/api/health") || { echo "DOWN: API unreachable or unhealthy"; exit 1; }
echo "$body" | grep -q '"database":"up"' || { echo "DOWN: $body"; exit 1; }
curl -fsS --max-time 10 -o /dev/null "$URL/" || { echo "DOWN: web unreachable"; exit 1; }
echo "OK"
