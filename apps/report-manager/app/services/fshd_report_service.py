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
        ("pulmonary ventilation", 5),
        ("ventilation", 3),
    ],
    "diaphragm_ultrasound": [
        ("膈肌", 6),
        ("qb", 1),
        ("db", 1),
        ("vs", 1),
        ("ee", 1),
        ("ei", 1),
        ("di", 1),
        ("diaphragm", 4),
    ],
    "ecg": [
        ("心电图", 5),
        ("qrs", 4),
        ("qtc", 4),
        ("pr", 3),
        ("窦性心律", 4),
        ("束支传导阻滞", 4),
        ("ecg", 5),
    ],
    "echocardiography": [
        ("超声心动图", 6),
        ("心脏超声", 5),
        ("lvef", 5),
        ("射血分数", 4),
        ("fs", 4),
        ("心动过缓", 3),
        ("tdi", 3),
        ("echocardiography", 5),
    ],
    "biochemistry": [
        ("生化", 4),
        ("常规生化", 5),
        ("alt", 3),
        ("ast", 3),
        ("肌酸激酶", 3),
        ("ckmb", 3),
        ("生化全套", 6),
        ("总胆红素", 4),
        ("ggt", 3),
        ("alp", 3),
        ("胆固醇", 3),
        ("甘油三酯", 3),
        ("il-6", 4),
        ("il6", 4),
        ("routine biochemistry", 5),
    ],
    "muscle_enzyme": [
        ("肌酶", 6),
        ("肌酸激酶", 5),
        ("ck", 5),
        ("ldh", 4),
        ("肌红蛋白", 4),
        ("ckmb", 4),
        ("myo", 3),
        ("mb", 2),
    ],
    "blood_routine": [
        ("血常规", 6),
        ("wbc", 4),
        ("hgb", 4),
        ("plt", 4),
        ("红细胞", 2),
        ("白细胞", 2),
        ("blood routine", 6),
        ("mcv", 3),
        ("mchc", 3),
    ],
    "thyroid_function": [
        ("甲功", 6),
        ("甲状腺", 4),
        ("tsh", 5),
        ("ft3", 5),
        ("ft4", 5),
        ("thyroid", 5),
    ],
    "coagulation": [
        ("凝血", 6),
        ("pt", 4),
        ("aptt", 4),
        ("inr", 4),
        ("纤维蛋白原", 4),
        ("d-二聚体", 4),
        ("d二聚体", 4),
        ("d-dimer", 5),
        ("coagulation", 5),
    ],
    "urinalysis": [
        ("尿常规", 6),
        ("尿蛋白", 4),
        ("尿糖", 4),
        ("红细胞/ul", 3),
        ("白细胞/ul", 3),
        ("urinalysis", 6),
        ("尿液分析", 5),
    ],
    "infection_screening": [
        ("感染筛查", 6),
        ("乙肝", 4),
        ("hiv", 4),
        ("梅毒", 4),
        ("hcv", 4),
        ("乙肝两对半", 6),
        ("hbsag", 5),
        ("tppa", 5),
        ("trust", 5),
        ("syphilis", 5),
        ("hbv", 5),
    ],
    "stool_test": [
        ("粪便", 5),
        ("大便", 5),
        ("便常规", 6),
        ("潜血", 4),
        ("幽门螺杆菌", 5),
        ("13c呼气", 6),
        ("dob", 5),
        ("hp", 3),
        ("stool", 4),
    ],
    "abdominal_ultrasound": [
        ("腹部超声", 6),
        ("肝胆胰脾", 4),
        ("腹部彩超", 6),
        ("胆囊", 3),
        ("肝脏", 3),
        ("胰腺", 3),
        ("脾脏", 3),
        ("腹膜后", 3),
        ("abdomen", 4),
    ],
}

#: WHAT A DOCUMENT *IS*, AS OPPOSED TO WHAT IT TALKS ABOUT.
#:
#: `REPORT_TYPE_RULES` above scores VOCABULARY, and for `genetic_report`
#: that is the wrong measure in the one direction that matters. A 门诊
#: 病历摘要 that quotes the patient's genetic result contains every word
#: the genetics rules look for — measured on a real one: genetic_report
#: 18 (基因检测 4 + fshd1 5 + d4z4 5 + 4qa 4) against medical_summary 16 —
#: so the clinic letter classified as the laboratory's own report, and
#: the API-side gate that decides whether a genetics cell may be GRADED
#: asked that classification and got 「yes」. The transcribed count was
#: then graded on the FSHD1 boundary and the transcribed haplotype
#: called permissive, in both redaction modes, with the citation chip
#: the patient taps calling the clinic letter 基因检测报告.
#:
#: The failure is self-reinforcing: the MORE of the result a 病历摘要
#: quotes, the more certainly it flips — so the documents this rule
#: exists to exclude are exactly the ones that trip it.
#:
#: A report is identified by the sections it HAS. A clinical narrative
#: has 主诉 / 现病史 / 既往史 / 查体 because of what it is, and no
#: genetics laboratory prints any of them — which makes their presence
#: decisive on its own rather than something to weigh against the
#: 检测项目 / 检测方法 / 送检单位 / 报告医师 a report shows. This is not a
#: vocabulary: adding an FSHD term to it would put the old bug back.
#:
#: AND NOT A SIGNATURE, A TIMESTAMP OR AN IDENTIFIER. 医师签名 was added
#: here and had to come out: every genetics report is signed, so one
#: extra line 「医师签名：王医师」 on an otherwise unchanged Southern blot
#: flipped it from 基因确诊 to self_reported and relabelled it 病历摘要 on
#: the citation chip the patient taps. This file already classifies that
#: string correctly, in `_BLOCK_STOP_MARKERS`, under the note that
#: signature blocks are never part of a clinical conclusion. THE TEST
#: FOR AN ENTRY IS 「no genetics laboratory prints this」, and a single
#: hit is disqualifying on its own precisely because it is supposed to
#: be impossible on a report — checked by execution against a real
#: Southern blot, a methylation report and a WES report, on which the
#: seventeen entries below score zero and 医师签名 scored three.
#:
#: The API mirrors this list as CLINICAL_NARRATIVE_MARKERS in
#: apps/api/src/modules/patient-profile/genetic-evidence.ts, and the
#: mobile bundle carries a third copy, because a classifier change does
#: not reclassify a stored row and both of those have to hold the same
#: line against the ones already on disk. IF THIS MOVES THEY MOVE.
MEDICAL_SUMMARY_STRUCTURE_MARKERS: Tuple[str, ...] = (
    "病历摘要",
    "门诊病历",
    "住院病历",
    "出院小结",
    "住院小结",
    "出院记录",
    "入院记录",
    "病程记录",
    "主诉",
    "现病史",
    "既往史",
    "个人史",
    "婚育史",
    "查体",
    "体格检查",
    "专科检查",
    "诊疗经过",
)

