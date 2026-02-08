#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:4000}"
REPORT_MANAGER_URL="${REPORT_MANAGER_URL:-http://localhost:8000}"

echo "== Health checks =="
curl -s "$API_BASE_URL/api/healthz" >/dev/null
curl -s "$REPORT_MANAGER_URL/healthz" >/dev/null

echo "== Auth flow (mock OTP) =="
PHONE="+86139$(date +%H%M%S)"
OTP_SEND=$(curl -s -X POST "$API_BASE_URL/api/auth/otp/send" \
  -H "Content-Type: application/json" \
  -d "{\"phoneNumber\":\"$PHONE\",\"scene\":\"register\"}")

OTP_REQUEST_ID=$(python3 - <<PY
import json,sys
resp=json.loads('''$OTP_SEND''')
print(resp.get('requestId') or '')
PY
)
OTP_CODE=$(python3 - <<PY
import json,sys
resp=json.loads('''$OTP_SEND''')
print(resp.get('mockCode') or '')
PY
)

if [ -z "$OTP_REQUEST_ID" ] || [ -z "$OTP_CODE" ]; then
  echo "OTP send failed: $OTP_SEND"
  exit 1
fi

REGISTER=$(curl -s -X POST "$API_BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"phoneNumber\":\"$PHONE\",\"password\":\"Passw0rd!\",\"otpCode\":\"$OTP_CODE\",\"otpRequestId\":\"$OTP_REQUEST_ID\"}")

TOKEN=$(python3 - <<PY
import json,sys
resp=json.loads('''$REGISTER''')
print(resp.get('token') or '')
PY
)

if [ -z "$TOKEN" ]; then
  echo "Register failed: $REGISTER"
  exit 1
fi

echo "== Profile flow =="
curl -s -X POST "$API_BASE_URL/api/profiles" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"fullName\":\"CLI测试用户\",\"diagnosisStage\":\"Stage1\"}" >/dev/null

curl -s -X GET "$API_BASE_URL/api/profiles/me" \
  -H "Authorization: Bearer $TOKEN" >/dev/null

echo "== AI Q&A =="
curl -s -X POST "$API_BASE_URL/api/ai/ask" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"question\":\"什么是FSHD？\",\"userContext\":{\"language\":\"zh\"}}" >/dev/null

echo "== Report Manager upload-and-analyze =="
TMP_BASE="$(mktemp /tmp/report.XXXXXX)"
TMP_PDF="${TMP_BASE}.pdf"
mv "$TMP_BASE" "$TMP_PDF"
python3 - <<PY
with open("$TMP_PDF","w") as f:
    f.write("%PDF-1.4\\n")
    f.write("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\\n")
    f.write("2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\\n")
    f.write("3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<<>>>>endobj\\n")
    f.write("4 0 obj<</Length 35>>stream\\n")
    f.write("BT/F1 12 Tf 100 700 Td(Test Medical Report)Tj ET\\n")
    f.write("endstream\\n")
    f.write("endobj\\n")
    f.write("xref 0 5\\n")
    f.write("0000000000 65535 f \\n")
    f.write("0000000009 00000 n \\n")
    f.write("0000000052 00000 n \\n")
    f.write("0000000095 00000 n \\n")
    f.write("0000000186 00000 n \\n")
    f.write("trailer<</Size 5/Root 1 0 R>>\\n")
    f.write("startxref 286\\n")
    f.write("%%EOF\\n")
PY

if [ -n "${REPORT_MANAGER_API_KEY:-}" ]; then
  curl -s -X POST "$REPORT_MANAGER_URL/api/reports/upload-and-analyze" \
    -H "Authorization: Bearer $REPORT_MANAGER_API_KEY" \
    -F "file=@$TMP_PDF" \
    -F "report_name=Smoke Test Report" \
    -F "user_id=1" >/dev/null
else
  curl -s -X POST "$REPORT_MANAGER_URL/api/reports/upload-and-analyze" \
    -F "file=@$TMP_PDF" \
    -F "report_name=Smoke Test Report" \
    -F "user_id=1" >/dev/null
fi

rm -f "$TMP_PDF"

echo "Smoke test passed."
