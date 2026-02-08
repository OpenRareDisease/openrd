import requests
import json
import re
from config import Config
from concurrent.futures import ThreadPoolExecutor, as_completed

from json_repair import repair_json
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

def _build_session():
    # urllib3 Retry API changed over time:
    # - old: `method_whitelist=...`
    # - new: `allowed_methods=...`
    # Some base images may ship an older urllib3, so we support both.
    retry_kwargs = dict(
        total=Config.AI_MAX_RETRIES,
        connect=Config.AI_MAX_RETRIES,
        read=Config.AI_MAX_RETRIES,
        status=Config.AI_MAX_RETRIES,
        backoff_factor=Config.AI_RETRY_BACKOFF,
        status_forcelist=[429, 500, 502, 503, 504],
    )
    try:
        retry = Retry(allowed_methods=frozenset(["POST"]), **retry_kwargs)
    except TypeError:
        retry = Retry(method_whitelist=frozenset(["POST"]), **retry_kwargs)
    adapter = HTTPAdapter(max_retries=retry)
    session = requests.Session()
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session

def _split_text(text, max_chars):
    if not text:
        return [""]
    if max_chars <= 0 or len(text) <= max_chars:
        return [text]

    chunks = []
    start = 0
    text_len = len(text)
    while start < text_len:
        end = min(start + max_chars, text_len)
        if end < text_len:
            window = text[start:end]
            cut = window.rfind("\n")
            if cut == -1:
                cut = window.rfind("。")
            if cut != -1 and cut > int(len(window) * 0.6):
                end = start + cut + 1
        chunks.append(text[start:end])
        start = end
    return chunks

def _empty_result():
    return {
        "document_classification": {
            "report_types": [],
            "confidence": 0.0,
            "language": [],
            "has_tables": None,
            "notes": None
        },
        "patient_info": {
            "name": None,
            "sex": None,
            "age": None,
            "id_numbers": {
                "patient_id": None,
                "visit_id": None,
                "barcode": None
            }
        },
        "encounter_info": {
            "facility": None,
            "department": None,
            "bed_no": None,
            "specimen": None,
            "ordering_doctor": None,
            "clinical_diagnosis": None,
            "request_time": None,
            "collect_time": None,
            "receive_time": None,
            "report_time": None
        },
        "observations": [],
        "findings": [],
        "latest_summary": {
            "by_analyte": {},
            "abnormal_list": []
        },
        "quality_control": {
            "missing_critical_fields": [],
            "possible_ocr_errors": [],
            "normalization_warnings": []
        }
    }

