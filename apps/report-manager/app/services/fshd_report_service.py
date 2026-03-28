import re
from typing import Any, Dict, Iterable, List, Optional, Tuple


REPORT_TYPE_LABELS: Dict[str, str] = {
    "genetic_report": "基因检测报告",
    "medical_summary": "病历摘要/住院小结",
    "physical_exam": "肌力/体格检查",
    "muscle_mri": "肌肉 MRI 报告",
    "pulmonary_function": "肺功能报告",
    "diaphragm_ultrasound": "膈肌超声报告",
    "ecg": "心电图报告",
    "echocardiography": "心脏超声报告",
    "biochemistry": "生化报告",
    "muscle_enzyme": "肌酶报告",
    "blood_routine": "血常规报告",
    "thyroid_function": "甲功报告",
    "coagulation": "凝血报告",
    "urinalysis": "尿常规报告",
    "infection_screening": "感染筛查报告",
    "stool_test": "粪便/幽门检测报告",
    "abdominal_ultrasound": "腹部超声报告",
    "other": "其他报告",
}

REPORT_TYPE_RULES: Dict[str, List[Tuple[str, int]]] = {
    "genetic_report": [
        ("基因检测", 4),
        ("fshd1", 5),
        ("fshd2", 5),
        ("d4z4", 5),
        ("4qa", 4),
        ("4qb", 4),
        ("ecori", 4),
        ("southern", 3),
        ("p13e-11", 3),
        ("bionano", 3),
    ],
    "medical_summary": [
        ("住院小结", 5),
        ("出院记录", 4),
        ("病历摘要", 5),
        ("门诊病历", 4),
        ("现病史", 3),
        ("既往史", 2),
        ("主诉", 2),
    ],
    "physical_exam": [
        ("肌力", 5),
        ("mrc", 5),
        ("翼状肩胛", 4),
        ("scapular winging", 4),
        ("beevor", 4),
        ("面肌无力", 3),
    ],
    "muscle_mri": [
        ("磁共振", 4),
        ("mri", 4),
        ("脂肪浸润", 5),
        ("炎性改变", 3),
        ("胫骨前肌", 4),
        ("胫前肌", 4),
        ("臀大肌", 4),
        ("趾长伸肌", 4),
        ("腓肠肌", 4),
    ],
    "pulmonary_function": [
        ("肺功能", 5),
        ("通气弥散残气", 5),
        ("fvc", 5),
        ("fev1", 5),
        ("dlco", 5),
        ("tlc", 4),
    ],
    "diaphragm_ultrasound": [
        ("膈肌", 6),
        ("qb", 3),
        ("db", 3),
        ("vs", 3),
        ("ee", 3),
        ("ei", 3),
        ("di", 3),
    ],
    "ecg": [
        ("心电图", 5),
        ("qrs", 4),
        ("qtc", 4),
        ("pr", 3),
        ("窦性心律", 4),
        ("束支传导阻滞", 4),
    ],
    "echocardiography": [
        ("超声心动图", 6),
        ("心脏超声", 5),
        ("lvef", 5),
        ("射血分数", 4),
        ("fs", 4),
        ("心动过缓", 3),
    ],
    "biochemistry": [
        ("生化", 4),
        ("常规生化", 5),
        ("alt", 3),
        ("ast", 3),
        ("肌酸激酶", 3),
        ("ckmb", 3),
    ],
    "muscle_enzyme": [
        ("肌酶", 6),
        ("肌酸激酶", 5),
        ("ck", 5),
        ("ldh", 4),
        ("肌红蛋白", 4),
        ("ckmb", 4),
    ],
    "blood_routine": [
        ("血常规", 6),
        ("wbc", 4),
        ("hgb", 4),
        ("plt", 4),
        ("红细胞", 2),
        ("白细胞", 2),
    ],
    "thyroid_function": [
        ("甲功", 6),
        ("甲状腺", 4),
        ("tsh", 5),
        ("ft3", 5),
        ("ft4", 5),
    ],
    "coagulation": [
        ("凝血", 6),
        ("pt", 4),
        ("aptt", 4),
        ("inr", 4),
        ("纤维蛋白原", 4),
        ("d-二聚体", 4),
        ("d二聚体", 4),
    ],
    "urinalysis": [
        ("尿常规", 6),
        ("尿蛋白", 4),
        ("尿糖", 4),
        ("红细胞/ul", 3),
        ("白细胞/ul", 3),
    ],
    "infection_screening": [
        ("感染筛查", 6),
        ("乙肝", 4),
        ("hiv", 4),
        ("梅毒", 4),
        ("hcv", 4),
    ],
    "stool_test": [
        ("粪便", 5),
        ("大便", 5),
        ("便常规", 6),
        ("潜血", 4),
        ("幽门螺杆菌", 5),
    ],
    "abdominal_ultrasound": [
        ("腹部超声", 6),
        ("肝胆胰脾", 4),
        ("腹部彩超", 6),
        ("胆囊", 3),
        ("肝脏", 3),
    ],
}

CRITICAL_FIELDS: Dict[str, List[str]] = {
    "genetic_report": ["diagnosis_type", "d4z4_repeat_pathogenic"],
    "medical_summary": ["onset_age", "progression_node"],
    "physical_exam": ["mrc_score"],
    "muscle_mri": ["muscle_name", "fatty_infiltration"],
    "pulmonary_function": ["fvc", "fvc_pred_pct"],
    "diaphragm_ultrasound": ["diaphragm_motion_summary"],
    "ecg": ["ecg_summary", "heart_rate"],
    "echocardiography": ["lvef", "echo_summary"],
    "biochemistry": ["ck"],
    "muscle_enzyme": ["ck", "ldh"],
}

MUSCLE_KEYWORDS: Dict[str, Dict[str, Any]] = {
    "deltoid": {"keywords": ["三角肌", "deltoid"], "region": "shoulder_girdle"},
    "biceps": {"keywords": ["肱二头肌", "biceps"], "region": "upper_arm"},
    "triceps": {"keywords": ["肱三头肌", "triceps"], "region": "upper_arm"},
    "wrist_extensor": {"keywords": ["腕伸肌", "wrist extensor"], "region": "upper_arm"},
    "finger_extensor": {"keywords": ["指伸肌", "finger extensor"], "region": "upper_arm"},
    "iliopsoas": {"keywords": ["髂腰肌", "iliopsoas"], "region": "hip"},
    "gluteus_maximus": {"keywords": ["臀大肌", "gluteus maximus"], "region": "hip"},
    "gluteus_medius": {"keywords": ["臀中肌", "gluteus medius"], "region": "hip"},
    "gluteus_minimus": {"keywords": ["臀小肌", "gluteus minimus"], "region": "hip"},
    "quadriceps": {"keywords": ["股四头肌", "quadriceps"], "region": "thigh"},
    "hamstrings": {"keywords": ["腘绳肌", "hamstring", "大腿后群"], "region": "thigh"},
    "tibialis_anterior": {"keywords": ["胫前肌", "胫骨前肌", "tibialis anterior"], "region": "ankle"},
    "extensor_digitorum_longus": {
        "keywords": ["趾长伸肌", "extensor digitorum longus"],
        "region": "ankle",
    },
    "gastrocnemius_medial_head": {
        "keywords": ["腓肠肌内侧头", "腓肠肌", "gastrocnemius"],
        "region": "ankle",
    },
    "soleus": {"keywords": ["比目鱼肌", "soleus"], "region": "ankle"},
    "serratus_anterior": {"keywords": ["前锯肌", "serratus"], "region": "shoulder_girdle"},
    "facial_muscles": {"keywords": ["面肌", "facial"], "region": "face"},
}

