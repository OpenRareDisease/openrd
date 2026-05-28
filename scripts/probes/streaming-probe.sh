#!/usr/bin/env bash
# Probe SiliconFlow (DeepSeek-V3) streaming behaviour before we wire
# the orchestrator's final-answer call onto an SSE channel. Three
# scenarios, run sequentially against the live API. Each writes its
# raw response to /tmp/openrd-probe/<scenario>.raw and a parsed
# summary to /tmp/openrd-probe/<scenario>.parsed.
#
# Reads AI_API_KEY + AI_API_BASE_URL from the repo .env. Forces
# AI_API_MODEL to deepseek-ai/DeepSeek-V3 regardless of what .env
# says, because Qwen3-VL doesn't support tool calling and we want
# the model that production will actually use.
#
# Usage:
#   cd <repo root>
#   bash scripts/probes/streaming-probe.sh

set -uo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
env_file="$repo_root/.env"
out_dir="/tmp/openrd-probe"
mkdir -p "$out_dir"

# Source just the keys we need so the script doesn't accidentally
# pollute its own env with the other 60 vars from .env.
api_key=$(grep '^AI_API_KEY=' "$env_file" | head -1 | cut -d= -f2-)
api_base=$(grep '^AI_API_BASE_URL=' "$env_file" | head -1 | cut -d= -f2-)
model="deepseek-ai/DeepSeek-V3"

if [[ -z "$api_key" || -z "$api_base" ]]; then
  echo "missing AI_API_KEY or AI_API_BASE_URL in $env_file" >&2
  exit 1
fi

run () {
  local name="$1"
  local payload="$2"
  echo
  echo "=== probe: $name ==="
  echo "writing raw stream to $out_dir/$name.raw"
  # -N disables curl's output buffering so we see deltas as they arrive.
  # --no-buffer would also work on newer curls.
  curl -sN \
    -H "Authorization: Bearer $api_key" \
    -H "Content-Type: application/json" \
    -X POST "$api_base/chat/completions" \
    -d "$payload" \
    >"$out_dir/$name.raw" 2>"$out_dir/$name.curl-err"
  local exit=$?
  if [[ $exit -ne 0 ]]; then
    echo "  curl exited $exit — see $out_dir/$name.curl-err"
    return
  fi
  local lines bytes
  lines=$(wc -l <"$out_dir/$name.raw" | tr -d ' ')
  bytes=$(wc -c <"$out_dir/$name.raw" | tr -d ' ')
  echo "  raw: $lines lines, $bytes bytes"
  echo "  first 3 SSE frames:"
  grep -m 3 '^data:' "$out_dir/$name.raw" | sed 's/^/    /'
  echo "  last 3 SSE frames:"
  tail -n 5 "$out_dir/$name.raw" | grep '^data:' | tail -n 3 | sed 's/^/    /'
}

# ----------------------------------------------------------------- 1
# Plain streaming, no tools. Baseline: do we get token-by-token
# `delta.content` frames?
run "1-plain-stream" "$(cat <<EOF
{
  "model": "$model",
  "stream": true,
  "max_tokens": 80,
  "messages": [
    {"role": "system", "content": "你是一个简洁的医学助理。"},
    {"role": "user", "content": "用一句话说明 FSHD 是什么。"}
  ]
}
EOF
)"

# ----------------------------------------------------------------- 2
# Streaming + tool definitions, prompt that should trigger a tool
# call. Critical: does the streamed assistant turn carry
# `delta.tool_calls`? Are the arguments JSON streamed across frames?
run "2-stream-with-tools-trigger" "$(cat <<EOF
{
  "model": "$model",
  "stream": true,
  "max_tokens": 200,
  "messages": [
    {"role": "system", "content": "你是一个医学助理。需要检索知识时调用 search_medical_kb。"},
    {"role": "user", "content": "查一下 D4Z4 重复数缩短的临床意义。"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "search_medical_kb",
        "description": "Search the FSHD medical knowledge base for chunks matching a query.",
        "parameters": {
          "type": "object",
          "properties": {
            "query": {"type": "string", "description": "The search query in Chinese or English."}
          },
          "required": ["query"]
        }
      }
    }
  ]
}
EOF
)"

# ----------------------------------------------------------------- 3
# Streaming + tools, but the prompt is broad enough that the model
# may answer directly. Confirms the "direct answer" branch streams
# content tokens like #1 even when tools were offered but not used.
run "3-stream-with-tools-no-trigger" "$(cat <<EOF
{
  "model": "$model",
  "stream": true,
  "max_tokens": 80,
  "messages": [
    {"role": "system", "content": "你是一个医学助理。"},
    {"role": "user", "content": "今天天气怎么样？（请简短回答。）"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "search_medical_kb",
        "description": "Search the FSHD medical knowledge base.",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}
      }
    }
  ]
}
EOF
)"

echo
echo "done. raw outputs in $out_dir/"
echo "next: hand-inspect each .raw file for:"
echo "  - frame format (data: {...} / data: [DONE])"
echo "  - delta.content presence + cadence"
echo "  - delta.tool_calls structure (index, id, function.name, function.arguments)"
echo "  - finish_reason (stop vs tool_calls)"
