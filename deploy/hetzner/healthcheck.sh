#!/usr/bin/env bash
# Wealth OS position monitor health check — exits 0 if healthy, 1 if down
set -euo pipefail

PORT="${HEALTH_PORT:-3001}"
URL="http://localhost:${PORT}/health"

STATUS=$(curl -sf --max-time 5 "$URL" 2>/dev/null) || { echo "FAIL: position monitor not responding at $URL"; exit 1; }

echo "OK: $STATUS"