CRITICAL_FIELDS: Dict[str, List[str]] = {
    "genetic_report": ["diagnosis_type", "d4z4_repeat_pathogenic"],
    "medical_summary": ["onset_age", "progression_node"],
    "physical_exam": ["mrc_score"],
    "muscle_mri": ["muscle_name", "fatty_infiltration"],
    "pulmonary_function": ["fvc", "fvc_pred_pct"],
    "diaphragm_ultrasound": ["diaphragm_motion_summary"],
    "ecg": ["ecg_summary", "heart_rate"],
    "echocardiography": ["lvef", "echo_summary"],
    "biochemistry": ["alt", "ast", "creatinine"],
    "muscle_enzyme": ["mb"],
    "blood_routine": ["wbc", "hgb", "plt"],
    "thyroid_function": ["ft3", "ft4", "tsh"],
    "coagulation": ["pt", "aptt"],
    "urinalysis": ["urine_protein", "urine_occult_blood"],
    "infection_screening": ["hbsag", "hiv_ab"],
    "stool_test": ["stool_occult_blood"],
    "abdominal_ultrasound": ["abdominal_ultrasound_impression"],
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
    # `genetic_positive` / `geneticPositive` are deliberately absent —
    # every other key here names a cell a laboratory printed. See the
    # note in `_extract_genetic` where the derivation was deleted.
    "haplotype": "haplotype",
    "ecori_fragment_kb": "ecoriFragmentKb",
    "d4z4_repeat_pathogenic": "d4z4RepeatPathogenic",
    "d4z4_repeat_other": "d4z4RepeatOther",
    "genetic_test_method": "geneticTestMethod",
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
    "wbc": "wbc",
    "neut_pct": "neutPct",
    "neut_abs": "neutAbs",
    "lymph_pct": "lymphPct",
    "lymph_abs": "lymphAbs",
    "mono_pct": "monoPct",
    "mono_abs": "monoAbs",
    "eos_pct": "eosPct",
    "eos_abs": "eosAbs",
    "baso_pct": "basoPct",
    "baso_abs": "basoAbs",
    "rbc": "rbc",
    "hgb": "hgb",
    "hct": "hct",
    "mcv": "mcv",
    "mch": "mch",
    "mchc": "mchc",
    "rdw_sd": "rdwSd",
    "rdw_cv": "rdwCv",
    "plt": "plt",
    "mpv": "mpv",
    "pct": "pct",
    "pdw": "pdw",
    "plcr": "plcr",
    "nrbc": "nrbc",
    "ft3": "ft3",
    "ft4": "ft4",
    "tsh": "tsh",
    "pt": "pt",
    "inr": "inr",
    "aptt": "aptt",
    "fibrinogen": "fibrinogen",
    "tt": "tt",
    "d_dimer": "dDimer",
    "tbil": "tbil",
    "dbil": "dbil",
    "ibil": "ibil",
    "tp": "tp",
    "alb": "alb",
    "globulin": "globulin",
    "a_g_ratio": "aGRatio",
    "alp": "alp",
    "ggt": "ggt",
    "urea": "urea",
    "bun": "bun",
    "glucose": "glucose",
    "cholesterol": "cholesterol",
    "triglyceride": "triglyceride",
    "hdl_c": "hdlC",
    "ldl_c": "ldlC",
    "vldl_c": "vldlC",
    "apo_a1": "apoA1",
    "apo_b": "apoB",
    "lp_a": "lpA",
    "phosphorus": "phosphorus",
    "magnesium": "magnesium",
    "co2cp": "co2cp",
    "potassium": "potassium",
    "sodium": "sodium",
    "chloride": "chloride",
    "calcium": "calcium",
    "il6": "il6",
    "urine_color": "urineColor",
    "urine_clarity": "urineClarity",
    "urine_glucose": "urineGlucose",
    "urine_ketone": "urineKetone",
    "urine_bilirubin": "urineBilirubin",
    "urine_specific_gravity": "urineSpecificGravity",
    "urine_ph": "urinePh",
    "urine_protein": "urineProtein",
    "urine_nitrite": "urineNitrite",
    "urine_occult_blood": "urineOccultBlood",
    "urine_leukocyte": "urineLeukocyte",
    "urine_leukocyte_esterase": "urineLeukocyteEsterase",
    "urine_urobilinogen": "urineUrobilinogen",
    "urine_rbc": "urineRbc",
    "urine_wbc": "urineWbc",
    "urine_bacteria": "urineBacteria",
    "urine_epithelial_cells": "urineEpithelialCells",
    "urine_mucus": "urineMucus",
    "hbsag": "hbsAg",
    "anti_hbs": "antiHbs",
    "hbeag": "hbeAg",
    "anti_hbe": "antiHbe",
    "anti_hbc": "antiHbc",
    "hiv_ab": "hivAb",
    "anti_hcv": "antiHcv",
    "tppa": "tppa",
    "trust_ab": "trustAb",
    "trust_titer": "trustTiter",
    "stool_color": "stoolColor",
    "stool_consistency": "stoolConsistency",
    "stool_blood": "stoolBlood",
    "stool_mucus": "stoolMucus",
    "stool_rbc": "stoolRbc",
    "stool_wbc": "stoolWbc",
    "stool_fat_globules": "stoolFatGlobules",
    "stool_occult_blood": "stoolOccultBlood",
    "hp_dob": "hpDob",
    "hp_result": "hpResult",
    "abdominal_ultrasound_finding": "abdominalUltrasoundFinding",
    "abdominal_ultrasound_impression": "abdominalUltrasoundImpression",
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


def _build_line_windows(lines: List[str], max_window: int = 2) -> List[str]:
    windows: List[str] = list(lines)
    for index in range(len(lines)):
        merged = lines[index]
        for width in range(1, max_window):
            if index + width >= len(lines):
                break
            merged = f"{merged}{lines[index + width]}"
            windows.append(merged)
    return windows


def _extract_sentences(text: str) -> List[str]:
    chunks = re.split(r"[\n.;。；]+", _normalize_text(text))
    return [chunk.strip() for chunk in chunks if chunk.strip()]


def _exact_float(value: Any) -> Optional[float]:
    """`value` as a number only when the WHOLE cell is one.

    `_safe_float` searches for a number anywhere in the string, which is
    what a cell like 「6.69 mmol/L」 needs and exactly wrong for a cell
    that is not a measurement: handed the stated interval 「1-10」 it
    answers 1.0. That 1 was reaching `observations[].result.value_num`
    and `latest_summary.by_analyte` — the two channels the interval fix
    did not cover — and 1 is inside the 1–4 window that gates a
    recommendation. Used where a value is being TYPED as a number rather
    than parsed out of a printed cell.
    """
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not re.fullmatch(r"[+-]?\d+(?:\.\d+)?", text):
        return None
    try:
        return float(text)
    except ValueError:
        return None


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


#: Words that, standing alone between a cell label and a number, mean
#: the label is naming the ASSAY rather than labelling a result.
#: 甲基化分析 is the standard Chinese name of the FSHD2 test, so
#: 「检测项目: FSHD 甲基化分析」 is a 检测项目 line and not a methylation
#: reading — see `_find_adjacent_regex`.
_METHOD_GAP_WORDS = ("分析", "检测", "检验", "测序", "方法", "项目", "技术", "平台", "试验")

#: What a gap may contain and still be only whitespace and punctuation.
_GAP_FILLER = re.compile(r"[\s,、;()\[\]/·．.-]+")

#: A separator that marks what follows as this label's VALUE.
#: `_normalize_text` has already folded 「：」 to 「:」 by the time any
#: pattern runs.
_GAP_VALUE_SEPARATORS = (":", "=")


def _gap_names_a_method(gap: str) -> bool:
    """Does the text between a label and a number name the assay?

    「甲基化分析 4qA」 — the gap is 分析, the number belongs to the
    haplotype token, and the cell has stated nothing. 「甲基化分析: 35%」
    is the same words with a colon, and that IS the result row: the
    assay name is doing duty as the row label. So a value separator in
    the gap settles it, and only a gap that is nothing but method words
    is refused.
    """
    if any(separator in gap for separator in _GAP_VALUE_SEPARATORS):
        return False
    stripped = _GAP_FILLER.sub("", gap)
    if not stripped:
        return False
    return bool(re.fullmatch(f"(?:{'|'.join(_METHOD_GAP_WORDS)})+", stripped))


#: WHICH MEASUREMENT A WORD IN THE GAP NAMES.
#:
#: One analyte per key, the words a laboratory writes for it per value.
#: A gap that names an analyte OTHER than the one the pattern is reading
#: is not a label-to-value gap however it is punctuated — see
#: `_gap_names_another_analyte`.
#:
#: THE CLASS THIS TABLE CLOSES: a cell label that is a PREFIX of another
#: cell's name. 「D4Z4」 is the label of the repeat count and also the
#: opening of 「D4Z4甲基化」 and 「D4Z4 EcoRI 片段长度」, so the repeat
#: count's own last-resort pattern reaches into both of those rows and
#: reports whatever number it finds as a count. Every FSHD genetics cell
#: in this file was walked for the same shape: 甲基化 opens 甲基化水平
#: (same analyte, so the fraction spelling still reads), EcoRI and
#: 片段长度 both open only length rows, and 重复数 opens nothing else.
_ANALYTE_GAP_WORDS: Dict[str, Tuple[str, ...]] = {
    "repeat_count": ("重复单元", "重复数", "重复拷贝", "repeat", "ru数"),
    "methylation": ("甲基化", "甲基", "methylation"),
    "fragment_length": ("片段", "长度", "大小", "fragment", "size", "kb"),
}


def _gap_names_another_analyte(gap: str, analyte: Optional[str]) -> bool:
    """Does the gap name a DIFFERENT measurement than the one being read?

    A gap naming another analyte is not a label separator however many
    colons it has, and the colon is the whole reason this exists
    separately from `_gap_names_a_method`: that one treats a value
    separator as settling the question, because 「甲基化分析: 35%」 really
    is the methylation result row with the assay name doing duty as the
    label. 「D4Z4甲基化: 35%」 has the same shape and is NOT the repeat
    count's row — it is the methylation row, whose label merely starts
    with the repeat count's label.

    So the last-resort `D4Z4(?P<gap>[^\\d\\n]{0,16})(?P<value>\\d+)`
    accepted 「D4Z4甲基化: 35%」 at confidence 0.97, the confidence of a
    cell we actually read, and the platform reported a laboratory count
    of 35 to a patient whose report states no count at all — while the
    same cell was ALSO read correctly as `methylation_value`, so one
    methylation reading became two answers about two different
    measurements. The fraction spelling 「D4Z4 甲基化水平：0.35」 gave
    `d4z4_repeat_pathogenic` = 0, and the passport then told the patient
    the laboratory had printed a count of zero, with 报告读取 beside it.

    Refusing the match rather than refusing the VALUE, because
    `_find_adjacent_regex` goes on to the next candidate: a report that
    prints a methylation row above a genuine count still reads the
    count. It also keeps the `length_in_kb` refusal in `_extract_genetic`
    live for the spelling this cannot see — 「D4Z4: 38 kb」 has a gap of
    just 「: 」 and is caught there, by the unit AFTER the number.
    """
    if not analyte:
        return False
    return any(
        word in gap.lower()
        for name, words in _ANALYTE_GAP_WORDS.items()
        if name != analyte
        for word in words
    )


def _find_adjacent_regex(
    text: str,
    patterns: Iterable[str],
    flags: int = re.IGNORECASE,
    analyte: Optional[str] = None,
) -> Tuple[Optional[re.Match], Optional[str]]:
    """`_find_regex`, for patterns that carry a `(?P<gap>…)` group.

    A NUMBER BELONGS TO THE LABEL NEXT TO IT, NOT TO THE NEAREST ONE.
    Every cell pattern in `_extract_genetic` used to be written
    `标签[^\\d]{0,N}(\\d+)`, and `[^\\d]` matches newlines — so a label on
    the 检测项目 line reached down into whatever line came next. Two of
    those were live:

      - `甲基化[^\\d]{0,12}` over a report whose 检测项目 line reads
        「FSHD 甲基化分析」 and whose next line reads 「单倍型: 4qA」
        captured 4 out of the haplotype token, and because the first
        match wins, the laboratory's real 甲基化 35% further down was
        never reached. In precise mode that 4 is what the assistant was
        handed; in strict mode it is what `numericValuesWithheld`
        counted.
      - `D4Z4[^\\d]{0,16}(\\d+)` over 「检测项目: D4Z4 重复单元数检测」
        above the same 「单倍型: 4qA」 reported a repeat count of 4 — a
        confirmed FSHD1-range count read out of an allele name, at
        confidence 0.97, while the report's own count sat unread below
        it.

    So the gap may not cross a line, a gap that is only the name of the
    method is not a label-to-value gap at all, and — `analyte` — a gap
    that names a DIFFERENT measurement belongs to that measurement's row
    rather than to this one. Where every candidate fails those tests the
    answer is no reading, which is the honest one: the cell this platform
    could not locate is a cell it has not read.

    `analyte` names what the patterns read, as a key of
    `_ANALYTE_GAP_WORDS`. Left unset the third test does not run, which
    is right for the callers outside `_extract_genetic` whose labels
    prefix nothing.
    """
    for pattern in patterns:
        for match in re.finditer(pattern, text, flags):
            gap = match.groupdict().get("gap") or ""
            if _gap_names_a_method(gap):
                continue
            if _gap_names_another_analyte(gap, analyte):
                continue
            return match, pattern
    return None, None


def _find_line_regex(
    lines: Iterable[str], patterns: Iterable[str], flags: int = re.IGNORECASE
) -> Tuple[Optional[re.Match], Optional[str]]:
    for line in lines:
        match, pattern = _find_regex(line, patterns, flags)
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


def _extract_named_text(text: str, patterns: Iterable[str]) -> Optional[str]:
    match, _ = _find_regex(text, patterns)
    if not match:
        return None
    group_index = 1 if match.lastindex else 0
    value = match.group(group_index)
    return value.strip() if isinstance(value, str) else None


def _normalize_qualitative_value(value: str) -> str:
    normalized = value.strip().replace("（", "(").replace("）", ")")
    normalized = normalized.replace(" ", "")
    mapping = {
        "(-)": "阴性(-)",
        "(+)": "阳性(+)",
        "阴性-": "阴性(-)",
        "阳性+": "阳性(+)",
    }
    return mapping.get(normalized, normalized)


def _panel_source_line(lines: List[str], keywords: Iterable[str], fallback: str) -> str:
    line = _find_best_line(lines, keywords)
    return line or fallback


def _append_panel_number(
    fields: List[Dict[str, Any]],
    panel: Dict[str, Any],
    *,
    field_name: str,
    raw_value: str,
    normalized_value: Optional[float],
    unit: Optional[str],
    source_text: str,
    confidence: float = 0.93,
) -> None:
    panel[field_name] = normalized_value if normalized_value is not None else raw_value
    _append_field(
        fields,
        _build_field(
            field_name,
            raw_value,
            normalized_value=normalized_value,
            unit=unit,
            source_text=source_text,
            confidence=confidence,
        ),
    )


def _append_panel_text(
    fields: List[Dict[str, Any]],
    panel: Dict[str, Any],
    *,
    field_name: str,
    raw_value: str,
    source_text: str,
    confidence: float = 0.88,
) -> None:
    panel[field_name] = raw_value
    _append_field(
        fields,
        _build_field(
            field_name,
            raw_value,
            source_text=source_text,
            confidence=confidence,
        ),
    )


def _panel_haystacks(text: str, lines: List[str]) -> List[str]:
    """Where a panel pattern may look for `分析物 … 结果`.

    The whole text first, so a report that keeps a row on one line keeps
    behaving exactly as before. Then two-line windows, because a *table*
    does not survive OCR as rows.

    PaddleOCR detects text boxes, and every cell of a lab table is its
    own box — so a row that reads

        抗梅毒螺旋体抗体(TPPA)   阴性(-)   阴性   凝集法

    arrives as four separate lines. Every panel pattern in this module
    is written `分析物[^\\n]{0,24}(结果)`, which cannot cross a newline,
    so the analyte matched and the result never did. The report was
    classified `infection_screening` at 0.99 confidence off the same
    text, and still produced `field_count: 0` — a patient's syphilis
    screening summarised as「具体结果：未提供」with the answer sitting
    one line below the question.

    The window is deliberately two lines wide and joined without a
    separator: it reunites a cell with the one that follows it and
    nothing further, so a miss stays a miss rather than pairing one
    analyte's name with another analyte's result.

    THAT BOUND ONLY HOLDS IF THE PATTERNS REALLY CANNOT CROSS A NEWLINE,
    AND FOR MOST OF THEM IT DID NOT. The paragraph above says every
    pattern is written `[^\\n]{0,24}`; in fact most were written
    `[^\\d]{0,16}` (and `[^\\d-]`, `[^0-5]`, `[^\\u4e00-…]`), and a
    newline is not a digit — so on the whole-text haystack those gaps
    reached past the end of their own line and picked up whatever number
    came next, with no two-line ceiling at all. That is how a 甲基化 cell
    read 4 out of the 单倍型: 4qA line below it, and how a D4Z4 cell read
    a repeat count out of the same token; see `_find_adjacent_regex`.
    Every gap class in this module now excludes `\\n`, so crossing a line
    happens only through the bounded windows, which is what this
    docstring always claimed. Do not write a new gap class without it.
    """
    return [text, *_build_line_windows(lines, max_window=2)]


def _extract_numeric_panel(
    text: str,
    lines: List[str],
    fields: List[Dict[str, Any]],
    panel: Dict[str, Any],
    definitions: Dict[str, Dict[str, Any]],
    *,
    confidence: float = 0.93,
) -> None:
    haystacks = _panel_haystacks(text, lines)
    for field_name, meta in definitions.items():
        raw_value = normalized_value = unit = None
        for haystack in haystacks:
            raw_value, normalized_value, unit = _extract_named_number(
                haystack,
                meta.get("patterns", []),
                meta.get("unit"),
            )
            if raw_value is not None:
                break
        if raw_value is None:
            continue
        _append_panel_number(
            fields,
            panel,
            field_name=field_name,
            raw_value=raw_value,
            normalized_value=normalized_value,
            unit=unit,
            source_text=_panel_source_line(lines, meta.get("keywords", []), raw_value),
            confidence=meta.get("confidence", confidence),
        )


def _extract_text_panel(
    text: str,
    lines: List[str],
    fields: List[Dict[str, Any]],
    panel: Dict[str, Any],
    definitions: Dict[str, Dict[str, Any]],
    *,
    confidence: float = 0.88,
) -> None:
    haystacks = _panel_haystacks(text, lines)
    for field_name, meta in definitions.items():
        raw_value = None
        for haystack in haystacks:
            raw_value = _extract_named_text(haystack, meta.get("patterns", []))
            if raw_value is not None:
                break
        if raw_value is None:
            continue
        if meta.get("normalize_qualitative"):
            raw_value = _normalize_qualitative_value(raw_value)
        _append_panel_text(
            fields,
            panel,
            field_name=field_name,
            raw_value=raw_value,
            source_text=_panel_source_line(lines, meta.get("keywords", []), raw_value),
            confidence=meta.get("confidence", confidence),
        )


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


def _structure_markers(normalized: str, markers: Iterable[str]) -> List[str]:
    """Which of `markers` this document's own layout shows.

    `normalized` is `_normalized_search_text` output — already
    lowercased and punctuation-folded, so the Chinese markers match as
    written and the English ones match case-insensitively.
    """
    return [marker for marker in markers if marker.lower() in normalized]


def _classify_report(
    text: str,
    document_type_hint: Optional[str] = None,
    report_name: Optional[str] = None,
) -> Tuple[str, float, List[str]]:
    classification_text = text
    if report_name:
        classification_text = f"{report_name}\n{text}"
    normalized = _normalized_search_text(classification_text)
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

    # `genetic_report` IS DECIDED ON STRUCTURE, NOT ON VOCABULARY.
    #
    # This is the only label in this function that downstream code
    # treats as permission — `isLaboratoryGeneticReport` on the API side
    # asks it before anything may GRADE a genetics cell — so it is the
    # only one where 「contains the words」 is not good enough. A 门诊病历
    # 摘要 that quotes a full genetic result outscores medical_summary on
    # keywords alone (measured: 18 to 16), and the uploader's declared
    # `other` does not outrank the classifier. See
    # MEDICAL_SUMMARY_STRUCTURE_MARKERS.
    #
    # A NARRATIVE SECTION IS DISQUALIFYING ON ITS OWN, rather than being
    # weighed against the laboratory sections. A 病历摘要 with the whole
    # report pasted into it shows MORE 检测项目/检测方法/送检单位/报告医师
    # than 主诉/现病史/查体, and it is still a 病历摘要 — a document that
    # reproduces a report is not the report. No genetics laboratory
    # prints 主诉 or 查体, so their presence is not evidence to be
    # outvoted. Being wrong this way costs a DISPLAY with its origin
    # attached; being wrong the other way costs a laboratory's sentence
    # with no laboratory behind it.
    #
    # A GENETICS REPORT WITH NO RECOGNISABLE STRUCTURE IS STILL
    # PROMOTED. Where neither list hits — an OCR that recovered the
    # result lines and none of the headings — this changes nothing, and
    # deliberately: demoting there would stop `_extract_genetic` running
    # and lose the patient's numbers entirely, and for some patients
    # that is the only copy of the count that exists. The API-side gate
    # is what refuses to grade an unconfirmed document; this one only
    # refuses to CALL it the laboratory's.
    if best_type == "genetic_report":
        narrative = _structure_markers(normalized, MEDICAL_SUMMARY_STRUCTURE_MARKERS)
        if narrative:
            # Always `medical_summary`, never `other`: the structural
            # markers ARE the evidence for the label even when the
            # keyword rules scored nothing, and `medical_summary` is the
            # one branch that still reads the quoted genetic values —
            # see the dispatch in `analyze_fshd_report`. Landing on
            # `other` would drop them.
            best_type = "medical_summary"
            best_score = max(scores.get("medical_summary", 0), 2 * len(narrative))
            confidence = min(0.99, 0.45 + best_score / 18.0)
            reasons["medical_summary"] = reasons.get("medical_summary", []) + [
                f"structure:文档带病历结构{'/'.join(narrative)}，不按基因报告判读"
            ]

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
    search_lines = _build_line_windows(lines)
    patient_name = None
    sex = None
    age = None
    patient_id = None
    visit_id = None
    barcode = None

    name_match, _ = _find_line_regex(
        search_lines,
        [r"(?:姓名|名)[: ]*([\u4e00-\u9fa5A-Za-z·]{2,24})$"],
    )
    if not name_match:
        name_match, _ = _find_regex(text, [r"(?:姓名|名)[: ]*([\u4e00-\u9fa5A-Za-z·]{2,24})"])
    if name_match:
        patient_name = name_match.group(1).strip()

    sex_match, _ = _find_line_regex(search_lines, [r"(?:性别|别)[: ]*(男|女|male|female)$"])
    if not sex_match:
        sex_match, _ = _find_regex(text, [r"(?:性别|别)[: ]*(男|女|male|female)"])
    if sex_match:
        raw_sex = sex_match.group(1).strip().lower()
        sex = "male" if raw_sex in {"男", "male"} else "female" if raw_sex in {"女", "female"} else raw_sex

    age_match, _ = _find_line_regex(search_lines, [r"(?:年龄|龄)[: ]*(\d{1,3})岁?$"])
    if not age_match:
        age_match, _ = _find_regex(text, [r"(?:年龄|龄)[: ]*(\d{1,3})"])
    if age_match:
        age = int(age_match.group(1))

    patient_id_match, _ = _find_regex(text, [r"(\d{17}[\dXx])"])
    if patient_id_match:
        patient_id = patient_id_match.group(1)

    visit_match, _ = _find_line_regex(
        search_lines,
        [r"(?:病历号|门诊号|住院号|就诊号|检查号)[: ]*([A-Za-z0-9-]+)$"],
    )
    if not visit_match:
        visit_match, _ = _find_regex(text, [r"(?:病历号|门诊号|住院号|就诊号|检查号)[: ]*([A-Za-z0-9-]+)"])
    if visit_match:
        visit_id = visit_match.group(1)

    barcode_match, _ = _find_line_regex(
        search_lines,
        [r"(?:样品编号|样本编号|条码号|条形码号|资料编号)[: ]*([A-Za-z0-9-]+)$"],
    )
    if not barcode_match:
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
    search_lines = _build_line_windows(lines)
    facility = None
    department = None
    clinical_diagnosis = None
    report_time = None
    collect_time = None
    request_time = None
    receive_time = None
    specimen = None
    bed_no = None
    ordering_doctor = None

    for line in lines[:8]:
        facility_match = re.search(r"([\u4e00-\u9fa5A-Za-z0-9()（）]+(?:医院|中心|研究所))", line)
        if facility_match:
            facility = facility_match.group(1).strip()
            break
        if "医院" in line or "中心" in line or "研究所" in line:
            facility = line.strip()
            break

    department_match, _ = _find_line_regex(
        search_lines,
        [r"(?:科室|送检科室|申请科室|科别)[: ]*([^\d:：]{2,20})$"],
    )
    if not department_match:
        department_match, _ = _find_regex(text, [r"(?:科室|送检科室|申请科室|科别)[: ]*([^\n]+)"])
    if department_match:
        department = department_match.group(1).strip()

    diagnosis_match, _ = _find_line_regex(search_lines, [r"(?:临床诊断|诊断)[: ]*([^\n]+)$"])
    if not diagnosis_match:
        diagnosis_match, _ = _find_regex(text, [r"(?:临床诊断|诊断)[: ]*([^\n]+)"])
    if diagnosis_match:
        clinical_diagnosis = diagnosis_match.group(1).strip()

    specimen_match, _ = _find_line_regex(
        search_lines,
        [r"(?:标本|样本|检材|本)[: ]*([^\s:：]{1,12})$"],
    )
    if specimen_match:
        specimen = specimen_match.group(1).strip()

    bed_match, _ = _find_line_regex(search_lines, [r"(?:床号|床位)[: ]*([A-Za-z0-9-]+)$"])
    if bed_match:
        bed_no = bed_match.group(1).strip()

    doctor_match, _ = _find_line_regex(
        search_lines,
        [r"(?:送检医生|申请医生|开单医生)[: ]*([^\s/]{2,20})(?:/[A-Za-z0-9-]+)?$"],
    )
    if doctor_match:
        ordering_doctor = doctor_match.group(1).strip()

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

    receive_match, _ = _find_regex(
        text,
        [r"(?:接收时间|签收时间)[: ]*(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:[ T]\d{1,2}:\d{2})?)"],
    )
    if receive_match:
        receive_time = receive_match.group(1)

    return {
        "facility": facility,
        "department": department,
        "bed_no": bed_no,
        "specimen": specimen,
        "ordering_doctor": ordering_doctor,
        "clinical_diagnosis": clinical_diagnosis,
        "request_time": request_time,
        "collect_time": collect_time,
        "receive_time": receive_time,
        "report_time": report_time,
    }


# --------------------------------------------------------------------
# Free-text guards
#
# Two shared mechanisms produced every bad conclusion the user found:
#
#   1. `_extract_block_after_header` captures every line after a header
#      until a stop keyword. Each call site passed its own stop list,
#      each list was incomplete, and a miss means "capture to the end of
#      the document". That is how an ECG summary became the whole report
#      —「…门诊号: 住院号:R000000 … 本报告仅供临床医师结合临床参考」—
#      with an inpatient medical-record number inside a field that the
#      API's prompt allowlist trusts.
#
#   2. `_extract_summary_line` returns the whole line containing a
#      keyword. In a table, the line containing 「膈肌厚度」 is the
#      *column header*, so `diaphragm_thickening_summary` came out as
#      「膈肌厚度(mm)」, and 「印象」 matched the bare header 「印象:」.
#
# The guards below are shared rather than per-extractor, because the
# failure was never specific to one report type.
# --------------------------------------------------------------------

#: Lines that end a captured block no matter which extractor asked.
#: Signature blocks, timestamps, identifiers and the boilerplate
#: disclaimer are never part of a clinical conclusion.
_BLOCK_STOP_MARKERS: Tuple[str, ...] = (
    # Signatures
    "诊断医生", "记录医生", "审核医生", "报告医生", "检查医生", "超声医师",
    "检验者", "核对者", "报告者", "医师签名", "签名",
    # Timestamps
    "检查日期", "打印日期", "报告日期", "报告时间", "检查时间", "采集时间",
    # Identifiers — the reason this list is not optional
    "住院号", "门诊号", "病历号", "条形码", "标本号", "样本号", "检验号",
    "申请单号", "影像号", "检查号", "登记号", "身份证",
    # Demographics. These sit inline in single-line layouts, so they end
    # a value as surely as a signature does — the ECG's own summary ran
    # straight through 「年龄:23」 into the rest of the header.
    "送检医生", "送检科室", "科别", "床别", "床号",
    "年龄", "姓名", "性别", "民族", "婚否",
    # Boilerplate
    "本报告", "仅供", "不作诊断", "结果仅对",
)

#: A signature: two to four CJK characters alone on a line, no digits,
#: no punctuation. 「钱医」「李晶」「孙医」 all match; so would a short
#: clinical phrase, which is why the clinical vocabulary below is
#: excluded first.
_BARE_NAME = re.compile(r"^[\u4e00-\u9fa5]{2,4}$")

#: Short clinical phrases that look like a name but are not. Anything
#: here is kept even when it stands alone on a line.
_NOT_A_NAME = frozenset({
    "未见异常", "大致正常", "心律不齐", "窦性心律", "脂肪浸润", "肌肉萎缩",
    "肌萎缩", "水肿", "正常", "异常", "阴性", "阳性", "轻度", "中度", "重度",
    "无异常", "未见", "请结合临床",
})


#: Headers that open a report's boilerplate tail. Everything from here
#: on is legal text about the *method*, not findings about the patient.
#:
#: This is the structural version of the phrase list below, and it is
#: the one that actually works. A genetic report's caveats run to a
#: dozen numbered items full of clinical vocabulary — 「解读偏差」,
#: 「医生诊断」, 「基因检测结果为阴性」 — so any keyword search over the
#: whole page lands in them. Cutting the tail off first means the search
#: only ever sees the part of the report that is about this patient.
_DISCLAIMER_SECTION_HEADERS: Tuple[str, ...] = (
    "检测局限", "局限性", "方法学局限", "附录信息", "附录",
    "免责声明", "声明", "注意事项", "参考文献", "术语说明",
)


def _before_disclaimer_section(lines: List[str]) -> List[str]:
    """Drop the boilerplate tail so a conclusion search cannot reach it."""
    for index, line in enumerate(lines):
        stripped = line.strip()
        # A header is short. The same words inside a sentence are not a
        # section break.
        if len(stripped) <= 16 and any(h in stripped for h in _DISCLAIMER_SECTION_HEADERS):
            return lines[:index]
    return lines


#: Boilerplate. A report's *conclusion* never comes from its disclaimer,
#: and the two look alike to a keyword search: the limitations section of
#: a genetic report says 「仍建议以医生诊断…为准」, which matches 「诊断」.
#:
#: Observed on a real FSHD1-positive report — D4Z4 = 3, haplotype 4qA —
#: whose `interpretation_summary` came out as a mid-sentence fragment of
#: caveat #5:「检者发病的主导原因.即使基因检测结果为阴性,仍建议以医生
#: 诊断…」. A patient reading their own positive result was shown a
#: sentence about what a *negative* result would mean.
_DISCLAIMER_MARKERS: Tuple[str, ...] = (
    "仅供参考", "仅供临床", "不作诊断", "不能完全排除", "不能排除",
    "受限于", "局限性", "免责", "本报告", "结果仅对", "以医生诊断",
    "建议以医生", "检测技术", "若受检者", "结果注释", "解释权",
    "并不能", "复核", "如有疑问", "有疑问请",
)


def _is_disclaimer(text: str) -> bool:
    return any(marker in text for marker in _DISCLAIMER_MARKERS)


def _looks_like_signature(text: str) -> bool:
    stripped = text.strip()
    return bool(_BARE_NAME.match(stripped)) and stripped not in _NOT_A_NAME


def _strip_trailing_signature(text: str) -> str:
    """Drop a doctor's name from the tail of a conclusion.

    The signature is usually its own OCR line and gets joined onto the
    conclusion with a space —「…请结合临床. 钱医」. It is the reporting
    physician's name: a third party's identifier, in a field that is
    shown to the patient and sent to the model.
    """
    parts = text.strip().split()
    while parts and _looks_like_signature(parts[-1]):
        parts.pop()
    return " ".join(parts).strip()


#: Ceiling on any free-text field. A clinical impression is one or two
#: sentences; anything longer means the extractor ran past its block,
#: and a length cap is the backstop for a stop-marker list that will
#: always be incomplete.
_FREE_TEXT_MAX = 200


#: Markers that carry a value with them —「年龄:23」,「住院号:R000000」.
#: These are excised as a pair; the text around them survives.
_INLINE_PAIR_MARKERS: Tuple[str, ...] = (
    "住院号", "门诊号", "病历号", "就诊号", "登记号", "标本号", "样本号",
    "检验号", "申请单号", "影像号", "检查号", "条形码", "身份证",
    "年龄", "姓名", "性别", "民族", "婚否", "科别", "床别", "床号",
    "送检医生", "送检科室", "检查日期", "打印日期", "报告日期",
    "报告时间", "检查时间", "采集时间",
)

#: Markers that run to the end of the text once they start — a
#: signature block or a disclaimer has nothing after it worth keeping.
_TAIL_MARKERS: Tuple[str, ...] = (
    "诊断医生", "记录医生", "审核医生", "报告医生", "检查医生", "超声医师",
    "检验者", "核对者", "报告者", "医师签名", "签名",
    "本报告", "仅供", "不作诊断", "结果仅对",
)


def _strip_inline_metadata(text: str) -> str:
    """Remove identifier/demographic pairs; truncate at a tail marker.

    Truncating at the *first* marker was the first attempt, and it threw
    away findings: this ECG's OCR merged two columns into one line, so
    「不完全性右束支传导阻滞」— a real diagnosis — sat after 「年龄:23」
    and went with it. A label carrying a value is a pair that can be
    lifted out; only signatures and disclaimers genuinely end the
    useful text.
    """
    for marker in _TAIL_MARKERS:
        index = text.find(marker)
        if index > 0:
            text = text[:index]

    for marker in _INLINE_PAIR_MARKERS:
        # `label: value` where the value runs to the next whitespace.
        text = re.sub(rf"{marker}\s*[:：]\s*\S*", " ", text)

    return re.sub(r"\s{2,}", " ", text).strip(" ,，;；")


def _clean_free_text(value: Optional[str]) -> Optional[str]:
    """Every free-text conclusion goes through here before becoming a field."""
    if not value:
        return None
    text = _strip_trailing_signature(_strip_inline_metadata(value))
    if not text:
        return None
    if len(text) > _FREE_TEXT_MAX:
        text = text[:_FREE_TEXT_MAX].rstrip() + "…"
    return text or None


#: A label with a colon and nothing after it: 「印象:」,「检查提示：」.
_LABEL_ONLY = re.compile(r"^[\u4e00-\u9fa5A-Za-z/]{1,12}\s*[:：]\s*$")

#: Lines that describe the examination rather than its result.
_EXAM_METADATA_PREFIXES: Tuple[str, ...] = (
    "检查部位", "检查项目", "检查方法", "检查设备", "检查途径",
    "送检项目", "标本类型", "仪器型号", "检验目的",
)

#: A short label carrying a *unit*: 「膈肌厚度(mm)」,「LVEF(%)」. The
#: parenthetical must be unit-shaped — latin letters, digits, symbols —
#: because a parenthetical in Chinese is content, not a unit.
_LABEL_WITH_UNIT = re.compile(
    r"^[\u4e00-\u9fa5A-Za-z/]{1,10}\s*[(（][A-Za-z%/·°μ\d.\s^-]{1,10}[)）]\s*$"
)


def _is_header_only(line: str) -> bool:
    """Is this line a column header or a section label rather than a value?

    Deliberately narrow. An earlier, looser version treated *any*
    「词语(括号)」 as a header, which threw away real conclusions —
    「房室大小及LVEF值正常范围(检查时心动过缓)」 is a finding, not a
    header, and it has exactly that shape. The distinction that holds is
    what is inside the brackets: a unit is latin/symbolic, a clarifying
    remark is Chinese.
    """
    stripped = line.strip()
    if any(stripped.startswith(prefix) for prefix in _EXAM_METADATA_PREFIXES):
        return True
    return bool(_LABEL_ONLY.match(stripped) or _LABEL_WITH_UNIT.match(stripped))


def _extract_summary_line(
    lines: List[str],
    keywords: Iterable[str],
    *,
    require_digit: bool = False,
) -> Optional[str]:
    """First line carrying one of `keywords` that actually says something.

    `_find_best_line` returns the whole matched line, and in a table the
    line carrying 「膈肌厚度」 is the column header — so this used to
    answer 「膈肌厚度(mm)」 when asked for a thickening summary, and
    「印象:」 when asked for an impression. A header is a label with no
    value; skip it and keep looking.

    `require_digit` is for fields that are measurements wearing a
    summary's name: 膈肌增厚 is a thickness, so a line with no figure in
    it is the wrong line however well its keywords match. Without it,
    「增厚率」matched the *conclusion* sentence and the 膈肌增厚 card
    showed the same text as 膈肌运动.
    """
    lowered_keywords = [keyword.lower() for keyword in keywords]
    for line in lines:
        stripped = line.strip()
        if not stripped or _is_header_only(stripped):
            continue
        if require_digit and not re.search(r"\d", stripped):
            continue
        if _is_disclaimer(stripped):
            continue
        lowered = stripped.lower()
        if any(keyword in lowered for keyword in lowered_keywords):
            return _clean_free_text(stripped)
    return None


def _extract_block_after_header(
    lines: List[str],
    start_keywords: Iterable[str],
    stop_keywords: Iterable[str],
) -> Optional[str]:
    capture = False
    parts: List[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if not capture and any(keyword in stripped for keyword in start_keywords):
            capture = True
            inline = re.split(r"[:：]", stripped, maxsplit=1)
            if len(inline) == 2 and inline[1].strip():
                parts.append(inline[1].strip())
            continue
        if capture:
            # The caller's stop list is additive to the shared one. Every
            # call site used to pass its own, every list was missing
            # something, and a miss means "run to the end of the
            # document" — which is exactly what happened to the ECG.
            if any(keyword in stripped for keyword in stop_keywords):
                break
            if any(marker in stripped for marker in _BLOCK_STOP_MARKERS):
                break
            if _is_disclaimer(stripped):
                break
            if _looks_like_signature(stripped):
                break
            parts.append(stripped)
    joined = " ".join(parts).strip()
    return _clean_free_text(joined)


#: Words that mark the sentence a patient is actually looking for.
_FINDING_MARKERS: Tuple[str, ...] = (
    "检出", "符合", "提示", "诊断为", "考虑为", "支持", "阳性", "阴性",
    "FSHD", "肌营养不良", "重复单元", "缩短",
)


def _pick_finding_sentence(block: Optional[str]) -> Optional[str]:
    """Reduce a results section to the sentence that states the result.

    The 检测结果 section of a genetic report opens with a paragraph of
    method — sample prep, platform, pipeline — before it says what was
    found. Truncated to fit, that paragraph is all a patient sees, and
    it tells them nothing about themselves. Prefer the sentence naming
    the finding; fall back to the whole block when none stands out.
    """
    if not block:
        return None
    sentences = [part.strip() for part in re.split(r"[。.;；\n]", block) if part.strip()]
    hits = [s for s in sentences if any(m in s for m in _FINDING_MARKERS)]
    if not hits:
        return block
    return _clean_free_text("。".join(hits))


#: How the D4Z4 array was measured, by explicit method name.
#:
#: This exists because of one sentence in the FSHD genetic-diagnostics
#: best practice guideline (Giardina et al., Clin Genet 2024;106(1):13-26,
#: doi:10.1111/cge.14533): the size and haplotype of the D4Z4 repeat
#: array 「cannot be determined by short read WES- or WGS-like
#: technologies」. A patient holding a negative whole-exome report does
#: not have a negative answer — they have the wrong test, and no screen
#: can tell them so unless something records which test it was.
#:
#: Patterns, not substrings, so that short Latin abbreviations (WES,
#: WGS, OGM, PFGE) need a word boundary. A false positive here is the
#: expensive direction: it is what would tell somebody their real
#: Southern blot was inapplicable.
_GENETIC_METHOD_PATTERNS: Dict[str, Tuple[str, ...]] = {
    "southern_blot": (
        r"southern\s*(?:blot|blotting|印迹|杂交)",
        r"\bp13\s*e\s*-?\s*11\b",
        r"\becor\s*[i1]\b",
        r"\bbln\s*[i1]\b",
        r"脉冲场(?:凝胶)?电泳",
        r"\bpfge\b",
    ),
    "optical_genome_mapping": (
        r"optical\s+genome\s+mapping",
        r"光学基因组图谱",
        r"光学图谱",
        r"\bbionano\b",
        r"\bogm\b",
    ),
    "molecular_combing": (
        r"molecular\s+combing",
        r"分子梳",
    ),
    "short_read_sequencing": (
        r"全外显子",
        r"whole\s+exome",
        r"exome\s+sequencing",
        r"\bwes\b",
        r"全基因组(?:测序|重测序)",
        r"whole\s+genome\s+sequencing",
        r"\bwgs\b",
        r"二代测序",
        r"高通量测序",
        r"next[-\s]generation\s+sequencing",
        r"\bngs\b",
        r"基因\s*panel",
        r"panel\s*测序",
        r"多基因(?:检测|包|panel)",
        r"捕获测序",
    ),
}


def _detect_genetic_method(body_lines: List[str]) -> Optional[str]:
    """Which family of methods this report says it used.

    Reads the report BODY — `_before_disclaimer_section` has already cut
    the boilerplate tail off — and that is the whole trick. A whole-exome
    report's limitations section routinely explains that the D4Z4 array
    requires Southern blot, and a Southern blot report routinely lists
    sequencing among the alternatives, so a keyword search over the
    entire page labels both of them wrong in the direction that costs a
    patient a second self-funded test.

    Returns the family name when exactly one matched, "ambiguous" when
    more than one did, and None when nothing did. The caller treats the
    last two the same way — as「we do not know」— but they are kept
    distinct so that a report which genuinely names two platforms is
    visible as such rather than looking like an unparsed page.
    """
    haystack = "\n".join(body_lines).lower()
    matched = [
        family
        for family, patterns in _GENETIC_METHOD_PATTERNS.items()
        if any(re.search(pattern, haystack, re.IGNORECASE) for pattern in patterns)
    ]
    if not matched:
        return None
    if len(matched) > 1:
        return "ambiguous"
    return matched[0]


#: Words that make the token beside them a statement about what the
#: laboratory did NOT find.
#:
#: A cell under one of these is not a reading, it is a refusal, and
#: carrying its token forward as though the report had asserted it is
#: how 「D4Z4 未检出3个重复单元」 became a repeat count of 3, 「未检出 4qA
#: 等位基因」 became a permissive haplotype, and 「本次检测不支持 FSHD1」
#: became this patient's diagnosis — each at the same confidence the
#: extractor gives a cell the laboratory did print, and each carried on
#: to the passport, the exports and the registry.
#:
#: MATCHED AGAINST THE ONE LINE THE TOKEN SITS ON, never the whole
#: report. Most genetic reports carry a 「未见其他异常」 or a 「阴性对照」
#: somewhere in them; matching over the whole text would abstain on
#: every genuine result in the file.
_ABSENCE_MARKERS = (
    "未检出",
    "未见",
    "未发现",
    "未检测到",
    "未提示",
    "阴性",
    "不支持",
    "排除",
    "not detected",
    "negative",
)

#: The report naming a type it is asking someone else to confirm.
#: Separate from absence because the wording differs, and because only
#: the graded fields care — a hedged sentence is still DISPLAYED, via
#: `interpretation_summary`; it just does not become a diagnosis.
_HEDGE_MARKERS = (
    "怀疑",
    "疑似",
    "待排",
    "拟诊",
    "不除外",
    "可能为",
    "rule out",
    "suspected",
)

#: A number followed by one of these is a length. Anchored with `\b` so
#: a 「kb」 that opens the next word is not read as this number's unit.
_LENGTH_UNIT_AFTER = re.compile(r"\s*(kb|bp|mb)\b", re.IGNORECASE)


def _line_around(text: str, index: int) -> str:
    """The single line `index` falls on, newline excluded."""
    start = text.rfind("\n", 0, index) + 1
    end = text.find("\n", index)
    return text[start:] if end == -1 else text[start:end]


def _asserts_absence(text: str, match: "re.Match") -> bool:
    """Does the line this match sits on say the thing was NOT found?"""
    line = _line_around(text, match.start()).lower()
    return any(marker in line for marker in _ABSENCE_MARKERS)


def _is_hedged(text: str, match: "re.Match") -> bool:
    """Does the line this match sits on merely suspect the thing?"""
    line = _line_around(text, match.start()).lower()
    return any(marker in line for marker in _HEDGE_MARKERS)


#: The 4q35 allele token, matched on its own and not inside a word.
_HAPLOTYPE_TOKEN = re.compile(r"\b(4qA|4qB)\b", re.IGNORECASE)

#: Labels under which a line is STATING THIS PATIENT'S ALLELE.
_HAPLOTYPE_RESULT_LABELS = (
    "单倍型",
    "haplotype",
    "等位基因",
    "allele",
    "分型",
    "结果",
    "结论",
)

#: Labels under which a line is naming the ASSAY, not this patient's
#: allele — and which OUTRANK the result labels above, because the
#: standard Southern blot 检测方法 line contains both: 「联合 p13E-11
#: 探针，再结合 4qA / 4qB 探针判断单倍型」 names 单倍型 while naming a
#: probe pair. That is the exact wording this platform's own patient
#: copy tells people to ask their laboratory for, so it is on the first
#: page of an ordinary report rather than an edge case.
_HAPLOTYPE_METHOD_LABELS = (
    "探针",
    "probe",
    "p13e-11",
    "p13e11",
    "方法",
    "项目",
    "引物",
    "primer",
    "试剂",
)


def _haplotype_tokens_on(line: str) -> Tuple[List[str], List[str]]:
    """The 4qA / 4qB tokens a line states, split by whether a result
    label introduces them: `(labelled, unlabelled)`.

    A LABEL INTRODUCES THE TOKEN THAT FOLLOWS IT, not the one that
    precedes it. 「附注: 4qA 为允许型单倍型」 is a footnote defining the
    term and it contains 单倍型, so a line-contains test read it as a
    second stated result and withheld the 4qB the report actually
    printed above it. The label sits AFTER the token there and BEFORE it
    on every real result row — 「4q35 单倍型: 4qA」, 「结果示 … 单倍型
    4qA」 — which is the same 「the value belongs to the label next to
    it」 rule `_find_adjacent_regex` applies to the numeric cells.

    Method and probe lines state nothing in either bucket, and neither
    does a line asserting the allele was NOT found.
    """
    lowered = line.lower()
    if any(label in lowered for label in _HAPLOTYPE_METHOD_LABELS):
        return [], []
    if any(marker in lowered for marker in _ABSENCE_MARKERS):
        return [], []
    label_positions = [
        lowered.find(label) for label in _HAPLOTYPE_RESULT_LABELS if label in lowered
    ]
    first_label = min(label_positions) if label_positions else None
    labelled: List[str] = []
    unlabelled: List[str] = []
    for match in _HAPLOTYPE_TOKEN.finditer(line):
        token = match.group(1)[:2].lower() + match.group(1)[2].upper()
        bucket = (
            labelled if first_label is not None and match.start() > first_label else unlabelled
        )
        if token not in bucket:
            bucket.append(token)
    return labelled, unlabelled


def _read_haplotype(lines: List[str]) -> Tuple[Optional[str], Optional[str]]:
    """THE HAPLOTYPE IS WHAT THE RESULT SECTION STATES.

    This was `re.search(r"\\b(4qA|4qB)\\b")` over the whole document —
    the FIRST token anywhere on the page. On a real Southern blot report
    the first occurrence is the 检测方法 line naming the standard probe
    pair, so a report whose RESULT reads 4qB was read as 4qA: FSHD1
    cannot be the mechanism on a 4qB allele, and that misreading turned
    a non-diagnosis into 基因确诊 and 可用于入组.

    IT WAS NOT ENOUGH TO FLAG IT. The old code dropped confidence to
    0.60 on a document naming both tokens and left the value in place,
    and nothing downstream reads confidence: the bridge writes
    `fields.haplotype` unconditionally, `parsePermissiveHaplotype` sees
    one token and returns `true`, and the assistant prompt and the
    patient-facing passport both assert a permissive allele. A flag only
    the parser can see is not a warning, so what is withheld now is the
    VALUE — the platform already renders a missing one as
    `unspecified_haplotype`, which is the honest answer and the one every
    downstream reader already handles. The sentence the report printed
    survives on `interpretation_summary`, which is displayed and never
    graded.

    Two tiers, in this order:

      1. lines that LABEL a result — 单倍型 / 检测结果 / 等位基因. If any
         of them state a token, they decide, and they decide alone.
      2. otherwise any remaining line, because an OCR that recovered the
         result lines and lost their headings is common and dropping the
         allele there loses a real reading.

    A method or probe line is excluded from both tiers, and either tier
    answers only when what it saw is UNANIMOUS. Both tokens stated, or
    nothing stated outside the method line, returns no haplotype rather
    than whichever came first.
    """
    labelled: List[str] = []
    labelled_source: Optional[str] = None
    unlabelled: List[str] = []
    unlabelled_source: Optional[str] = None
    for line in lines:
        on_line_labelled, on_line_unlabelled = _haplotype_tokens_on(line)
        for token in on_line_labelled:
            if token not in labelled:
                labelled.append(token)
        for token in on_line_unlabelled:
            if token not in unlabelled:
                unlabelled.append(token)
        if on_line_labelled and labelled_source is None:
            labelled_source = line.strip()
        if on_line_unlabelled and unlabelled_source is None:
            unlabelled_source = line.strip()
    if labelled:
        return (labelled[0], labelled_source) if len(labelled) == 1 else (None, None)
    if len(unlabelled) == 1:
        return unlabelled[0], unlabelled_source
    return None, None


def _extract_genetic(lines: List[str], fields: List[Dict[str, Any]], findings: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    diagnosis_match, _ = _find_regex(text, [r"\b(FSHD1|FSHD2)\b", r"(FSHD\s*[12])"])
    # NAMING A TYPE IS NOT DIAGNOSING IT. 「本次检测不支持 FSHD1」 and
    # 「临床怀疑 FSHD1，请进一步检查」 both named FSHD1 and both came out
    # as this patient's diagnosis at 0.98 — the value the passport
    # prints, the exports carry, and `applyGeneticReportAutofill` writes
    # into `patient_profiles`. A report that excludes a type, or only
    # suspects one, has not stated one. The sentence itself survives on
    # `interpretation_summary`, which is displayed and not graded.
    diagnosis_type = (
        diagnosis_match.group(1).replace(" ", "")
        if diagnosis_match
        and not _asserts_absence(text, diagnosis_match)
        and not _is_hedged(text, diagnosis_match)
        else None
    )

    # 4qA is the token the whole FSHD1 reading rests on — FSHD1 cannot be
    # the mechanism on a 4qB allele — so it is read off the RESULT, never
    # off the first place the page happens to print it. See
    # `_read_haplotype`.
    haplotype, haplotype_source = _read_haplotype(lines)

    # EVERY NUMERIC CELL BELOW IS READ WITH `_find_adjacent_regex`, which
    # is where the 「a number near the label is the label's number」 bug
    # is fixed for all of them at once. Each pattern names its gap so
    # that helper can judge it; each names its value so the group
    # numbers stay readable now that the gap is a group too.
    ecori_match, _ = _find_adjacent_regex(
        text,
        [
            r"EcoRI(?P<gap>[^\d\n]{0,16})(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>kb|KB)",
            r"片段长度(?P<gap>[^\d\n]{0,16})(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>kb|KB)",
        ],
        analyte="fragment_length",
    )
    ecori_fragment = ecori_match.group("value") if ecori_match else None

    d4z4_pair_match, _ = _find_adjacent_regex(
        text,
        [
            r"D4Z4(?P<gap>[^\d\n]{0,24})(?P<value>\d+)\s*[/／]\s*(?P<other>\d+)",
            r"重复数(?P<gap>[^\d\n]{0,20})(?P<value>\d+)\s*[/／]\s*(?P<other>\d+)",
        ],
        analyte="repeat_count",
    )
    d4z4_pathogenic = d4z4_pair_match.group("value") if d4z4_pair_match else None
    d4z4_other = d4z4_pair_match.group("other") if d4z4_pair_match else None
    d4z4_source_text = d4z4_pair_match.group(0) if d4z4_pair_match else None
    # Whichever pattern won, kept so the cell can be judged below —
    # what is beside the number decides whether it is a count at all.
    d4z4_match = d4z4_pair_match
    # A range is not a count. `D4Z4[^\d]{0,16}(\d+)` matched the first
    # number of 「D4Z4重复单元数: 1-10」 and reported it as 1 — turning a
    # lab's stated uncertainty into a confident single figure, and one
    # inside the 1–4 window that gates the passport's ophthalmology
    # recommendation. Capture the interval instead and leave
    # `normalized_value` empty, so every reader downstream can see that
    # a test was done and that it did not pin the number down.
    d4z4_is_range = False
    if not d4z4_pathogenic:
        d4z4_range_match, _ = _find_adjacent_regex(
            text,
            [r"D4Z4(?P<gap>[^\d\n]{0,16})(?P<value>\d+\s*(?:-|–|—|~|～|至|到)\s*\d+)"],
            analyte="repeat_count",
        )
        if d4z4_range_match:
            d4z4_pathogenic = re.sub(r"\s+", "", d4z4_range_match.group("value"))
            d4z4_source_text = d4z4_range_match.group(0)
            d4z4_match = d4z4_range_match
            d4z4_is_range = True
        else:
            d4z4_single_match, _ = _find_adjacent_regex(
                text,
                [r"D4Z4(?P<gap>[^\d\n]{0,16})(?P<value>\d+)"],
                analyte="repeat_count",
            )
            if d4z4_single_match:
                d4z4_pathogenic = d4z4_single_match.group("value")
                d4z4_source_text = d4z4_single_match.group(0)
                d4z4_match = d4z4_single_match

    # WHAT IS BESIDE THE NUMBER DECIDES WHETHER IT IS A COUNT.
    #
    # The last fallback above is 「any digit within 16 characters of
    # D4Z4」. It read 38 repeats out of 「D4Z4 EcoRI 片段长度: 38 kb」, 3
    # repeats out of 「D4Z4 未检出3个重复单元」 — the sentence saying none
    # were found — and 0 out of a cell no laboratory can mean. Each was
    # written as `d4z4_repeat_pathogenic` at 0.97, the confidence of a
    # cell we actually read, and each reached the passport and the
    # exports.
    #
    # A LENGTH AND A NEGATION ARE ABSTENTIONS. The number in them
    # answers another question, and in the kb case it is already
    # recorded under its own name as `ecori_fragment_kb` — emitting it
    # twice under two names is the two-answers-about-one-measurement
    # problem, not a second reading.
    #
    # A 0 IS KEPT. The cell really does print 0, and a reviewer has to
    # see that it was read and refused rather than find the row missing.
    # It is never typed as a count, and its confidence puts it in the
    # review queue.
    d4z4_refusal: Optional[str] = None
    if d4z4_match is not None and d4z4_pathogenic and not d4z4_is_range:
        if _asserts_absence(text, d4z4_match):
            d4z4_refusal = "negated"
        elif _LENGTH_UNIT_AFTER.match(text, d4z4_match.end()):
            d4z4_refusal = "length_in_kb"
        elif d4z4_pathogenic.isdigit() and int(d4z4_pathogenic) == 0:
            d4z4_refusal = "zero"
    if d4z4_refusal in {"negated", "length_in_kb"}:
        # `d4z4_other` only ever comes off the pair match, which is the
        # same match just judged, so it goes with it.
        d4z4_pathogenic = None
        d4z4_other = None
        d4z4_source_text = None

    # 甲基化分析 IS THE NAME OF THE TEST, NOT A READING OF IT.
    #
    # The gap here was `[^\d]{0,12}`, twelve characters that could
    # include newlines — so a report whose 检测项目 line names 「FSHD 甲基
    # 化分析」 and whose next line states 「单倍型: 4qA」 produced a
    # methylation value of 4, captured out of the allele name, and the
    # laboratory's real 甲基化 35% below it was never reached because the
    # first match wins. Eight characters, no newline, and a gap that is
    # only the method's name is not a reading. This repo states no
    # methylation boundary, so nothing grades the number — but precise
    # mode hands it to the assistant verbatim and strict mode counts it
    # in `numericValuesWithheld`, and a 4 in that cell is a claim about
    # this patient either way.
    methylation_match, _ = _find_adjacent_regex(
        text,
        [r"甲基化(?P<gap>[^\d\n]{0,8})(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>%?)"],
        analyte="methylation",
    )
    methylation_value = methylation_match.group("value") if methylation_match else None
    # THE UNIT IS WHAT THE REPORT PRINTED, OR NOTHING. It used to fall
    # back to 「%」, so 「甲基化 0.35」 — a fraction, which is how a
    # bisulfite ratio is commonly printed — was written out as 0.35 with
    # unit %, and the bridge rendered it 「0.35%」 on the patient's report
    # screen. This repo states no methylation boundary anywhere, so
    # nothing grades the number; stamping on a unit the laboratory did
    # not print was the one way this field could still say something
    # false.
    methylation_unit = (methylation_match.group("unit") or None) if methylation_match else None

    body = _before_disclaimer_section(lines)
    genetic_method = _detect_genetic_method(body)
    interpretation = _pick_finding_sentence(
        _extract_block_after_header(
            body,
            ["检测结果", "检测结论", "结果分析"],
            ["遗传咨询", "建议", "变异位点", "检测方法"],
        )
    ) or _extract_summary_line(
        body,
        ["检测结论", "结论", "结果分析", "解读", "提示", "interpretation", "impression"],
    )
    # `genetic_positive` WAS DERIVED HERE AND IS GONE.
    #
    # It read `「yes」 if diagnosis_type or d4z4_pathogenic else
    # 「uncertain」` — a verdict computed from the PRESENCE of a cell, not
    # from what the cell said, and with no 「no」 in its vocabulary at
    # all, so it could only ever affirm. Run over the states this
    # platform refuses to read, every one of them came out 「yes」: a
    # count cell reading 0, a length the report gave in kb, 「未检出3个
    # 重复单元」, and a 病历摘要 transcribing what a patient remembered.
    #
    # It was not confined to the parser. The bridge in
    # apps/api/src/services/ocr/embedded-report-ocr.ts copies every
    # structured field into `ocr_payload.fields` under both spellings,
    # so `geneticPositive: 「yes」` was persisted on the document row,
    # shown to the patient in the report screen's raw payload panel,
    # counted by `fieldCount` — which is what decides whether a parse
    # was empty enough to offer a re-run — and written into
    # `observations` and `latest_summary.by_analyte` as though a
    # laboratory had reported it.
    #
    # NOT REPLACED WITH AN HONEST VERSION. A version that could say
    # 「no」 would have to decide what a contracted array is, and that
    # boundary already exists — once — in `clinicaliseD4Z4` in
    # apps/api/src/modules/ai-agents/security/pii-redactor.ts. A second
    # copy here is the drift this repo keeps paying for. Everything the
    # verdict was computed FROM is still emitted: `diagnosis_type` is
    # the report's own word, and the D4Z4 cell travels with its own
    # reading. Nothing that could be read off the report is lost.
    #
    # See also the matching note in the prompt allowlist, which removed
    # this key from the model's view for the same reason.

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
            "haplotype",
            haplotype,
            source_text=haplotype_source,
            # ONE CONFIDENCE, because there is only one state left that
            # emits a value. The ambiguous case used to be emitted at
            # 0.60 to put it in the review queue; the queue is a human
            # process and the value reached the passport, the assistant
            # and the registry export in the meantime. It is withheld at
            # the parse now — see `_read_haplotype`.
            confidence=0.95,
        )
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
            normalized_value=(
                None if (d4z4_is_range or d4z4_refusal) else int(d4z4_pathogenic)
            ),
            source_text=d4z4_source_text,
            # A range is a genuine reading, but it is a weaker one than a
            # single number and the review queue should see it that way.
            # A refused cell is not a reading at all: below the 0.75
            # threshold so it is queued for a human every time.
            confidence=0.30 if d4z4_refusal else (0.80 if d4z4_is_range else 0.97),
        )
        if d4z4_pathogenic
        else None,
    )
    _append_field(
        fields,
        _build_field(
            "genetic_test_method",
            genetic_method,
            source_text=None,
            # Below the 0.75 review threshold on purpose when the report
            # names two platforms: 「ambiguous」 is exactly the case a
            # human should look at.
            confidence=0.70 if genetic_method == "ambiguous" else 0.92,
        )
        if genetic_method
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
            unit=methylation_unit,
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
        "haplotype": haplotype,
        "ecori_fragment_kb": _safe_float(ecori_fragment) if ecori_fragment else None,
        # None for a range: this key is typed as a count and every
        # consumer of it does arithmetic. The interval itself survives on
        # the `d4z4_repeat_pathogenic` structured field, whose
        # `field_value` is the raw text. Same for a refused cell — a 0
        # is what the report printed, not a count anything may use.
        "d4z4_repeat_pathogenic": (
            int(d4z4_pathogenic)
            if d4z4_pathogenic and not d4z4_is_range and not d4z4_refusal
            else None
        ),
        "d4z4_repeat_other": int(d4z4_other) if d4z4_other else None,
        "genetic_test_method": genetic_method,
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

        left_match, _ = _find_regex(sentence, [r"(?:左|left)[^0-5\n]{0,12}([0-5](?:[+-])?)"])
        right_match, _ = _find_regex(sentence, [r"(?:右|right)[^0-5\n]{0,12}([0-5](?:[+-])?)"])

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

    report_impression = _extract_block_after_header(
        lines,
        ["印象", "结论", "提示"],
        ["报告医师", "审核医师", "报告日期", "检查日期"],
    ) or _extract_summary_line(lines, ["印象", "结论", "提示"])
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
        "fvc": [r"\bFVC\b[^\d\n]{0,10}(\d+(?:\.\d+)?)\s*(L|%)?"],
        "fvc_pred_pct": [r"FVC(?:[% ]*Pred|占预计值|预计%)?[^\d\n]{0,12}(\d+(?:\.\d+)?)\s*(%)"],
        "fev1": [r"\bFEV1\b[^\d\n]{0,10}(\d+(?:\.\d+)?)\s*(L|%)?"],
        "fev1_pred_pct": [r"FEV1(?:[% ]*Pred|占预计值|预计%)?[^\d\n]{0,12}(\d+(?:\.\d+)?)\s*(%)"],
        "fev1_fvc": [r"FEV1/FVC[^\d\n]{0,12}(\d+(?:\.\d+)?)\s*(%)"],
        "tlc": [r"\bTLC\b[^\d\n]{0,10}(\d+(?:\.\d+)?)\s*(L|%)?"],
        "tlc_pred_pct": [r"TLC(?:[% ]*Pred|占预计值|预计%)?[^\d\n]{0,12}(\d+(?:\.\d+)?)\s*(%)"],
        "dlco": [r"\bDLCO\b[^\d\n]{0,10}(\d+(?:\.\d+)?)\s*([A-Za-z/%·]+)?"],
        "dlco_pred_pct": [r"DLCO(?:[% ]*Pred|占预计值|预计%)?[^\d\n]{0,12}(\d+(?:\.\d+)?)\s*(%)"],
        "dlco_va": [r"DLCO/VA[^\d\n]{0,12}(\d+(?:\.\d+)?)\s*([A-Za-z/%·]+)?"],
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

    table_patterns = {
        "fvc": [r"\bFVC\b[^\n]*?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"],
        "fev1": [r"\bFEV ?1\b[^\n]*?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"],
        "fev1_fvc": [r"FEV ?1\s*[%/ ]\s*FVC[^\n]*?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"],
        "tlc": [r"\bTLC[- ]?SB\b[^\n]*?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"],
        "dlco": [r"\bDLCO[- ]?SB\b[^\n]*?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"],
        "dlco_va": [r"\bDLCO\s*/\s*VA\b[^\n]*?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"],
    }

    for field_name, patterns in table_patterns.items():
        match, _ = _find_regex(text, patterns)
        if not match:
            continue
        actual_value = match.group(2)
        actual_numeric = _safe_float(actual_value)
        pct_value = match.group(3)
        pct_numeric = _safe_float(pct_value)
        panel[field_name] = actual_numeric if actual_numeric is not None else actual_value
        _append_field(
            fields,
            _build_field(
                field_name,
                actual_value,
                normalized_value=actual_numeric,
                source_text=_panel_source_line(lines, [field_name.upper().replace("_", "/"), field_name.upper()], actual_value),
                confidence=0.96,
            ),
        )
        if field_name in {"fvc", "fev1", "tlc", "dlco"} and pct_numeric is not None:
            pct_field = f"{field_name}_pred_pct"
            panel[pct_field] = pct_numeric
            _append_field(
                fields,
                _build_field(
                    pct_field,
                    pct_value,
                    normalized_value=pct_numeric,
                    unit="%",
                    source_text=_panel_source_line(lines, [field_name.upper().replace("_", "/"), field_name.upper()], pct_value),
                    confidence=0.95,
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
        "right_qb": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bQB\b[^\d\n]{0,8}(\d+(?:\.\d+)?)"],
        "right_db": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bDB\b[^\d\n]{0,8}(\d+(?:\.\d+)?)"],
        "right_vs": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bVS\b[^\d\n]{0,8}(\d+(?:\.\d+)?)"],
        "left_qb": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bQB\b[^\d\n]{0,8}(\d+(?:\.\d+)?)"],
        "left_db": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bDB\b[^\d\n]{0,8}(\d+(?:\.\d+)?)"],
        "left_vs": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bVS\b[^\d\n]{0,8}(\d+(?:\.\d+)?)"],
        "right_ee": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bEE\b[^\d\n]{0,8}(\d+(?:\.\d+)?)"],
        "right_ei": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bEI\b[^\d\n]{0,8}(\d+(?:\.\d+)?)"],
        "right_di": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bDI\b[^\d\n]{0,8}(\d+(?:\.\d+)?)"],
        "left_ee": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bEE\b[^\d\n]{0,8}(\d+(?:\.\d+)?)"],
        "left_ei": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bEI\b[^\d\n]{0,8}(\d+(?:\.\d+)?)"],
        "left_di": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bDI\b[^\d\n]{0,8}(\d+(?:\.\d+)?)"],
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

    row_patterns = {
        "right": [r"右侧膈肌[^\d\n]{0,12}(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"],
        "left": [r"左侧膈肌[^\d\n]{0,12}(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"],
    }
    row_field_order = ["qb", "db", "vs", "ee", "ei", "di"]

    for side, patterns in row_patterns.items():
        match, _ = _find_regex(text, patterns)
        if not match:
            continue
        for offset, suffix in enumerate(row_field_order, start=1):
            raw_value = match.group(offset)
            normalized_value = _safe_float(raw_value)
            field_name = f"{side}_{suffix}"
            panel[field_name] = normalized_value if normalized_value is not None else raw_value
            _append_field(
                fields,
                _build_field(
                    field_name,
                    raw_value,
                    normalized_value=normalized_value,
                    source_text=_panel_source_line(lines, [f"{'右' if side == 'right' else '左'}侧膈肌"], raw_value),
                    confidence=0.95,
                ),
            )

    motion_summary = _extract_block_after_header(
        lines,
        ["检查提示", "印象"],
        ["诊断医生", "记录医生", "审核医生", "检查日期", "打印日期"],
    ) or _extract_summary_line(lines, ["未见明显异常声像", "膈肌运动", "运动幅度"])
    thickening_summary = _extract_summary_line(
        lines, ["增厚率", "厚度", "thickening"], require_digit=True
    )
    # The conclusion sentence mentions 增厚率 too, so without the digit
    # requirement above this field mirrored 膈肌运动. Guard the residual
    # case where both keywords land on the same line anyway.
    if thickening_summary and thickening_summary == motion_summary:
        thickening_summary = None
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
        "heart_rate": [r"(?:HR|心率|房率|室率)[^\d\n]{0,8}(\d+(?:\.\d+)?)\s*(?:bpm|次/分)?"],
        "pr_interval_ms": [r"(?:\bPR\b|P-R间期)[^\d\n]{0,8}(\d+(?:\.\d+)?)\s*(ms|毫秒)?"],
        "qrs_duration_ms": [r"\bQRS\b[^\d\n]{0,8}(\d+(?:\.\d+)?)\s*(ms|毫秒)?"],
        "qt_ms": [r"\bQT\b[^\d\n]{0,8}(\d+(?:\.\d+)?)\s*(ms|毫秒)?"],
        "qtc_ms": [r"\bQTc\b[^\d\n]{0,8}(\d+(?:\.\d+)?)\s*(ms|毫秒)?"],
        "axis_p": [r"P轴[^\d\n-]{0,8}(-?\d+(?:\.\d+)?)"],
        "axis_qrs": [r"QRS轴[^\d\n-]{0,8}(-?\d+(?:\.\d+)?)"],
        "axis_t": [r"T轴[^\d\n-]{0,8}(-?\d+(?:\.\d+)?)"],
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
    ecg_summary = _extract_block_after_header(
        lines,
        ["心电图诊断", "诊断"],
        ["检查日期", "报告日期", "审核医师", "审校医师"],
    ) or _extract_summary_line(lines, ["窦性", "传导阻滞", "心电图提示", "sinus rhythm", "bundle branch block", "ecg impression"])

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
        "lvef": [r"(?:LVEF|EF|射血分数)[^\d\n]{0,8}(\d+(?:\.\d+)?)\s*(%)"],
        "fs": [r"\bFS\b[^\d\n]{0,8}(\d+(?:\.\d+)?)\s*(%)"],
        "co": [r"\bCO\b[^\d\n]{0,8}(\d+(?:\.\d+)?)\s*([A-Za-z/]+)?"],
        "hr": [r"(?:HR|心率)[^\d\n]{0,8}(\d+(?:\.\d+)?)\s*(?:bpm|次/分)?"],
        "lad": [r"\bLAD\b[^\d\n]{0,8}(\d+(?:\.\d+)?)\s*(mm|cm)?"],
        "aod": [r"\bAOD\b[^\d\n]{0,8}(\d+(?:\.\d+)?)\s*(mm|cm)?"],
        "lvd_d": [r"(?:LVDd|LVDD)[^\d\n]{0,8}(\d+(?:\.\d+)?)\s*(mm|cm)?"],
        "e_over_e_prime": [r"E/E['′]?[^\d\n]{0,8}(\d+(?:\.\d+)?)"],
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


def _extract_blood_routine(lines: List[str], fields: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    panel: Dict[str, Any] = normalized_summary.get("lab_panel", {})
    definitions = {
        "wbc": {"patterns": [r"(?:白细胞计数|WBC)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["白细胞计数", "WBC"]},
        "neut_pct": {"patterns": [r"(?:中性粒细胞比率|NEUT%|%NEUT)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "unit": "%", "keywords": ["中性粒细胞比率", "NEUT"]},
        "neut_abs": {"patterns": [r"(?:中性粒细胞数|NEUT#|#NEUT)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["中性粒细胞数", "NEUT"]},
        "lymph_pct": {"patterns": [r"(?:淋巴细胞比率|LYMPH%|%LYMPH)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "unit": "%", "keywords": ["淋巴细胞比率", "LYMPH"]},
        "lymph_abs": {"patterns": [r"(?:淋巴细胞数|LYMPH#|#LYMPH)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["淋巴细胞数", "LYMPH"]},
        "mono_pct": {"patterns": [r"(?:单核细胞比率|MONO%|%MONO)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "unit": "%", "keywords": ["单核细胞比率", "MONO"]},
        "mono_abs": {"patterns": [r"(?:单核细胞数|MONO#|#MONO)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["单核细胞数", "MONO"]},
        "eos_pct": {"patterns": [r"(?:嗜酸细胞百分比|EOS%|%EOS)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "unit": "%", "keywords": ["嗜酸细胞百分比", "EOS"]},
        "eos_abs": {"patterns": [r"(?:嗜酸细胞数|EOS#|#EOS)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["嗜酸细胞数", "EOS"]},
        "baso_pct": {"patterns": [r"(?:嗜碱细胞百分比|BASO%|%BASO)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "unit": "%", "keywords": ["嗜碱细胞百分比", "BASO"]},
        "baso_abs": {"patterns": [r"(?:嗜碱细胞数|BASO#|#BASO)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["嗜碱细胞数", "BASO"]},
        "rbc": {"patterns": [r"(?:红细胞计数|RBC)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["红细胞计数", "RBC"]},
        "hgb": {"patterns": [r"(?:血红蛋白量|血红蛋白|HGB)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["血红蛋白", "HGB"]},
        "hct": {"patterns": [r"(?:红细胞比积|HCT)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["红细胞比积", "HCT"]},
        "mcv": {"patterns": [r"(?:平均红细胞体积|MCV)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["平均红细胞体积", "MCV"]},
        "mch": {"patterns": [r"(?:平均血红蛋白含量|MCH)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["平均血红蛋白含量", "MCH"]},
        "mchc": {"patterns": [r"(?:平均血红蛋白浓度|MCHC)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["平均血红蛋白浓度", "MCHC"]},
        "rdw_sd": {"patterns": [r"(?:红细胞分布宽度标准差|RDW-SD)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["红细胞分布宽度标准差", "RDW-SD"]},
        "rdw_cv": {"patterns": [r"(?:红细胞分布宽度变异系数|RDW-CV|RDW)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["红细胞分布宽度变异系数", "RDW"]},
        "plt": {"patterns": [r"(?:血小板计数|PLT)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["血小板计数", "PLT"]},
        "mpv": {"patterns": [r"(?:血小板平均体积|MPV)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["血小板平均体积", "MPV"]},
        "pct": {"patterns": [r"(?:血小板比积|PCT)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["血小板比积", "PCT"]},
        "pdw": {"patterns": [r"(?:血小板分布宽度|PDW)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["血小板分布宽度", "PDW"]},
        "plcr": {"patterns": [r"(?:大型血小板比率|P-LCR|PLCR)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["大型血小板比率", "P-LCR"]},
        "nrbc": {"patterns": [r"(?:有核红细胞|NRBC)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["有核红细胞", "NRBC"]},
    }
    _extract_numeric_panel(text, lines, fields, panel, definitions)
    normalized_summary["lab_panel"] = panel


def _extract_thyroid_function(lines: List[str], fields: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    panel: Dict[str, Any] = normalized_summary.get("lab_panel", {})
    definitions = {
        "ft3": {"patterns": [r"(?:游离T3(?:\(FT3\))?|FT3结果?)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["游离T3", "FT3"]},
        "ft4": {"patterns": [r"(?:游离T4(?:\(FT4\))?|FT4结果?)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["游离T4", "FT4"]},
        "tsh": {
            "patterns": [
                r"(?:超敏促甲状腺素(?:\(TSH3?\))?|促甲状腺激素(?:\(TSH3?\))?)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)",
                r"(?:^|\n)\s*(?:TSH3?|sTSH)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)",
            ],
            "keywords": ["促甲状腺激素", "TSH"],
        },
    }
    _extract_numeric_panel(text, lines, fields, panel, definitions)
    normalized_summary["lab_panel"] = panel


def _extract_coagulation(lines: List[str], fields: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    panel: Dict[str, Any] = normalized_summary.get("lab_panel", {})
    definitions = {
        "pt": {"patterns": [r"(?:凝血酶原时间|PT)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["凝血酶原时间", "PT"]},
        "inr": {"patterns": [r"(?:国际标准化比值|PT-INR|INR)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["国际标准化比值", "INR"]},
        "aptt": {"patterns": [r"(?:活化部分凝血活酶时间|APTT)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["活化部分凝血活酶时间", "APTT"]},
        "fibrinogen": {"patterns": [r"(?:纤维蛋白原|FIB|Fg)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["纤维蛋白原", "FIB", "Fg"]},
        "tt": {"patterns": [r"(?:凝血酶时间|TT)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["凝血酶时间", "TT"]},
        "d_dimer": {"patterns": [r"(?:D[ -]?二聚体定量|D-Dimer|D二聚体)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["D-二聚体", "D-Dimer"]},
    }
    _extract_numeric_panel(text, lines, fields, panel, definitions)
    normalized_summary["lab_panel"] = panel


def _extract_urinalysis(lines: List[str], fields: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    panel: Dict[str, Any] = normalized_summary.get("lab_panel", {})
    text_definitions = {
        "urine_color": {"patterns": [r"(?:颜色)[^\n\u4e00-\u9fa5A-Za-z]{0,8}([^\s]+)"], "keywords": ["颜色"]},
        "urine_clarity": {"patterns": [r"(?:透明度|浊度|清晰度)[^\n\u4e00-\u9fa5A-Za-z]{0,8}([^\s]+)"], "keywords": ["透明度", "浊度"]},
        "urine_glucose": {"patterns": [r"(?:葡萄糖(?:\(GLU\))?|GLU)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性|\(-\)|阳性|\(\+\)|弱阳性)"], "keywords": ["葡萄糖", "GLU"], "normalize_qualitative": True},
        "urine_ketone": {"patterns": [r"(?:酮体(?:\(KET\))?|KET)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性|\(-\)|阳性|\(\+\)|弱阳性)"], "keywords": ["酮体", "KET"], "normalize_qualitative": True},
        "urine_bilirubin": {"patterns": [r"(?:胆红素(?:\(BIL\))?|BIL)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性|\(-\)|阳性|\(\+\)|弱阳性)"], "keywords": ["胆红素", "BIL"], "normalize_qualitative": True},
        "urine_protein": {"patterns": [r"(?:蛋白质(?:\(PRO\))?|PRO)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性|\(-\)|阳性|\(\+\)|弱阳性)"], "keywords": ["蛋白质", "PRO"], "normalize_qualitative": True},
        "urine_nitrite": {"patterns": [r"(?:亚硝酸盐(?:\(NIT\))?|NIT)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性|\(-\)|阳性|\(\+\)|弱阳性)"], "keywords": ["亚硝酸盐", "NIT"], "normalize_qualitative": True},
        "urine_occult_blood": {"patterns": [r"(?:潜血(?:\(OB\)|\(BLD\))?|OB|BLD)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性|\(-\)|阳性|\(\+\)|弱阳性)"], "keywords": ["潜血", "OB"], "normalize_qualitative": True},
        "urine_leukocyte": {"patterns": [r"(?:白细胞酯酶|白细胞(?:\(LEU\))?|LEU)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性|\(-\)|阳性|\(\+\)|弱阳性)"], "keywords": ["白细胞酯酶", "白细胞", "LEU"], "normalize_qualitative": True},
        "urine_urobilinogen": {"patterns": [r"(?:尿胆原(?:\(URO\))?|URO)[^\n\u4e00-\u9fa5A-Za-z]{0,8}([^\s]+)"], "keywords": ["尿胆原", "URO"]},
    }
    numeric_definitions = {
        "urine_specific_gravity": {"patterns": [r"(?:比重|SG)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["比重", "SG"]},
        "urine_ph": {"patterns": [r"(?:pH值|pH)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["pH值", "pH"]},
        "urine_rbc": {"patterns": [r"(?:红细胞\(RBC\)|红细胞/HPF|红细胞)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["红细胞", "RBC"]},
        "urine_wbc": {"patterns": [r"(?:白细胞\(WBC\)|白细胞/HPF|白细胞)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["白细胞", "WBC"]},
        "urine_bacteria": {"patterns": [r"(?:细菌|BACT)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["细菌", "BACT"]},
        "urine_epithelial_cells": {"patterns": [r"(?:上皮细胞|EC)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["上皮细胞", "EC"]},
        "urine_mucus": {"patterns": [r"(?:粘液丝|MUCS)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["粘液丝", "MUCS"]},
    }
    _extract_text_panel(text, lines, fields, panel, text_definitions)
    _extract_numeric_panel(text, lines, fields, panel, numeric_definitions)
    normalized_summary["lab_panel"] = panel


def _extract_infection_screening(lines: List[str], fields: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    panel: Dict[str, Any] = normalized_summary.get("lab_panel", {})
    text_definitions = {
        "hbsag": {"patterns": [r"(?:HBsAg|乙型肝炎病毒表面抗原)[^\n]{0,24}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["HBsAg", "表面抗原"], "normalize_qualitative": True},
        "anti_hbs": {"patterns": [r"(?:Anti-HBs|抗乙型肝炎病毒表面抗体)[^\n]{0,24}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["Anti-HBs", "表面抗体"], "normalize_qualitative": True},
        "hbeag": {"patterns": [r"(?:HBeAg|乙型肝炎病毒e抗原)[^\n]{0,24}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["HBeAg", "e抗原"], "normalize_qualitative": True},
        "anti_hbe": {"patterns": [r"(?:Anti-HBe|抗乙型肝炎病毒e抗体)[^\n]{0,24}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["Anti-HBe", "e抗体"], "normalize_qualitative": True},
        "anti_hbc": {"patterns": [r"(?:Anti-HBc|抗乙型肝炎病毒核心抗体)[^\n]{0,24}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["Anti-HBc", "核心抗体"], "normalize_qualitative": True},
        "hiv_ab": {"patterns": [r"(?:HIV|人类免疫缺陷病毒抗原抗体联合检测)[^\n]{0,24}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["HIV"], "normalize_qualitative": True},
        "anti_hcv": {"patterns": [r"(?:Anti-HCV|丙型肝炎病毒抗体)[^\n]{0,24}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["Anti-HCV", "丙型肝炎病毒抗体"], "normalize_qualitative": True},
        "tppa": {"patterns": [r"(?:TPPA|抗梅毒螺旋体抗体)[^\n]{0,24}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["TPPA", "抗梅毒螺旋体抗体"], "normalize_qualitative": True},
        "trust_ab": {"patterns": [r"(?:TRUST(?:非特异性抗体)?)[^\n]{0,24}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["TRUST"], "normalize_qualitative": True},
    }
    _extract_text_panel(text, lines, fields, panel, text_definitions)

    numeric_definitions = {
        "trust_titer": {"patterns": [r"(?:TRUST滴度)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["TRUST滴度"]},
    }
    _extract_numeric_panel(text, lines, fields, panel, numeric_definitions)
    normalized_summary["lab_panel"] = panel


def _extract_stool_test(lines: List[str], fields: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    panel: Dict[str, Any] = normalized_summary.get("lab_panel", {})
    text_definitions = {
        "stool_color": {"patterns": [r"(?:颜色)[^\n\u4e00-\u9fa5A-Za-z]{0,8}([^\s]+)"], "keywords": ["颜色"]},
        "stool_consistency": {"patterns": [r"(?:硬度|性状)[^\n\u4e00-\u9fa5A-Za-z]{0,8}([^\s]+)"], "keywords": ["硬度", "性状"]},
        "stool_blood": {"patterns": [r"(?:血液)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["血液"], "normalize_qualitative": True},
        "stool_mucus": {"patterns": [r"(?:粘液)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["粘液"], "normalize_qualitative": True},
        "stool_rbc": {"patterns": [r"(?:红细胞)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["红细胞"], "normalize_qualitative": True},
        "stool_wbc": {"patterns": [r"(?:白细胞)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["白细胞"], "normalize_qualitative": True},
        "stool_fat_globules": {"patterns": [r"(?:脂肪球)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["脂肪球"], "normalize_qualitative": True},
        "stool_occult_blood": {"patterns": [r"(?:隐血试验(?:\(OBT\))?|OBT)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["隐血试验", "OBT"], "normalize_qualitative": True},
        "hp_result": {"patterns": [r"(?:检测结果|样本次检测结果为)(阴性\+?|阳性\+?)"], "keywords": ["检测结果", "样本次检测结果"]},
    }
    numeric_definitions = {
        "hp_dob": {"patterns": [r"(?:DOB|DPM值)[^\d\n]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["DOB", "DPM值"]},
    }
    _extract_text_panel(text, lines, fields, panel, text_definitions)
    _extract_numeric_panel(text, lines, fields, panel, numeric_definitions)
    normalized_summary["lab_panel"] = panel


def _extract_abdominal_ultrasound(lines: List[str], fields: List[Dict[str, Any]], findings: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    finding_text = _extract_block_after_header(
        lines,
        ["检查所见", "超声所见"],
        ["检查提示", "印象", "诊断医生", "记录医生", "审核医生", "检查日期", "打印日期"],
    )
    impression_text = _extract_block_after_header(
        lines,
        ["检查提示", "印象"],
        ["诊断医生", "记录医生", "审核医生", "检查日期", "打印日期"],
    )
    if finding_text:
        _append_field(
            fields,
            _build_field(
                "abdominal_ultrasound_finding",
                finding_text,
                source_text=finding_text,
                confidence=0.9,
            ),
        )
        findings.append(
            {
                "modality": "Ultrasound",
                "body_part": "abdomen",
                "finding_text": finding_text,
                "impression_text": impression_text or finding_text,
                "source_evidence": {"raw_snippet": finding_text[:120], "line_hint": "finding block"},
            }
        )
    if impression_text:
        _append_field(
            fields,
            _build_field(
                "abdominal_ultrasound_impression",
                impression_text,
                source_text=impression_text,
                confidence=0.92,
            ),
        )
    normalized_summary["abdominal_ultrasound_summary"] = {
        "finding_text": finding_text,
        "impression_text": impression_text,
    }


def _extract_lab_value(lines: List[str], keywords: Iterable[str]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    keyword_tokens = [keyword.lower().strip() for keyword in keywords if keyword and keyword.strip()]

    def extract_numeric_value(line: str) -> Tuple[Optional[str], Optional[str]]:
        match = re.search(r"([<>]?\d+(?:\.\d+)?)\s*([A-Za-z/%μµ·/\-]+)?", line)
        if not match:
            return None, None
        return match.group(1), (match.group(2) or "").strip() or None

    def search_segment(line: str) -> str:
        lowered_line = line.lower()
        matched = next((keyword for keyword in keyword_tokens if keyword in lowered_line), None)
        if not matched:
            return line
        keyword_pos = lowered_line.find(matched)
        segment = line[keyword_pos + len(matched) :] if keyword_pos >= 0 else line
        segment = re.sub(r"^\s*\([^)]+\)\s*", "", segment)
        return segment

    def is_reference_range(line: str) -> bool:
        return bool(
            re.fullmatch(
                r"[<>]?\d+(?:\.\d+)?\s*[-~]\s*[<>]?\d+(?:\.\d+)?(?:\s*[A-Za-z/%μµ·/\-]+)?",
                line.strip(),
            )
        )

    def is_unit_only(line: str) -> bool:
        return bool(re.fullmatch(r"[A-Za-z/%μµ·/\-]+", line.strip()))

    for index, line in enumerate(lines):
        lowered = line.lower()
        matched_keyword = next((keyword for keyword in keyword_tokens if keyword in lowered), None)
        if not matched_keyword:
            continue

        raw_value, unit = extract_numeric_value(search_segment(line))
        if raw_value is not None and not is_reference_range(line):
            return raw_value, unit, line

        source_parts = [line]
        for offset in range(1, 5):
            next_index = index + offset
            if next_index >= len(lines):
                break
            candidate = lines[next_index].strip()
            if not candidate:
                continue
            source_parts.append(candidate)

            if re.fullmatch(r"[↑↓→]+", candidate):
                continue

            if raw_value is None:
                candidate_value, candidate_unit = extract_numeric_value(search_segment(candidate))
                if candidate_value is not None and not is_reference_range(candidate):
                    raw_value = candidate_value
                    unit = candidate_unit or unit
                    if unit:
                        return raw_value, unit, " ".join(source_parts)
                    continue

            if raw_value is not None and unit is None and is_unit_only(candidate):
                unit = candidate
                return raw_value, unit, " ".join(source_parts)

        if raw_value is not None:
            return raw_value, unit, " ".join(source_parts)
    return None, None, None


# --------------------------------------------------------------------
# Generic lab-table reader
#
# Everything above is per-analyte: someone wrote a regex for FT3, so FT3
# is extracted; nobody wrote one for 「游离甲状腺素指数」, so it is not.
# That is a list that can only ever cover reports we have already seen,
# and the user's ask was the opposite —「如果有其他格式的报告也可以识别
# 出来，不局限于我这几个」.
#
# The way out is that the *shape* is universal. Chinese lab reports put
# a header row over the results —「No 项目 结果 参考区间 单位 方法」— and
# PaddleOCR emits one cell per line, so a row is N consecutive lines
# where N is the header's width. Reading that structure extracts every
# analyte on the page, including ones nobody anticipated.
#
# Observed motivating case: an FT3/FT4/TSH panel classified correctly at
# 0.99 confidence and yielded 3 fields, because only three analytes had
# hand-written patterns and the rest of the table was invisible.
# --------------------------------------------------------------------

#: Header cells that mark a results table. 「项目」 and 「结果」 are the
#: load-bearing pair; the rest disambiguate.
_TABLE_HEADER_CELLS: Tuple[str, ...] = (
    "项目", "结果", "参考区间", "参考值", "单位", "方法", "提示", "结果值",
    "检验项目", "检测项目", "英文缩写", "No", "NO", "序号",
)

#: A cell holding a measurement: an optional comparator, digits, and
#: nothing else. 「6.000」 yes; 「3.5-6.59」 no (that is a range).
_VALUE_CELL = re.compile(r"^[<>≤≥]?\s*\d+(?:\.\d+)?$")

#: A reference range rather than a result.
_RANGE_CELL = re.compile(r"^[<>≤≥]?\s*\d+(?:\.\d+)?\s*[-~—]\s*\d+(?:\.\d+)?$")

#: A unit. Deliberately loose — units vary wildly — but never CJK.
_UNIT_CELL = re.compile(r"^[A-Za-zμµ%/·\^\d\.\*]{1,14}$")


#: Assay methods. They sit in the last column, look exactly like an
#: analyte name, and are followed by the next row's number — so without
#: this list 「化学发光法」 was read as a test whose result was the row
#: number below it.
_METHOD_WORDS: Tuple[str, ...] = (
    "化学发光", "凝集法", "酶法", "免疫", "比浊", "electrode", "速率法",
    "终点法", "干化学", "镜检", "培养", "PCR", "测定法", "显色",
    "双缩脲", "溴甲酚绿", "比色", "电极", "计算", "电阻抗", "流式",
    "鞘流", "散射", "分光", "亲和", "钼酸", "脲酶", "氧化",
)

#: A row number glued to the analyte name — 「*1白细胞计数(WBC)」,
#: 「22血小板比积(PCT)」. The number is the table's own index, not part
#: of the test's name.
_ROW_NUMBER_PREFIX = re.compile(r"^[*#\s]*\d{1,3}\s*")


def _looks_like_analyte(cell: str) -> bool:
    """A cell naming a test: has letters or CJK, is not a header, is short."""
    if not cell or len(cell) > 28:
        return False
    if cell in _TABLE_HEADER_CELLS or _is_header_only(cell):
        return False
    if _VALUE_CELL.match(cell) or _RANGE_CELL.match(cell):
        return False
    # `label:value` is report metadata — 「申请时间:2023-12-20」 — not a
    # row of the results table.
    if re.search(r"[:：]", cell):
        return False
    if any(word in cell for word in _METHOD_WORDS):
        return False
    # A unit is not a test. 「fL」 and 「U/L」 sit in their own column and
    # are followed by the next row's figures, so an unfiltered scan read
    # them as analytes whose result was someone else's number.
    if _UNIT_CELL.match(cell) and not re.search(r"[\u4e00-\u9fa5]", cell):
        return False
    return bool(re.search(r"[\u4e00-\u9fa5A-Za-z]", cell))


def extract_lab_table_rows(lines: List[str]) -> List[Dict[str, Any]]:
    """Read every `analyte / value / unit` triple out of a results table.

    Scans for an analyte cell followed, within a short window, by a
    value cell. The window is what makes this layout-agnostic: whether
    the row is `名称 结果 区间 单位` or `No 名称 结果 单位`, the value is
    the first bare number after the name, and the unit is the first
    unit-shaped cell after that.

    Stops at the boilerplate tail so a page number or a phone number in
    the footer is never read as a result.
    """
    body = _before_disclaimer_section(lines)
    rows: List[Dict[str, Any]] = []
    seen: set = set()

    index = 0
    while index < len(body):
        name = body[index].strip()
        if not _looks_like_analyte(name) or any(m in name for m in _BLOCK_STOP_MARKERS):
            index += 1
            continue

        value = unit = ref = None
        cursor = index + 1
        end = min(len(body), index + 6)
        while cursor < end:
            cell = body[cursor].strip()
            # The next analyte ends this row, whether or not this one
            # found a value. Scanning past it skipped every other row:
            # the cursor landed beyond the next name, so a table read as
            # rows 1, 3, 5.
            if _looks_like_analyte(cell):
                break
            if value is None and _VALUE_CELL.match(cell):
                value = cell
            elif value is not None and ref is None and _RANGE_CELL.match(cell):
                ref = cell
            elif value is not None and unit is None and _UNIT_CELL.match(cell):
                unit = cell
            cursor += 1

        if value is None:
            index += 1
            continue

        clean = _ROW_NUMBER_PREFIX.sub("", name).strip()
        key = clean.lower()
        if clean and key not in seen:
            seen.add(key)
            rows.append({"name": clean, "value": value, "unit": unit, "reference": ref})
        # Resume at the cell that ended the row — the next analyte, or
        # the first cell this row did not claim.
        index = max(cursor, index + 1)

    return rows


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
        "tbil": ["总胆红素", "tbil"],
        "dbil": ["直接胆红素", "dbil"],
        "ibil": ["间接胆红素", "ibil"],
        "tp": ["总蛋白", "tp"],
        "alb": ["白蛋白", "alb"],
        "globulin": ["球蛋白", "globulin", "glo"],
        "a_g_ratio": ["白球比例", "a/g"],
        "alp": ["碱性磷酸酶", "alp"],
        "ggt": ["谷氨酰转肽酶", "谷氨酰基转移酶", "ggt"],
        "urea": ["尿素", "urea", "bun"],
        "glucose": ["葡萄糖", "血糖", "glu"],
        "cholesterol": ["总胆固醇", "tcho", "cholesterol"],
        "triglyceride": ["甘油三酯", "tg"],
        "hdl_c": ["高密度脂蛋白", "hdl-c", "hdl"],
        "ldl_c": ["低密度脂蛋白", "ldl-c", "ldl"],
        "vldl_c": ["极低密度脂蛋白", "vldl-c", "vldl"],
        "apo_a1": ["载脂蛋白a1", "apoa1", "apo-a1"],
        "apo_b": ["载脂蛋白b", "apob", "apo-b"],
        "lp_a": ["脂蛋白a", "lp(a)", "lpa"],
        "phosphorus": ["无机磷", "磷", "p"],
        "magnesium": ["镁", "mg"],
        "co2cp": ["碳酸氢根", "co2cp"],
        "potassium": ["钾", "k"],
        "sodium": ["钠", "na"],
        "chloride": ["氯", "cl"],
        "calcium": ["钙", "ca"],
        "il6": ["白介素6", "il-6", "il6"],
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


def _append_generic_table_fields(lines: List[str], fields: List[Dict[str, Any]]) -> None:
    """Add table rows the type-specific extractors did not already cover.

    Keys are prefixed `table_` and slugged from the printed analyte
    name. They are deliberately NOT canonical keys: the API's prompt
    allowlist is deny-by-default, so these reach the patient's own
    report screen but not a model prompt until someone reviews the name.
    That is the right default for a value read off an arbitrary table.
    """
    existing = {str(f.get("source_text") or "") for f in fields}
    existing_names = {str(f.get("field_name") or "").lower() for f in fields}

    for row in extract_lab_table_rows(lines):
        slug = re.sub(r"[^a-z0-9]+", "_", row["name"].lower()).strip("_")
        if not slug:
            slug = re.sub(r"\s+", "_", row["name"])[:24]
        key = f"table_{slug}"[:48]
        if key.lower() in existing_names or row["value"] in existing:
            continue
        existing_names.add(key.lower())
        _append_field(
            fields,
            _build_field(
                key,
                row["value"],
                normalized_value=_safe_float(row["value"]),
                unit=row["unit"],
                source_text=f"{row['name']} {row['value']} {row['unit'] or ''}".strip(),
                # Lower than a hand-written pattern: the analyte was
                # matched by table position, not by knowing what it is.
                confidence=0.7,
            ),
        )


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
                    # `_exact_float`, not `_safe_float`: an extractor
                    # that meant a number passed one, and everything
                    # else arriving here is text. Scraping a digit out
                    # of that text is how 「1-10」 became 1.0.
                    "value_num": normalized_value if isinstance(normalized_value, (int, float)) else _exact_float(normalized_value),
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


def analyze_fshd_report(
    ocr_text: str,
    document_type_hint: Optional[str] = None,
    report_name: Optional[str] = None,
) -> Dict[str, Any]:
    normalized_text = _normalize_text(ocr_text)
    lines = _extract_lines(normalized_text)
    report_type, report_confidence, classification_reasons = _classify_report(
        normalized_text,
        document_type_hint,
        report_name,
    )

    structured_fields: List[Dict[str, Any]] = []
    findings: List[Dict[str, Any]] = []
    normalized_summary: Dict[str, Any] = {}

    if report_type == "genetic_report":
        _extract_genetic(lines, structured_fields, findings, normalized_summary)
    elif report_type == "medical_summary":
        _extract_medical_summary(lines, structured_fields, normalized_summary)
        # A TRANSCRIPTION IS STILL READ. For some patients the 病历摘要 is
        # the only page in the account that carries the D4Z4 count, and
        # the platform's answer to that has always been 「display it with
        # its origin, never grade it」 — the origin being this
        # classification, which now says 病历摘要 rather than
        # genetic_report. Skipping the genetics extractor here would not
        # make the value ungradeable, it would make it invisible: the
        # API's `pickGeneticEvidenceDocument` only reaches a non-report
        # document THROUGH the genetic result keys, and the redactor can
        # only stamp `not_read_off_a_laboratory_report` onto a cell that
        # exists. The refusal is the API's job; producing the cell to
        # refuse is this one's.
        _extract_genetic(lines, structured_fields, findings, normalized_summary)
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
    elif report_type == "blood_routine":
        _extract_blood_routine(lines, structured_fields, normalized_summary)
    elif report_type == "thyroid_function":
        _extract_thyroid_function(lines, structured_fields, normalized_summary)
    elif report_type == "coagulation":
        _extract_coagulation(lines, structured_fields, normalized_summary)
    elif report_type == "urinalysis":
        _extract_urinalysis(lines, structured_fields, normalized_summary)
    elif report_type == "infection_screening":
        _extract_infection_screening(lines, structured_fields, normalized_summary)
    elif report_type == "stool_test":
        _extract_stool_test(lines, structured_fields, normalized_summary)
    elif report_type == "abdominal_ultrasound":
        _extract_abdominal_ultrasound(lines, structured_fields, findings, normalized_summary)

    if report_type in {
        "muscle_enzyme",
        "biochemistry",
        "other",
    }:
        _extract_labs(lines, structured_fields, normalized_summary)

    # Whatever the hand-written extractors missed, read off the table
    # itself. Runs last and only *adds*: a type-specific extractor knows
    # this analyte's canonical key, its unit conversion and its
    # reference semantics, so where one exists it wins. The generic
    # reader is what makes a report nobody anticipated still produce
    # values — see extract_lab_table_rows.
    _append_generic_table_fields(lines, structured_fields)

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
