#!/usr/bin/env bash

set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:4000}"
RUN_AI_TESTS="${RUN_AI_TESTS:-auto}"
PHONE_PREFIX="${PHONE_PREFIX:-+86139}"

TEST_TMP_DIR="${TEST_TMP_DIR:-$(mktemp -d /tmp/openrd-test.XXXXXX)}"
RESPONSE_BODY=""
RESPONSE_CODE=""

cleanup_test_tmp() {
  rm -rf "$TEST_TMP_DIR"
}

trap cleanup_test_tmp EXIT

log_step() {
  printf '\n== %s ==\n' "$1"
}

log_info() {
  printf '%s\n' "$1"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_bin() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

request() {
  local tmp_body
  tmp_body="$(mktemp "$TEST_TMP_DIR/response.XXXXXX")"
  RESPONSE_CODE="$(curl -sS -o "$tmp_body" -w "%{http_code}" "$@")" || {
    local curl_exit=$?
    rm -f "$tmp_body"
    fail "curl failed with exit code $curl_exit"
  }
  RESPONSE_BODY="$(cat "$tmp_body")"
  rm -f "$tmp_body"
}

request_json() {
  local method="$1"
  local path="$2"
  local payload="${3:-}"
  local token="${4:-}"

  if [ -n "$token" ]; then
    request -X "$method" "$API_BASE_URL$path" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      -d "$payload"
  else
    request -X "$method" "$API_BASE_URL$path" \
      -H "Content-Type: application/json" \
      -d "$payload"
  fi
}

request_get() {
  local path="$1"
  local token="${2:-}"

  if [ -n "$token" ]; then
    request "$API_BASE_URL$path" -H "Authorization: Bearer $token"
  else
    request "$API_BASE_URL$path"
  fi
}

request_form() {
  local path="$1"
  local token="$2"
  shift 2

  if [ -n "$token" ]; then
    request -X POST "$API_BASE_URL$path" \
      -H "Authorization: Bearer $token" \
      "$@"
  else
    request -X POST "$API_BASE_URL$path" "$@"
  fi
}

request_patch_json() {
  local path="$1"
  local payload="$2"
  local token="$3"
  request -X PATCH "$API_BASE_URL$path" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

request_download() {
  local path="$1"
  local token="$2"
  local output_file="$3"

  if [ -n "$token" ]; then
    RESPONSE_CODE="$(curl -sS -o "$output_file" -w "%{http_code}" \
      "$API_BASE_URL$path" \
      -H "Authorization: Bearer $token")" || fail "curl download failed"
  else
    RESPONSE_CODE="$(curl -sS -o "$output_file" -w "%{http_code}" "$API_BASE_URL$path")" \
      || fail "curl download failed"
  fi
  RESPONSE_BODY=""
}

assert_status() {
  local expected="$1"
  [ "$RESPONSE_CODE" = "$expected" ] || fail "Expected HTTP $expected, got $RESPONSE_CODE. Body: $RESPONSE_BODY"
}

assert_status_any() {
  local expected
  for expected in "$@"; do
    if [ "$RESPONSE_CODE" = "$expected" ]; then
      return 0
    fi
  done
  fail "Expected one of HTTP [$*], got $RESPONSE_CODE. Body: $RESPONSE_BODY"
}

assert_nonempty() {
  local name="$1"
  local value="$2"
  [ -n "$value" ] || fail "$name is empty"
}

assert_eq() {
  local name="$1"
  local actual="$2"
  local expected="$3"
  [ "$actual" = "$expected" ] || fail "$name mismatch. expected=$expected actual=$actual"
}

assert_file_nonempty() {
  local file_path="$1"
  [ -s "$file_path" ] || fail "Expected non-empty file: $file_path"
}

json_get_from() {
  local json_text="$1"
  local path="$2"
  local default_value="${3:-}"

  JSON_INPUT="$json_text" python3 - "$path" "$default_value" <<'PY'
import json
import os
import sys

path = sys.argv[1]
default = sys.argv[2]
raw = os.environ.get("JSON_INPUT", "")

try:
    data = json.loads(raw)
except Exception:
    print(default)
    raise SystemExit(0)

current = data
if path:
    for part in path.split('.'):
        if part == '':
            continue
        if isinstance(current, list):
            try:
                current = current[int(part)]
            except Exception:
                print(default)
                raise SystemExit(0)
            continue
        if not isinstance(current, dict):
            print(default)
            raise SystemExit(0)
        if part not in current:
            print(default)
            raise SystemExit(0)
        current = current[part]

if current is None:
    print(default)
elif isinstance(current, bool):
    print('true' if current else 'false')
elif isinstance(current, (dict, list)):
    print(json.dumps(current, ensure_ascii=False))
else:
    print(str(current))
PY
}

json_has_value() {
  local json_text="$1"
  local path="$2"
  local value
  value="$(json_get_from "$json_text" "$path" "")"
  [ -n "$value" ]
}

should_run_ai_tests() {
  case "$RUN_AI_TESTS" in
    1|true|TRUE|yes|YES)
      return 0
      ;;
    0|false|FALSE|no|NO)
      return 1
      ;;
  esac

  [ -n "${AI_API_KEY:-}" ] || [ -n "${OPENAI_API_KEY:-}" ]
}

