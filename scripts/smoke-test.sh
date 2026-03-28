#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/test-lib.sh"

require_bin curl
require_bin python3

log_step "Health"
request_get /api/healthz
assert_status 200

log_step "Register And Login"
PHONE="$(next_phone_number)"
REGISTER_RESULT="$(register_test_user "$PHONE")"
TOKEN="$(printf '%s\n' "$REGISTER_RESULT" | sed -n '1p')"
USER_ID="$(printf '%s\n' "$REGISTER_RESULT" | sed -n '2p')"
assert_nonempty "registered user id" "$USER_ID"

LOGIN_TOKEN="$(login_test_user "$PHONE")"
assert_nonempty "login token" "$LOGIN_TOKEN"

log_step "Create Profile"
request_json POST /api/profiles \
  '{"fullName":"Smoke Test User","diagnosisStage":"Stage1","regionCity":"Shanghai"}' \
  "$TOKEN"
assert_status 201
PROFILE_ID="$(json_get_from "$RESPONSE_BODY" "id")"
assert_nonempty "profile id" "$PROFILE_ID"

request_get /api/profiles/me "$TOKEN"
assert_status 200

log_step "Core Follow-up"
request_json POST /api/profiles/me/measurements \
  '{"muscleGroup":"deltoid","side":"left","strengthScore":4,"entryMode":"guided_assessment"}' \
  "$TOKEN"
assert_status 201

request_json POST /api/profiles/me/function-tests \
  '{"testType":"stair_climb","measuredValue":12.5,"unit":"s"}' \
  "$TOKEN"
assert_status 201

request_json POST /api/profiles/me/activity-logs \
  '{"source":"manual","content":"Smoke test activity log"}' \
  "$TOKEN"
assert_status 201

log_step "Upload And OCR"
GENETIC_PDF="$TEST_TMP_DIR/genetic-smoke.pdf"
create_simple_pdf "$GENETIC_PDF" "Genetic Report FSHD1 4qA EcoRI 20 kb D4Z4 3/22"
upload_report_file "$TOKEN" "genetic_report" "Smoke Genetic Report" "$GENETIC_PDF"
DOCUMENT_ID="$(json_get_from "$RESPONSE_BODY" "id")"
assert_nonempty "smoke document id" "$DOCUMENT_ID"

request_get "/api/profiles/me/documents/$DOCUMENT_ID/ocr" "$TOKEN"
assert_status 200

CLASSIFIED_TYPE="$(json_get_from "$RESPONSE_BODY" "ocrPayload.fields.classifiedType")"
D4Z4_REPEATS="$(json_get_from "$RESPONSE_BODY" "ocrPayload.fields.d4z4Repeats")"
assert_eq "classifiedType" "$CLASSIFIED_TYPE" "genetic_report"
assert_nonempty "d4z4 repeats" "$D4Z4_REPEATS"

DOWNLOADED_FILE="$TEST_TMP_DIR/downloaded-report.bin"
request_download "/api/profiles/me/documents/$DOCUMENT_ID" "$TOKEN" "$DOWNLOADED_FILE"
assert_status 200
assert_file_nonempty "$DOWNLOADED_FILE"

log_step "Read Models"
request_get /api/profiles/me/passport "$TOKEN"
assert_status 200

request_get /api/profiles/me/risk "$TOKEN"
assert_status 200

request_get "/api/profiles/me/insights/muscle?muscleGroup=deltoid&limit=6" "$TOKEN"
assert_status 200

if should_run_ai_tests; then
  log_step "AI Checks"
  request_json POST /api/ai/ask \
    '{"question":"什么是FSHD？","userContext":{"language":"zh"}}' \
    "$TOKEN"
  assert_status 200

  request_json POST "/api/profiles/me/documents/$DOCUMENT_ID/summary" '{}' "$TOKEN"
  if [ "$RESPONSE_CODE" != "200" ]; then
    fail "document summary failed: $RESPONSE_BODY"
  fi
else
  log_info "Skipping AI checks. Set RUN_AI_TESTS=1 to enforce."
fi

log_step "Smoke Test Passed"
printf 'phone=%s\nprofile_id=%s\ndocument_id=%s\n' "$PHONE" "$PROFILE_ID" "$DOCUMENT_ID"