SIDE_KEYWORDS = {
    "left": ["左", "left", " l "],
    "right": ["右", "right", " r "],
    "bilateral": ["双侧", "bilateral"],
}

MRC_NORMALIZATION = {
    "0": 0.0,
    "1": 1.0,
    "2": 2.0,
    "3-": 2.7,
    "3": 3.0,
    "3+": 3.3,
    "4-": 3.7,
    "4": 4.0,
    "4+": 4.3,
    "5-": 4.7,
    "5": 5.0,
}

STRUCTURED_KEY_ALIASES = {
    "diagnosis_type": "diagnosisType",
    "genetic_positive": "geneticPositive",
    "haplotype": "haplotype",
    "ecori_fragment_kb": "ecoriFragmentKb",
    "d4z4_repeat_pathogenic": "d4z4RepeatPathogenic",
    "d4z4_repeat_other": "d4z4RepeatOther",
    "onset_age": "onsetAge",
    "disease_duration": "diseaseDuration",
    "progression_node": "progressionNode",
    "current_function_status": "currentFunctionStatus",
    "family_history": "familyHistory",
    "muscle_name": "muscleName",
    "mrc_score": "mrcScore",
    "facial_weakness": "facialWeakness",
    "scapular_winging": "scapularWinging",
    "beevor_sign": "beevorSign",
    "gait_abnormality": "gaitAbnormality",
    "situp_ability": "situpAbility",
    "region": "region",
    "fatty_infiltration": "fattyInfiltration",
    "inflammatory_change": "inflammatoryChange",
    "atrophy": "atrophy",
    "asymmetry": "asymmetry",
    "report_impression": "reportImpression",
    "fvc": "fvc",
    "fvc_pred_pct": "fvcPredPct",
    "fev1": "fev1",
    "fev1_pred_pct": "fev1PredPct",
    "fev1_fvc": "fev1Fvc",
    "tlc": "tlc",
    "tlc_pred_pct": "tlcPredPct",
    "dlco": "dlco",
    "dlco_pred_pct": "dlcoPredPct",
    "dlco_va": "dlcoVa",
    "ventilatory_pattern": "ventilatoryPattern",
    "severity": "severity",
    "diffusion_status": "diffusionStatus",
    "diaphragm_motion_summary": "diaphragmMotionSummary",
    "diaphragm_thickening_summary": "diaphragmThickeningSummary",
    "ecg_rhythm": "ecgRhythm",
    "heart_rate": "heartRate",
    "pr_interval_ms": "prIntervalMs",
    "qrs_duration_ms": "qrsDurationMs",
    "qt_ms": "qtMs",
    "qtc_ms": "qtcMs",
    "axis_p": "axisP",
    "axis_qrs": "axisQrs",
    "axis_t": "axisT",
    "conduction_abnormality": "conductionAbnormality",
    "ecg_summary": "ecgSummary",
    "lvef": "lvef",
    "fs": "fs",
    "co": "co",
    "hr": "hr",
    "lad": "lad",
    "aod": "aod",
    "lvd_d": "lvdD",
    "e_over_e_prime": "eOverEPrime",
    "chamber_size_status": "chamberSizeStatus",
    "wall_motion_status": "wallMotionStatus",
    "valve_status": "valveStatus",
    "echo_summary": "echoSummary",
    "ck": "ck",
    "mb": "mb",
    "ldh": "ldh",
    "ckmb": "ckmb",
    "creatinine": "creatinine",
    "uric_acid": "uricAcid",
    "alt": "alt",
    "ast": "ast",
}


def _normalize_text(text: str) -> str:
    normalized = text or ""
    replacements = {
        "：": ":",
        "（": "(",
        "）": ")",
        "％": "%",
        "，": ",",
        "。": ".",
        "；": ";",
        "【": "[",
        "】": "]",
        "“": "\"",
        "”": "\"",
        "↑": " ↑ ",
        "↓": " ↓ ",
        "\u3000": " ",
    }
    for before, after in replacements.items():
        normalized = normalized.replace(before, after)
    normalized = normalized.replace("\r", "\n")
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\n{2,}", "\n", normalized)
    return normalized.strip()


def _normalized_search_text(text: str) -> str:
    lowered = _normalize_text(text).lower()
    return f" {lowered} "


def _extract_lines(text: str) -> List[str]:
    return [line.strip() for line in _normalize_text(text).split("\n") if line.strip()]


def _extract_sentences(text: str) -> List[str]:
    chunks = re.split(r"[\n.;。；]+", _normalize_text(text))
    return [chunk.strip() for chunk in chunks if chunk.strip()]


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def _extract_date(text: str) -> Optional[str]:
    match = re.search(r"(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})", text)
    if not match:
        return None
    year, month, day = match.groups()
    return f"{year}-{int(month):02d}-{int(day):02d}"


def _find_best_line(lines: Iterable[str], keywords: Iterable[str]) -> Optional[str]:
    lowered_keywords = [keyword.lower() for keyword in keywords]
    for line in lines:
        lowered = line.lower()
        if any(keyword in lowered for keyword in lowered_keywords):
            return line
    return None


def _find_regex(text: str, patterns: Iterable[str], flags: int = re.IGNORECASE) -> Tuple[Optional[re.Match], Optional[str]]:
    for pattern in patterns:
        match = re.search(pattern, text, flags)
        if match:
            return match, pattern
    return None, None


def _extract_named_number(text: str, patterns: Iterable[str], unit: Optional[str] = None) -> Tuple[Optional[str], Optional[float], Optional[str]]:
    match, _ = _find_regex(text, patterns)
    if not match:
        return None, None, None
    raw_value = match.group(1).strip()
    detected_unit = unit
    if match.lastindex and match.lastindex >= 2:
        maybe_unit = match.group(2)
        if maybe_unit and maybe_unit.strip():
            detected_unit = maybe_unit.strip()
    return raw_value, _safe_float(raw_value), detected_unit


def _build_field(
    field_name: str,
    field_value: Any,
    *,
    normalized_value: Any = None,
    unit: Optional[str] = None,
    side: str = "unspecified",
    body_region: Optional[str] = None,
    source_text: Optional[str] = None,
    source_page: Optional[int] = None,
    confidence: float = 0.9,
    abnormal_flag: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "field_name": field_name,
        "field_value": field_value,
        "normalized_value": normalized_value if normalized_value is not None else field_value,
        "unit": unit,
        "side": side,
        "body_region": body_region,
        "source_page": source_page,
        "source_text": source_text,
        "confidence": round(float(confidence), 2),
    }
    if abnormal_flag:
        payload["abnormal_flag"] = abnormal_flag
    if extra:
        payload.update(extra)
    return payload


def _append_field(container: List[Dict[str, Any]], field: Optional[Dict[str, Any]]) -> None:
    if field and field.get("field_value") not in (None, "", []):
        container.append(field)


def _canonical_side(text: str) -> str:
    lowered = f" {text.lower()} "
    if any(keyword in lowered for keyword in SIDE_KEYWORDS["bilateral"]):
        return "bilateral"
    if any(keyword in lowered for keyword in SIDE_KEYWORDS["left"]):
        return "left"
    if any(keyword in lowered for keyword in SIDE_KEYWORDS["right"]):
        return "right"
    return "unspecified"


