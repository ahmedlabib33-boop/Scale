#!/usr/bin/env bash
# Runs every VibroScale test suite against a local copy of index.html.
# Needs Node.js and Playwright with Chromium (npx playwright install chromium).
set -u
cd "$(dirname "$0")/.."
PORT="${PORT:-8765}"
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
export VIBRO_URL="http://127.0.0.1:$PORT/index.html"

failed=0
for t in test.js test_ios.js test_fixes.js test_auto.js test_harden.js; do
  echo "=== $t"
  if node "tests/$t" > "tests/out-$t.log" 2>&1; then
    tail -n 1 "tests/out-$t.log"
  else
    failed=1
    grep -E "^FAIL|Error" "tests/out-$t.log" | head -20
    echo "(full log: tests/out-$t.log)"
  fi
done
if [ "$failed" = 0 ]; then echo; echo "All suites passed."; else echo; echo "Some suites FAILED."; fi
exit "$failed"
