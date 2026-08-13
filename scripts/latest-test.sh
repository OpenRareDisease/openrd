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
  '{"fullName":"Latest Test User","preferredName":"LTU","diagnosisStage":"Stage1","regionCity":"Shanghai","notes":"latest test"}' \
  "$TOKEN"
assert_status 201
PROFILE_ID="$(json_get_from "$RESPONSE_BODY" "id")"
assert_nonempty "profile id" "$PROFILE_ID"

# PIPL Art. 29. requireSensitiveDataConsent guards every write below
# that stores health or genetic data — the baseline, all six follow-up
# tables, submissions and document upload. Registration does not record
# the acceptance (in the app the consent modal does), so without this
# the very next request is a 403 `sensitive_consent_required` and this
# script has not run past here since the gate moved out of the mobile
# modal and onto the server (commit 683fe65).
#
# The version is not pinned server-side, so this records the version
# the mobile bundle currently shows — see lib/legal-content.ts.
log_step "Sensitive Data Consent"
request_json POST /api/legal/acceptances \
  '{"document":"sensitive_data_consent","version":"2026-08-02"}' "$TOKEN"
assert_status_any 200 201

log_step "Baseline"
request_json PUT /api/profiles/me/baseline \
  '{
    "foundation":{"fullName":"Latest Test User","preferredName":"LTU","diagnosisYear":2024,"regionLabel":"Shanghai"},
    "diseaseBackground":{"diagnosedFshd":true,"diagnosisType":"FSHD1","d4z4":"3/22","haplotype":"4qA","methylation":"12%","familyHistory":"mother suspected","onsetRegion":"shoulder"},
    "currentStatus":{"independentlyAmbulatory":true,"armRaiseDifficulty":true,"facialWeakness":false,"footDrop":false,"breathingSymptoms":false,"assistiveDevices":["AFO"]},
    "currentChallenges":{"fatigue":3,"pain":1,"stairs":2,"dressing":1,"reachingUp":3,"walkingStability":1},
    "notes":"baseline latest test"
  }' \
  "$TOKEN"
assert_status 200

request_get /api/profiles/me/baseline "$TOKEN"
assert_status 200

log_step "Profile Update"
request_json PUT /api/profiles/me \
  '{"primaryPhysician":"Dr Smoke","contactEmail":"latest@example.com","regionDistrict":"Pudong"}' \
  "$TOKEN"
assert_status 200

log_step "Submission"
request_json POST /api/profiles/me/submissions \
  '{"submissionKind":"followup","summary":"Latest full test submission","changedSinceLast":true}' \
  "$TOKEN"
assert_status 201
SUBMISSION_ID="$(json_get_from "$RESPONSE_BODY" "id")"
assert_nonempty "submission id" "$SUBMISSION_ID"

log_step "Core Data Entry"
request_json POST /api/profiles/me/measurements \
  "{\"submissionId\":\"$SUBMISSION_ID\",\"muscleGroup\":\"deltoid\",\"side\":\"left\",\"strengthScore\":4,\"entryMode\":\"guided_assessment\",\"recordedAt\":\"2026-03-28T09:00:00.000Z\"}" \
  "$TOKEN"
assert_status 201

request_json POST /api/profiles/me/measurements \
  "{\"submissionId\":\"$SUBMISSION_ID\",\"muscleGroup\":\"biceps\",\"side\":\"right\",\"strengthScore\":3,\"entryMode\":\"guided_assessment\",\"recordedAt\":\"2026-03-28T09:01:00.000Z\"}" \
  "$TOKEN"
assert_status 201

request_json POST /api/profiles/me/function-tests \
  "{\"submissionId\":\"$SUBMISSION_ID\",\"testType\":\"stair_climb\",\"measuredValue\":11.2,\"unit\":\"s\",\"performedAt\":\"2026-03-28T09:10:00.000Z\"}" \
  "$TOKEN"
assert_status 201

request_json POST /api/profiles/me/symptom-scores \
  "{\"submissionId\":\"$SUBMISSION_ID\",\"symptomKey\":\"fatigue\",\"score\":4,\"recordedAt\":\"2026-03-28T09:11:00.000Z\"}" \
  "$TOKEN"