def _muscle_from_sentence(sentence: str) -> Optional[Tuple[str, str]]:
    lowered = sentence.lower()
    for canonical_name, meta in MUSCLE_KEYWORDS.items():
        if any(keyword.lower() in lowered for keyword in meta["keywords"]):
            return canonical_name, meta["region"]
    return None


def _classify_report(text: str, document_type_hint: Optional[str] = None) -> Tuple[str, float, List[str]]:
    normalized = _normalized_search_text(text)
    scores: Dict[str, int] = {}
    reasons: Dict[str, List[str]] = {}

    hint_mapping = {
        "mri": "muscle_mri",
        "genetic_report": "genetic_report",
        "blood_panel": "biochemistry",
        "other": "other",
    }
    normalized_hint = hint_mapping.get((document_type_hint or "").strip().lower(), "")

    for report_type, rules in REPORT_TYPE_RULES.items():
        score = 0
        matched: List[str] = []
        for keyword, weight in rules:
            if keyword.lower() in normalized:
                score += weight
                matched.append(keyword)
        if normalized_hint and report_type == normalized_hint:
            score += 2
            matched.append(f"hint:{document_type_hint}")
        if score > 0:
            scores[report_type] = score
            reasons[report_type] = matched

    if not scores:
        return "other", 0.45, ["未命中已知模板关键词"]

    best_type = max(scores, key=scores.get)
    best_score = scores[best_type]
    confidence = min(0.99, 0.45 + best_score / 18.0)

    # Muscle enzyme should outrank generic biochemistry when CK/LDH-like markers dominate.
    if best_type == "biochemistry":
        enzyme_score = scores.get("muscle_enzyme", 0)
        if enzyme_score >= best_score - 1:
            best_type = "muscle_enzyme"
            best_score = enzyme_score
            confidence = min(0.99, 0.45 + best_score / 18.0)

    return best_type, round(confidence, 2), reasons.get(best_type, [])


def _extract_patient_info(lines: List[str]) -> Dict[str, Any]:
    text = "\n".join(lines)
    patient_name = None
    sex = None
    age = None
    patient_id = None
    visit_id = None
    barcode = None

    name_match, _ = _find_regex(text, [r"姓名[: ]*([\u4e00-\u9fa5A-Za-z·]{2,24})"])
    if name_match:
        patient_name = name_match.group(1).strip()

    sex_match, _ = _find_regex(text, [r"性别[: ]*(男|女|male|female)"])
    if sex_match:
        raw_sex = sex_match.group(1).strip().lower()
        sex = "male" if raw_sex in {"男", "male"} else "female" if raw_sex in {"女", "female"} else raw_sex

    age_match, _ = _find_regex(text, [r"年龄[: ]*(\d{1,3})"])
    if age_match:
        age = int(age_match.group(1))

    patient_id_match, _ = _find_regex(text, [r"(\d{17}[\dXx])"])
    if patient_id_match:
        patient_id = patient_id_match.group(1)

    visit_match, _ = _find_regex(text, [r"(?:病历号|门诊号|住院号|就诊号|检查号)[: ]*([A-Za-z0-9-]+)"])
    if visit_match:
        visit_id = visit_match.group(1)

    barcode_match, _ = _find_regex(text, [r"(?:样品编号|样本编号|条码号|条形码号|资料编号)[: ]*([A-Za-z0-9-]+)"])
    if barcode_match:
        barcode = barcode_match.group(1)

    return {
        "name": patient_name,
        "sex": sex,
        "age": age,
        "id_numbers": {
            "patient_id": patient_id,
            "visit_id": visit_id,
            "barcode": barcode,
        },
    }


def _extract_encounter_info(lines: List[str]) -> Dict[str, Any]:
    text = "\n".join(lines)
    facility = None
    department = None
    clinical_diagnosis = None
    report_time = None
    collect_time = None
    request_time = None

    for line in lines[:8]:
        if "医院" in line or "中心" in line or "研究所" in line:
            facility = line.strip()
            break

    department_match, _ = _find_regex(text, [r"(?:科室|送检科室|申请科室)[: ]*([^\n]+)"])
    if department_match:
        department = department_match.group(1).strip()

    diagnosis_match, _ = _find_regex(text, [r"(?:临床诊断|诊断)[: ]*([^\n]+)"])
    if diagnosis_match:
        clinical_diagnosis = diagnosis_match.group(1).strip()

    time_patterns = [
        r"(?:报告日期|报告时间|报告打印时间)[: ]*(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:[ T]\d{1,2}:\d{2})?)",
        r"(?:检查日期|检查时间)[: ]*(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:[ T]\d{1,2}:\d{2})?)",
    ]
    report_match, _ = _find_regex(text, time_patterns)
    if report_match:
        report_time = report_match.group(1)

    collect_match, _ = _find_regex(text, [r"(?:采样时间|采集时间|送检日期)[: ]*(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:[ T]\d{1,2}:\d{2})?)"])
    if collect_match:
        collect_time = collect_match.group(1)

    request_match, _ = _find_regex(text, [r"(?:申请时间|开单时间)[: ]*(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:[ T]\d{1,2}:\d{2})?)"])
    if request_match:
        request_time = request_match.group(1)

    return {
        "facility": facility,
        "department": department,
        "bed_no": None,
        "specimen": None,
        "ordering_doctor": None,
        "clinical_diagnosis": clinical_diagnosis,
        "request_time": request_time,
        "collect_time": collect_time,
        "receive_time": None,
        "report_time": report_time,
    }


def _extract_summary_line(lines: List[str], keywords: Iterable[str]) -> Optional[str]:
    return _find_best_line(lines, keywords)