next_phone_number() {
  printf '%s%s%d%d' \
    "$PHONE_PREFIX" \
    "$(date +%H%M%S)" \
    "$(( $$ % 10 ))" \
    "$(( RANDOM % 10 ))"
}

register_test_user() {
  local phone="$1"

  request_json POST /api/auth/otp/send "{\"phoneNumber\":\"$phone\",\"scene\":\"register\"}"
  assert_status 200
  local otp_request_id otp_code
  otp_request_id="$(json_get_from "$RESPONSE_BODY" "requestId")"
  otp_code="$(json_get_from "$RESPONSE_BODY" "mockCode")"
  assert_nonempty "otp requestId" "$otp_request_id"
  assert_nonempty "otp code" "$otp_code"

  request_json POST /api/auth/register \
    "{\"phoneNumber\":\"$phone\",\"password\":\"Passw0rd!\",\"otpCode\":\"$otp_code\",\"otpRequestId\":\"$otp_request_id\"}"
  assert_status_any 200 201

  local token user_id
  token="$(json_get_from "$RESPONSE_BODY" "token")"
  user_id="$(json_get_from "$RESPONSE_BODY" "user.id")"
  assert_nonempty "register token" "$token"
  assert_nonempty "user id" "$user_id"

  printf '%s\n%s\n' "$token" "$user_id"
}

login_test_user() {
  local phone="$1"

  request_json POST /api/auth/login "{\"phoneNumber\":\"$phone\",\"password\":\"Passw0rd!\"}"
  assert_status 200
  local token
  token="$(json_get_from "$RESPONSE_BODY" "token")"
  assert_nonempty "login token" "$token"
  printf '%s\n' "$token"
}

create_simple_pdf() {
  local output_file="$1"
  local text="$2"

  python3 - "$output_file" "$text" <<'PY'
import sys

output = sys.argv[1]
text = sys.argv[2].replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

content = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET"

objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    f"4 0 obj\n<< /Length {len(content.encode('latin-1'))} >>\nstream\n{content}\nendstream\nendobj\n",
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
]

offsets = [0]
pdf = "%PDF-1.4\n"
current_offset = len(pdf.encode("latin-1"))
for obj in objects:
    offsets.append(current_offset)
    pdf += obj
    current_offset += len(obj.encode("latin-1"))

xref_offset = current_offset
pdf += f"xref\n0 {len(objects) + 1}\n"
pdf += "0000000000 65535 f \n"
for offset in offsets[1:]:
    pdf += f"{offset:010d} 00000 n \n"
pdf += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n"

with open(output, "wb") as f:
    f.write(pdf.encode("latin-1"))
PY
}

upload_report_file() {
  local token="$1"
  local document_type="$2"
  local title="$3"
  local file_path="$4"
  local mime_type="${5:-application/pdf}"

  request_form /api/profiles/me/documents/upload "$token" \
    -F "documentType=$document_type" \
    -F "title=$title" \
    -F "file=@$file_path;type=$mime_type"
  assert_status 201
}
