#!/usr/bin/env bash
# Smoke test: builds the SDK bundle, starts the server with a placeholder
# Client-side ID, and checks that the page and API respond. It does not
# contact LaunchDarkly, so it runs anywhere (including CI).
set -euo pipefail

PORT="${PORT:-3999}"
for f in server.js public/app.js; do node --check "$f"; done

LD_CLIENT_SIDE_ID=smoke-test PORT="$PORT" node server.js > /tmp/abc-shop-smoke.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 20); do
  curl -sf "http://localhost:$PORT/api/config" > /dev/null && break
  sleep 0.5
done

curl -sf "http://localhost:$PORT/api/config" | grep -q '"clientSideId":"smoke-test"'
curl -sf "http://localhost:$PORT/" | grep -q '<title>ACME Shop</title>'
curl -sf "http://localhost:$PORT/vendor/launchdarkly.js" > /dev/null
curl -sf -X POST -H 'Content-Type: application/json' -d '{}' \
  "http://localhost:$PORT/api/report-error" | grep -q '"count":1'

echo "Smoke test passed."