assert_status 201

request_json POST /api/profiles/me/daily-impacts \
  "{\"submissionId\":\"$SUBMISSION_ID\",\"adlKey\":\"stairs\",\"difficultyLevel\":3,\"recordedAt\":\"2026-03-28T09:12:00.000Z\"}" \
  "$TOKEN"
assert_status 201

request_json POST /api/profiles/me/followup-events \
  "{\"submissionId\":\"$SUBMISSION_ID\",\"eventType\":\"uploaded_report\",\"occurredAt\":\"2026-03-28\",\"description\":\"Latest script uploaded reports\"}" \
  "$TOKEN"
assert_status 201

request_json POST /api/profiles/me/activity-logs \
  "{\"submissionId\":\"$SUBMISSION_ID\",\"source\":\"manual\",\"content\":\"Latest test activity log\",\"logDate\":\"2026-03-28\"}" \
  "$TOKEN"
assert_status 201

request_json POST /api/profiles/me/medications \
  "{\"submissionId\":\"$SUBMISSION_ID\",\"medicationName\":\"Vitamin D\",\"dosage\":\"1 tablet\",\"frequency\":\"daily\",\"status\":\"active\"}" \
  "$TOKEN"
assert_status 201

log_step "Structured Report Uploads"
GENETIC_PDF="$TEST_TMP_DIR/genetic.pdf"
PULMONARY_PDF="$TEST_TMP_DIR/pulmonary.pdf"
MRI_PDF="$TEST_TMP_DIR/mri.pdf"
ECG_PDF="$TEST_TMP_DIR/ecg.pdf"
LAB_PDF="$TEST_TMP_DIR/lab.pdf"

create_simple_pdf "$GENETIC_PDF" "Genetic Report FSHD1 4qA EcoRI 20 kb D4Z4 3/22"
create_simple_pdf "$PULMONARY_PDF" "Pulmonary Function Report FVC 2.31 L FVC Pred 68 % FEV1 2.10 L DLCO 78 % restrictive ventilation"
create_simple_pdf "$MRI_PDF" "MRI report fatty infiltration gluteus hamstring tibialis anterior left greater than right"
create_simple_pdf "$ECG_PDF" "ECG report sinus rhythm HR 58 PR 160 ms QRS 92 ms QTc 420 ms incomplete right bundle branch block"
create_simple_pdf "$LAB_PDF" "Biochemistry CK 693 U/L LDH 280 U/L CKMB 35 U/L creatinine 52 umol/L"

upload_report_file "$TOKEN" "genetic_report" "Latest Genetic Report" "$GENETIC_PDF"
GENETIC_DOC_ID="$(json_get_from "$RESPONSE_BODY" "id")"
assert_nonempty "genetic document id" "$GENETIC_DOC_ID"

upload_report_file "$TOKEN" "blood_panel" "Latest Pulmonary Report" "$PULMONARY_PDF"
PULMONARY_DOC_ID="$(json_get_from "$RESPONSE_BODY" "id")"
assert_nonempty "pulmonary document id" "$PULMONARY_DOC_ID"

upload_report_file "$TOKEN" "mri" "Latest MRI Report" "$MRI_PDF"
MRI_DOC_ID="$(json_get_from "$RESPONSE_BODY" "id")"
assert_nonempty "mri document id" "$MRI_DOC_ID"

upload_report_file "$TOKEN" "other" "Latest ECG Report" "$ECG_PDF"
ECG_DOC_ID="$(json_get_from "$RESPONSE_BODY" "id")"
assert_nonempty "ecg document id" "$ECG_DOC_ID"

upload_report_file "$TOKEN" "blood_panel" "Latest Lab Report" "$LAB_PDF"
LAB_DOC_ID="$(json_get_from "$RESPONSE_BODY" "id")"
assert_nonempty "lab document id" "$LAB_DOC_ID"

log_step "Attach Documents To Submission"
request_patch_json "/api/profiles/me/submissions/$SUBMISSION_ID/documents" \
  "{\"documentIds\":[\"$GENETIC_DOC_ID\",\"$PULMONARY_DOC_ID\",\"$MRI_DOC_ID\",\"$ECG_DOC_ID\",\"$LAB_DOC_ID\"]}" \
  "$TOKEN"
