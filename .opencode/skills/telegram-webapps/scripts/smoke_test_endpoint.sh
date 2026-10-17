#!/usr/bin/env bash
# Smoke test — validates that an endpoint correctly accepts and rejects Telegram initData.
#
# Usage:
#   BOT_TOKEN="..." ENDPOINT="http://localhost:3000/api/action" bash smoke_test_endpoint.sh
#
# Requires: python3 (generates test fixtures), curl
# Returns: exit 0 if all tests pass, exit 1 on any failure.
#
# The script sends 5 requests:
#   1. Valid initData    → expect 2xx
#   2. Expired initData  → expect 401
#   3. Tampered initData → expect 401
#   4. No auth header    → expect 401
#   5. Wrong scheme      → expect 401

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${BOT_TOKEN:?BOT_TOKEN env var is required}"
: "${ENDPOINT:?ENDPOINT env var is required (e.g. http://localhost:3000/api/action)}"

PASS=0
FAIL=0
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() { printf "${GREEN}PASS${NC} %s\n" "$1"; PASS=$((PASS+1)); }
fail() { printf "${RED}FAIL${NC} %s\n" "$1"; FAIL=$((FAIL+1)); }

echo "=== Telegram Mini App auth smoke test ==="
echo "Endpoint: $ENDPOINT"
echo ""

# Generate a fresh, valid initData fixture
VALID_INIT=$(python3 "$SCRIPT_DIR/generate_test_init_data.py" "$BOT_TOKEN")

# 1. Valid initData — backend should accept it
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENDPOINT" \
  -H "Authorization: tma $VALID_INIT" \
  -H "Content-Type: application/json" \
  -d '{}')
if [[ "$STATUS" == 2* ]]; then
  pass "Valid initData accepted (HTTP $STATUS)"
else
  fail "Valid initData rejected (HTTP $STATUS, expected 2xx)"
fi

# 2. Expired initData (2 hours old — beyond default 1h window)
EXPIRED_INIT=$(python3 "$SCRIPT_DIR/generate_test_init_data.py" "$BOT_TOKEN" --age-offset 7200)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENDPOINT" \
  -H "Authorization: tma $EXPIRED_INIT" \
  -H "Content-Type: application/json" \
  -d '{}')
if [[ "$STATUS" == "401" ]]; then
  pass "Expired initData rejected (HTTP 401)"
else
  fail "Expired initData not rejected (HTTP $STATUS, expected 401)"
fi

# 3. Tampered initData (extra field appended — hash will not match)
TAMPERED="${VALID_INIT}&injected=true"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENDPOINT" \
  -H "Authorization: tma $TAMPERED" \
  -H "Content-Type: application/json" \
  -d '{}')
if [[ "$STATUS" == "401" ]]; then
  pass "Tampered initData rejected (HTTP 401)"
else
  fail "Tampered initData not rejected (HTTP $STATUS, expected 401)"
fi

# 4. No Authorization header at all
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{}')
if [[ "$STATUS" == "401" ]]; then
  pass "Missing auth header rejected (HTTP 401)"
else
  fail "Missing auth header not rejected (HTTP $STATUS, expected 401)"
fi

# 5. Wrong scheme (Bearer instead of tma)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$ENDPOINT" \
  -H "Authorization: Bearer $VALID_INIT" \
  -H "Content-Type: application/json" \
  -d '{}')
if [[ "$STATUS" == "401" ]]; then
  pass "Wrong auth scheme rejected (HTTP 401)"
else
  fail "Wrong auth scheme not rejected (HTTP $STATUS, expected 401)"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
