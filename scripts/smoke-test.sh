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

# The public passport surface is mounted OUTSIDE /api (routes/index.ts
# says why), so it needs its own route in every proxy in front of the
# origin. It shipped without one: Caddy's /api/* block did not match it,
# the catch-all handed it to the static app, nginx's try_files answered
# 200 with index.html, and expo-router rendered +not-found. A clinician
# opening a forwarded share link saw a Chinese consumer app's not-found
# screen, opened_count stayed 0, and the patient's revoke list therefore
# told them the doctor had never opened it. Nothing failed anywhere.
#
# So the smoke test asks the question the deploy could not answer: does a
# token-shaped path reach the API at all? A bogus token is the right
# probe — the router answers every unknown/expired/revoked token with the
# same 404 HTML page by design, so 404 + text/html IS the proof it
# arrived. index.html from the static app would be 200.
log_step "Public Passport Route Reaches The API"
request_get "/s/passport/smoke-test-not-a-real-token-000000000000000000000"
assert_status 404
case "$RESPONSE_BODY" in
  *"这个链接打不开了"*) : ;;
  *) fail "GET /s/passport/<token> did not reach the API. Expected the router's own 404 page; got: ${RESPONSE_BODY:0:200}" ;;
esac

log_step "Register And Login"
PHONE="$(next_phone_number)"
REGISTER_RESULT="$(register_test_user "$PHONE")"
TOKEN="$(printf '%s\n' "$REGISTER_RESULT" | sed -n '1p')"
USER_ID="$(printf '%s\n' "$REGISTER_RESULT" | sed -n '2p')"
assert_nonempty "registered user id" "$USER_ID"

LOGIN_TOKEN="$(login_test_user "$PHONE")"
assert_nonempty "login token" "$LOGIN_TOKEN"

# v2.4.0 — concurrent registration → 409 not 500. Reusing the same
# OTP is impossible because OTP gets consumed, so we re-register
# with the same phone (post-consume) and assert the duplicate-user
# 409 path. The shape of register_test_user makes this a single-call
# probe instead of true parallelism — the race-free 409 vs the
# concurrent-race 409 are the same code path on the server side
# (`23505` unique violation → 409) so this still smoke-tests the
# transaction.
log_step "Duplicate Register Returns 409"
request_json POST /api/auth/register \
  "{\"phoneNumber\":\"$PHONE\",\"otpCode\":\"000000\",\"password\":\"smoke-password-123\"}"
assert_status_any 409 400  # 400 if OTP path validates first, 409 if user-exists path validates first

log_step "Create Profile"
request_json POST /api/profiles \
  '{"fullName":"Smoke Test User","diagnosisStage":"Stage1","regionCity":"Shanghai"}' \
  "$TOKEN"
assert_status 201
PROFILE_ID="$(json_get_from "$RESPONSE_BODY" "id")"
assert_nonempty "profile id" "$PROFILE_ID"

request_get /api/profiles/me "$TOKEN"
assert_status 200

# PIPL Art. 29. Every route that STORES health or genetic data sits
# behind requireSensitiveDataConsent, and nothing records the
# acceptance at registration — in the app it is the consent modal that
# writes the ledger row. A script that never records it gets a 403
# `sensitive_consent_required` on the first measurement below, which is
# where this smoke test has been dying since the gate moved out of the
# mobile modal and onto the server (commit 683fe65).
#
# The version is not pinned server-side (the web export ships
# separately from the API), so this records the version the mobile
# bundle currently shows — see lib/legal-content.ts.
log_step "Sensitive Data Consent"
request_json POST /api/legal/acceptances \
  '{"document":"sensitive_data_consent","version":"2026-08-02"}' "$TOKEN"
assert_status_any 200 201

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

# v2.4.0 — document_type must be the canonical 4-value vocabulary,
# NOT the OCR sub-type. The migration 012 CHECK enforces this; here
# we assert the controller's canonicalizeDocumentType helper kept
# the row passing.
request_get "/api/profiles/me" "$TOKEN"
assert_status 200
DOC_TYPE="$(json_get_from "$RESPONSE_BODY" "documents.0.documentType")"
case "$DOC_TYPE" in
  mri|genetic_report|blood_panel|other) ;;
  *) fail "document_type '$DOC_TYPE' not in migration 012 allowlist {mri,genetic_report,blood_panel,other}" ;;
esac

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

# v2.4.0 — sharing-preferences (4 toggles) read + write round-trip.
# The race-free path is enough for the smoke test; the parallel-tab
# `SELECT FOR UPDATE` path is exercised by sharing-preferences.test.ts.
log_step "Sharing Preferences"
request_get /api/profiles/me/sharing-preferences "$TOKEN"
assert_status 200
request_json PUT /api/profiles/me/sharing-preferences \
  '{"dataDonation":true}' "$TOKEN"
assert_status 200
DONATION="$(json_get_from "$RESPONSE_BODY" "flags.dataDonation")"
assert_eq "dataDonation flag persisted" "$DONATION" "true"

# v2.4.0 — AI consent endpoints + audit list. We don't assert on
# specific levels because the consent default depends on whether the
# user has gone through the onboarding flow; we just smoke that the
# endpoints respond 200 with the expected shape.
log_step "AI Consent + Audit List"
request_get /api/profiles/me/consent "$TOKEN"
assert_status 200
request_get /api/profiles/me/consent/history?limit=10 "$TOKEN"
assert_status 200
request_get /api/ai/audit?limit=10 "$TOKEN"
assert_status 200