assert_status 200

log_step "Verify OCR Results"
request_get "/api/profiles/me/documents/$GENETIC_DOC_ID/ocr" "$TOKEN"
assert_status 200
assert_eq "genetic classifiedType" "$(json_get_from "$RESPONSE_BODY" "ocrPayload.fields.classifiedType")" "genetic_report"
assert_nonempty "genetic diagnosisType" "$(json_get_from "$RESPONSE_BODY" "ocrPayload.fields.diagnosisType")"
assert_nonempty "genetic structured fields" "$(json_get_from "$RESPONSE_BODY" "ocrPayload.aiExtraction.fshd.structured_fields")"

request_get "/api/profiles/me/documents/$PULMONARY_DOC_ID/ocr" "$TOKEN"
assert_status 200
assert_eq "pulmonary classifiedType" "$(json_get_from "$RESPONSE_BODY" "ocrPayload.fields.classifiedType")" "pulmonary_function"
assert_nonempty "pulmonary fvcPredPct" "$(json_get_from "$RESPONSE_BODY" "ocrPayload.fields.fvcPredPct")"

request_get "/api/profiles/me/documents/$MRI_DOC_ID/ocr" "$TOKEN"
assert_status 200
assert_eq "mri classifiedType" "$(json_get_from "$RESPONSE_BODY" "ocrPayload.fields.classifiedType")" "muscle_mri"
assert_nonempty "mri impression" "$(json_get_from "$RESPONSE_BODY" "ocrPayload.aiExtraction.fshd.normalized_summary.mri_summary.affected_regions")"

request_get "/api/profiles/me/documents/$ECG_DOC_ID/ocr" "$TOKEN"
assert_status 200
assert_eq "ecg classifiedType" "$(json_get_from "$RESPONSE_BODY" "ocrPayload.fields.classifiedType")" "ecg"
assert_nonempty "ecg summary" "$(json_get_from "$RESPONSE_BODY" "ocrPayload.fields.ecgSummary")"

request_get "/api/profiles/me/documents/$LAB_DOC_ID/ocr" "$TOKEN"
assert_status 200
LAB_CLASSIFIED_TYPE="$(json_get_from "$RESPONSE_BODY" "ocrPayload.fields.classifiedType")"
assert_nonempty "lab classifiedType" "$LAB_CLASSIFIED_TYPE"
assert_nonempty "lab ck" "$(json_get_from "$RESPONSE_BODY" "ocrPayload.fields.ck")"

log_step "Downloads"
for DOC_ID in "$GENETIC_DOC_ID" "$PULMONARY_DOC_ID" "$MRI_DOC_ID"; do
  OUT_FILE="$TEST_TMP_DIR/$DOC_ID.bin"
  request_download "/api/profiles/me/documents/$DOC_ID" "$TOKEN" "$OUT_FILE"
  assert_status 200
  assert_file_nonempty "$OUT_FILE"
done

log_step "Read Aggregated Views"
request_get /api/profiles/me "$TOKEN"
assert_status 200
assert_nonempty "documents list" "$(json_get_from "$RESPONSE_BODY" "documents.0.id")"

request_get /api/profiles/me/passport "$TOKEN"
assert_status 200
assert_nonempty "passport diagnosis" "$(json_get_from "$RESPONSE_BODY" "diagnosis.geneticType")"

request_get /api/profiles/me/passport/export "$TOKEN"
assert_status 200
assert_nonempty "passport markdown" "$(json_get_from "$RESPONSE_BODY" "markdown")"

request_get /api/profiles/me/risk "$TOKEN"
assert_status 200
assert_nonempty "risk overallLevel" "$(json_get_from "$RESPONSE_BODY" "overallLevel")"

request_get /api/profiles/me/progression-summary "$TOKEN"
assert_status 200
assert_nonempty "progression headline" "$(json_get_from "$RESPONSE_BODY" "currentStatus.headline")"

request_get "/api/profiles/me/insights/muscle?muscleGroup=deltoid&limit=6" "$TOKEN"
assert_status 200
assert_nonempty "muscle insight group" "$(json_get_from "$RESPONSE_BODY" "muscleGroup")"