def _extract_genetic(lines: List[str], fields: List[Dict[str, Any]], findings: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    diagnosis_match, _ = _find_regex(text, [r"\b(FSHD1|FSHD2)\b", r"(FSHD\s*[12])"])
    diagnosis_type = diagnosis_match.group(1).replace(" ", "") if diagnosis_match else None

    haplotype_match, _ = _find_regex(text, [r"\b(4qA|4qB)\b"])
    haplotype = haplotype_match.group(1) if haplotype_match else None

    ecori_match, _ = _find_regex(
        text,
        [
            r"EcoRI[^\d]{0,16}(\d+(?:\.\d+)?)\s*(kb|KB)",
            r"片段长度[^\d]{0,16}(\d+(?:\.\d+)?)\s*(kb|KB)",
        ],
    )
    ecori_fragment = ecori_match.group(1) if ecori_match else None

    d4z4_pair_match, _ = _find_regex(
        text,
        [
            r"D4Z4[^\d]{0,24}(\d+)\s*[/／]\s*(\d+)",
            r"重复数[^\d]{0,20}(\d+)\s*[/／]\s*(\d+)",
        ],
    )
    d4z4_pathogenic = d4z4_pair_match.group(1) if d4z4_pair_match else None
    d4z4_other = d4z4_pair_match.group(2) if d4z4_pair_match else None
    if not d4z4_pathogenic:
        d4z4_single_match, _ = _find_regex(text, [r"D4Z4[^\d]{0,16}(\d+)"])
        if d4z4_single_match:
            d4z4_pathogenic = d4z4_single_match.group(1)

    methylation_match, _ = _find_regex(text, [r"甲基化[^\d]{0,12}(\d+(?:\.\d+)?)\s*(%?)"])
    methylation_value = methylation_match.group(1) if methylation_match else None
    methylation_unit = methylation_match.group(2) if methylation_match else "%"

    interpretation = _extract_summary_line(lines, ["结论", "提示", "interpretation", "impression", "诊断"])
    genetic_positive = "yes" if diagnosis_type or d4z4_pathogenic else "uncertain"

    _append_field(
        fields,
        _build_field(
            "diagnosis_type",
            diagnosis_type,
            source_text=diagnosis_match.group(0) if diagnosis_match else interpretation,
            confidence=0.98 if diagnosis_type else 0.0,
        ) if diagnosis_type else None,
    )
    _append_field(
        fields,
        _build_field(
            "genetic_positive",
            genetic_positive,
            normalized_value=genetic_positive,
            source_text=interpretation or diagnosis_type,
            confidence=0.88,
        ),
    )
    _append_field(
        fields,
        _build_field("haplotype", haplotype, source_text=haplotype_match.group(0) if haplotype_match else None, confidence=0.95)
        if haplotype
        else None,
    )
    _append_field(
        fields,
        _build_field(
            "ecori_fragment_kb",
            ecori_fragment,
            normalized_value=_safe_float(ecori_fragment),
            unit="kb",
            source_text=ecori_match.group(0) if ecori_match else None,
            confidence=0.94,
        )
        if ecori_fragment
        else None,
    )
    _append_field(
        fields,
        _build_field(
            "d4z4_repeat_pathogenic",
            d4z4_pathogenic,
            normalized_value=int(d4z4_pathogenic) if d4z4_pathogenic else None,
            source_text=d4z4_pair_match.group(0) if d4z4_pair_match else None,
            confidence=0.97,
        )
        if d4z4_pathogenic
        else None,
    )
    _append_field(
        fields,
        _build_field(
            "d4z4_repeat_other",
            d4z4_other,
            normalized_value=int(d4z4_other) if d4z4_other else None,
            source_text=d4z4_pair_match.group(0) if d4z4_pair_match else None,
            confidence=0.94,
        )
        if d4z4_other
        else None,
    )
    _append_field(
        fields,
        _build_field(
            "methylation_value",
            methylation_value,
            normalized_value=_safe_float(methylation_value),
            unit=methylation_unit or "%",
            source_text=methylation_match.group(0) if methylation_match else None,
            confidence=0.9,
        )
        if methylation_value
        else None,
    )
    _append_field(
        fields,
        _build_field("interpretation_summary", interpretation, source_text=interpretation, confidence=0.82)
        if interpretation
        else None,
    )

    if interpretation:
        findings.append(
            {
                "modality": "genetic",
                "body_part": "genetic",
                "finding_text": interpretation,
                "impression_text": interpretation,
                "source_evidence": {
                    "raw_snippet": interpretation[:120],
                    "line_hint": "summary line",
                },
            }
        )

    normalized_summary["genetic_summary"] = {
        "diagnosis_type": diagnosis_type,
        "genetic_positive": genetic_positive,
        "haplotype": haplotype,
        "ecori_fragment_kb": _safe_float(ecori_fragment) if ecori_fragment else None,
        "d4z4_repeat_pathogenic": int(d4z4_pathogenic) if d4z4_pathogenic else None,
        "d4z4_repeat_other": int(d4z4_other) if d4z4_other else None,
        "methylation_value": _safe_float(methylation_value) if methylation_value else None,
        "interpretation_summary": interpretation,
    }


def _extract_medical_summary(lines: List[str], fields: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    sentences = _extract_sentences("\n".join(lines))
    onset_age = None
    onset_sentence = None
    disease_duration = None
    duration_sentence = None
    current_function_status = None
    family_history = None
    key_signs: List[str] = []
    timeline: List[Dict[str, Any]] = []

    for sentence in sentences:
        if onset_age is None:
            onset_match, _ = _find_regex(sentence, [r"(\d{1,2})\s*岁[^。;；]*(?:起病|发病)", r"(?:起病|发病)[^。;；]*(\d{1,2})\s*岁"])
            if onset_match:
                onset_age = int(onset_match.group(1))
                onset_sentence = sentence
        if disease_duration is None:
            duration_match, _ = _find_regex(sentence, [r"(?:病程|发病|患病)[^。;；]*(\d{1,2})\s*年", r"(\d{1,2})\s*年(?:前|余)[^。;；]*(?:出现|起病|发病)"])
            if duration_match:
                disease_duration = int(duration_match.group(1))
                duration_sentence = sentence
        if family_history is None and "家族史" in sentence:
            family_history = sentence
        if current_function_status is None and any(keyword in sentence for keyword in ["行走", "爬楼", "抬手", "呼吸", "上下楼", "步态"]):
            current_function_status = sentence
        if any(keyword in sentence for keyword in ["翼状肩胛", "面肌无力", "足下垂", "beevor", "肩胛突出"]):
            key_signs.append(sentence)
        if any(keyword in sentence for keyword in ["起病", "发病", "加重", "进展", "确诊", "检查提示"]):
            normalized_age = None
            age_match, _ = _find_regex(sentence, [r"(\d{1,2})\s*岁"])
            if age_match:
                normalized_age = int(age_match.group(1))
            timeline.append(
                {
                    "event_type": "progression_node" if "进展" in sentence or "加重" in sentence else "clinical_event",
                    "event_time": _extract_date(sentence) or sentence[:24],
                    "normalized_age": normalized_age,
                    "description": sentence,
                }
            )

    progression_node = timeline[0]["description"] if timeline else None
    key_clinical_signs = "；".join(dict.fromkeys(key_signs)) if key_signs else None

    _append_field(
        fields,
        _build_field("onset_age", onset_age, normalized_value=onset_age, source_text=onset_sentence, confidence=0.82)
        if onset_age is not None
        else None,
    )
    _append_field(
        fields,
        _build_field(
            "disease_duration",
            disease_duration,
            normalized_value=disease_duration,
            unit="year",
            source_text=duration_sentence,
            confidence=0.8,
        )
        if disease_duration is not None
        else None,
    )
    _append_field(
        fields,
        _build_field("progression_node", progression_node, source_text=progression_node, confidence=0.76)
        if progression_node
        else None,
    )
    _append_field(
        fields,
        _build_field(
            "current_function_status",
            current_function_status,
            source_text=current_function_status,
            confidence=0.74,
        )
        if current_function_status
        else None,
    )
    _append_field(
        fields,
        _build_field("family_history", family_history, source_text=family_history, confidence=0.78)
        if family_history
        else None,
    )
    _append_field(
        fields,
        _build_field("key_clinical_signs", key_clinical_signs, source_text=key_clinical_signs, confidence=0.74)
        if key_clinical_signs
        else None,
    )

    normalized_summary["timeline"] = timeline
    normalized_summary["medical_summary"] = {
        "onset_age": onset_age,
        "disease_duration": disease_duration,
        "progression_node": progression_node,
        "current_function_status": current_function_status,
        "family_history": family_history,
        "key_clinical_signs": key_signs,
    }


def _extract_physical_exam(lines: List[str], fields: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    sentences = _extract_sentences("\n".join(lines))
    muscle_strength: List[Dict[str, Any]] = []

    for sentence in sentences:
        muscle = _muscle_from_sentence(sentence)
        if not muscle:
            continue
        canonical_name, body_region = muscle
        side = _canonical_side(sentence)

        left_match, _ = _find_regex(sentence, [r"(?:左|left)[^0-5]{0,12}([0-5](?:[+-])?)"])
        right_match, _ = _find_regex(sentence, [r"(?:右|right)[^0-5]{0,12}([0-5](?:[+-])?)"])

        if left_match or right_match:
            if left_match:
                score = left_match.group(1)
                muscle_strength.append(
                    {
                        "muscle_name": canonical_name,
                        "side": "left",
                        "mrc_score": score,
                        "mrc_numeric": MRC_NORMALIZATION.get(score),
                        "source_text": sentence,
                        "confidence": 0.95,
                        "body_region": body_region,
                    }
                )
            if right_match:
                score = right_match.group(1)
                muscle_strength.append(
                    {
                        "muscle_name": canonical_name,
                        "side": "right",
                        "mrc_score": score,
                        "mrc_numeric": MRC_NORMALIZATION.get(score),
                        "source_text": sentence,
                        "confidence": 0.95,
                        "body_region": body_region,
                    }
                )
            continue

        generic_match, _ = _find_regex(sentence, [r"([0-5](?:[+-])?)"])
        if generic_match:
            score = generic_match.group(1)
            muscle_strength.append(
                {
                    "muscle_name": canonical_name,
                    "side": side,
                    "mrc_score": score,
                    "mrc_numeric": MRC_NORMALIZATION.get(score),
                    "source_text": sentence,
                    "confidence": 0.88,
                    "body_region": body_region,
                }
            )

    for item in muscle_strength:
        _append_field(
            fields,
            _build_field(
                "mrc_score",
                item["mrc_score"],
                normalized_value=item["mrc_numeric"],
                side=item["side"],
                body_region=item["body_region"],
                source_text=item["source_text"],
                confidence=item["confidence"],
                extra={"muscle_name": item["muscle_name"]},
            ),
        )

    special_flags = {
        "facial_weakness": "yes" if _find_best_line(lines, ["面肌无力", "闭眼无力", "鼓腮无力"]) else None,
        "scapular_winging": "yes" if _find_best_line(lines, ["翼状肩胛", "肩胛突出", "scapular winging"]) else None,
        "beevor_sign": "positive" if _find_best_line(lines, ["beevor"]) else None,
        "gait_abnormality": _find_best_line(lines, ["步态", "鸭步", "行走困难", "足下垂"]),
        "situp_ability": _find_best_line(lines, ["仰卧起坐", "起坐", "sit-up"]),
    }

    for field_name, value in special_flags.items():
        if not value:
            continue
        _append_field(fields, _build_field(field_name, value, source_text=str(value), confidence=0.82))

    normalized_summary["muscle_strength"] = muscle_strength
    normalized_summary["physical_exam_flags"] = special_flags


def _extract_mri(lines: List[str], fields: List[Dict[str, Any]], findings: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    sentences = _extract_sentences("\n".join(lines))
    mri_map: List[Dict[str, Any]] = []

    for sentence in sentences:
        muscle = _muscle_from_sentence(sentence)
        if not muscle:
            continue
        canonical_name, body_region = muscle
        lowered = sentence.lower()
        side = _canonical_side(sentence)
        fatty = "yes" if any(keyword in sentence for keyword in ["脂肪浸润", "脂肪变", "fatty"]) else None
        inflammation = "yes" if any(keyword in sentence for keyword in ["炎性改变", "炎症", "edema"]) else None
        atrophy = "yes" if any(keyword in sentence for keyword in ["萎缩", "atrophy"]) else None

        asymmetry = "none"
        if "左侧较重" in sentence or "左侧更重" in sentence or "left greater than right" in lowered:
            asymmetry = "left_gt_right"
        elif "右侧较重" in sentence or "右侧更重" in sentence or "right greater than left" in lowered:
            asymmetry = "right_gt_left"

        if not any([fatty, inflammation, atrophy]) and asymmetry == "none":
            continue

        item = {
            "region": body_region,
            "muscle_name": canonical_name,
            "side": side,
            "fatty_infiltration": fatty,
            "inflammatory_change": inflammation,
            "atrophy": atrophy,
            "asymmetry": asymmetry,
            "source_text": sentence,
            "confidence": 0.8 if asymmetry != "none" else 0.86,
        }
        mri_map.append(item)

        if fatty:
            _append_field(
                fields,
                _build_field(
                    "fatty_infiltration",
                    fatty,
                    side=side,
                    body_region=body_region,
                    source_text=sentence,
                    confidence=item["confidence"],
                    extra={"muscle_name": canonical_name, "region": body_region},
                ),
            )
        if inflammation:
            _append_field(
                fields,
                _build_field(
                    "inflammatory_change",
                    inflammation,
                    side=side,
                    body_region=body_region,
                    source_text=sentence,
                    confidence=item["confidence"],
                    extra={"muscle_name": canonical_name, "region": body_region},
                ),
            )
        if atrophy:
            _append_field(
                fields,
                _build_field(
                    "atrophy",
                    atrophy,
                    side=side,
                    body_region=body_region,
                    source_text=sentence,
                    confidence=item["confidence"],
                    extra={"muscle_name": canonical_name, "region": body_region},
                ),
            )
        if asymmetry != "none":
            _append_field(
                fields,
                _build_field(
                    "asymmetry",
                    asymmetry,
                    side=side,
                    body_region=body_region,
                    source_text=sentence,
                    confidence=0.8,
                    extra={"muscle_name": canonical_name, "region": body_region},
                ),
            )

    report_impression = _extract_summary_line(lines, ["印象", "结论", "提示"])
    if report_impression:
        _append_field(fields, _build_field("report_impression", report_impression, source_text=report_impression, confidence=0.8))
        findings.append(
            {
                "modality": "MRI",
                "body_part": "muscle",
                "finding_text": report_impression,
                "impression_text": report_impression,
                "source_evidence": {
                    "raw_snippet": report_impression[:120],
                    "line_hint": "impression line",
                },
            }
        )

    normalized_summary["mri_map"] = mri_map
    normalized_summary["mri_summary"] = {
        "report_impression": report_impression,
        "affected_regions": list(dict.fromkeys(item["region"] for item in mri_map if item["region"])),
    }


def _extract_pulmonary(lines: List[str], fields: List[Dict[str, Any]], findings: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    metric_patterns = {
        "fvc": [r"\bFVC\b[^\d]{0,10}(\d+(?:\.\d+)?)\s*(L|%)?"],
        "fvc_pred_pct": [r"FVC(?:[% ]*Pred|占预计值|预计%)?[^\d]{0,12}(\d+(?:\.\d+)?)\s*(%)"],
        "fev1": [r"\bFEV1\b[^\d]{0,10}(\d+(?:\.\d+)?)\s*(L|%)?"],
        "fev1_pred_pct": [r"FEV1(?:[% ]*Pred|占预计值|预计%)?[^\d]{0,12}(\d+(?:\.\d+)?)\s*(%)"],
        "fev1_fvc": [r"FEV1/FVC[^\d]{0,12}(\d+(?:\.\d+)?)\s*(%)"],
        "tlc": [r"\bTLC\b[^\d]{0,10}(\d+(?:\.\d+)?)\s*(L|%)?"],
        "tlc_pred_pct": [r"TLC(?:[% ]*Pred|占预计值|预计%)?[^\d]{0,12}(\d+(?:\.\d+)?)\s*(%)"],
        "dlco": [r"\bDLCO\b[^\d]{0,10}(\d+(?:\.\d+)?)\s*([A-Za-z/%·]+)?"],
        "dlco_pred_pct": [r"DLCO(?:[% ]*Pred|占预计值|预计%)?[^\d]{0,12}(\d+(?:\.\d+)?)\s*(%)"],
        "dlco_va": [r"DLCO/VA[^\d]{0,12}(\d+(?:\.\d+)?)\s*([A-Za-z/%·]+)?"],
    }
    panel: Dict[str, Any] = {}

    for field_name, patterns in metric_patterns.items():
        raw_value, normalized_value, unit = _extract_named_number(text, patterns)
        if raw_value is None:
            continue
        panel[field_name] = normalized_value if normalized_value is not None else raw_value
        _append_field(
            fields,
            _build_field(
                field_name,
                raw_value,
                normalized_value=normalized_value,
                unit=unit,
                source_text=_find_best_line(lines, [field_name.upper(), field_name.lower().replace("_", "/")]) or raw_value,
                confidence=0.94,
            ),
        )

    ventilatory_pattern = None
    if _find_best_line(lines, ["限制性通气"]):
        ventilatory_pattern = "restrictive"
    elif _find_best_line(lines, ["阻塞性通气"]):
        ventilatory_pattern = "obstructive"
    elif _find_best_line(lines, ["混合性通气"]):
        ventilatory_pattern = "mixed"
    elif _find_best_line(lines, ["通气功能正常", "肺功能正常"]):
        ventilatory_pattern = "normal"

    severity = _extract_summary_line(lines, ["轻度", "中度", "重度"])
    diffusion_status = _extract_summary_line(lines, ["弥散功能正常", "弥散功能下降", "正常肺弥散"])

    if ventilatory_pattern:
        _append_field(fields, _build_field("ventilatory_pattern", ventilatory_pattern, source_text=ventilatory_pattern, confidence=0.86))
    if severity:
        _append_field(fields, _build_field("severity", severity, source_text=severity, confidence=0.8))
    if diffusion_status:
        _append_field(fields, _build_field("diffusion_status", diffusion_status, source_text=diffusion_status, confidence=0.82))
        findings.append(
            {
                "modality": "PFT",
                "body_part": "lung",
                "finding_text": diffusion_status,
                "impression_text": diffusion_status,
                "source_evidence": {
                    "raw_snippet": diffusion_status[:120],
                    "line_hint": "summary line",
                },
            }
        )

    panel.update(
        {
            "ventilatory_pattern": ventilatory_pattern,
            "severity": severity,
            "diffusion_status": diffusion_status,
        }
    )
    normalized_summary["cardio_respiratory_panel"] = {
        **normalized_summary.get("cardio_respiratory_panel", {}),
        **panel,
    }


def _extract_diaphragm_ultrasound(lines: List[str], fields: List[Dict[str, Any]], findings: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    metric_definitions = {
        "right_qb": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bQB\b[^\d]{0,8}(\d+(?:\.\d+)?)"],
        "right_db": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bDB\b[^\d]{0,8}(\d+(?:\.\d+)?)"],
        "right_vs": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bVS\b[^\d]{0,8}(\d+(?:\.\d+)?)"],
        "left_qb": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bQB\b[^\d]{0,8}(\d+(?:\.\d+)?)"],
        "left_db": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bDB\b[^\d]{0,8}(\d+(?:\.\d+)?)"],
        "left_vs": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bVS\b[^\d]{0,8}(\d+(?:\.\d+)?)"],
        "right_ee": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bEE\b[^\d]{0,8}(\d+(?:\.\d+)?)"],
        "right_ei": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bEI\b[^\d]{0,8}(\d+(?:\.\d+)?)"],
        "right_di": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bDI\b[^\d]{0,8}(\d+(?:\.\d+)?)"],
        "left_ee": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bEE\b[^\d]{0,8}(\d+(?:\.\d+)?)"],
        "left_ei": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bEI\b[^\d]{0,8}(\d+(?:\.\d+)?)"],
        "left_di": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bDI\b[^\d]{0,8}(\d+(?:\.\d+)?)"],
    }
    panel: Dict[str, Any] = normalized_summary.get("cardio_respiratory_panel", {})

    for field_name, patterns in metric_definitions.items():
        raw_value, normalized_value, _ = _extract_named_number(text, patterns)
        if raw_value is None:
            continue
        panel[field_name] = normalized_value if normalized_value is not None else raw_value
        _append_field(
            fields,
            _build_field(field_name, raw_value, normalized_value=normalized_value, source_text=raw_value, confidence=0.9),
        )

    motion_summary = _extract_summary_line(lines, ["膈肌运动", "运动幅度", "活动度"])
    thickening_summary = _extract_summary_line(lines, ["增厚率", "厚度", "thickening"])
    if motion_summary:
        _append_field(fields, _build_field("diaphragm_motion_summary", motion_summary, source_text=motion_summary, confidence=0.82))
        findings.append(
            {
                "modality": "Ultrasound",
                "body_part": "diaphragm",
                "finding_text": motion_summary,
                "impression_text": motion_summary,
                "source_evidence": {"raw_snippet": motion_summary[:120], "line_hint": "summary line"},
            }
        )
    if thickening_summary:
        _append_field(fields, _build_field("diaphragm_thickening_summary", thickening_summary, source_text=thickening_summary, confidence=0.82))

    panel["diaphragm_motion_summary"] = motion_summary
    panel["diaphragm_thickening_summary"] = thickening_summary
    normalized_summary["cardio_respiratory_panel"] = panel


def _extract_ecg(lines: List[str], fields: List[Dict[str, Any]], findings: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    metric_patterns = {
        "heart_rate": [r"(?:HR|心率)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(?:bpm|次/分)?"],
        "pr_interval_ms": [r"\bPR\b[^\d]{0,8}(\d+(?:\.\d+)?)\s*(ms|毫秒)?"],
        "qrs_duration_ms": [r"\bQRS\b[^\d]{0,8}(\d+(?:\.\d+)?)\s*(ms|毫秒)?"],
        "qt_ms": [r"\bQT\b[^\d]{0,8}(\d+(?:\.\d+)?)\s*(ms|毫秒)?"],
        "qtc_ms": [r"\bQTc\b[^\d]{0,8}(\d+(?:\.\d+)?)\s*(ms|毫秒)?"],
        "axis_p": [r"P轴[^\d-]{0,8}(-?\d+(?:\.\d+)?)"],
        "axis_qrs": [r"QRS轴[^\d-]{0,8}(-?\d+(?:\.\d+)?)"],
        "axis_t": [r"T轴[^\d-]{0,8}(-?\d+(?:\.\d+)?)"],
    }
    panel: Dict[str, Any] = normalized_summary.get("cardio_respiratory_panel", {})

    for field_name, patterns in metric_patterns.items():
        raw_value, normalized_value, unit = _extract_named_number(text, patterns)
        if raw_value is None:
            continue
        panel[field_name] = normalized_value if normalized_value is not None else raw_value
        _append_field(
            fields,
            _build_field(field_name, raw_value, normalized_value=normalized_value, unit=unit, source_text=raw_value, confidence=0.95),
        )

    rhythm = _extract_summary_line(lines, ["窦性心律", "窦性心律不齐", "心律", "sinus rhythm", "sinus arrhythmia"])
    conduction = _extract_summary_line(lines, ["束支传导阻滞", "传导阻滞", "房室传导", "bundle branch block", "atrioventricular block"])
    ecg_summary = _extract_summary_line(lines, ["窦性", "传导阻滞", "心电图提示", "诊断", "sinus rhythm", "bundle branch block", "ecg impression"])

    if rhythm:
        _append_field(fields, _build_field("ecg_rhythm", rhythm, source_text=rhythm, confidence=0.9))
    if conduction:
        _append_field(fields, _build_field("conduction_abnormality", conduction, source_text=conduction, confidence=0.86))
    if ecg_summary:
        _append_field(fields, _build_field("ecg_summary", ecg_summary, source_text=ecg_summary, confidence=0.84))
        findings.append(
            {
                "modality": "ECG",
                "body_part": "heart",
                "finding_text": ecg_summary,
                "impression_text": ecg_summary,
                "source_evidence": {"raw_snippet": ecg_summary[:120], "line_hint": "summary line"},
            }
        )

    panel["ecg_rhythm"] = rhythm
    panel["conduction_abnormality"] = conduction
    panel["ecg_summary"] = ecg_summary
    normalized_summary["cardio_respiratory_panel"] = panel


def _extract_echo(lines: List[str], fields: List[Dict[str, Any]], findings: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    metric_patterns = {
        "lvef": [r"(?:LVEF|EF|射血分数)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(%)"],
        "fs": [r"\bFS\b[^\d]{0,8}(\d+(?:\.\d+)?)\s*(%)"],
        "co": [r"\bCO\b[^\d]{0,8}(\d+(?:\.\d+)?)\s*([A-Za-z/]+)?"],
        "hr": [r"(?:HR|心率)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(?:bpm|次/分)?"],
        "lad": [r"\bLAD\b[^\d]{0,8}(\d+(?:\.\d+)?)\s*(mm|cm)?"],
        "aod": [r"\bAOD\b[^\d]{0,8}(\d+(?:\.\d+)?)\s*(mm|cm)?"],
        "lvd_d": [r"(?:LVDd|LVDD)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(mm|cm)?"],
        "e_over_e_prime": [r"E/E['′]?[^\d]{0,8}(\d+(?:\.\d+)?)"],
    }
    panel: Dict[str, Any] = normalized_summary.get("cardio_respiratory_panel", {})

    for field_name, patterns in metric_patterns.items():
        raw_value, normalized_value, unit = _extract_named_number(text, patterns)
        if raw_value is None:
            continue
        panel[field_name] = normalized_value if normalized_value is not None else raw_value
        _append_field(
            fields,
            _build_field(field_name, raw_value, normalized_value=normalized_value, unit=unit, source_text=raw_value, confidence=0.94),
        )

    chamber_size_status = _extract_summary_line(lines, ["房室大小正常", "心腔大小", "房室内径"])
    wall_motion_status = _extract_summary_line(lines, ["室壁运动", "节段性室壁运动"])
    valve_status = _extract_summary_line(lines, ["瓣膜", "反流", "狭窄"])
    echo_summary = _extract_summary_line(lines, ["超声提示", "结论", "印象", "LVEF正常", "心动过缓"])

    if chamber_size_status:
        _append_field(fields, _build_field("chamber_size_status", chamber_size_status, source_text=chamber_size_status, confidence=0.82))
    if wall_motion_status:
        _append_field(fields, _build_field("wall_motion_status", wall_motion_status, source_text=wall_motion_status, confidence=0.82))
    if valve_status:
        _append_field(fields, _build_field("valve_status", valve_status, source_text=valve_status, confidence=0.82))
    if echo_summary:
        _append_field(fields, _build_field("echo_summary", echo_summary, source_text=echo_summary, confidence=0.84))
        findings.append(
            {
                "modality": "Ultrasound",
                "body_part": "heart",
                "finding_text": echo_summary,
                "impression_text": echo_summary,
                "source_evidence": {"raw_snippet": echo_summary[:120], "line_hint": "summary line"},
            }
        )

    panel.update(
        {
            "chamber_size_status": chamber_size_status,
            "wall_motion_status": wall_motion_status,
            "valve_status": valve_status,
            "echo_summary": echo_summary,
        }
    )
    normalized_summary["cardio_respiratory_panel"] = panel


def _extract_lab_value(lines: List[str], keywords: Iterable[str]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    for line in lines:
        lowered = line.lower()
        if not any(keyword.lower() in lowered for keyword in keywords):
            continue
        match = re.search(r"([<>]?\d+(?:\.\d+)?)\s*([A-Za-z/%μµ·/\-]+)?", line)
        if match:
            return match.group(1), (match.group(2) or "").strip() or None, line
    return None, None, None


def _extract_labs(lines: List[str], fields: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    analytes = {
        "ck": ["肌酸激酶", "ck"],
        "mb": ["肌红蛋白", " myo ", " mb "],
        "ldh": ["乳酸脱氢酶", "ldh"],
        "ckmb": ["ckmb", "ck-mb"],
        "creatinine": ["肌酐", "creatinine", "cr"],
        "uric_acid": ["尿酸", "uric acid", "ua"],
        "alt": ["alt", "谷丙转氨酶"],
        "ast": ["ast", "谷草转氨酶"],
    }
    panel: Dict[str, Any] = normalized_summary.get("lab_panel", {})

    for field_name, keywords in analytes.items():
        raw_value, unit, source_line = _extract_lab_value(lines, keywords)
        if raw_value is None:
            continue
        numeric_value = _safe_float(raw_value)
        panel[field_name] = numeric_value if numeric_value is not None else raw_value
        _append_field(
            fields,
            _build_field(
                field_name,
                raw_value,
                normalized_value=numeric_value,
                unit=unit,
                source_text=source_line,
                confidence=0.93,
            ),
        )

    normalized_summary["lab_panel"] = panel


def _dedupe_preserve_order(values: Iterable[Any]) -> List[Any]:
    seen = set()
    items: List[Any] = []
    for value in values:
        if value in (None, "", []):
            continue
        marker = str(value)
        if marker in seen:
            continue
        seen.add(marker)
        items.append(value)
    return items


def _build_observations(structured_fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    observations: List[Dict[str, Any]] = []
    for field in structured_fields:
        field_name = field.get("field_name")
        field_value = field.get("field_value")
        normalized_value = field.get("normalized_value")
        if field_name in {"interpretation_summary", "progression_node", "current_function_status", "report_impression", "echo_summary", "ecg_summary", "diaphragm_motion_summary", "diaphragm_thickening_summary"}:
            continue
        observations.append(
            {
                "category": field.get("body_region"),
                "panel_name": "fshd_structured",
                "analyte_name": field_name,
                "analyte_aliases": [STRUCTURED_KEY_ALIASES.get(field_name, field_name)],
                "result": {
                    "value_raw": str(field_value) if field_value is not None else None,
                    "value_num": normalized_value if isinstance(normalized_value, (int, float)) else _safe_float(normalized_value),
                    "value_text": None if isinstance(normalized_value, (int, float)) else str(normalized_value) if normalized_value is not None else str(field_value) if field_value is not None else None,
                    "unit": field.get("unit"),
                },
                "reference": {"range_raw": None, "low": None, "high": None, "unit": field.get("unit")},
                "interpretation": {
                    "flag_raw": field.get("abnormal_flag"),
                    "is_abnormal": field.get("abnormal_flag") in {"high", "low", "abnormal_unspecified"},
                    "direction": field.get("abnormal_flag") if field.get("abnormal_flag") in {"high", "low"} else None,
                },
                "method": None,
                "specimen": None,
                "timestamp": None,
                "source_evidence": {
                    "raw_snippet": field.get("source_text"),
                    "line_hint": "structured field",
                },
            }
        )
    return observations


def _build_latest_summary(observations: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_analyte: Dict[str, Dict[str, Any]] = {}
    abnormal_list: List[Dict[str, Any]] = []
    for obs in observations:
        analyte_name = obs.get("analyte_name")
        if not analyte_name:
            continue
        result = obs.get("result", {})
        interpretation = obs.get("interpretation", {})
        reference = obs.get("reference", {})
        by_analyte[analyte_name] = {
            "value_num": result.get("value_num"),
            "value_text": result.get("value_text") or result.get("value_raw"),
            "unit": result.get("unit"),
            "timestamp": obs.get("timestamp"),
            "is_abnormal": interpretation.get("is_abnormal"),
            "direction": interpretation.get("direction"),
            "reference_low": reference.get("low"),
            "reference_high": reference.get("high"),
        }
        if interpretation.get("is_abnormal"):
            abnormal_list.append(
                {
                    "analyte_name": analyte_name,
                    "value_raw": result.get("value_raw"),
                    "unit": result.get("unit"),
                    "flag_raw": interpretation.get("flag_raw"),
                    "reference_range": reference.get("range_raw"),
                }
            )
    return {"by_analyte": by_analyte, "abnormal_list": abnormal_list}


def _legacy_aliases(normalized_summary: Dict[str, Any]) -> Dict[str, Any]:
    genetic = normalized_summary.get("genetic_summary", {})
    physical_exam = normalized_summary.get("muscle_strength", [])
    cardio = normalized_summary.get("cardio_respiratory_panel", {})
    labs = normalized_summary.get("lab_panel", {})

    strength_by_group: Dict[str, List[Dict[str, Any]]] = {}
    for item in physical_exam:
        strength_by_group.setdefault(item.get("muscle_name") or "", []).append(item)

    def _format_strength(group_name: str) -> Optional[str]:
        items = strength_by_group.get(group_name) or []
        if not items:
            return None
        left = next((item.get("mrc_score") for item in items if item.get("side") == "left"), None)
        right = next((item.get("mrc_score") for item in items if item.get("side") == "right"), None)
        generic = next((item.get("mrc_score") for item in items if item.get("side") in {"unspecified", "bilateral"}), None)
        if left or right:
            parts = []
            if left:
                parts.append(f"L{left}")
            if right:
                parts.append(f"R{right}")
            return " / ".join(parts)
        return generic

    return {
        "d4z4_repeats": genetic.get("d4z4_repeat_pathogenic"),
        "methylation_value": genetic.get("methylation_value"),
        "serratus_fatigue_grade": None,
        "deltoid_strength": _format_strength("deltoid"),
        "biceps_strength": _format_strength("biceps"),
        "triceps_strength": _format_strength("triceps"),
        "quadriceps_strength": _format_strength("quadriceps"),
        "liver_function": " / ".join(
            _dedupe_preserve_order(
                [
                    f"ALT {labs.get('alt')}" if labs.get("alt") is not None else None,
                    f"AST {labs.get('ast')}" if labs.get("ast") is not None else None,
                ]
            )
        )
        or None,
        "creatine_kinase": labs.get("ck"),
        "stair_test_result": normalized_summary.get("medical_summary", {}).get("current_function_status"),
    }


def analyze_fshd_report(ocr_text: str, document_type_hint: Optional[str] = None) -> Dict[str, Any]:
    normalized_text = _normalize_text(ocr_text)
    lines = _extract_lines(normalized_text)
    report_type, report_confidence, classification_reasons = _classify_report(normalized_text, document_type_hint)

    structured_fields: List[Dict[str, Any]] = []
    findings: List[Dict[str, Any]] = []
    normalized_summary: Dict[str, Any] = {}

    if report_type == "genetic_report":
        _extract_genetic(lines, structured_fields, findings, normalized_summary)
    elif report_type == "medical_summary":
        _extract_medical_summary(lines, structured_fields, normalized_summary)
    elif report_type == "physical_exam":
        _extract_physical_exam(lines, structured_fields, normalized_summary)
    elif report_type == "muscle_mri":
        _extract_mri(lines, structured_fields, findings, normalized_summary)
    elif report_type == "pulmonary_function":
        _extract_pulmonary(lines, structured_fields, findings, normalized_summary)
    elif report_type == "diaphragm_ultrasound":
        _extract_diaphragm_ultrasound(lines, structured_fields, findings, normalized_summary)
    elif report_type == "ecg":
        _extract_ecg(lines, structured_fields, findings, normalized_summary)
    elif report_type == "echocardiography":
        _extract_echo(lines, structured_fields, findings, normalized_summary)

    if report_type in {
        "muscle_enzyme",
        "biochemistry",
        "blood_routine",
        "thyroid_function",
        "coagulation",
        "urinalysis",
        "infection_screening",
        "stool_test",
        "abdominal_ultrasound",
        "other",
    }:
        _extract_labs(lines, structured_fields, normalized_summary)

    observations = _build_observations(structured_fields)
    latest_summary = _build_latest_summary(observations)
    patient_info = _extract_patient_info(lines)
    encounter_info = _extract_encounter_info(lines)
    legacy = _legacy_aliases(normalized_summary)

    missing_fields = []
    critical_fields = CRITICAL_FIELDS.get(report_type, [])
    extracted_field_names = {item.get("field_name") for item in structured_fields}
    for field_name in critical_fields:
        if field_name not in extracted_field_names:
            missing_fields.append(field_name)

    low_confidence_fields = [
        item
        for item in structured_fields
        if float(item.get("confidence") or 0) < 0.75
    ]

    quality_control = {
        "missing_critical_fields": missing_fields,
        "possible_ocr_errors": [],
        "normalization_warnings": [
            "source_page unavailable in embedded OCR mode; source_text is preserved for review."
        ],
    }

    fshd_payload = {
        "report_type": report_type,
        "report_type_label": REPORT_TYPE_LABELS.get(report_type, report_type),
        "report_type_confidence": report_confidence,
        "classification_reasons": classification_reasons,
        "structured_fields": structured_fields,
        "normalized_summary": normalized_summary,
        "review_queue": low_confidence_fields,
        "field_count": len(structured_fields),
    }

    result: Dict[str, Any] = {
        "schema_version": "fshd_structured_v1",
        "document_classification": {
            "report_types": [report_type],
            "confidence": report_confidence,
            "language": ["zh"],
            "has_tables": report_type
            in {
                "genetic_report",
                "pulmonary_function",
                "diaphragm_ultrasound",
                "ecg",
                "echocardiography",
                "biochemistry",
                "muscle_enzyme",
                "blood_routine",
                "thyroid_function",
                "coagulation",
                "urinalysis",
            },
            "notes": None,
        },
        "patient_info": patient_info,
        "encounter_info": encounter_info,
        "observations": observations,
        "findings": findings,
        "latest_summary": latest_summary,
        "quality_control": quality_control,
        "fshd": fshd_payload,
    }
    result.update(legacy)
    return result