# v2.4.0 — cross-user submissionId → 404. Register a second user,
# create a submission as user A (token=$TOKEN), then attempt to
# attach a measurement under that submission as user B. The
# `assertSubmissionOwnedByProfile` helper (added in PR-Sec-1) should
# reject with 404.
log_step "Cross-User Submission Returns 404"
request_json POST /api/profiles/me/submissions \
  '{"submissionKind":"followup","summary":"Smoke cross-user test"}' "$TOKEN"
assert_status 201
SUBMISSION_A="$(json_get_from "$RESPONSE_BODY" "id")"
assert_nonempty "submission A id" "$SUBMISSION_A"

PHONE_B="$(next_phone_number)"
REGISTER_B="$(register_test_user "$PHONE_B")"
TOKEN_B="$(printf '%s\n' "$REGISTER_B" | sed -n '1p')"
assert_nonempty "second user token" "$TOKEN_B"

request_json POST /api/profiles \
  '{"fullName":"Smoke User B","diagnosisStage":"Stage1"}' "$TOKEN_B"
assert_status 201

# User B needs the Art. 29 acceptance too, or the consent middleware
# answers 403 before the ownership check ever runs — and this step
# would then "pass" for a reason that has nothing to do with cross-user
# isolation, while silently no longer testing it.
request_json POST /api/legal/acceptances \
  '{"document":"sensitive_data_consent","version":"2026-08-02"}' "$TOKEN_B"
assert_status_any 200 201

request_json POST /api/profiles/me/measurements \
  "{\"muscleGroup\":\"deltoid\",\"side\":\"left\",\"strengthScore\":3,\"entryMode\":\"self_report\",\"submissionId\":\"$SUBMISSION_A\"}" \
  "$TOKEN_B"
assert_status 404

if should_run_ai_tests; then
  # The AI check used to hit POST /api/ai/ask. No patient reaches that
  # route: lib/ai-streaming.ts opens /api/ai/ask/stream and every AI
  # surface in the app (问答, AskAboutDrawer) goes through it. The
  # streaming route has machinery /ask does not — its own consent gate,
  # multi-turn history parsing, SSE backpressure, keepalives and an
  # end-of-stream audit write — so a regression in any of it shipped
  # green while the smoke test asked a route nobody uses.
  #
  # This asserts the whole path a patient actually takes: consent
  # granted → POST /ask/stream → a `done` frame with a real answer →
  # an audit row carrying our progressId.
  log_step "AI Checks (streaming, the route the app uses)"

  # /ask/stream 403s with code=consent_required unless BOTH flags are
  # on (level 'none' otherwise). Granting them here means a broken
  # consent lookup surfaces as a 403 below rather than as a skipped
  # check.
  request_json PUT /api/profiles/me/consent '{"personal":true,"thirdParty":true}' "$TOKEN"
  assert_status 200

  STREAM_PROGRESS_ID="smoke-stream-$(date +%s)-$$"
  # `history` is sent so the shared history parser runs — an invalid
  # history is a pre-SSE 400, and the done frame echoes how many turns
  # the server actually kept.
  # --max-time bounds the run: an SSE response that never terminates
  # would otherwise hang the deploy check indefinitely.
  request -X POST "$API_BASE_URL/api/ai/ask/stream" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: text/event-stream" \
    --no-buffer \
    --max-time 180 \
    -d "{\"question\":\"什么是FSHD？\",\"progressId\":\"$STREAM_PROGRESS_ID\",\"history\":[{\"role\":\"user\",\"content\":\"你好\"},{\"role\":\"assistant\",\"content\":\"你好，有什么可以帮你？\"}]}"
  assert_status 200

  # SSE frames are `event: <type>\ndata: <json>\n\n`. Take the data
  # line that follows the first `event: done`; a stream that errored or
  # was cut short never emits one, which is exactly the failure the old
  # check could not see.
  DONE_FRAME="$(printf '%s\n' "$RESPONSE_BODY" | awk '/^event: done$/ { getline; sub(/^data: /, ""); print; exit }')"
  assert_nonempty "SSE done frame" "$DONE_FRAME"
  assert_eq "done frame type" "$(json_get_from "$DONE_FRAME" "type")" "done"
  assert_nonempty "streamed answer" "$(json_get_from "$DONE_FRAME" "data.answer")"
  assert_eq "progressId echoed" "$(json_get_from "$DONE_FRAME" "data.progressId")" "$STREAM_PROGRESS_ID"
  assert_eq "history turns used" "$(json_get_from "$DONE_FRAME" "data.historyMessageCount")" "2"

  # The audit row is written after the last frame, so it also proves
  # the route reached its end rather than dying mid-stream. Substring
  # match instead of items.0 — other AI calls in this script write rows
  # too and the ordering is not ours to depend on.
  request_get /api/ai/audit?limit=20 "$TOKEN"
  assert_status 200
  case "$RESPONSE_BODY" in
    *"$STREAM_PROGRESS_ID"*) ;;
    *) fail "no audit row for progressId $STREAM_PROGRESS_ID: $RESPONSE_BODY" ;;
  esac

  request_json POST "/api/profiles/me/documents/$DOCUMENT_ID/summary" '{}' "$TOKEN"
  if [ "$RESPONSE_CODE" != "200" ]; then
    fail "document summary failed: $RESPONSE_BODY"
  fi
else
  log_info "Skipping AI checks. Set RUN_AI_TESTS=1 to enforce."
fi

log_step "Smoke Test Passed"
printf 'phone=%s\nprofile_id=%s\ndocument_id=%s\n' "$PHONE" "$PROFILE_ID" "$DOCUMENT_ID"