request_get "/api/profiles/me/submissions?page=1&pageSize=5" "$TOKEN"
assert_status 200
assert_eq "submission total" "$(json_get_from "$RESPONSE_BODY" "total")" "1"
assert_eq "submission id" "$(json_get_from "$RESPONSE_BODY" "items.0.id")" "$SUBMISSION_ID"

if should_run_ai_tests; then
  # Streaming, not POST /api/ai/ask: no patient reaches the plain JSON
  # route. lib/ai-streaming.ts opens /api/ai/ask/stream and every AI
  # surface in the app goes through it, and that route carries its own
  # consent gate, multi-turn history parsing, SSE backpressure,
  # keepalives and an end-of-stream audit write — none of which the old
  # check touched, so a regression in any of them passed.
  log_step "AI (streaming)"

  # Both flags, or getConsentStatus returns level 'none' and the route
  # answers 403 code=consent_required before committing to SSE.
  request_json PUT /api/profiles/me/consent '{"personal":true,"thirdParty":true}' "$TOKEN"
  assert_status 200

  STREAM_PROGRESS_ID="latest-stream-$(date +%s)-$$"
  # `history` exercises the shared history parser; --max-time keeps a
  # stream that never terminates from hanging the run.
  request -X POST "$API_BASE_URL/api/ai/ask/stream" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: text/event-stream" \
    --no-buffer \
    --max-time 180 \
    -d "{\"question\":\"请简要解释 FSHD 的常见临床特点\",\"progressId\":\"$STREAM_PROGRESS_ID\",\"history\":[{\"role\":\"user\",\"content\":\"你好\"},{\"role\":\"assistant\",\"content\":\"你好，有什么可以帮你？\"}]}"
  assert_status 200

  # `event: <type>\ndata: <json>\n\n` — pull the data line after the
  # first `event: done`. A stream that errored or was cut short never
  # emits one.
  DONE_FRAME="$(printf '%s\n' "$RESPONSE_BODY" | awk '/^event: done$/ { getline; sub(/^data: /, ""); print; exit }')"
  assert_nonempty "SSE done frame" "$DONE_FRAME"
  assert_eq "done frame type" "$(json_get_from "$DONE_FRAME" "type")" "done"
  assert_nonempty "streamed answer" "$(json_get_from "$DONE_FRAME" "data.answer")"
  assert_eq "progressId echoed" "$(json_get_from "$DONE_FRAME" "data.progressId")" "$STREAM_PROGRESS_ID"
  assert_eq "history turns used" "$(json_get_from "$DONE_FRAME" "data.historyMessageCount")" "2"
  # The done frame must stay narrowed to buildAskResponseData: the
  # audit-internal prompt fields have leaked onto this channel before.
  assert_eq "no raw prompt on the wire" "$(json_get_from "$DONE_FRAME" "data.finalPrompt" "absent")" "absent"
  assert_eq "no prompt hash on the wire" "$(json_get_from "$DONE_FRAME" "data.redactedPromptHash" "absent")" "absent"

  # The audit row lands after the last frame, so finding it also proves
  # the stream reached its end. Substring match: other AI calls here
  # write rows too and the ordering is not ours to depend on.
  request_get /api/ai/audit?limit=20 "$TOKEN"
  assert_status 200
  case "$RESPONSE_BODY" in
    *"$STREAM_PROGRESS_ID"*) ;;
    *) fail "no audit row for progressId $STREAM_PROGRESS_ID: $RESPONSE_BODY" ;;
  esac

  request_json POST "/api/profiles/me/documents/$GENETIC_DOC_ID/summary" '{}' "$TOKEN"
  assert_status 200
  assert_nonempty "document summary" "$(json_get_from "$RESPONSE_BODY" "summary")"
else
  log_info "Skipping AI tests. Set RUN_AI_TESTS=1 to enforce."
fi

log_step "Latest Test Passed"
printf 'phone=%s\nprofile_id=%s\nsubmission_id=%s\n' "$PHONE" "$PROFILE_ID" "$SUBMISSION_ID"