def _merge_results(results):
    merged = _empty_result()
    warnings = merged["quality_control"]["normalization_warnings"]

    for result in results:
        if not isinstance(result, dict):
            warnings.append("One chunk returned a non-JSON result and was skipped.")
            continue
        if result.get("error"):
            warnings.append(f"Chunk error: {result.get('error')}")
        doc = result.get("document_classification", {})
        if isinstance(doc, dict):
            merged_doc = merged["document_classification"]
            merged_doc["report_types"] = list(set(merged_doc["report_types"]) | set(doc.get("report_types") or []))
            merged_doc["language"] = list(set(merged_doc["language"]) | set(doc.get("language") or []))
            merged_doc["has_tables"] = merged_doc["has_tables"] or doc.get("has_tables")
            merged_doc["confidence"] = max(merged_doc["confidence"], doc.get("confidence") or 0.0)
            if not merged_doc["notes"] and doc.get("notes"):
                merged_doc["notes"] = doc.get("notes")

        for section in ["patient_info", "encounter_info"]:
            merged_section = merged.get(section, {})
            candidate = result.get(section, {})
            if isinstance(candidate, dict):
                for key, value in candidate.items():
                    if isinstance(value, dict):
                        merged_sub = merged_section.get(key, {})
                        for sub_key, sub_value in value.items():
                            if merged_sub.get(sub_key) is None and sub_value is not None:
                                merged_sub[sub_key] = sub_value
                        merged_section[key] = merged_sub
                    else:
                        if merged_section.get(key) is None and value is not None:
                            merged_section[key] = value
                merged[section] = merged_section

        merged["observations"].extend(result.get("observations") or [])
        merged["findings"].extend(result.get("findings") or [])

        qc = result.get("quality_control", {})
        if isinstance(qc, dict):
            for key in ["missing_critical_fields", "possible_ocr_errors", "normalization_warnings"]:
                merged["quality_control"][key].extend(qc.get(key) or [])

    # de-duplicate qc warnings
    for key in ["missing_critical_fields", "possible_ocr_errors", "normalization_warnings"]:
        merged["quality_control"][key] = list(dict.fromkeys(merged["quality_control"][key]))

    # recompute latest_summary
    latest_by_analyte = {}
    abnormal_list = []
    for obs in merged["observations"]:
        if not isinstance(obs, dict):
            continue
        analyte = obs.get("analyte_name")
        if not analyte:
            continue
        current = latest_by_analyte.get(analyte)
        candidate_ts = obs.get("timestamp")
        if current is None:
            latest_by_analyte[analyte] = obs
        else:
            existing_ts = current.get("timestamp")
            if existing_ts is None and candidate_ts is not None:
                latest_by_analyte[analyte] = obs
            elif candidate_ts is not None and existing_ts is not None and str(candidate_ts) > str(existing_ts):
                latest_by_analyte[analyte] = obs
            else:
                # fallback to last seen
                latest_by_analyte[analyte] = obs

    merged_latest = {"by_analyte": {}, "abnormal_list": []}
    for analyte, obs in latest_by_analyte.items():
        result = obs.get("result", {}) if isinstance(obs, dict) else {}
        interpretation = obs.get("interpretation", {}) if isinstance(obs, dict) else {}
        reference = obs.get("reference", {}) if isinstance(obs, dict) else {}
        merged_latest["by_analyte"][analyte] = {
            "value_num": result.get("value_num"),
            "value_text": result.get("value_text"),
            "unit": result.get("unit"),
            "timestamp": obs.get("timestamp"),
            "is_abnormal": interpretation.get("is_abnormal"),
            "direction": interpretation.get("direction"),
            "reference_low": reference.get("low"),
            "reference_high": reference.get("high")
        }
        if interpretation.get("is_abnormal") is True:
            abnormal_list.append({
                "analyte_name": analyte,
                "value_raw": result.get("value_raw"),
                "unit": result.get("unit"),
                "flag_raw": interpretation.get("flag_raw"),
                "reference_range": reference.get("range_raw")
            })
    merged_latest["abnormal_list"] = abnormal_list
    merged["latest_summary"] = merged_latest

    # safety cap
    if len(merged["observations"]) > 100:
        merged["observations"] = merged["observations"][:100]
        merged["quality_control"]["normalization_warnings"].append(
            "Observations truncated to first 100 items after merge."
        )

    return merged

