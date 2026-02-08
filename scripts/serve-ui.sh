#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-8080}"
cd "$(dirname "$0")/../ui"

echo "Serving static UI at http://0.0.0.0:${PORT}"
exec python3 -m http.server "${PORT}"