def _call_ai(ocr_text):
    """
    Call Silicon Flow AI API for a single text chunk.
    """
    headers = {
        "Authorization": f"Bearer {Config.AI_API_KEY}",
        "Content-Type": "application/json"
    }
    
    prompt_template = """You are a universal medical-report extraction engine.

Task:
Given raw OCR text of ANY medical report (Chinese/English mix; tables; multi-page; may contain abnormal flags ↑/↓/*; may include reference ranges; may include qualitative results like 阴性/阳性; may include imaging conclusions), extract and structure ALL possible indicators, findings, and metadata into a single JSON object following the schema below. If output would be too long, keep at most 100 observations and omit the rest (do not truncate JSON). Keep `source_evidence.raw_snippet` concise (<=120 chars).

Hard output rules:
1) Output ONLY one valid JSON object. No markdown. No extra text.
1.1) Do NOT wrap the JSON in code fences.
2) Never hallucinate. Only extract what is present in the text.
3) Keep BOTH: (a) original text evidence and (b) normalized value where possible.
4) If an item exists but cannot be normalized reliably, still include it with raw_text and set normalized fields to null.
5) Prefer patient “result” over reference ranges. Never treat reference ranges as results.
6) If the same indicator appears multiple times (e.g., repeated tests), keep ALL in `observations` with timestamps if available; also compute a `latest_summary` section selecting the latest value per indicator.
7) DO NOT extract educational/health‑education paragraphs (e.g., “疾病小常识/科普/注意事项/宣教/建议”) into observations or findings.
8) If the report includes structured rows like “姓名/性别/年龄/身份证号/样品送检日期/门诊号/住院号”, treat it as tabular content and set `has_tables=true` (even if visually not a strict table).
9) Never drop core identity/contact fields if present in OCR (name/sex/age/ID/sample id/phone/email/address). Prefer imperfect extraction over null.
10) ID field mapping (critical):
   - `patient_id` must be the national ID (身份证号) or other explicit ID number; ONLY use 18‑digit mainland China ID if present.
   - `visit_id` should be used for 病历号/门诊号/住院号/就诊号/检查号.
   - `barcode` should be 样品编号/样本编号/资料编号/条码号/条形码号.
   - Never put a medical record/visit number into `patient_id`.
   - For tokens labeled 病人ID/患者ID/MR号/检查号, always map to `visit_id` unless an 18‑digit身份证号 is explicitly present.
11) CBC/血常规 table rules:
   - Each row = one observation. Prefer numeric results; if the “result” cell is non‑numeric noise (e.g., doctor name), set value_* to null and add a normalization warning.
   - If unit is missing in the row, infer from the column header ONLY if explicitly shown (e.g., “10^9/L”, “%”, “g/L”). Otherwise leave unit null.
   - Do not treat reference ranges as results.
12) Name cleanup:
   - Prefer consecutive Chinese characters for patient name; remove stray punctuation/symbols/asterisks when obvious.
   - Do not guess missing characters; keep as‑is if uncertain.

Input:
Medical Report Text:
<<OCR_TEXT>>

----------------------------
Output JSON Schema (MUST follow exactly)
----------------------------
{
  "document_classification": {
    "report_types": [], 
    "confidence": 0.0,
    "language": [],
    "has_tables": null,
    "notes": null
  },
  "patient_info": {
    "name": null,
    "sex": null,
    "age": null,
    "id_numbers": {
      "patient_id": null,
      "visit_id": null,
      "barcode": null
    }
  },
  "encounter_info": {
    "facility": null,
    "department": null,
    "bed_no": null,
    "specimen": null,
    "ordering_doctor": null,
    "clinical_diagnosis": null,
    "request_time": null,
    "collect_time": null,
    "receive_time": null,
    "report_time": null
  },
  "observations": [
    {
      "category": null,
      "panel_name": null,
      "analyte_name": null,
      "analyte_aliases": [],
      "result": {
        "value_raw": null,
        "value_num": null,
        "value_text": null,
        "unit": null
      },
      "reference": {
        "range_raw": null,
        "low": null,
        "high": null,
        "unit": null
      },
      "interpretation": {
        "flag_raw": null,
        "is_abnormal": null,
        "direction": null
      },
      "method": null,
      "specimen": null,
      "timestamp": null,
      "source_evidence": {
        "raw_snippet": null,
        "line_hint": null
      }
    }
  ],
  "findings": [
    {
      "modality": null,
      "body_part": null,
      "finding_text": null,
      "impression_text": null,
      "source_evidence": {
        "raw_snippet": null,
        "line_hint": null
      }
    }
  ],
  "latest_summary": {
    "by_analyte": {
      "ANALYTE_CANONICAL_NAME": {
        "value_num": null,
        "value_text": null,
        "unit": null,
        "timestamp": null,
        "is_abnormal": null,
        "direction": null,
        "reference_low": null,
        "reference_high": null
      }
    },
    "abnormal_list": [
      {
        "analyte_name": null,
        "value_raw": null,
        "unit": null,
        "flag_raw": null,
        "reference_range": null
      }
    ]
  },
  "quality_control": {
    "missing_critical_fields": [],
    "possible_ocr_errors": [],
    "normalization_warnings": []
  }
}

----------------------------
Extraction Instructions (High recall, high precision)
----------------------------

A) Step 1 — Document classification
- Identify report types from cues such as:
  - Lab: Blood routine / CBC, Coagulation, Biochemistry, Urinalysis, Stool, Immunology/Serology (e.g., syphilis TPPA/TRUST), Genetic testing, etc.
  - Functional test: Pulmonary function (spirometry, DLCO, TLC, FEV1/FVC).
  - Imaging: MRI, Ultrasound (e.g., echocardiography), etc.
- Fill `document_classification.report_types` as a list (can be multiple).
- Set `has_tables` true if the text looks like rows/columns with analyte/result/reference/unit.

B) Step 2 — Metadata extraction
Extract any available:
- Facility/hospital name, department (or research institute), address, phone, email.
- specimen type (blood/serum/plasma/urine/stool), request/collection/report times.
- clinician, diagnosis, bed number, IDs.
Put them into `patient_info` and `encounter_info`. If absent, keep null.

Patient identity priority:
- Always capture: name, sex, age, ID number (身份证号), sample id (样品编号/条码/资料编号), and sample send date (样品送检日期).
- Put ID number into `patient_info.id_numbers.patient_id`.
- Put sample id into `patient_info.id_numbers.barcode`.
If the ID number is embedded in a long token, extract the 18‑digit sequence.

Gene report priority (if report is genetic testing):
- Prefer extracting: gene type/variant type (e.g., 4qA/4qB), D4Z4 repeat count, methylation value, and diagnosis date (报告日期/诊断日期).
- If 4qA/4qB appears, create an observation with analyte_name like "基因类型/单倍型/变体结构(4qA/4qB)" and also include it in latest_summary.by_analyte.

C) Step 3 — Observation extraction (the core)
Goal: extract ALL measurable indicators and qualitative test results.
For each row/item/indicator in tables or lists, create one `observations[]` item.

1) Canonical naming:
- Put the most standard name in `analyte_name`.
- Include variants/abbreviations in `analyte_aliases` (e.g., "肌酸激酶", "CK", "Creatine Kinase").
- If the analyte is obviously part of a panel (e.g., CBC, Coagulation, liver function), set `panel_name`.

2) Result parsing:
- If numeric: store original in `value_raw`, parsed number in `value_num`, unit in `unit`.
- If qualitative: store in `value_text` (e.g., 阴性/阳性/未提示/正常/异常/软/黄色/澄清).
- If both appear, keep both (num in value_num + short text in value_text if meaningful).

3) Reference range:
- Keep the raw reference string in `range_raw`.
- If a clear low/high exists (e.g., "11.0–14.5"), parse into `low` and `high`.
- Ensure reference unit matches; if unclear, keep only range_raw.

4) Abnormal flags:
- Detect abnormality from symbols/words: ↑, ↓, H/L, 高/低, abnormal, “*” marks, or value outside reference.
- Put original flag in `flag_raw`.
- Set `is_abnormal` true/false where determinable.
- Set `direction` as "high" / "low" / null.

5) Timestamp:
- Use per-item time if present; else use report_time/collect_time; else null.

6) Source evidence:
- Always copy a short exact `raw_snippet` that contains the analyte and its result (for traceability).
- If line numbers aren’t available, put a best-effort `line_hint` such as "near top table" / "page footer time line" / etc.

D) Step 4 — Findings for imaging/functional tests
If the report contains narrative sections like “影像所见/印象/结论/提示/超声所见/肺功能结论”:
- Add entries to `findings[]` with modality (MRI/Ultrasound/PFT), body_part (if mentioned), and both finding_text and impression_text.
- Do NOT convert narrative into numbers unless the report already provides explicit numbers (those numbers should also be extracted into `observations`).
For genetic testing reports, only include concise conclusion/impression in `findings`. Do not include health‑education paragraphs.

E) Step 5 — Latest summary
- Build `latest_summary.by_analyte` by selecting the most recent observation per canonical analyte name.
- Populate `abnormal_list` with all analytes whose latest is abnormal.

F) Normalization rules
1) Convert full-width digits to half-width. Handle commas in numbers.
2) For percentages:
   - Keep raw (e.g., "67.4%") in value_raw
   - Parse numeric 67.4 into value_num
   - Unit should be "%"
   - Do NOT auto-convert to decimals unless the text explicitly indicates ratio form.
3) For INR/PT/APTT/TT/Fg and similar:
   - Keep exact unit (s, g/L, etc).
4) For “阴性/(-)/negative” and “阳性/(+)/positive”:
   - Normalize to Chinese "阴性"/"阳性" in value_text when clearly equivalent, but keep original in value_raw too.
5) Do not guess missing units or missing mappings (e.g., do NOT infer D4Z4 repeats from fragment length unless the report explicitly provides a conversion).

G) OCR robustness / error handling
- If you see likely OCR mistakes (e.g., “I” vs “1”, “O” vs “0”, broken decimals), add them to `quality_control.possible_ocr_errors` with the suspicious token and why.
- If a row is ambiguous (value could be reference), keep the observation but add a warning in `quality_control.normalization_warnings`.

Return only the JSON object.
"""
    prompt = prompt_template.replace("<<OCR_TEXT>>", ocr_text)
    
    data = {
        "model": Config.AI_MODEL,
        "messages": [
            {
                "role": "system",
                "content": "You are a medical data extraction expert. Extract the requested data fields from the provided medical report text and return them as a JSON object with the exact field names specified."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": 0.1,
        "max_tokens": 3500
    }
    
    try:
        session = _build_session()
        response = session.post(
            Config.AI_API_URL,
            headers=headers,
            data=json.dumps(data),
            timeout=(Config.AI_CONNECT_TIMEOUT, Config.AI_READ_TIMEOUT)
        )
        response.raise_for_status()

        # 解析AI返回的结果
        ai_response = response.json()
        content = ai_response['choices'][0]['message']['content']

        # 尝试移除代码块包裹
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.IGNORECASE | re.DOTALL)

        # 将AI返回的文本转换为JSON对象
        try:
            return json.loads(cleaned)
        except Exception:
            # 尝试截取首尾花括号之间的JSON
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start != -1 and end != -1 and end > start:
                try:
                    return json.loads(cleaned[start:end + 1])
                except Exception:
                    pass

            # 最后尝试 JSON 修复
            try:
                repaired = repair_json(cleaned)
                return json.loads(repaired)
            except Exception:
                return {
                    "raw_response": content,
                    "error": "json_parse_failed"
                }
    except Exception as e:
        if "response" in locals():
            print(f"AI analysis error: {response.status_code} {response.text}")
        else:
            print(f"AI analysis error: {e}")
        return {
            "error": "request_failed",
            "detail": str(e)
        }

def analyze_medical_report(ocr_text):
    """
    Analyze medical report text using Silicon Flow AI API and extract required data fields.
    Splits long OCR into chunks and runs parallel calls, then merges.
    """
    chunks = _split_text(ocr_text, Config.AI_CHUNK_CHARS)
    if len(chunks) == 1 or Config.AI_PARALLELISM <= 1 or not Config.AI_ENABLE_PARALLEL:
        result = _call_ai(chunks[0])
        return result if isinstance(result, dict) else _empty_result()

    results = []
    workers = min(Config.AI_PARALLELISM, len(chunks))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_map = {executor.submit(_call_ai, chunk): idx for idx, chunk in enumerate(chunks)}
        for future in as_completed(future_map):
            try:
                results.append(future.result())
            except Exception as e:
                results.append({"error": "chunk_failed", "detail": str(e)})

    return _merge_results(results)
