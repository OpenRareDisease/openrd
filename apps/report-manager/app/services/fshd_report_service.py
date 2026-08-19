import re
from functools import lru_cache
from typing import Any, Dict, Iterable, List, NamedTuple, Optional, Tuple


#: `\b` NEVER FIRES BETWEEN A CHINESE CHARACTER AND A LATIN ONE, AND A
#: CHINESE LABORATORY PRINTS WITHOUT SPACES.
#:
#: Python's `\w` is Unicode-aware for `str` patterns, so every CJK
#: character is a word character — and `\b` is a transition between word
#: and non-word. 「不支持FSHD1诊断」 has 持 before the F and 诊 after the
#: 1: both sides word, no transition, NO BOUNDARY. So every pattern in
#: this file that anchored a Latin or digit token with `\b` was invisible
#: on the real spelling, silently, in the direction that costs a reading:
#:
#:   - `\b(4qA|4qB)\b` could not see 「4q35单倍型4qB」, the report's own
#:     result row, so `_read_haplotype` fell through to the explanatory
#:     footnote and answered with whichever allele the FOOTNOTE names.
#:     FSHD1 cannot be the mechanism on 4qB.
#:   - `\bFSHD\s*([12])\b` could not see 「不支持FSHD1诊断」, the exclusion
#:     clause, so the report's own refusal never reached the type reader.
#:   - `(kb|bp|mb)\b` could not see 「38kb的片段」, so the `length_in_kb`
#:     refusal — the one that stops a fragment length being published as
#:     a repeat count — did not fire on the no-space spelling.
#:   - `\becor\s*[i1]\b` could not see 「EcoRI酶切」, so a Southern blot
#:     report reported no method at all.
#:
#: The replacement is a boundary defined on the ASCII word alphabet
#: alone. At the head of a Latin token the second alternative is always
#: false (the next character is the token's own first letter), so it
#: reduces to 「the character before is not ASCII-alphanumeric」; at the
#: tail the first is always false and it reduces to the mirror image.
#: That is exactly what `\b` was written to mean here, and it holds
#: whether the neighbouring character is a space, a bracket or 型.
#:
#: Applied CENTRALLY: every pattern in this module reaches `re` through
#: `_find_regex`, `_read_cell`, `_detect_genetic_method` or
#: `_cjk_safe_compile`, and all four rewrite it first — so a `\b`
#: written in a new pattern is fixed by construction rather than by
#: remembering. Do not call `re` on a pattern from this file without one
#: of them. `test_no_pattern_in_the_module_keeps_a_raw_word_boundary`
#: holds the precompiled half of that line.
_ASCII_WORD_BOUNDARY = r"(?:(?<![0-9A-Za-z_])|(?![0-9A-Za-z_]))"


@lru_cache(maxsize=512)
def _cjk_safe(pattern: str) -> str:
    """`pattern` with every `\\b` rewritten to survive Chinese typesetting."""
    return pattern.replace(r"\b", _ASCII_WORD_BOUNDARY)


def _cjk_safe_compile(pattern: str, flags: int = 0) -> "re.Pattern":
    """`re.compile`, for the patterns this module keeps precompiled."""
    return re.compile(_cjk_safe(pattern), flags)


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
#: genetics laboratory prints any of them AS A SECTION OF ITS OWN —
#: which makes their presence decisive rather than something to weigh
#: against the 检测项目 / 检测方法 / 送检单位 / 报告医师 a report shows.
#: This is not a vocabulary: adding an FSHD term to it would put the old
#: bug back.
#:
#: BUT 「HAS THE SECTION」 IS NOT 「CONTAINS THE WORD」, and reading it as
#: the second cost genuine result reports their own label. A radiology,
#: EMG or muscle-MRI report prints the referring clinician's requisition
#: across the top of itself, and that block carries 主诉 and 现病史 as
#: form COLUMNS; and 请结合临床及查体 / 与主诉相符 / 结合既往史 is the
#: standard closing of a Chinese radiology conclusion — the radiologist
#: REFERRING to the clinical history, which is the opposite of the
#: document being one. So the tuples below are split by the role their
#: entries play and read in their position by `_narrative_structure`:
#: a section HEADING is not a mention, a requisition COLUMN is not a
#: section, and a document TITLE is neither.
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
#: The API mirrors these two tuples as NARRATIVE_DOCUMENT_KIND_MARKERS
#: and CLINICAL_STORY_SECTION_MARKERS in
#: apps/api/src/modules/patient-profile/genetic-evidence.ts, and the
#: mobile bundle carries a third copy, because a classifier change does
#: not reclassify a stored row and both of those have to hold the same
#: line against the ones already on disk. IF THIS MOVES THEY MOVE.

#: WHAT THE PAGE CALLS ITSELF. A title, not a topic — no result report
#: is titled 病历摘要 or 出院小结, which is why a title recognised
#: anywhere on the page is decisive with nothing weighed against it.
NARRATIVE_DOCUMENT_KIND_MARKERS: Tuple[str, ...] = (
    "病历摘要",
    "门诊病历",
    "住院病历",
    "出院小结",
    "住院小结",
    "出院记录",
    "入院记录",
    "病程记录",
)

#: THE SECTIONS A PERSON'S STORY IS TOLD IN. Names of sections rather
#: than of documents, which is why these are counted only where the page
#: prints them AS sections — see `_narrative_structure`.
CLINICAL_STORY_SECTION_MARKERS: Tuple[str, ...] = (
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

#: Both halves, for the audit that keeps 「no genetics laboratory prints
#: this」 executable over every entry at once.
MEDICAL_SUMMARY_STRUCTURE_MARKERS: Tuple[str, ...] = (
    NARRATIVE_DOCUMENT_KIND_MARKERS + CLINICAL_STORY_SECTION_MARKERS
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


#: A SENTENCE END, AND NEVER A DECIMAL POINT.
#:
#: `_normalize_text` folds 「。」 to 「.」 before any of this runs, so the
#: full stop and the decimal point are the same character by the time a
#: block gets here — and splitting on a bare 「.」 cuts a report's own
#: sentence mid-number. Measured on the sentence a patient reads
#: verbatim under 报告详情 → 来源追溯: an EcoRI fragment of 18.5 kb came
#: out as 「5 kb」 (roughly one repeat unit — a severely contracted
#: array — where 18.5 kb is not), and a methylation level of 0.35 came
#: out as 「0」.
#:
#: A dot is a decimal point only with a digit on BOTH sides. Requiring a
#: non-digit before it is not enough on its own: a clause ending in a
#: number — 「重复数为 3.单倍型: 4qA」 — would then never split.
#:
#: ONE SPLITTER, BECAUSE THE SECOND COPY HAD THE SAME BUG. This lived
#: only in `_pick_finding_sentence`, and `_extract_sentences` — the
#: 病历摘要 / 查体 / MRI path — kept its own `[\n.;。；]+`, on which
#: 「病程 18.5 年」 split into 「病程 18」 and 「5 年」: the duration regex
#: needs 病程 and 年 in one sentence, so `disease_duration` came out
#: EMPTY on the ordinary spelling, `progression_node` was published as
#: the truncated 「…病程 18」, and the timeline gained a phantom event
#: 「5 年, 逐渐加重」 with no age attached.
_SENTENCE_BREAK = re.compile(r"[。;；\n]|(?<!\d)\.|\.(?!\d)")


def _extract_sentences(text: str) -> List[str]:
    chunks = _SENTENCE_BREAK.split(_normalize_text(text))
    return [chunk.strip() for chunk in chunks if chunk and chunk.strip()]


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
        match = re.search(_cjk_safe(pattern), text, flags)
        if match:
            return match, pattern
    return None, None


#: Words that, standing alone between a cell label and a number, mean
#: the label is naming the ASSAY rather than labelling a result.
#: 甲基化分析 is the standard Chinese name of the FSHD2 test, so
#: 「检测项目: FSHD 甲基化分析」 is a 检测项目 line and not a methylation
#: reading — see `_read_cell`.
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


#: WHAT A LABEL'S OWN TAIL MAY SAY. The words a Chinese laboratory puts
#: between a cell's name and its reading, spelled as the printed row
#: spells them: 「甲基化水平」, 「D4Z4重复单元数」, 「片段大小」,
#: 「D4Z4阵列」. None of them is a claim; each is the rest of the label.
#:
#: A REPORT'S OWN ROW, NOT A SENTENCE ABOUT THE DISEASE — see
#: `_gap_is_label_to_value`.
_LABEL_TAIL_WORDS: Tuple[str, ...] = (
    "水平", "程度", "比例", "比率", "百分比", "率", "值", "数", "个数",
    "重复", "单元", "拷贝", "阵列", "区域", "区", "片段", "长度", "大小",
    "结果", "报告", "检出", "检测到", "所示", "如下",
    "分析", "检测", "检验", "测定", "测序", "方法", "项目", "计数",
)

#: THE TOKEN THAT SAYS 「WHAT FOLLOWS IS THIS LABEL'S VALUE」. 「:」 and
#: 「=」 are the printed ones; 为 and 是 are the same statement in a
#: sentence — 「检出 D4Z4 重复单元数为 3」.
_GAP_VALUE_INTRODUCERS: Tuple[str, ...] = (":", "=", "为", "是", "共")

#: A LATIN RUN INSIDE A GAP IS A NAME IN THE OTHER SCRIPT. 「D4Z4 EcoRI
#: 片段长度: 38 kb」 puts the enzyme between the label and the value, and
#: 「甲基化 MS-PCR 35%」 puts the assay's initials there. Removed with the
#: parenthetical, and for the same reason.
#:
#: THIS IS THE LIMIT OF WHAT `_gap_is_label_to_value` CLOSES: the
#: sentences it refuses are Chinese, because the reports that carry a
#: disease-background paragraph print it in Chinese. An English sentence
#: between an English label and a number is not judged by this test at
#: all, and would need its own list of connectives.
_GAP_LATIN_RUN = re.compile(r"[A-Za-z]+")


def _gap_is_label_to_value(gap: str, analyte: Optional[str] = None) -> bool:
    """Is the text between a label and a number a LABEL-TO-VALUE gap?

    A WIDTH IS NOT A SHAPE, AND THIS CLASS HAS NOW BEEN FIXED THREE
    TIMES BY NARROWING ONE. `[^\\d]{0,12}` let a 检测项目 line reach into
    the row below it; excluding `\\n` fixed that and left `{0,8}`, which
    is short enough for 「甲基化水平: 35%」 and equally short enough for
    「…甲基化水平常低于 25%」 — an ordinary sentence of disease
    background, printed on the genetics reports that carry one, on which
    this platform then published `methylation_value: 35%` for a report
    that measured no methylation at all. Measured on a synthetic FSHD1
    report whose only methylation words are in its background paragraph:
    `methylation_value: 25.0` in `genetic_summary`, on `observations`,
    in `latest_summary.by_analyte`, and rendered on the patient's own
    report screen beside cells the laboratory really printed.
    THE NEXT WIDENING WOULD HAVE REINTRODUCED IT, and the one after
    that.

    So the gap is judged by WHAT IT SAYS. Strip the name in the other
    script, the label's own tail words and the punctuation between them,
    and a label-to-value gap has nothing left — or has nothing left but
    the token that introduces a value. 「水平常低于」 keeps 「常低于」,
    which is a claim about a population and not the rest of a label, so
    the number after it is not this patient's reading. A gap ten
    characters wide made of nothing but 「重复单元数检测结果为」 still
    reads, and a gap two characters wide made of 「低于」 does not.

    THIS IS THE THIRD TEST OF ITS FAMILY AND THE MOST GENERAL.
    `_gap_names_a_method` refuses a gap that is only the assay's name;
    `_gap_names_another_analyte` refuses one that names a different
    measurement; both name what a gap MAY NOT contain. This one states
    what it may. A word absent from `_LABEL_TAIL_WORDS` costs a reading
    that a report really printed, which is the failure this repo
    prefers: an unread cell is visibly missing, an invented one is not.
    """
    stripped = _GAP_LATIN_RUN.sub("", gap)
    stripped = _GAP_FILLER.sub("", stripped)
    if not stripped:
        return True
    for introducer in _GAP_VALUE_INTRODUCERS:
        head, separator, _ = stripped.partition(introducer)
        if separator:
            # Everything after the introducer is filler or nothing —
            # `_GAP_FILLER` has already run — so only the head has to be
            # the label's own tail.
            stripped = head
            break
    # The analyte's own name may repeat inside its label —
    # 「D4Z4 重复单元数」 read by the 重复数 pattern — and that is the rest
    # of the label, not a second measurement. Another analyte's words are
    # refused before this runs, by `_gap_names_another_analyte`.
    tail_words = _LABEL_TAIL_WORDS + _ANALYTE_GAP_WORDS.get(analyte or "", ())
    while stripped:
        for word in tail_words:
            if word and stripped.startswith(word):
                stripped = stripped[len(word) :]
                break
        else:
            return False
    return True


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
    `_read_cell` goes on to the next candidate: a report that
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


#: Labels under which a number is THIS PATIENT'S READING.
#:
#: 检出 / 检测到 are here because a laboratory writes its result as a
#: sentence as often as it does a row — 「本项目…检出 D4Z4 重复单元数为 3」 —
#: and the clause opener is the only label that sentence has.
_RESULT_VALUE_LABELS: Tuple[str, ...] = (
    "检测结果", "检测结论", "结果", "结论", "检出", "检测到", "报告结果",
    "result",
)

#: Labels under which a number is NOT this patient's reading: it belongs
#: to the assay, to the assay's limits, or to a population.
#:
#: 检测下限 IS THE ONE THIS TABLE EXISTS FOR. `_gap_names_a_method`
#: refuses only a gap that is NOTHING BUT method words and
#: `_gap_names_another_analyte` refuses only a gap naming a DIFFERENT
#: analyte, so the 检测方法 line 「D4Z4 重复单元数, 检测下限 1 个重复单
#: 元」 passed both — it names the method AND the right analyte — and
#: `re.finditer` returning the first accepted match meant the report's
#: own result row was never reached. Measured on a report that EXCLUDES
#: FSHD1 (count 18, 结论 未见缩短): published as a confirmed 1-repeat
#: contraction, `d4z4Repeats_clinical: within_fshd1_repeat_range` in
#: both prompt modes, and an AAN Level B ophthalmology recommendation on
#: the passport.
_METHOD_VALUE_LABELS: Tuple[str, ...] = (
    "检测方法", "方法", "检测项目", "项目", "检测下限", "检出下限",
    "检测范围", "灵敏度", "分辨率", "参考区间", "参考值", "参考范围",
    "参考", "正常人群", "正常范围", "正常值", "试剂", "仪器", "平台",
    "探针", "probe", "引物", "primer", "method", "reference",
)

#: Ranking of a reading by the ROW IT SITS ON. Lower wins;
#: `_REFUSED_ROW` never wins at all.
#:
#: `_DEDICATED_ROW` IS WHY THIS IS A FOUR-WAY RANK AND NOT A THREE-WAY
#: ONE. With only 结果-label / unlabelled / refused, the report's own
#: dedicated result row was ALWAYS the lowest rank that can win: on the
#: cell-per-line layout this module documents as the norm, 「检测结果:」
#: is its own line and the analyte rows below it carry no label of their
#: own, so they scored unlabelled — while any 结论 PROSE SENTENCE
#: quoting a threshold carries 结论 and scored the result rank. Measured:
#: a report whose own row reads 5 and whose conclusion reads 「D4Z4 重复
#: 单元数低于 10 个即为缩短」 published 10. A dedicated analyte row
#: outranks a sentence that merely mentions the analyte, which is what
#: the words 「the report's own result row」 were always supposed to mean.
#:
#: `_TABLE_ROW` IS SEPARATE FROM `_DEDICATED_ROW` BECAUSE A TIE WAS
#: BEING SETTLED BY APPEND ORDER. The fix above promoted an unlabelled
#: row inside a 检测结果/检测结论 section to `_DEDICATED_ROW` — and on
#: the cell-per-line layout the conclusion PROSE SENTENCE also sits on
#: its own line under a bare header, so it was promoted to exactly the
#: rank of the rebuilt table rows. `_page_rows` appends the rebuilt rows
#: LAST and `_read_cell` keeps a candidate only when the rank is
#: STRICTLY better, so on that tie the earlier prose row won and the
#: report's own printed count lost. Measured on the same document the
#: note above was written for: own row 5, conclusion 「D4Z4 重复单元数低
#: 于 10 个即为缩短」, published 10 again — the grey-zone boundary, at
#: 0.97, on a patient the report puts squarely inside the FSHD1 range.
#:
#: A row rebuilt by `_table_row_lines` is an analyte cell paired with
#: ITS OWN value cell; nothing else on the page is that. It therefore
#: gets a rank of its own above every inherited one, and the tie is
#: decided by what the rows ARE rather than by the order they were
#: appended in. See also `_KIND_CONCLUSION`, which stops a conclusion
#: sentence from being promoted to the data rank in the first place.
_TABLE_ROW = 0
_DEDICATED_ROW = 1
_RESULT_ROW = 2
_UNLABELLED_ROW = 3
_REFUSED_ROW = 4

#: The best rank there is. `_read_cell` stops early only on this one:
#: stopping on `_DEDICATED_ROW` would return before the rebuilt table
#: rows — which are appended last — were ever examined, which is the
#: same defect from the other side.
_BEST_ROW = _TABLE_ROW


def _line_span(text: str, index: int) -> Tuple[str, int]:
    """The single line `index` falls on, and the offset it starts at."""
    start = text.rfind("\n", 0, index) + 1
    end = text.find("\n", index)
    return (text[start:] if end == -1 else text[start:end]), start


# --------------------------------------------------------------------
# THE PAGE AS LABELLED ROWS
#
# WHAT KEPT FAILING WAS THE SHAPE OF THE READER, NOT THE INDIVIDUAL
# PATTERNS. Every genetics reader in this file used to run over one
# flat blob — every line of the page joined together — and decide which
# match to keep by re-deriving, from the characters around it, which
# kind of row it had landed on. Three rounds of fixes have all been the
# same fix: another label added to `_METHOD_VALUE_LABELS`, another
# lookahead, another gap test. They are individually right and they do
# not compose, because the blob throws away the one thing that settles
# every one of these questions — WHICH ROW OF THE REPORT THIS IS.
#
# So the page is segmented into rows and each row is LABELLED ONCE,
# before any pattern runs:
#
#   TITLE       what the test was ORDERED to look for. Never a result.
#   METHOD      the assay, its limits, its reference interval, its
#               probes. Never a reading of this patient.
#   NOTE        a footnote defining a term. Never a reading either.
#   RESULT      a row inside the report's 检测结果 section.
#   TABLE       a row rebuilt from the cell-per-line OCR layout.
#   PLAIN       everything else; ranked by its own in-line label.
#
# and every reader then asks the ROW, not the characters. A title is
# refused because it is a title, not because the conclusion below it
# happened to repeat the token and negate it — which is the difference
# between D2 being fixed and D2 being fixed for the wordings we have
# seen. Two of the eleven defects this pass was written for are not
# reachable at all once the rows carry their own kind.
# --------------------------------------------------------------------

#: What a document is NAMED. A report is titled after the type it was
#: ordered to look for, so its title says nothing about what was found —
#: and `_read_diagnosis_type` refused per TOKEN, which only helps when
#: the conclusion happens to repeat the token. The ordinary Chinese
#: negative conclusion does not: 「未见 4q35 D4Z4 阵列缩短, 结果在正常
#: 范围」 names no type at all, so 「FSHD1 基因检测报告」 was left as the
#: only candidate and won at the unlabelled rank — published as this
#: patient's 分型, on the passport, in the exports, and written into
#: `patient_profiles` by `applyGeneticReportAutofill`.
_TITLE_ROW_SUFFIXES: Tuple[str, ...] = (
    "报告", "报告单", "报告书", "检验单", "检查单", "申请单", "记录单",
)

#: A title is short. THIRTY CHARACTERS WAS NOT SHORT ENOUGH TO BE A
#: LIMIT AND NOT LONG ENOUGH TO BE ONE. 「面肩肱型肌营养不良1型(FSHD1)
#: D4Z4重复单元数检测报告单」 — a title a Chinese genetics laboratory
#: prints as a matter of course, disease name and gene target and
#: document type all spelled out — is 32 characters, so it fell through
#: to PLAIN and its FSHD1 was read as this patient's stated 分型 on the
#: ordinary negative wording that names no type of its own.
_TITLE_ROW_MAX = 40

#: What a document can be NAMED without ending in the word 报告.
#: 「FSHD1基因检测」 is a whole title as printed, and it satisfies none of
#: `_TITLE_ROW_SUFFIXES`; so is 「FSHD1基因检测申请」. A line carrying one
#: of these AND standing at the top of the page is the document's name,
#: because the name is the first thing printed on it — position is the
#: honest discriminator here, and it is the one a suffix list was
#: standing in for.
#:
#: Required IN ADDITION to first-position so that a cell-per-line report
#: whose heading row was dropped by the OCR does not have its first DATA
#: cell refused as a title: 「D4Z4重复单元数 3」 names no document.
_TITLE_NAME_WORDS: Tuple[str, ...] = ("报告", "检测", "检验", "检查", "筛查")

#: Section headers that open a run of rows. Matched only against a line
#: that is NOTHING BUT the header, so 「检测方法: …」 with its own content
#: keeps being ranked by its in-line label and does not open a section.
#:
#: NO ENTRY IN THESE TUPLES OPENS A SECTION ON A BARE
#: `_TABLE_HEADER_CELLS` CELL. The bare column headings 项目 / 结果 /
#: 单位 are absent from the lists below, but absence is not what enforces
#: that rule and never could be: 检测项目 / 检验项目 / 参考区间 / 参考值
#: are column headings AND the names of method-ish things, so they
#: legitimately belong in `_METHOD_SECTION_HEADERS` while a lone one of
#: them on a line is a table heading. `_row_label` refuses them there,
#: for every string in both tuples at once, rather than leaving a list to
#: stay in sync by hand. `test_no_line_can_claim_two_labels` fails if any
#: overlap between these lists is left for statement order to settle.
#:
#: 检测结果 AND 检测结论 ARE NOT THE SAME SECTION and used to share this
#: tuple. A 检测结果 header heads DATA ROWS; a 检测结论 header heads a
#: PROSE SENTENCE. Promoting an unlabelled row under either of them to
#: the dedicated data rank put a sentence quoting a threshold level with
#: the report's own printed cell — see `_TABLE_ROW`.
_RESULT_SECTION_HEADERS: Tuple[str, ...] = (
    "检测结果", "检验结果", "报告结果",
)
_CONCLUSION_SECTION_HEADERS: Tuple[str, ...] = (
    "检测结论", "检验结论", "结果分析",
)
_METHOD_SECTION_HEADERS: Tuple[str, ...] = (
    "检测方法", "检验方法", "检测项目", "检验项目", "送检项目",
    "参考区间", "参考值", "参考范围",
)
_NOTE_SECTION_HEADERS: Tuple[str, ...] = ("附注", "备注", "注释", "说明")

#: A footnote that carries its own content — 「附注: 4qA 为允许型单倍型」.
_NOTE_ROW_PREFIXES: Tuple[str, ...] = ("附注", "备注", "注释", "说明", "注:")

#: Labels that name WHAT WAS ORDERED. What a test was ordered to look
#: for says nothing about what was found — the same thing a TITLE says
#: nothing about — so the label and the one cell holding its value are
#: both refused. `_EXAM_METADATA_PREFIXES` carries the rest of this
#: family (送检项目, 检查项目, 标本类型, 检验目的 …); these two are
#: listed separately only because they are ALSO column headings, which
#: is the ambiguity `_row_label` decides.
_ORDERED_ITEM_LABELS: Tuple[str, ...] = ("检测项目", "检验项目")

_KIND_TITLE = "title"
_KIND_METHOD = "method"
_KIND_NOTE = "note"
_KIND_RESULT = "result"
_KIND_CONCLUSION = "conclusion"
_KIND_TABLE = "table"
_KIND_PLAIN = "plain"

#: How far a label reaches.
#:
#: THE THIRD ONE IS WHAT `_page_rows` HAD NO WAY TO SAY, and its absence
#: is why 送检项目 had to be either harmless or catastrophic with nothing
#: in between. A bare 送检项目 line is a metadata LABEL whose value is
#: the NEXT CELL — that is what the cell-per-line layout does with every
#: header-block field — and it was being treated as a header that opens a
#: RUN. Measured on a genetically confirmed report laid out that way:
#: 送检项目 opened a METHOD section that never closed, `_KIND_METHOD` is
#: in `_REFUSED_ROW_KINDS`, and `diagnosis_type`, `haplotype` and
#: `d4z4_repeat_pathogenic` all came back None with an EMPTY
#: `review_queue` reporting nothing amiss — the whole genetic finding
#: erased by one OCR line.
#:
#: Giving it `_SCOPE_SELF` instead would have traded that for the
#: opposite error: the cell BELOW the label is the name of the test that
#: was ORDERED, and on 「送检项目 / FSHD1基因检测 / 检测结论: 未见…缩短」
#: a plain next cell publishes `diagnosis_type: FSHD1` on a report that
#: excludes it. Measured too, on 检查项目, 检测项目 and 标本类型, which
#: reach this page today with no section to open at all. The label and
#: its one value cell are both the ordered test's name, and neither is a
#: reading of this patient.
_SCOPE_SELF = "self"
_SCOPE_RUN = "run"
_SCOPE_NEXT = "next"

#: Kinds that ASSERT nothing about this patient, whatever they contain.
#: A reading is never taken off one. A REFUSAL still is — the absence
#: and hedge tests in `_read_diagnosis_type` run over every row before
#: the kind is consulted, because a report that excludes a type on its
#: 检测项目 line has still excluded it. Refusing to read and refusing to
#: hear the report's own 「no」 are opposite things.
_REFUSED_ROW_KINDS = frozenset({_KIND_TITLE, _KIND_METHOD, _KIND_NOTE})


class _Row(NamedTuple):
    """One row of the page, with the kind that was decided for it."""

    text: str
    kind: str


def _is_title_row(line: str, *, first_content_line: bool = False) -> bool:
    """Is this line the document's NAME rather than one of its rows?

    A title is short and carries no value separator — 「报告日期: …」 is
    metadata, not the title. Beyond that it is recognised two ways, and
    ONE OF THEM USED TO BE THE ONLY ONE:

      - it ends in the word for a report, or
      - it stands at the TOP OF THE PAGE and names a document.

    Ending in 报告 was doing all the work, and two entirely ordinary
    Chinese titles do not:

        面肩肱型肌营养不良1型(FSHD1)D4Z4重复单元数检测报告单
        FSHD1基因检测

    The first ends in 报告单 and was refused for LENGTH — 32 characters
    against a cap of 30. The second is a title in full and ends in 检测.
    Both fell through to PLAIN, and on the ordinary negative conclusion
    that names no type — 「未见 4q35 D4Z4 阵列缩短, 结果在正常范围」 —
    the title's FSHD1 was then the only candidate left and was published
    as this patient's 分型 at 0.98, onto the passport, the exports and
    `patient_profiles` via `applyGeneticReportAutofill`.

    `first_content_line` is the caller's knowledge of WHERE the line
    sits, which is the property a suffix list was standing in for: a
    document's name is the first thing printed on it. It is required in
    addition to `_TITLE_NAME_WORDS` rather than instead of it, so that a
    page whose heading was lost by the OCR does not have its first DATA
    row refused as a title.
    """
    stripped = line.strip()
    if not stripped or len(stripped) > _TITLE_ROW_MAX or ":" in stripped:
        return False
    if stripped.endswith(_TITLE_ROW_SUFFIXES):
        return True
    return first_content_line and any(word in stripped for word in _TITLE_NAME_WORDS)


def _is_bare_header(line: str) -> Optional[str]:
    """The header a line spells when it spells NOTHING BUT a header.

    Returns the header text with its trailing colon removed, or None if
    the line carries content of its own — 「检测方法: PCR」 is a labelled
    row and is ranked by `_inline_row_rank`, not a section opener.

    CONTENT AFTER THE COLON IS WHAT MAKES A LINE NOT BARE, and stripping
    the colon off the END was not the same test. 「标本类型:外周血」 is
    eight characters with no digit in it, so it survived a
    `rstrip(":")` unchanged and was handed on as though it were a bare
    header — which under `_SCOPE_NEXT` would have labelled the NEXT row
    with a label belonging to this one's value.
    """
    stripped = line.strip()
    head, separator, tail = stripped.partition(":")
    if separator and tail.strip():
        return None
    stripped = head.strip()
    if not stripped or len(stripped) > 10 or re.search(r"\d", stripped):
        return None
    return stripped


def _row_label(line: str, *, first_content_line: bool = False) -> Optional[Tuple[str, str]]:
    """The kind this line is, and HOW FAR that label reaches.

    THE ONE PLACE A LINE'S LABEL IS DECIDED. Every list this consults
    overlaps some other list — that is a property of the strings a
    Chinese laboratory prints, not a mistake in the lists — and the
    overlaps used to be settled by which `if` happened to be written
    first, and the previous round fixed ONE overlap in place rather than
    fixing the way overlaps are settled — so the same defect came back
    on the next string:

      - 检测项目 / 检验项目 / 参考区间 / 参考值 / 参考范围 are in
        `_METHOD_SECTION_HEADERS` AND in `_TABLE_HEADER_CELLS`. A bare
        one of them opened a METHOD run that propagated down the rest of
        the page and refused every row under it — `_KIND_METHOD` is in
        `_REFUSED_ROW_KINDS`, so `_read_cell`, `_read_diagnosis_type`
        and `_read_haplotype` skip it. That is the overlap the previous
        round guarded, by name, inside the section test, and the guard
        holds: measured on this page today, a bare 检测项目 opens
        nothing.
      - 送检项目 is in `_METHOD_SECTION_HEADERS` AND is an
        `_EXAM_METADATA_PREFIXES` label, and the guard above cannot
        reach it because 送检项目 is not a column heading. Measured on a
        genetically confirmed cell-per-line report: the same runaway
        METHOD run, `d4z4_repeat_pathogenic`, `haplotype` and
        `diagnosis_type` all None, with an empty `review_queue`
        reporting nothing amiss. A guard written against one LIST was
        never what made the rule true.
      - AND A GUARD THAT STOPS AT THE HEADING COVERS HALF THE LINE THAT
        MATTERS. The cell under a bare 检测项目 / 检查项目 / 标本类型 /
        检验目的 is the name of the test that was ORDERED, and left
        plain it publishes `diagnosis_type: FSHD1` off 「FSHD1基因检测」
        on a report whose own conclusion excludes it. Measured on all
        four.
      - 附注 / 备注 / 注释 / 说明 are in `_NOTE_SECTION_HEADERS` AND in
        `_NOTE_ROW_PREFIXES`. Harmless — both say NOTE — but harmless
        by coincidence rather than by decision.

    So the precedence is written down ONCE, here, and
    `test_no_line_can_claim_two_labels` fails if any pair of these lists
    overlaps on a string whose two labels disagree and is not listed in
    this function. A column heading is not a section; a metadata label
    is not a section either, and reaches exactly its own value cell; a
    section header is a section; a document name is a title.
    """
    header = _is_bare_header(line)
    if header is not None:
        # 1. A LABEL NAMING WHAT WAS ORDERED reaches its own value cell
        #    and no further. See `_SCOPE_NEXT`.
        #
        #    检测项目 / 检验项目 are here as well as in
        #    `_TABLE_HEADER_CELLS`, and that is the ambiguity resolved
        #    rather than dodged: a lone one of them is either the heading
        #    of the ANALYTE-NAME column or the label of the ordered
        #    test's name, and the cell below it is a test's name under
        #    BOTH readings. 「检测项目 / FSHD1基因检测 / 检测结论: 未见
        #    …缩短」 published `diagnosis_type: FSHD1` on a report that
        #    excludes it, because the previous round's column-heading
        #    guard stops at the heading and says nothing about the cell
        #    under it. Nothing is lost on the table reading: a count in
        #    a cell-per-line table is read off the row `_table_row_lines`
        #    rebuilds, not off the analyte cell.
        if header in _ORDERED_ITEM_LABELS or any(
            header.startswith(prefix) for prefix in _EXAM_METADATA_PREFIXES
        ):
            return _KIND_METHOD, _SCOPE_NEXT
        # 2. A COLUMN HEADING IS NOT A SECTION, whatever else the string
        #    also spells. It closes the open run, the way the next
        #    heading cell of the same row would.
        if header in _TABLE_HEADER_CELLS:
            return _KIND_PLAIN, _SCOPE_SELF
        # 3. A section header opens its section.
        if header in _RESULT_SECTION_HEADERS:
            return _KIND_RESULT, _SCOPE_RUN
        if header in _CONCLUSION_SECTION_HEADERS:
            return _KIND_CONCLUSION, _SCOPE_RUN
        if header in _METHOD_SECTION_HEADERS:
            return _KIND_METHOD, _SCOPE_RUN
        if header in _NOTE_SECTION_HEADERS:
            return _KIND_NOTE, _SCOPE_RUN
    # 4. A metadata label CARRYING its value — 「送检项目: FSHD1基因检测」
    #    — is the same statement on one line, and is refused the same
    #    way. It never reached `_is_bare_header`, and as a PLAIN row its
    #    FSHD1 was read as this patient's stated type.
    if any(line.strip().startswith(prefix) for prefix in _EXAM_METADATA_PREFIXES):
        return _KIND_METHOD, _SCOPE_SELF
    # 5. A footnote carrying its own content.
    if any(line.strip().startswith(prefix) for prefix in _NOTE_ROW_PREFIXES):
        return _KIND_NOTE, _SCOPE_SELF
    # 6. The document's name.
    if _is_title_row(line, first_content_line=first_content_line):
        return _KIND_TITLE, _SCOPE_SELF
    # 7. Any other header-shaped line closes the run without opening one.
    stripped = line.strip()
    if stripped in _TABLE_HEADER_CELLS or _is_header_row(stripped) or _is_header_only(stripped):
        return _KIND_PLAIN, _SCOPE_SELF
    return None


def _page_rows(lines: List[str]) -> List[_Row]:
    """The report's lines, each labelled with the kind of row it is.

    Sections propagate: a bare 「检测结果」 line makes the analyte rows
    beneath it result rows even though they carry no label of their own,
    which is exactly the layout on which the old rank put the patient's
    real count below a conclusion sentence.

    WHICH LABEL A LINE GETS IS NOT DECIDED HERE. `_row_label` decides
    it, in one place, with the overlaps between the lists resolved
    explicitly — a column heading is not a section, a metadata label is
    not a section, and a metadata label reaches exactly its own value
    cell. This loop only applies the SCOPE that comes back with the
    label: `_SCOPE_RUN` opens a section, `_SCOPE_SELF` closes the open
    one, and `_SCOPE_NEXT` labels the following row and nothing further.

    The rows rebuilt by `_table_row_lines` are appended last and carry
    `_KIND_TABLE`: they are, by construction, an analyte cell paired with
    its own value cell, which is the most dedicated result row a report
    has — and being appended last is why `_TABLE_ROW` is a rank of its
    own rather than a tie with `_DEDICATED_ROW`.
    """
    rows: List[_Row] = []
    section: Optional[str] = None
    pending: Optional[str] = None
    seen_content = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        label = _row_label(stripped, first_content_line=not seen_content)
        seen_content = True
        if label is None:
            rows.append(_Row(stripped, pending or section or _KIND_PLAIN))
            pending = None
            continue
        kind, scope = label
        if scope == _SCOPE_RUN:
            section = kind
            pending = None
        elif scope == _SCOPE_NEXT:
            section = None
            pending = kind
        else:
            section = None
            pending = None
        rows.append(_Row(stripped, kind))
    rows.extend(_Row(text, _KIND_TABLE) for text in _table_row_lines(lines))
    return rows


def _inline_row_rank(line: str, value_start: int) -> int:
    """Rank a number by the LABEL NEAREST TO ITS LEFT on its own line.

    The same rule `_haplotype_tokens_on` applies to the allele tokens: a
    label introduces what FOLLOWS it, so the label governing a number is
    the last one to open before it. 「检测方法: D4Z4 重复单元数, 检测下限
    1」 — the label before the 1 is 检测下限, and a detection limit is a
    property of the assay, not a reading of this patient. 「检测项目:
    D4Z4 重复单元数 检测结果: 3」 is the same line shape with the two
    labels the other way round, and there the 3 really is the result.

    Nearest-label rather than whole-line, because a line carrying both
    families is ordinary in an OCR that flattened a table row, and a
    line-contains test has to guess which one it belongs to.

    `value_start` is an offset into `line`. This answers only the three
    ranks a LINE can decide on its own; `_row_rank` is what combines it
    with the kind the row was labelled with.
    """
    lowered = line.lower()
    best_rank = _UNLABELLED_ROW
    best_at = -1
    for labels, rank in (
        (_RESULT_VALUE_LABELS, _RESULT_ROW),
        (_METHOD_VALUE_LABELS, _REFUSED_ROW),
    ):
        for label in labels:
            at = lowered.rfind(label, 0, value_start)
            if at > best_at:
                best_at = at
                best_rank = rank
    return best_rank


def _row_rank(row: _Row, value_start: int) -> int:
    """What a reading found at `value_start` on `row` is worth.

    THE KIND DECIDES FIRST. A title, a method row and a footnote are
    refused whatever they contain — that is the whole point of labelling
    the rows — and a table row is the dedicated result row it was
    rebuilt from, ranked above every inherited label because it is the
    only row on the page that pairs an analyte cell with its own value
    cell.

    Inside a section the row's own in-line label still governs when it
    HAS one, so a 结论 sentence printed under the results heading is read
    as the sentence it is; it is only a row with no label of its own that
    inherits the section's.

    AND A 检测结论 SECTION IS NOT A 检测结果 SECTION. Both used to live in
    `_RESULT_SECTION_HEADERS` and both promoted an unlabelled row to
    `_DEDICATED_ROW` — but a 检测结论 header heads a PROSE SENTENCE, not
    a data row, and promoting that sentence to the data rank is what put
    「D4Z4 重复单元数低于 10 个即为缩短」 level with the report's own
    printed 5. A sentence under a conclusion heading ranks as the
    conclusion it is.
    """
    if row.kind in _REFUSED_ROW_KINDS:
        return _REFUSED_ROW
    if row.kind == _KIND_TABLE:
        return _TABLE_ROW
    rank = _inline_row_rank(row.text, value_start)
    if rank == _UNLABELLED_ROW:
        if row.kind == _KIND_RESULT:
            return _DEDICATED_ROW
        if row.kind == _KIND_CONCLUSION:
            return _RESULT_ROW
    return rank


def _read_cell(
    rows: List[_Row],
    patterns: Iterable[str],
    flags: int = re.IGNORECASE,
    analyte: Optional[str] = None,
) -> Tuple[Optional[re.Match], Optional[str]]:
    """Read one cell off the page, ROW BY ROW, best row wins.

    Returns `(match, row_text)` — the row is returned because everything
    the caller does next is a question about the row the number sits on:
    whether that row asserts an absence, and whether a length unit
    follows the number ON IT. Handing back the whole page for those
    tests is how a marker on a neighbouring line used to answer them.

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

    Matching per ROW is what makes that structural rather than
    remembered: there is no page-wide string for a gap to run off the
    end of. The gap classes still exclude `\\n` — a row rebuilt from
    table cells is one string — and they now exclude `(` as well,
    because a gap that opens a bracket puts the number INSIDE the
    analyte's own abbreviation: `游离T3(?:\\(FT3\\))?[^\\d\\n]{0,16}(\\d+)`
    backtracked out of the optional 「(FT3)」 and captured the 3 of the
    NAME, publishing `ft3: 3` while the row's real 5.2 sat unread.

    A gap that is only the name of the method is not a label-to-value
    gap at all, and — `analyte` — a gap that names a DIFFERENT
    measurement belongs to that measurement's row rather than to this
    one. Where every candidate fails those tests the answer is no
    reading, which is the honest one: the cell this platform could not
    locate is a cell it has not read.

    `analyte` names what the patterns read, as a key of
    `_ANALYTE_GAP_WORDS`. Left unset the third test does not run, which
    is right for a caller whose label prefixes no other cell's name;
    every caller today is in `_extract_genetic` and every one of them
    sets it.

    AND THE FIRST ACCEPTED MATCH DOES NOT DECIDE. A number on a title, a
    method row, a detection-limit row, a reference row or a footnote is
    not read at all; a number on a REBUILT TABLE ROW outranks one on the
    report's own dedicated result row, which outranks one in a conclusion
    sentence, which outranks one on an unlabelled line, however far down
    the page each sits — see `_row_rank`. Within one rank the earliest
    match still wins, and pattern order still outranks everything,
    because both encode a preference a caller wrote down deliberately.

    THE EARLY EXIT IS `_BEST_ROW`, NOT `_DEDICATED_ROW`. The rebuilt
    table rows are appended LAST by `_page_rows`, so stopping at the
    first dedicated row returned before they were examined at all — and
    since the ties this scan has to break are precisely between an
    inherited label and a rebuilt row, that exit decided them by append
    order. It now stops only on the rank nothing can beat.
    """
    for pattern in patterns:
        compiled = re.compile(_cjk_safe(pattern), flags)
        best: Optional[re.Match] = None
        best_row: Optional[str] = None
        best_rank = _REFUSED_ROW
        for row in rows:
            if row.kind in _REFUSED_ROW_KINDS:
                continue
            for match in compiled.finditer(row.text):
                gap = match.groupdict().get("gap") or ""
                if _gap_names_a_method(gap):
                    continue
                if _gap_names_another_analyte(gap, analyte):
                    continue
                if not _gap_is_label_to_value(gap, analyte):
                    continue
                value_at = match.start("value") if "value" in match.groupdict() else match.start()
                rank = _row_rank(row, value_at)
                if rank >= _REFUSED_ROW:
                    continue
                if rank < best_rank:
                    best, best_row, best_rank = match, row.text, rank
                    if best_rank == _BEST_ROW:
                        break
            if best_rank == _BEST_ROW:
                break
        if best is not None:
            return best, best_row
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
    abnormal_flag: Optional[str] = None,
    reference_range_raw: Optional[str] = None,
    reference_low: Optional[float] = None,
    reference_high: Optional[float] = None,
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
            # PASSED THROUGH RATHER THAN READ HERE. `_build_field` writes
            # each of these only when the row printed one, so a caller
            # that reads no reference column produces exactly the shape
            # it always did. See `_row_context` for what the row said.
            abnormal_flag=abnormal_flag,
            reference_range_raw=reference_range_raw,
            reference_low=reference_low,
            reference_high=reference_high,
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
    a repeat count out of the same token; see `_read_cell`.
    Every gap class in this module now excludes `\\n`, so crossing a line
    happens only through the bounded windows, which is what this
    docstring always claimed. Do not write a new gap class without it.

    AND THEY EXCLUDE `(` FOR THE SAME KIND OF REASON. A gap that opens a
    bracket puts the captured number inside the analyte's OWN
    abbreviation: `(?:游离T3(?:\\(FT3\\))?)[^\\d\\n]{0,16}(\\d+)` over the
    row 「游离T3(FT3)」 backtracks out of the optional parenthetical, runs
    the gap into 「(FT」 and captures the 3 of the NAME — so a panel whose
    values sat on their own OCR lines published `ft3: 3` and `ft4: 4`,
    numbers no assay produced, while the row's real 5.2 and 16.8 were
    read only by the generic table reader under `table_*` keys. With `(`
    out of the gap the whole-text haystack simply misses and the
    two-line window pairs the name with its value, which is what these
    windows are for.
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
    #: The panel's own analyte vocabulary, which is what tells one row
    #: from another inside it — see `_row_context`.
    vocabulary: Dict[str, List[str]] = {
        name: list(meta.get("keywords", [])) for name, meta in definitions.items()
    }
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
        row = _row_context(vocabulary, field_name, lines, raw_value)
        _append_panel_number(
            fields,
            panel,
            field_name=field_name,
            raw_value=raw_value,
            normalized_value=normalized_value,
            # THE DEFINITION'S UNIT WINS WHERE IT HAS ONE, because a
            # hard-coded 「%」 is a statement about the analyte and the
            # row's is a reading of the page. Where it has none the row's
            # is all there is, and it used to be discarded.
            unit=unit or row.unit,
            # THE ROW, WHERE THE ROW READER FOUND ONE. `_panel_source_line`
            # answers with the first LINE carrying a keyword, and on the
            # cell-per-line layout that line is the analyte's name and
            # nothing else — evidence that does not contain the reading
            # it is evidence for. It also left
            # `_append_generic_table_fields` unable to tell that this row
            # had already been published, so a 甲功 panel shipped its FT3
            # twice: `ft3` and `table_游离t3`, both on `observations` and
            # — once the flag was carried — both in `abnormal_list`.
            source_text=row.source_text
            or _panel_source_line(lines, meta.get("keywords", []), raw_value),
            confidence=meta.get("confidence", confidence),
            abnormal_flag=row.flag,
            reference_range_raw=row.reference_raw,
            reference_low=row.reference_low,
            reference_high=row.reference_high,
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


#: Passed as `normalized_value` to say 「THIS CELL HAS NO TYPED VALUE」.
#:
#: `None` cannot say it. `None` is the ordinary 「nothing to normalise,
#: so fall back to the printed text」 that every qualitative cell in this
#: file relies on — `_safe_float("阴性(-)")` is None and the field must
#: still ship 阴性(-). So a caller that has REFUSED to type a cell had no
#: way to say so, and `_build_field` filled the gap with the printed text
#: anyway: the refused repeat count of 0 passed `normalized_value=None`
#: and shipped `normalized_value: 「0」`, which `_build_observations` then
#: read with `_exact_float` into `result.value_num: 0.0` and
#: `latest_summary.by_analyte`. Two comments asserted the cell was 「never
#: typed as a count」 while it was being typed as one.
NO_NORMALIZED_VALUE = object()


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
    reference_range_raw: Optional[str] = None,
    reference_low: Optional[float] = None,
    reference_high: Optional[float] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if normalized_value is NO_NORMALIZED_VALUE:
        normalized: Any = None
    elif normalized_value is not None:
        normalized = normalized_value
    else:
        normalized = field_value
    payload: Dict[str, Any] = {
        "field_name": field_name,
        "field_value": field_value,
        "normalized_value": normalized,
        "unit": unit,
        "side": side,
        "body_region": body_region,
        "source_page": source_page,
        "source_text": source_text,
        "confidence": round(float(confidence), 2),
    }
    if abnormal_flag:
        payload["abnormal_flag"] = abnormal_flag
    # WRITTEN ONLY WHEN THE ROW PRINTED ONE, so a field from an extractor
    # that reads no reference column keeps the shape it always had. A
    # one-sided limit leaves the other end None on purpose — 「<25」 is an
    # upper limit and no lower one, which is the whole of what a CKMB row
    # states, and recording it as one-sided is what stops it being
    # dropped for not being a pair. `_build_observations` is what carries
    # these onto `observations[].reference`.
    if reference_range_raw:
        payload["reference_range_raw"] = reference_range_raw
    if reference_low is not None:
        payload["reference_low"] = reference_low
    if reference_high is not None:
        payload["reference_high"] = reference_high
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


#: WHERE A HEADING MAY START. The head of its line, a space, an opening
#: bracket, or the end of the previous sentence — never welded to
#: another Chinese character, because a marker that follows one is a
#: word inside a phrase: the 查体 of 「请结合临床及查体」 follows 及, the
#: 主诉 of 「与主诉相符」 follows 与. `_normalize_text` has already folded
#: 。；（【 to . ; ( [ by the time this is asked.
_HEADING_STARTS = set(" \t\n([\"'.;!?")

#: WHERE A HEADING MAY END. Its separator, or the line. Running text
#: after the marker makes it a mention — the 查体 of 「结合临床查体.」 is
#: followed by ., the 个人史 of 「结合个人史及用药史」 by 及.
_HEADING_ENDS = set(" \t\n:)]")

#: A label the way a printed form prints one.
_FORM_FIELD_LABEL = _cjk_safe_compile(r"[一-龥A-Za-z][一-龥A-Za-z0-9]{0,7}:")


def _is_form_row(line: str) -> bool:
    """Is this line a row of form fields rather than a section of prose.

    THE REQUISITION IS WHY THIS EXISTS. A radiology, EMG or muscle-MRI
    report is printed with the referring clinician's requisition across
    the top of it, and that block carries 主诉 and 现病史 as columns
    beside 申请科室 and 申请医师::

        主诉:双下肢无力5年 现病史:进行性加重

    Those are the referrer's QUESTION, not the patient's story, and the
    document under them is a genuine imaging report.

    COLUMNS ARE THE DIFFERENCE, and it is the one the page itself draws.
    A form row lays fields side by side, so two or more labels are
    separated by nothing but whitespace. A narrative section owns its
    line, and two narrative sections that share one are separated by the
    end of a sentence rather than by a column gap — 「主诉:无力3年.现病
    史:进行性加重.」 is prose a wrap happened to join, and it stays prose
    because . is not whitespace.

    ONE COLUMN IS NOT A FORM ROW, deliberately: a requisition that
    prints 主诉 alone on its line is indistinguishable from a narrative
    that does, and where this cannot tell, the document stays a
    narrative.
    """
    return sum(1 for column in line.split() if _FORM_FIELD_LABEL.search(column)) >= 2


def _shows_heading(line: str, marker: str) -> bool:
    """Does `marker` sit on `line` as a section label rather than a word."""
    at = line.find(marker)
    while at >= 0:
        before = line[at - 1] if at else "\n"
        after = line[at + len(marker)] if at + len(marker) < len(line) else "\n"
        if before in _HEADING_STARTS and after in _HEADING_ENDS:
            return True
        at = line.find(marker, at + 1)
    return False


def _names_itself_a_narrative(line: str, marker: str) -> bool:
    """Does `line` carry `marker` as the document's own title.

    The name ENDS the line — 「xx医院 病历摘要」 — or carries its own
    separator, 「出院小结:」. What precedes it is not asked, because a
    longer name is still a name: the 病历摘要 inside 门诊病历摘要 is the
    page naming itself, while 「参见出院小结中的记载」 puts 中 after it and
    is a mention.
    """
    at = line.find(marker)
    while at >= 0:
        rest = line[at + len(marker) :]
        if not rest.strip() or rest[0] in _HEADING_ENDS:
            return True
        at = line.find(marker, at + 1)
    return False


def _narrative_structure(normalized: str) -> List[str]:
    """The narrative structure this document's own layout shows.

    `normalized` is `_normalized_search_text` output, whose line breaks
    survive — the layout IS the evidence, so it has to.

    Reads the two marker tuples in their POSITION rather than as
    substrings. See MEDICAL_SUMMARY_STRUCTURE_MARKERS for why: a word a
    result report prints as ordinary professional language is not a
    witness that the document is a narrative about a person.
    """
    witnesses: List[str] = []
    lines = normalized.split("\n")
    for marker in NARRATIVE_DOCUMENT_KIND_MARKERS:
        if any(_names_itself_a_narrative(line, marker) for line in lines):
            witnesses.append(marker)
    prose = [line for line in lines if not _is_form_row(line)]
    for marker in CLINICAL_STORY_SECTION_MARKERS:
        if any(_shows_heading(line, marker) for line in prose):
            witnesses.append(marker)
    return witnesses


def _classify_report(
    text: str,
    document_type_hint: Optional[str] = None,
    report_name: Optional[str] = None,
    *,
    demote_narrative: bool = True,
) -> Tuple[str, float, List[str]]:
    """What kind of document this is.

    `demote_narrative=False` returns the VOCABULARY winner with the
    structural demotion switched off. Its one caller is
    `analyze_fshd_report`, asking 「what does this narrative quote」 so it
    can run that extractor as well — see the note there. Nothing that
    decides a LABEL may pass it: the demotion is the label.
    """
    classification_text = text
    if report_name:
        classification_text = f"{report_name}\n{text}"
    normalized = _normalized_search_text(classification_text)
    # Read once and used twice — to SCORE `medical_summary` and, below,
    # to demote a result label the quoted values won.
    narrative = _narrative_structure(normalized)
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
            # `medical_summary` IS SCORED ON STRUCTURE, NOT ON THE WORD.
            #
            # Every one of its seven keywords is a document-kind name or
            # a story-section name, so `_narrative_structure` has
            # already decided which of them this page prints AS one.
            # Scoring them as substrings made an EMG report whose only
            # conclusion is 「肌源性损害电生理表现，与主诉相符」 score
            # `medical_summary` 2 against nothing — this file has no EMG
            # template — so the report came out labelled 病历摘要, and
            # the assistant's eligibility gate refuses to send a
            # narrative's text. The report is now `other`, which is the
            # honest answer for a document this parser has no template
            # for, and the gate refuses it as 「cannot tell」 rather than
            # as somebody's medical record.
            #
            # The weights stay: they are what keeps a real 病历摘要
            # ahead of the vocabulary its quoted result scores. It is
            # the MEMBERSHIP that structure decides.
            if report_type == "medical_summary" and keyword not in narrative:
                continue
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

    # WHAT A DOCUMENT IS, IS DECIDED ON STRUCTURE, NOT ON VOCABULARY.
    #
    # Two labels out of this function are read downstream as permission
    # — `isLaboratoryGeneticReport` on the API side asks for
    # `genetic_report` before anything may GRADE a genetics cell, and
    # the assistant's eligibility gate (`RESULT_DOCUMENT_TYPES` in
    # apps/api/src/modules/ai-agents/security/pii-redactor.ts) asks for
    # ANY of the fifteen result labels before a document's own
    # impression may be sent to a model at all. For both of them
    # 「contains the words」 is not good enough. A 门诊病历摘要 that quotes
    # a full genetic result outscores medical_summary on keywords alone
    # (measured: 18 to 16), and the uploader's declared `other` does not
    # outrank the classifier. See MEDICAL_SUMMARY_STRUCTURE_MARKERS.
    #
    # THE GUARD USED TO COVER `genetic_report` AND NOTHING ELSE, and a
    # narrative wins the other labels just as easily, on the same
    # mechanism: it is the quoted result that scores. Measured through
    # this function, one 出院小结 / 门诊病历 / 入院记录 / 病程记录 /
    # 住院病历 / 病历摘要 per label came back as `muscle_mri`,
    # `pulmonary_function`, `echocardiography`, `muscle_enzyme`,
    # `diaphragm_ultrasound`, `blood_routine`, `abdominal_ultrasound`
    # and `coagulation` — eight result labels, every one of them a
    # licence for the assistant to send that document's own impression
    # verbatim. So the demotion is asked of every label.
    #
    # EXCEPT `physical_exam`, WHICH IS DEFINED BY THESE SECTIONS. 肌力 /
    # 体格检查 / 查体 IS what a physical-exam document is, and three of
    # them are entries on CLINICAL_STORY_SECTION_MARKERS; demoting it
    # would relabel every one and lose `_extract_physical_exam`. It
    # needs no demotion either — the API's eligibility gate already
    # counts `physical_exam` as a non-result document, beside
    # `medical_summary` and `other`.
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
    # A REPORT WITH NO RECOGNISABLE STRUCTURE IS STILL PROMOTED. Where
    # the narrative structure does not show — an OCR that recovered the
    # result lines and none of the headings — this changes nothing, and
    # deliberately: demoting there would lose the patient's numbers
    # entirely, and for some patients the quoted count is the only copy
    # that exists. The API-side gates are what refuse to grade or to
    # send an unconfirmed document; this one only refuses to CALL it a
    # result.
    #
    # AND THE DEMOTION COSTS NO VALUES. `analyze_fshd_report` runs the
    # demoted document's OWN extractor as well as the narrative one, so
    # the 出院小结 that quotes an MRI still yields its muscle rows — it
    # yields them labelled 病历摘要, which is what it is.
    if demote_narrative and best_type not in ("medical_summary", "physical_exam"):
        if narrative:
            # Always `medical_summary`, never `other`: the structural
            # markers ARE the evidence for the label even when the
            # keyword rules scored nothing, and `medical_summary` is the
            # branch that also reads the quoted values — see the
            # dispatch in `analyze_fshd_report`. Landing on `other`
            # would drop them.
            demoted_from = best_type
            best_type = "medical_summary"
            best_score = max(scores.get("medical_summary", 0), 2 * len(narrative))
            confidence = min(0.99, 0.45 + best_score / 18.0)
            reasons["medical_summary"] = reasons.get("medical_summary", []) + [
                f"structure:文档带病历结构{'/'.join(narrative)}，不按{REPORT_TYPE_LABELS.get(demoted_from, demoted_from)}判读"
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


#: How short a line has to be to be a section HEADING rather than a
#: sentence that happens to use the word.
_DISCLAIMER_HEADER_MAX = 16

#: The end of a clause. `_normalize_text` has already folded 「。」 to
#: 「.」 and 「，」 to 「,」 by the time these lines exist, but both
#: spellings are listed because `_before_disclaimer_section` is also
#: reachable with text that has not been through it.
_CLAUSE_TERMINATORS = "。.;；,，、"


def _before_disclaimer_section(lines: List[str]) -> List[str]:
    """Drop the boilerplate tail so a conclusion search cannot reach it.

    THE TAIL IS NOT ALWAYS ITS OWN HEADING. This only ever cut when the
    marker word sat on a line of at most `_DISCLAIMER_HEADER_MAX`
    characters, so a limitations paragraph written INLINE — 「本次检测存
    在局限性: 本方法无法检测 D4Z4 重复序列长度, 该区域需通过 Southern
    blot 或分子梳检测。」 — was not cut at all. That paragraph is on
    every whole-exome report, and it names the two methods the exome did
    NOT use: `_detect_genetic_method` then saw short_read_sequencing AND
    southern_blot AND molecular_combing, returned 「ambiguous」, and the
    passport fell to unknown. Its own docstring names this scenario and
    calls the body cut 「the whole trick」 that handles it, so the cut is
    what had to change.

    So a marker inside a longer line cuts THAT LINE at the marker and
    everything after it, keeping whatever the line said first — a
    conclusion sentence followed by a caveat in the same paragraph keeps
    its conclusion.

    WHAT IS KEPT HAS TO BE A FINISHED CLAUSE. 「本次检测存在局限性:」
    opens with the caveat's own subject, so cutting at 局限性 leaves
    「本次检测存在」 — and that fragment came out as this report's
    `interpretation_summary`, which is the sentence the patient reads
    under 报告详情 → 来源追溯. So the head is trimmed back to its last
    clause terminator, which drops the caveat's own opening words and
    keeps whatever finished before them. A head with no terminator in it
    at all is nothing but that opening, and goes.
    """
    for index, line in enumerate(lines):
        stripped = line.strip()
        if len(stripped) <= _DISCLAIMER_HEADER_MAX:
            # A heading. The whole line goes.
            if any(h in stripped for h in _DISCLAIMER_SECTION_HEADERS):
                return lines[:index]
            continue
        at = min(
            (stripped.find(h) for h in _DISCLAIMER_SECTION_HEADERS if h in stripped),
            default=-1,
        )
        if at < 0:
            continue
        head = stripped[:at]
        ends = [head.rfind(mark) for mark in _CLAUSE_TERMINATORS]
        last = max(ends)
        kept = head[: last + 1].strip() if last >= 0 else ""
        return lines[:index] + ([kept] if kept else [])
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
    """Is this short line a person's name rather than a statement?

    A REFUSAL AND A FINDING ARE BOTH STATEMENTS, AND `_NOT_A_NAME` COULD
    NOT SAY SO. It is a list of whole phrases, so it answers only for the
    phrases somebody thought of — and the negation vocabulary of a
    genetics conclusion was not among them. 「未见缩短」 and 「阵列缩短」
    are four CJK characters alone on a line, which is the entire test
    `_BARE_NAME` applies, so a conclusion whose last line is the clause
    that MAKES IT NEGATIVE had that clause deleted: as a block line by
    `_extract_block_after_header`, and as a trailing token by
    `_strip_trailing_signature`. The report said the array was not
    shortened; the patient was shown a sentence that no longer said it.

    So the two vocabularies this file already keeps are asked as well —
    `_ABSENCE_MARKERS`, what was NOT found, and `_FINDING_MARKERS`, what
    was. Either of them present means the line is reporting, and a
    reporting line is not a signature whatever its length. Both are
    defined below this point in the file and resolved when this runs.
    """
    stripped = text.strip()
    if not _BARE_NAME.match(stripped) or stripped in _NOT_A_NAME:
        return False
    lowered = stripped.lower()
    if any(marker in lowered for marker in _ABSENCE_MARKERS):
        return False
    return not any(marker.lower() in lowered for marker in _FINDING_MARKERS)


def _strip_trailing_signature(text: str) -> str:
    """Drop a doctor's name from the tail of a conclusion.

    The signature is its own OCR line and gets joined onto the
    conclusion with a space —「…请结合临床. 钱医」. It is the reporting
    physician's name: a third party's identifier, in a field that is
    shown to the patient and sent to the model.

    THE CODE NOW DOES ONLY WHAT THAT SENTENCE JUSTIFIES. It used to pop
    every trailing token `_looks_like_signature` accepted, which is any
    two-to-four-character Chinese word — so 「…D4Z4阵列 未见缩短」 shipped
    as 「…D4Z4阵列」, a negative conclusion with the negation removed. The
    scenario the docstring describes has a mark of its own: the clause
    before the name has ENDED. A name appended to a finished clause is
    dropped; a word continuing an unfinished one is part of the finding
    and stays, whether or not anybody listed it.

    A value that is nothing but a name is still nothing but a name, and
    goes entirely.
    """
    parts = text.strip().split()
    while len(parts) > 1 and _looks_like_signature(parts[-1]):
        head = " ".join(parts[:-1]).rstrip()
        if not head or head[-1] not in _CLAUSE_TERMINATORS:
            break
        parts.pop()
    if len(parts) == 1 and _looks_like_signature(parts[0]):
        return ""
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

    A KEYWORD LINE THAT IS NOTHING BUT THE KEYWORD IS THE HEADER OF THE
    SENTENCE BELOW IT. On the cell-per-line OCR layout this module
    documents as the norm, 「检测结论」 is its own line and the
    conclusion is the NEXT one — and that sentence carries none of the
    keywords, so it was never a candidate. Worse, matching the bare
    header ENDED the search: `_clean_free_text` reduces 「检测结论」 to
    nothing, and that nothing was returned. Measured on a cell-per-line
    genetics report: `interpretation_summary` came out None, `findings`
    came out empty, and the report's own 检测结论 sentence appeared
    NOWHERE in the payload — not in the genetic summary, not in the
    structured field, not under 报告详情 → 来源追溯, and not in what the
    assistant is handed as the report's own words.

    So a header that cleans to nothing hands off to the first line under
    it that says something, and a header with no sentence under it does
    not stop the scan.
    """
    lowered_keywords = [keyword.lower() for keyword in keywords]
    stripped_lines = [line.strip() for line in lines]
    for index, stripped in enumerate(stripped_lines):
        if not stripped or _is_header_only(stripped):
            continue
        if require_digit and not re.search(r"\d", stripped):
            continue
        if _is_disclaimer(stripped):
            continue
        lowered = stripped.lower()
        if not any(keyword in lowered for keyword in lowered_keywords):
            continue
        value = _clean_free_text(stripped)
        if value:
            return value
        value = _summary_line_under_header(stripped_lines, index, require_digit=require_digit)
        if value:
            return value
    return None


def _summary_line_under_header(
    stripped_lines: List[str],
    header_index: int,
    *,
    require_digit: bool = False,
) -> Optional[str]:
    """The first line under a bare header that states something.

    Stops at the next header, at a disclaimer and at a signature, so a
    header with nothing under it answers None rather than reaching down
    the page for someone else's sentence.
    """
    for stripped in stripped_lines[header_index + 1:]:
        if not stripped:
            continue
        if _is_header_only(stripped) or _is_header_row(stripped):
            return None
        if _is_disclaimer(stripped) or _looks_like_signature(stripped):
            return None
        if require_digit and not re.search(r"\d", stripped):
            return None
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

    The sentences are cut on `_SENTENCE_BREAK`, which is where the
    numbers a genetics laboratory prints survive the cut.
    """
    if not block:
        return None
    sentences = [part.strip() for part in _SENTENCE_BREAK.split(block) if part.strip()]
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

    The cut covers a limitations paragraph written inline as well as one
    under its own heading — it did not, and that gap is what this
    docstring used to describe as handled. See
    `_before_disclaimer_section`.

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
        if any(re.search(_cjk_safe(pattern), haystack, re.IGNORECASE) for pattern in patterns)
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
_LENGTH_UNIT_AFTER = _cjk_safe_compile(r"\s*(kb|bp|mb)\b", re.IGNORECASE)

#: A COMPARATOR IMMEDIATELY BEFORE THE NUMBER MAKES IT A BOUND.
#:
#: `_BOUND_CELL` already states this doctrine for the table reader — a
#: one-sided limit is a REFERENCE, and 「D4Z4重复单元数 >10」 read as a
#: count of 10 drops the comparator and lands the patient exactly on the
#: boundary that sends a reader off to evaluate FSHD2. The prose reader
#: had no such test: its gap class `[^\d\n(]{0,16}` happily swallows the
#: 「>」 or the 「大于」 and hands back the bare digits, so the same row
#: reached `d4z4_repeat_pathogenic: 10` at 0.97 whenever it was not
#: sitting under a section header that refused it wholesale.
#:
#: The Chinese spellings are here because a laboratory writes the
#: reference in words as often as in symbols, and — see `_cjk_safe` —
#: they are matched without `\b`, which would never fire against CJK.
_BOUND_BEFORE_VALUE = re.compile(
    r"(?:[<>≤≥⩽⩾]|大于等于|小于等于|不小于|不大于|不少于|不多于|不低于|不高于"
    r"|大于|小于|超过|多于|少于|至少|最多)\s*$"
)


def _line_around(text: str, index: int) -> str:
    """The single line `index` falls on, newline excluded."""
    return _line_span(text, index)[0]


def _asserts_absence(text: str, match: "re.Match") -> bool:
    """Does the line this match sits on say the thing was NOT found?"""
    line = _line_around(text, match.start()).lower()
    return any(marker in line for marker in _ABSENCE_MARKERS)


def _is_hedged(text: str, match: "re.Match") -> bool:
    """Does the line this match sits on merely suspect the thing?"""
    line = _line_around(text, match.start()).lower()
    return any(marker in line for marker in _HEDGE_MARKERS)


#: The FSHD type token, on its own and not inside a longer one.
_DIAGNOSIS_TYPE_TOKEN = _cjk_safe_compile(r"\bFSHD\s*([12])\b", re.IGNORECASE)

#: A COUNT IS NEVER THE DIGIT OF A LATIN TOKEN — and the token this
#: exists for is FSHD1.
#:
#: The last-resort repeat-count pattern is 「any digit within 16
#: characters of D4Z4」, and on the ordinary Chinese positive conclusion
#:
#:     …D4Z4重复序列缩短,符合FSHD1分子诊断标准.
#:
#: the gap from D4Z4 to that digit is exactly 14 characters, so the value
#: captured was the 「1」 of FSHD1. A report printing NO repeat count
#: anywhere — which is most positive Southern blot reports, they state
#: the conclusion and leave the array size to the fragment row —
#: published `d4z4_repeat_pathogenic: 1` at 0.97, the confidence of a
#: cell actually read, with `latest_summary.by_analyte…value_num: 1.0`
#: and nothing in the review queue. One repeat is the most severe
#: contraction there is; the patient it was invented for had no count on
#: their report at all.
#:
#: A lookbehind for a Latin letter rather than for the four letters of
#: FSHD, because the shape is what is wrong: a digit welded to the end
#: of a Latin word is part of that word's NAME. 4qA, D4Z4 and every
#: gene symbol a genetics report prints have the same property, and a
#: laboratory writes a count after a Chinese character, a separator or a
#: space — never after a letter.
_NOT_INSIDE_A_LATIN_TOKEN = r"(?<![A-Za-z])"


def _read_diagnosis_type(rows: List[_Row]) -> Tuple[Optional[str], Optional[re.Match]]:
    """THE TYPE THE REPORT STATES, WHICH IS NOT THE TYPE IT IS NAMED FOR.

    This was `re.search` for the first FSHD1/FSHD2 token anywhere on the
    page, with the absence and hedge tests asked only of the line that
    token happened to sit on — and the first occurrence on a real report
    is its TITLE or its 检测项目 line. Measured on a report that excludes
    the type in its own words:

        FSHD1 基因检测报告
        检测结果: D4Z4 重复单元数 18
        结论: 本次检测不支持 FSHD1, 建议评估 FSHD2。

    came out `diagnosis_type: FSHD1` at 0.98 — the value the passport
    prints under 分型, the exports carry and `applyGeneticReportAutofill`
    writes into `patient_profiles`. Every FSHD report is titled after the
    type it was ordered to look for, so this fired on the negative ones
    as a class, not on an edge case.

    THE PER-TOKEN REFUSAL WAS NOT ENOUGH, AND COULD NOT BE. It only
    reaches a title when the conclusion happens to repeat the token and
    negate it. The ordinary Chinese negative conclusion does not repeat
    it — 「检测结果: 未见 4q35 D4Z4 阵列缩短, 结果在正常范围」 states the
    exclusion without naming a type at all — so on that wording the
    title was the only candidate left and won at the unlabelled rank.
    A title is now refused BECAUSE IT IS A TITLE, before any token is
    read off it: see `_page_rows`.

    The per-token refusal stays, for what it does cover: a type named in
    a negating or hedging clause anywhere is not stated, however many
    other times the page prints it. Kept per token, so 「符合 FSHD1，不
    支持 FSHD2」 still reports FSHD1 — the two are different claims and
    refusing both would lose a real diagnosis. Among what is left, a
    token on a dedicated result row outranks one in a conclusion
    sentence, which outranks one on an unlabelled line — see `_row_rank`.
    """
    refused: set = set()
    candidates: List[Tuple[int, int, str, re.Match]] = []
    for position, row in enumerate(rows):
        for match in _DIAGNOSIS_TYPE_TOKEN.finditer(row.text):
            token = f"FSHD{match.group(1)}"
            if _asserts_absence(row.text, match) or _is_hedged(row.text, match):
                # A refusal printed on a title or a method row is still
                # this report refusing the type, so it is collected
                # before the kind is consulted.
                refused.add(token)
                continue
            rank = _row_rank(row, match.start())
            if rank >= _REFUSED_ROW:
                continue
            candidates.append((rank, position, token, match))
    for _, _, token, match in sorted(candidates, key=lambda item: (item[0], item[1])):
        if token not in refused:
            return token, match
    return None, None


#: The 4q35 allele token, matched on its own and not inside a word.
_HAPLOTYPE_TOKEN = _cjk_safe_compile(r"\b(4qA|4qB)\b", re.IGNORECASE)

#: Labels of a row WHOSE SUBJECT IS THE HAPLOTYPE — a dedicated result
#: row, where the token that follows is the answer and the only answer.
_HAPLOTYPE_DEDICATED_LABELS = (
    "单倍型",
    "haplotype",
    "分型",
)

#: Labels under which a line is stating a result of SOME kind, the
#: allele among possibly several things. A 结论 sentence is the ordinary
#: example and it is why this tier is separate from the one above — see
#: `_read_haplotype`.
_HAPLOTYPE_RESULT_LABELS = (
    "等位基因",
    "allele",
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


def _haplotype_tokens_on(line: str) -> Tuple[List[str], List[str], List[str]]:
    """The 4qA / 4qB tokens a line states, split by the label that
    introduces each: `(dedicated, result, unlabelled)`.

    A LABEL INTRODUCES THE TOKEN THAT FOLLOWS IT, not the one that
    precedes it. 「附注: 4qA 为允许型单倍型」 is a footnote defining the
    term and it contains 单倍型, so a line-contains test read it as a
    second stated result and withheld the 4qB the report actually
    printed above it. The label sits AFTER the token there and BEFORE it
    on every real result row — 「4q35 单倍型: 4qA」, 「结果示 … 单倍型
    4qA」 — which is the same 「the value belongs to the label next to
    it」 rule `_read_cell` applies to the numeric cells.

    WHICH label is the tier: the NEAREST one to the token's left, so a
    line carrying both — 「结论: … 单倍型为 4qA」 — is read as the
    dedicated row it is rather than as a sentence that merely mentions
    an allele.

    Method and probe lines state nothing in any bucket, and neither does
    a line asserting the allele was NOT found.
    """
    lowered = line.lower()
    if any(label in lowered for label in _HAPLOTYPE_METHOD_LABELS):
        return [], [], []
    if any(marker in lowered for marker in _ABSENCE_MARKERS):
        return [], [], []
    dedicated: List[str] = []
    result: List[str] = []
    unlabelled: List[str] = []
    for match in _HAPLOTYPE_TOKEN.finditer(line):
        token = match.group(1)[:2].lower() + match.group(1)[2].upper()
        bucket = unlabelled
        nearest = -1
        for labels, candidate in (
            (_HAPLOTYPE_DEDICATED_LABELS, dedicated),
            (_HAPLOTYPE_RESULT_LABELS, result),
        ):
            for label in labels:
                at = lowered.rfind(label, 0, match.start())
                if at > nearest:
                    nearest = at
                    bucket = candidate
        if token not in bucket:
            bucket.append(token)
    return dedicated, result, unlabelled


def _read_haplotype(rows: List[_Row]) -> Tuple[Optional[str], Optional[str]]:
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

    Three tiers, in this order:

      1. a DEDICATED haplotype row — 单倍型 / haplotype / 分型. The row's
         whole subject is the allele, so what it states is the answer.
      2. otherwise a line labelled as a result of some other kind —
         结果 / 结论 / 等位基因.
      3. otherwise any remaining line, because an OCR that recovered the
         result lines and lost their headings is common and dropping the
         allele there loses a real reading.

    TIER 1 EXISTS BECAUSE A ROW OUTRANKS A SENTENCE. This routine used
    to union the labelled tokens across ALL lines and then require
    unanimity of the union, and 结果 and 结论 were both on that one list
    — so the routine bi-allelic Southern blot conclusion, which names
    the contracted 4qA allele and the normal 4qB one in ONE SENTENCE,
    put both tokens in the labelled bucket and wiped out the haplotype
    the same report states on its own 单倍型 row directly above it. That
    is not an edge case: naming both alleles is how a bi-allelic
    Southern blot conclusion is written, so the report that states the
    allele most plainly was the one this platform refused to read, and
    the passport fell to `unspecified_haplotype` on it.

    A method or probe line is excluded from every tier, and each tier
    answers only when what IT saw is UNANIMOUS — a tier that names both
    alleles stops the search rather than deferring to the next one,
    because a contradiction inside one tier is exactly the case the
    withholding is for. Both tokens stated, or nothing stated outside
    the method line, returns no haplotype rather than whichever came
    first.

    A TITLE, A METHOD ROW AND A FOOTNOTE ARE OUT BEFORE ANY TIER IS
    CONSIDERED, because `_page_rows` labelled them. That is what keeps
    the third tier honest: 「附注: 4qA 为允许型单倍型」 is a definition of
    the term, and on a report printing 「4q35单倍型4qB」 — the no-space
    spelling, invisible to the old `\\b`-anchored token — the footnote
    was the only allele the reader could see, so the ONE test that says
    FSHD1 cannot be the mechanism here answered 4qA. The nearest-label
    rule inside `_haplotype_tokens_on` handles a footnote that mentions
    the term; the row kind handles one that IS a footnote.
    """
    tiers: Tuple[List[str], List[str], List[str]] = ([], [], [])
    sources: List[Optional[str]] = [None, None, None]
    for row in rows:
        if row.kind in _REFUSED_ROW_KINDS:
            continue
        for index, tokens in enumerate(_haplotype_tokens_on(row.text)):
            for token in tokens:
                if token not in tiers[index]:
                    tiers[index].append(token)
            if tokens and sources[index] is None:
                sources[index] = row.text.strip()
    for index, tokens in enumerate(tiers):
        if not tokens:
            continue
        return (tokens[0], sources[index]) if len(tokens) == 1 else (None, None)
    return None, None


def _extract_genetic(lines: List[str], fields: List[Dict[str, Any]], findings: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    # THE PAGE IS SEGMENTED INTO LABELLED ROWS BEFORE ANY PATTERN RUNS.
    #
    # `_page_rows` gives every line of the report body the kind of row it
    # is — title, method, footnote, a row inside the 检测结果 section,
    # or a row rebuilt from the cell-per-line OCR layout — and every
    # reader below asks the ROW rather than re-deriving the answer from
    # the characters around a match. See the note above `_page_rows`.
    #
    # THE CELL-PER-LINE TABLE IS REBUILT INTO THAT LIST. Every gap in
    # this extractor is `[^\d\n(]{0,N}` — deliberately, so a label on one
    # line cannot reach a number on the next — and the OCR layout this
    # module documents as the norm emits ONE TEXT BOX PER TABLE CELL. So
    # on a genetics report whose repeat count sits in a table, the label
    # and its number are on separate lines and not one pattern here can
    # see them: the count was read only by `_append_generic_table_fields`,
    # which slugged 「D4Z4甲基化水平」 and 「D4Z4重复单元数」 onto the SAME
    # key and dropped the second. `_table_row_lines` puts the row back
    # together as one row so the canonical readers — the gap tests, the
    # absence test, the kb test, the zero refusal — get the cell they
    # were written for.
    #
    # THE BOILERPLATE TAIL IS CUT FIRST, for the readers as well as for
    # the conclusion. A limitations paragraph is full of numbers that
    # answer somebody else's question, and this extractor used to run
    # over the whole page including it.
    body = _before_disclaimer_section(lines)
    rows = _page_rows(body)
    # NAMING A TYPE IS NOT DIAGNOSING IT. 「本次检测不支持 FSHD1」 and
    # 「临床怀疑 FSHD1，请进一步检查」 both named FSHD1 and both came out
    # as this patient's diagnosis at 0.98 — the value the passport
    # prints, the exports carry, and `applyGeneticReportAutofill` writes
    # into `patient_profiles`. A report that excludes a type, or only
    # suspects one, has not stated one. The sentence itself survives on
    # `interpretation_summary`, which is displayed and not graded.
    #
    # AND NEITHER IS BEING TITLED AFTER IT — see `_read_diagnosis_type`,
    # where a title is refused because `_page_rows` labelled it one,
    # rather than because the conclusion happened to repeat the token.
    diagnosis_type, diagnosis_match = _read_diagnosis_type(rows)

    # 4qA is the token the whole FSHD1 reading rests on — FSHD1 cannot be
    # the mechanism on a 4qB allele — so it is read off the RESULT, never
    # off the first place the page happens to print it. See
    # `_read_haplotype`.
    haplotype, haplotype_source = _read_haplotype(rows)

    # EVERY NUMERIC CELL BELOW IS READ WITH `_read_cell`, which
    # is where the 「a number near the label is the label's number」 bug
    # is fixed for all of them at once. Each pattern names its gap so
    # that helper can judge it; each names its value so the group
    # numbers stay readable now that the gap is a group too.
    # 大小 / size READ THE SAME CELL AS 片段长度, and until they were
    # here 「D4Z4 大小: 20 kb」 produced NOTHING AT ALL: the fragment
    # patterns required the literal labels EcoRI or 片段长度, and the
    # repeat count's own last-resort pattern refuses that number
    # correctly, because 大小 is a `fragment_length` word in
    # `_ANALYTE_GAP_WORDS`. So a stated array size fell between the two
    # and the report read as though it carried no size at all.
    #
    # Every one of these requires the printed kb unit, which is what
    # keeps 大小 — a word with other uses — from reading a number that
    # is not a length. The key it lands on names EcoRI because this
    # platform has one length cell and that is its name; what any reader
    # does with it is 「a length in kb, not a repeat count」, which is
    # true whichever enzyme cut it.
    ecori_match, _ = _read_cell(
        rows,
        [
            r"EcoRI(?P<gap>[^\d\n(]{0,16})(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>kb|KB)",
            r"片段长度(?P<gap>[^\d\n(]{0,16})(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>kb|KB)",
            r"大小(?P<gap>[^\d\n(]{0,16})(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>kb|KB)",
            r"\bsize(?P<gap>[^\d\n(]{0,16})(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>kb|KB)",
            # LAST, AND IT IS WHAT MAKES THE REFUSAL BELOW HONEST. The
            # `length_in_kb` refusal fires on ANY 「D4Z4 … N kb」 spelling
            # while the four patterns above each require their own
            # literal label, so on 「检测结果: D4Z4阵列38kb」 — no EcoRI,
            # no 片段长度, no 大小 — the measurement was refused as a
            # count and recorded NOWHERE, under a comment saying it was
            # 「already recorded under its own name as
            # ecori_fragment_kb」. The refusal and the recording now
            # cover the same spellings. Tried last so a row that DOES
            # carry its own label still reports through it.
            r"D4Z4(?P<gap>[^\d\n(]{0,16})(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>kb|KB)",
        ],
        analyte="fragment_length",
    )
    ecori_fragment = ecori_match.group("value") if ecori_match else None

    d4z4_pair_match, d4z4_row = _read_cell(
        rows,
        [
            r"D4Z4(?P<gap>[^\d\n(]{0,24})" + _NOT_INSIDE_A_LATIN_TOKEN + r"(?P<value>\d+)\s*[/／]\s*(?P<other>\d+)",
            r"重复数(?P<gap>[^\d\n(]{0,20})" + _NOT_INSIDE_A_LATIN_TOKEN + r"(?P<value>\d+)\s*[/／]\s*(?P<other>\d+)",
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
    #
    # A DETERMINATE COUNT IS TRIED FIRST, AND THE INTERVAL TEST IS PART
    # OF THE PATTERN RATHER THAN OF THE ORDERING.
    #
    # The range branch used to be searched over the WHOLE document
    # before the single-count branch was tried at all, so any interval
    # printed anywhere near the token D4Z4 outranked the determinate
    # count on the result row: a population reference interval, or — the
    # measured case — the grey zone quoted back in the conclusion,
    # 「结论: D4Z4 重复单元数 1-10 为缩短范围」 on a report whose own row
    # reads 5. The interval replaced the 5, `normalized_value` went
    # empty, and the passport reported the item as having no determinate
    # result on a report that states one plainly.
    #
    # Ordering alone cannot fix it — trying the single pattern first
    # over 「1-10」 reports 1, which is the bug the range branch was
    # written for. So the single pattern now REFUSES a number that is
    # the left edge of a printed interval, and the range branch reads
    # only what is left: on 「1-10」 the single pattern matches nothing
    # (the gap cannot cross a digit, so there is no other number at that
    # anchor to fall back to) and the range still answers.
    d4z4_is_range = False
    if not d4z4_pathogenic:
        d4z4_single_match, d4z4_single_row = _read_cell(
            rows,
            [
                r"D4Z4(?P<gap>[^\d\n(]{0,16})"
                + _NOT_INSIDE_A_LATIN_TOKEN
                + r"(?P<value>\d+)(?!\s*(?:-|–|—|~|～|至|到)\s*\d)"
            ],
            analyte="repeat_count",
        )
        if d4z4_single_match:
            d4z4_pathogenic = d4z4_single_match.group("value")
            d4z4_source_text = d4z4_single_match.group(0)
            d4z4_match = d4z4_single_match
            d4z4_row = d4z4_single_row
        else:
            d4z4_range_match, d4z4_range_row = _read_cell(
                rows,
                [
                    r"D4Z4(?P<gap>[^\d\n(]{0,16})"
                    + _NOT_INSIDE_A_LATIN_TOKEN
                    + r"(?P<value>\d+\s*(?:-|–|—|~|～|至|到)\s*\d+)"
                ],
                analyte="repeat_count",
            )
            if d4z4_range_match:
                d4z4_pathogenic = re.sub(r"\s+", "", d4z4_range_match.group("value"))
                d4z4_source_text = d4z4_range_match.group(0)
                d4z4_match = d4z4_range_match
                d4z4_row = d4z4_range_row
                d4z4_is_range = True

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
    # THAT SENTENCE IS TRUE OF EVERY kb SPELLING AND OF NO OTHER UNIT.
    # It used to be true of neither: the refusal fires on any 「D4Z4 … N
    # kb」 while the length patterns each required a literal label, so
    # 「D4Z4阵列38kb」 was refused as a count and recorded nowhere. The
    # length patterns now end with a D4Z4-anchored kb fallback, which
    # covers exactly what the refusal covers in kb.
    #
    # `_LENGTH_UNIT_AFTER` ALSO REFUSES bp AND mb, AND THOSE ARE NOT
    # RECORDED. This platform has one length cell, it is named and typed
    # in kilobases, and converting a laboratory's printed unit to fill it
    # would be this module restating a measurement it was not given. A
    # 「D4Z4 … N bp」 report therefore carries no length — which is the
    # honest outcome, not an oversight, and is the sentence to change if
    # a second length cell is ever added.
    #
    # A 0 IS KEPT. The cell really does print 0, and a reviewer has to
    # see that it was read and refused rather than find the row missing.
    # It is never typed as a count, and its confidence puts it in the
    # review queue.
    #
    # 「Never typed as a count」 IS ENFORCED BY `NO_NORMALIZED_VALUE`, and
    # it used to be asserted by this comment and by the one on
    # `normalized_summary` while being false in both: passing
    # `normalized_value=None` is how a qualitative cell asks
    # `_build_field` to fall back to the printed text, so the refused
    # cell shipped `normalized_value: 「0」`, `_build_observations` read
    # it with `_exact_float` into `result.value_num: 0.0`, and
    # `latest_summary.by_analyte.d4z4_repeat_pathogenic.value_num` was
    # 0.0 — a laboratory count of zero, on the two channels a model and
    # the passport read numbers off.
    #
    # AND THE REFUSAL APPLIES TO BOTH SIDES OF A PAIR. It was asked only
    # of `d4z4_pathogenic`, while `d4z4_other` comes off the SAME match
    # and was typed unconditionally — so 「D4Z4 重复数 3/0」 published
    # `d4z4_repeat_other` = 0 with `normalized_value: 0`, and
    # `_build_observations` carried it to `result.value_num: 0.0` and
    # `latest_summary.by_analyte`: the two channels the note on
    # `NO_NORMALIZED_VALUE` names as the whole reason this refusal
    # exists. A repeat count of zero is not a valid reading on either
    # allele.
    #
    # AND A BOUND IS KEPT, ON THE SAME TERMS AS THE 0. 「D4Z4重复单元数
    # >10」 is either the population reference or a genuinely one-sided
    # result — a Southern blot that could not resolve a large array
    # really does report 「>10」 — and the two are not distinguishable
    # from the row. What IS certain either way is that 10 is not this
    # patient's count: it is the grey-zone boundary, so publishing it
    # types a patient the report places ABOVE the FSHD1 range as sitting
    # on its edge. The comparator is put back on `field_value` so the
    # cell reads 「>10」 and not 「10」 to the reviewer and the model.
    d4z4_refusal: Optional[str] = None
    d4z4_bound: Optional[str] = None
    if d4z4_match is not None and d4z4_pathogenic and not d4z4_is_range:
        value_at = (
            d4z4_match.start("value")
            if "value" in d4z4_match.groupdict()
            else d4z4_match.start()
        )
        bound_before = _BOUND_BEFORE_VALUE.search((d4z4_row or "")[:value_at])
        if _asserts_absence(d4z4_row or "", d4z4_match):
            d4z4_refusal = "negated"
        elif _LENGTH_UNIT_AFTER.match(d4z4_row or "", d4z4_match.end()):
            d4z4_refusal = "length_in_kb"
        elif bound_before is not None:
            d4z4_refusal = "reference_bound"
            d4z4_bound = bound_before.group(0).strip()
        elif d4z4_pathogenic.isdigit() and int(d4z4_pathogenic) == 0:
            d4z4_refusal = "zero"
    if d4z4_refusal in {"negated", "length_in_kb"}:
        # `d4z4_other` only ever comes off the pair match, which is the
        # same match just judged, so it goes with it.
        d4z4_pathogenic = None
        d4z4_other = None
        d4z4_source_text = None
    elif d4z4_refusal == "reference_bound" and d4z4_bound:
        # Shown as the report printed it. `normalized_value` is already
        # `NO_NORMALIZED_VALUE` for any refusal, so nothing downstream
        # does arithmetic on either half of this string.
        d4z4_pathogenic = f"{d4z4_bound}{d4z4_pathogenic}"
        d4z4_other = None
    # Kept visible and never typed, on the same terms as the pathogenic
    # side: a reviewer has to see that the row was read and refused
    # rather than find it missing.
    d4z4_other_refused = bool(d4z4_other) and d4z4_other.isdigit() and int(d4z4_other) == 0

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
    methylation_match, _ = _read_cell(
        rows,
        [r"甲基化(?P<gap>[^\d\n(]{0,8})(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>%?)"],
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

    genetic_method = _detect_genetic_method(body)
    # THE SENTENCE THE PATIENT READS IS THE ONE THE REPORT CONCLUDED
    # WITH, WHEN IT STATES A FINDING.
    #
    # This tried the 检测结果 block first and only fell through to the
    # 结论 line when the block came back empty — and 建议 is one of the
    # block's stop keywords. The standard Chinese negative conclusion
    # carries it in the middle of the sentence: 「结论: 本次检测不支持
    # FSHD1, 建议评估 FSHD2。」 So the block stopped ONE LINE SHORT of the
    # exclusion, answered with the result row above it, and the fallback
    # that would have found the exclusion never ran. Measured on exactly
    # that report: `interpretation_summary` came out 「D4Z4 重复单元数
    # 18」 — a bare number, with the sentence saying the test does not
    # support FSHD1 nowhere in the payload at all. That sentence is what
    # the patient reads under 报告详情 → 来源追溯 and what the assistant
    # is given as the report's own words.
    #
    # So the conclusion line is preferred WHEN IT STATES A FINDING —
    # `_FINDING_MARKERS`, the same test `_pick_finding_sentence` applies
    # inside a block. A bare 「结论: 详见下述」 states nothing and does
    # not displace the block; a conclusion that excludes, confirms or
    # hedges a type does.
    conclusion_line = _extract_summary_line(
        body,
        ["检测结论", "结论", "结果分析", "解读", "提示", "interpretation", "impression"],
    )
    block_sentence = _pick_finding_sentence(
        _extract_block_after_header(
            body,
            ["检测结果", "检测结论", "结果分析"],
            ["遗传咨询", "建议", "变异位点", "检测方法"],
        )
    )
    if conclusion_line and any(marker in conclusion_line for marker in _FINDING_MARKERS):
        interpretation = conclusion_line
    else:
        interpretation = block_sentence or conclusion_line
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
                NO_NORMALIZED_VALUE
                if (d4z4_is_range or d4z4_refusal)
                else int(d4z4_pathogenic)
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
            normalized_value=(
                NO_NORMALIZED_VALUE if d4z4_other_refused else int(d4z4_other)
            ),
            source_text=d4z4_pair_match.group(0) if d4z4_pair_match else None,
            confidence=0.30 if d4z4_other_refused else 0.94,
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
        # `field_value` is the raw text. Same for a refused cell on
        # EITHER side of a pair — a 0 is what the report printed, not a
        # count anything may use, and the structured fields beside this
        # one now say the same thing rather than falling back to the
        # printed digit. See `NO_NORMALIZED_VALUE`.
        "d4z4_repeat_pathogenic": (
            int(d4z4_pathogenic)
            if d4z4_pathogenic and not d4z4_is_range and not d4z4_refusal
            else None
        ),
        "d4z4_repeat_other": (
            int(d4z4_other) if d4z4_other and not d4z4_other_refused else None
        ),
        "genetic_test_method": genetic_method,
        "methylation_value": _safe_float(methylation_value) if methylation_value else None,
        "interpretation_summary": interpretation,
    }


#: A QUANTITY, AND NEVER THE FRACTIONAL HALF OF ONE.
#:
#: The third face of the decimal-point defect, and the one that only
#: became reachable once `_extract_sentences` stopped cutting 「病程 18.5
#: 年」 in two. `(\d{1,2})\s*年` has nothing to stop it starting AFTER
#: the decimal point, so the sentence that survived the split was then
#: read as a disease duration of 5 years — a patient eighteen and a half
#: years into a progressive myopathy described to the assistant as five,
#: on `disease_duration`, which the exports carry.
#:
#: A digit run is a number only when neither a digit nor a decimal point
#: sits immediately to its left, which is the same rule `_SENTENCE_BREAK`
#: applies to the dot itself. The fractional part is captured too: 18.5
#: years is what the record says, and rounding it here would be this
#: module inventing precision it was not given.
_QUANTITY = r"(?<![\d.])(\d{1,3}(?:\.\d+)?)"


def _as_number(text: str) -> Any:
    """A captured quantity as `int` when it is whole, `float` otherwise."""
    value = _exact_float(text)
    if value is None:
        return None
    return int(value) if value.is_integer() else value


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
            onset_match, _ = _find_regex(
                sentence,
                [
                    rf"{_QUANTITY}\s*岁[^。;；]*(?:起病|发病)",
                    rf"(?:起病|发病)[^。;；]*{_QUANTITY}\s*岁",
                ],
            )
            if onset_match:
                onset_age = _as_number(onset_match.group(1))
                onset_sentence = sentence
        if disease_duration is None:
            duration_match, _ = _find_regex(
                sentence,
                [
                    rf"(?:病程|发病|患病)[^。;；]*{_QUANTITY}\s*年",
                    rf"{_QUANTITY}\s*年(?:前|余)[^。;；]*(?:出现|起病|发病)",
                ],
            )
            if duration_match:
                disease_duration = _as_number(duration_match.group(1))
                duration_sentence = sentence
        if family_history is None and "家族史" in sentence:
            family_history = sentence
        if current_function_status is None and any(keyword in sentence for keyword in ["行走", "爬楼", "抬手", "呼吸", "上下楼", "步态"]):
            current_function_status = sentence
        if any(keyword in sentence for keyword in ["翼状肩胛", "面肌无力", "足下垂", "beevor", "肩胛突出"]):
            key_signs.append(sentence)
        if any(keyword in sentence for keyword in ["起病", "发病", "加重", "进展", "确诊", "检查提示"]):
            normalized_age = None
            age_match, _ = _find_regex(sentence, [rf"{_QUANTITY}\s*岁"])
            if age_match:
                normalized_age = _as_number(age_match.group(1))
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

        left_match, _ = _find_regex(sentence, [r"(?:左|left)[^0-5\n(]{0,12}([0-5](?:[+-])?)"])
        right_match, _ = _find_regex(sentence, [r"(?:右|right)[^0-5\n(]{0,12}([0-5](?:[+-])?)"])

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
        "fvc": [r"\bFVC\b[^\d\n(]{0,10}(\d+(?:\.\d+)?)\s*(L|%)?"],
        "fvc_pred_pct": [r"FVC(?:[% ]*Pred|占预计值|预计%)?[^\d\n(]{0,12}(\d+(?:\.\d+)?)\s*(%)"],
        "fev1": [r"\bFEV1\b[^\d\n(]{0,10}(\d+(?:\.\d+)?)\s*(L|%)?"],
        "fev1_pred_pct": [r"FEV1(?:[% ]*Pred|占预计值|预计%)?[^\d\n(]{0,12}(\d+(?:\.\d+)?)\s*(%)"],
        "fev1_fvc": [r"FEV1/FVC[^\d\n(]{0,12}(\d+(?:\.\d+)?)\s*(%)"],
        "tlc": [r"\bTLC\b[^\d\n(]{0,10}(\d+(?:\.\d+)?)\s*(L|%)?"],
        "tlc_pred_pct": [r"TLC(?:[% ]*Pred|占预计值|预计%)?[^\d\n(]{0,12}(\d+(?:\.\d+)?)\s*(%)"],
        "dlco": [r"\bDLCO\b[^\d\n(]{0,10}(\d+(?:\.\d+)?)\s*([A-Za-z/%·]+)?"],
        "dlco_pred_pct": [r"DLCO(?:[% ]*Pred|占预计值|预计%)?[^\d\n(]{0,12}(\d+(?:\.\d+)?)\s*(%)"],
        "dlco_va": [r"DLCO/VA[^\d\n(]{0,12}(\d+(?:\.\d+)?)\s*([A-Za-z/%·]+)?"],
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
        "right_qb": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bQB\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)"],
        "right_db": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bDB\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)"],
        "right_vs": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bVS\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)"],
        "left_qb": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bQB\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)"],
        "left_db": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bDB\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)"],
        "left_vs": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bVS\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)"],
        "right_ee": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bEE\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)"],
        "right_ei": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bEI\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)"],
        "right_di": [r"(?:右侧|右膈肌|R)[^\n]{0,20}\bDI\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)"],
        "left_ee": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bEE\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)"],
        "left_ei": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bEI\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)"],
        "left_di": [r"(?:左侧|左膈肌|L)[^\n]{0,20}\bDI\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)"],
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
        "right": [r"右侧膈肌[^\d\n(]{0,12}(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"],
        "left": [r"左侧膈肌[^\d\n(]{0,12}(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"],
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
        "heart_rate": [r"(?:HR|心率|房率|室率)[^\d\n(]{0,8}(\d+(?:\.\d+)?)\s*(?:bpm|次/分)?"],
        "pr_interval_ms": [r"(?:\bPR\b|P-R间期)[^\d\n(]{0,8}(\d+(?:\.\d+)?)\s*(ms|毫秒)?"],
        "qrs_duration_ms": [r"\bQRS\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)\s*(ms|毫秒)?"],
        "qt_ms": [r"\bQT\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)\s*(ms|毫秒)?"],
        "qtc_ms": [r"\bQTc\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)\s*(ms|毫秒)?"],
        "axis_p": [r"P轴[^\d\n(-]{0,8}(-?\d+(?:\.\d+)?)"],
        "axis_qrs": [r"QRS轴[^\d\n(-]{0,8}(-?\d+(?:\.\d+)?)"],
        "axis_t": [r"T轴[^\d\n(-]{0,8}(-?\d+(?:\.\d+)?)"],
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
        "lvef": [r"(?:LVEF|EF|射血分数)[^\d\n(]{0,8}(\d+(?:\.\d+)?)\s*(%)"],
        "fs": [r"\bFS\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)\s*(%)"],
        "co": [r"\bCO\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)\s*([A-Za-z/]+)?"],
        "hr": [r"(?:HR|心率)[^\d\n(]{0,8}(\d+(?:\.\d+)?)\s*(?:bpm|次/分)?"],
        "lad": [r"\bLAD\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)\s*(mm|cm)?"],
        "aod": [r"\bAOD\b[^\d\n(]{0,8}(\d+(?:\.\d+)?)\s*(mm|cm)?"],
        "lvd_d": [r"(?:LVDd|LVDD)[^\d\n(]{0,8}(\d+(?:\.\d+)?)\s*(mm|cm)?"],
        "e_over_e_prime": [r"E/E['′]?[^\d\n(]{0,8}(\d+(?:\.\d+)?)"],
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
        "wbc": {"patterns": [r"(?:白细胞计数|WBC)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["白细胞计数", "WBC"]},
        "neut_pct": {"patterns": [r"(?:中性粒细胞比率|NEUT%|%NEUT)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "unit": "%", "keywords": ["中性粒细胞比率", "NEUT"]},
        "neut_abs": {"patterns": [r"(?:中性粒细胞数|NEUT#|#NEUT)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["中性粒细胞数", "NEUT"]},
        "lymph_pct": {"patterns": [r"(?:淋巴细胞比率|LYMPH%|%LYMPH)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "unit": "%", "keywords": ["淋巴细胞比率", "LYMPH"]},
        "lymph_abs": {"patterns": [r"(?:淋巴细胞数|LYMPH#|#LYMPH)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["淋巴细胞数", "LYMPH"]},
        "mono_pct": {"patterns": [r"(?:单核细胞比率|MONO%|%MONO)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "unit": "%", "keywords": ["单核细胞比率", "MONO"]},
        "mono_abs": {"patterns": [r"(?:单核细胞数|MONO#|#MONO)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["单核细胞数", "MONO"]},
        "eos_pct": {"patterns": [r"(?:嗜酸细胞百分比|EOS%|%EOS)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "unit": "%", "keywords": ["嗜酸细胞百分比", "EOS"]},
        "eos_abs": {"patterns": [r"(?:嗜酸细胞数|EOS#|#EOS)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["嗜酸细胞数", "EOS"]},
        "baso_pct": {"patterns": [r"(?:嗜碱细胞百分比|BASO%|%BASO)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "unit": "%", "keywords": ["嗜碱细胞百分比", "BASO"]},
        "baso_abs": {"patterns": [r"(?:嗜碱细胞数|BASO#|#BASO)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["嗜碱细胞数", "BASO"]},
        "rbc": {"patterns": [r"(?:红细胞计数|RBC)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["红细胞计数", "RBC"]},
        "hgb": {"patterns": [r"(?:血红蛋白量|血红蛋白|HGB)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["血红蛋白", "HGB"]},
        "hct": {"patterns": [r"(?:红细胞比积|HCT)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["红细胞比积", "HCT"]},
        "mcv": {"patterns": [r"(?:平均红细胞体积|MCV)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["平均红细胞体积", "MCV"]},
        "mch": {"patterns": [r"(?:平均血红蛋白含量|MCH)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["平均血红蛋白含量", "MCH"]},
        "mchc": {"patterns": [r"(?:平均血红蛋白浓度|MCHC)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["平均血红蛋白浓度", "MCHC"]},
        "rdw_sd": {"patterns": [r"(?:红细胞分布宽度标准差|RDW-SD)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["红细胞分布宽度标准差", "RDW-SD"]},
        "rdw_cv": {"patterns": [r"(?:红细胞分布宽度变异系数|RDW-CV|RDW)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["红细胞分布宽度变异系数", "RDW"]},
        "plt": {"patterns": [r"(?:血小板计数|PLT)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["血小板计数", "PLT"]},
        "mpv": {"patterns": [r"(?:血小板平均体积|MPV)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["血小板平均体积", "MPV"]},
        "pct": {"patterns": [r"(?:血小板比积|PCT)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["血小板比积", "PCT"]},
        "pdw": {"patterns": [r"(?:血小板分布宽度|PDW)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["血小板分布宽度", "PDW"]},
        "plcr": {"patterns": [r"(?:大型血小板比率|P-LCR|PLCR)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["大型血小板比率", "P-LCR"]},
        "nrbc": {"patterns": [r"(?:有核红细胞|NRBC)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["有核红细胞", "NRBC"]},
    }
    _extract_numeric_panel(text, lines, fields, panel, definitions)
    normalized_summary["lab_panel"] = panel


def _extract_thyroid_function(lines: List[str], fields: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    panel: Dict[str, Any] = normalized_summary.get("lab_panel", {})
    definitions = {
        "ft3": {"patterns": [r"(?:游离T3(?:\(FT3\))?|FT3结果?)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["游离T3", "FT3"]},
        "ft4": {"patterns": [r"(?:游离T4(?:\(FT4\))?|FT4结果?)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["游离T4", "FT4"]},
        "tsh": {
            "patterns": [
                r"(?:超敏促甲状腺素(?:\(TSH3?\))?|促甲状腺激素(?:\(TSH3?\))?)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)",
                r"(?:^|\n)\s*(?:TSH3?|sTSH)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)",
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
        "pt": {"patterns": [r"(?:凝血酶原时间|PT)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["凝血酶原时间", "PT"]},
        "inr": {"patterns": [r"(?:国际标准化比值|PT-INR|INR)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["国际标准化比值", "INR"]},
        "aptt": {"patterns": [r"(?:活化部分凝血活酶时间|APTT)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["活化部分凝血活酶时间", "APTT"]},
        "fibrinogen": {"patterns": [r"(?:纤维蛋白原|FIB|Fg)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["纤维蛋白原", "FIB", "Fg"]},
        "tt": {"patterns": [r"(?:凝血酶时间|TT)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["凝血酶时间", "TT"]},
        "d_dimer": {"patterns": [r"(?:D[ -]?二聚体定量|D-Dimer|D二聚体)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["D-二聚体", "D-Dimer"]},
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
        "urine_specific_gravity": {"patterns": [r"(?:比重|SG)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["比重", "SG"]},
        "urine_ph": {"patterns": [r"(?:pH值|pH)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["pH值", "pH"]},
        "urine_rbc": {"patterns": [r"(?:红细胞\(RBC\)|红细胞/HPF|红细胞)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["红细胞", "RBC"]},
        "urine_wbc": {"patterns": [r"(?:白细胞\(WBC\)|白细胞/HPF|白细胞)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["白细胞", "WBC"]},
        "urine_bacteria": {"patterns": [r"(?:细菌|BACT)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["细菌", "BACT"]},
        "urine_epithelial_cells": {"patterns": [r"(?:上皮细胞|EC)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["上皮细胞", "EC"]},
        "urine_mucus": {"patterns": [r"(?:粘液丝|MUCS)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["粘液丝", "MUCS"]},
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
        "trust_titer": {"patterns": [r"(?:TRUST滴度)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["TRUST滴度"]},
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
        "hp_dob": {"patterns": [r"(?:DOB|DPM值)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"], "keywords": ["DOB", "DPM值"]},
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


#: `_ASCII_WORD_BOUNDARY` with the hyphen inside the word, for analyte
#: abbreviations. See `_analyte_keyword_pattern`.
_ANALYTE_TOKEN_BOUNDARY = r"(?:(?<![0-9A-Za-z_-])|(?![0-9A-Za-z_-]))"


@lru_cache(maxsize=512)
def _analyte_keyword_pattern(keyword: str) -> "re.Pattern":
    """`keyword`, anchored so a Latin abbreviation is not read inside a word.

    THE SAME `\\b` DEFECT, IN A SUBSTRING TEST. The analyte keywords in
    `_extract_labs` were matched with `keyword in line`, and several of
    them are one or two Latin letters: `k` for 钾, `p` for 无机磷, `ca`
    for 钙, `cr` for 肌酐. On the ordinary Chinese spelling
    「肌酸激酶(CK): 890 U/L」 the `k` of `(CK)` matched, and the patient's
    CREATINE KINASE — the muscle-damage marker an FSHD report is
    uploaded for, and one that runs an order of magnitude above the
    reference range — was published a second time as
    `potassium: 890 U/L`, a potassium of 890 being an unsurvivable
    figure. 「血小板计数(PLT)」 fed its count to 无机磷 the same way.

    A Latin keyword needs a boundary at whichever end is Latin; a
    Chinese one needs none, because 钾 does not occur inside a longer
    Latin token. A lookaround rather than `\\b` for the reason the note
    on `_ASCII_WORD_BOUNDARY` gives: the neighbouring character on a
    Chinese report is usually CJK, and `\\b` does not fire there.

    THE HYPHEN IS PART OF THE WORD HERE, which `\\b` would not have
    given either. `mb` — myoglobin — matched inside 「(CK-MB)」, so a
    CK-MB of 25 was published as this patient's MYOGLOBIN as well, and
    the 肌红蛋白 row further down never reached the field because the
    first line carrying a keyword wins. The old keyword list tried to
    say this by padding the short ones with spaces (「 mb 」), which
    fails on every Chinese report because there are no spaces to pad
    against. A hyphenated abbreviation is one token, so `-` joins the
    alphabet the boundary is defined on.

    A BOUNDARY ONLY ANSWERS FOR THE LATIN NAMES. `ck` inside `CK-MB` is
    settled here; 肌酸激酶 inside 肌酸激酶同工酶 is the same collision
    with no boundary to appeal to, and it is settled in
    `_competing_analyte_keywords`.
    """
    stripped = keyword.strip()
    pattern = re.escape(stripped)
    if re.match(r"[0-9A-Za-z_-]", stripped):
        pattern = _ANALYTE_TOKEN_BOUNDARY + pattern
    if re.search(r"[0-9A-Za-z_-]$", stripped):
        pattern = pattern + _ANALYTE_TOKEN_BOUNDARY
    return re.compile(pattern, re.IGNORECASE)


#: ANALYTE NAMES THIS MODULE DOES NOT OWN, LISTED SO THAT IT KNOWS THEM
#: WHEN IT SEES THEM.
#:
#: `_competing_analyte_keywords` computes collisions from the map, which
#: closes every collision BETWEEN TWO CELLS THE MAP OWNS — 肌酸激酶 inside
#: 肌酸激酶同工酶, 低密度脂蛋白 inside 极低密度脂蛋白. It cannot see the
#: other half of the class: a mapped name printed inside the name of an
#: analyte the map has never heard of. A cardiac panel is an ordinary
#: thing for an FSHD patient to upload, and measured on a synthetic one
#: in the ordinary 项目/结果/单位/参考区间 layout, six rows published six
#: other patients' analytes:
#:
#:     脑钠肽(BNP) 1580 pg/mL     →  sodium: 1580     (钠 inside 脑钠肽)
#:     超敏肌钙蛋白I 0.85 ng/mL   →  calcium: 0.85    (钙 inside 肌钙蛋白)
#:     前白蛋白(PA) 180 mg/L      →  alb: 180         (白蛋白 inside 前白蛋白)
#:     β2微球蛋白 3.6 mg/L        →  globulin: 3.6    (球蛋白 inside 微球蛋白)
#:     尿肌酐 8500 umol/L         →  creatinine: 8500 (a urine result as serum)
#:     尿磷 22 mmol/24h           →  phosphorus: 22   (the same, one column over)
#:
#: A sodium of 1580 is not a survivable figure and a creatinine of 8500
#: is a dialysis emergency; each was published at 0.93 with the row's own
#: unit and reference interval attached, which is what makes them read as
#: measurements rather than as noise.
#:
#: WHAT IS AND IS NOT ON THIS LIST. Every entry is a printed analyte name
#: that CONTAINS a name the map owns — that is the only shape this list
#: can act on, since a name containing nothing mapped collides with
#: nothing. They were collected from the vocabulary this repo already
#: carries: the analyte names in the panel definitions above
#: (`_extract_blood_routine`, `_extract_thyroid_function`,
#: `_extract_coagulation`, `_extract_urinalysis`), the names in
#: `REPORT_TYPE_RULES`, and the rows the archived corpus prints — the
#: 超敏肌钙蛋白I row in `tests/test_fshd_report_service.py` among them.
#: A name that belongs to a cell the map SHOULD own is not listed here;
#: it is added to that cell's keywords instead, which closes the
#: collision through the map and reads the row at the same time — see
#: 磷酸肌酸激酶 on `ck` and 白蛋白/球蛋白 on `a_g_ratio`.
#:
#: THE URINE FORMS ARE HERE BECAUSE A URINE RESULT IS NOT A SERUM ONE.
#: Only the bare 尿X spellings are listed: 「24小时尿钙」 contains 「尿钙」,
#: so the interval spellings are covered by containment.
_FOREIGN_ANALYTE_NAMES: Tuple[str, ...] = (
    # 钠
    "脑钠肽", "钠尿肽", "利钠肽",
    # 钙
    "肌钙蛋白", "降钙素原", "降钙素",
    # 白蛋白
    "前白蛋白", "微量白蛋白", "糖化白蛋白",
    # 球蛋白
    "微球蛋白", "免疫球蛋白", "甲状腺球蛋白",
    # 血红蛋白 (the 血常规 panel's own cell)
    "糖化血红蛋白",
    # 磷
    "酸性磷酸酶", "磷脂",
    # a urine analyte is not the serum one
    "尿肌酐", "尿钙", "尿磷", "尿钾", "尿钠", "尿氯", "尿镁",
    "尿葡萄糖", "尿总蛋白", "尿白蛋白", "尿尿素", "尿淀粉酶",
)


def _competing_analyte_keywords(
    analytes: Dict[str, List[str]], field_name: str
) -> Tuple[str, ...]:
    """Other analytes' names that CONTAIN one of this analyte's names.

    THE CHINESE HALF OF THE SAME DEFECT AS `_analyte_keyword_pattern`,
    and the one that costs the most on an FSHD report. A boundary keeps
    `ck` out of `CK-MB`; nothing kept 肌酸激酶 out of 肌酸激酶同工酶,
    which is the printed Chinese name of the very same row. Measured on
    the ordinary panel order:

        肌酸激酶同工酶(CK-MB): 25 U/L
        肌酸激酶(CK): 890 U/L

    the first line carrying a keyword wins, so `ck` was published as 25
    — a NORMAL creatine kinase — on a patient whose CK is 890, an order
    of magnitude above the reference range and the muscle-damage marker
    this platform exists to track. Three more collisions of the same
    shape are live in the map below: 低密度脂蛋白 inside 极低密度脂蛋白
    (an LDL-C of 3.10 published as the VLDL 0.45), 磷 inside 碱性磷酸酶
    (an ALP of 80 published as a phosphorus of 80), and 脂蛋白a inside
    载脂蛋白a1.

    This is the same rule `_ANALYTE_GAP_WORDS` states for the genetics
    cells — a label that is a PREFIX of another cell's name reaches into
    that other cell's row — computed from the map rather than written
    out, so an analyte added later is covered without anyone noticing
    that it needs to be.

    AND THE MAP IS NOT THE WHOLE VOCABULARY OF A LABORATORY REPORT. A
    computed answer only sees the cells this module owns; the same
    collision with a cell it has never heard of — 钠 inside 脑钠肽 — has
    to be told. `_FOREIGN_ANALYTE_NAMES` is that half, and it is read
    through the identical containment test, so a name added to either
    side behaves the same way.
    """
    mine = [k.strip().lower() for k in analytes[field_name] if k and k.strip()]
    competing: List[str] = []
    for other, other_keywords in analytes.items():
        if other == field_name:
            continue
        for keyword in other_keywords:
            token = (keyword or "").strip().lower()
            if token and any(m != token and m in token for m in mine):
                competing.append(token)
    for name in _FOREIGN_ANALYTE_NAMES:
        token = name.strip().lower()
        if token and any(m != token and m in token for m in mine):
            competing.append(token)
    return tuple(dict.fromkeys(competing))


#: A CELL THAT IS THE TABLE'S OWN ROW INDEX — 「*9」, 「#12」. The marker
#: is the printer's, not the laboratory's, and the digits after it are a
#: position in the table, so it is never a measurement. This is the cell
#: an LDH of 319 was published as 9 off; see `_names_a_method`.
#:
#: ONLY THE MARKED FORM, and deliberately. A bare 「9」 on its own line is
#: the same shape as a reading of 9, and the context that would tell them
#: apart — 「the next cell names an analyte」 — does not: on a two-column
#: 名称/结果 table with no reference or unit column, EVERY reading is a
#: bare number whose next cell names the following analyte. Refusing on
#: that would drop a real reading from every such table to catch a row
#: whose value the laboratory omitted, which is the more common case lost
#: to the rarer one. The marked index needs no such guess.
_ROW_INDEX_CELL = re.compile(r"^[*#]\s*\d{1,3}$")

#: A token — a run with no digits and no spaces in it — with no analyte
#: cell inside it. Splitting on digits is what keeps the row index and
#: the reading out of the token: 「*14肌酸激酶(CK)」 is 「*」 and
#: 「肌酸激酶(CK)」, and a flattened row is its name, its figures and its
#: method column as separate tokens.
_NON_NUMERIC_TOKEN = re.compile(r"[^\s\d]+")


def _names_a_method(token: str) -> bool:
    """`token` names the ASSAY, not the analyte the assay measures.

    A CHINESE ASSAY IS NAMED AFTER THE ENZYME THAT DRIVES IT, so the
    method column of an ordinary biochemistry panel is full of tokens
    that are an analyte's own printed name with 法 glued on. Measured on
    a real archived report — patient_documents 62dd3f96, a 常规生化全套
    from 福建医科大学附属第一医院 — the ALT row's method column reads
    「乳酸脱氢酶法」, and on the cell-per-line OCR layout that is a line
    of its own, printed ELEVEN ROWS ABOVE the report's actual
    「*12乳酸脱氢酶(LDH)」. `_extract_lab_value` takes the first line
    carrying a keyword, so 乳酸脱氢酶 matched the METHOD, found no number
    on it, and read forward into the next row — where the first number
    is 「*9」, the AST row's INDEX. An LDH of 319 against an upper limit
    of 250 was published to a clinician as 9.

    THIS IS `_gap_names_a_method` FOR THE LABORATORY PATH. Round 26 built
    that defence for the genetics cells — a gap that is nothing but
    method words is not a label separator — and this half of the file
    never got it. The shape, not the instance: a method name is not a
    result label anywhere in this module, so this is checked for EVERY
    analyte rather than for LDH. Ten of the map's entries have a Chinese
    name that heads a common assay name — 肌酸激酶法, 尿素酶法, 尿酸酶法,
    肌酐酶法, 葡萄糖氧化酶法, 磷钼酸法, 钙羧基偶氮法, 镁二甲苯胺蓝法 and
    乳酸脱氢酶法 among them — and every one of them was one printing order
    away from the same reading. Only LDH happened to be bitten on this
    report; nothing but the order in which the laboratory listed its
    methods was protecting the other nine.

    A token, not a line, so a row printed on ONE line keeps its reading:
    「丙氨酸氨基转移酶(ALT) 21 9-50 U/L 乳酸脱氢酶法」 refuses its last
    token and reads its first. `_looks_like_analyte` takes the whole cell
    instead, which is right for the cell-per-line reader it serves and
    wrong here.
    """
    if not token or any(character.isdigit() for character in token):
        return False
    lowered = token.lower()
    if lowered.endswith("法"):
        return True
    return any(word.lower() in lowered for word in _METHOD_WORDS)


#: CACHED, AND RETURNING TUPLES, because every one of the map's analytes
#: rescans every line of the document: without this the two span readers
#: below ran 35 times over the same text and tripled the cost of a parse.
#: Tuples rather than lists so a caller cannot extend the cached answer —
#: `matched_span` builds its own list on top of this one.
@lru_cache(maxsize=1024)
def _method_name_spans(line: str) -> Tuple[Tuple[int, int], ...]:
    """Where on `line` an assay method is named. See `_names_a_method`."""
    return tuple(
        (match.start(), match.end())
        for match in _NON_NUMERIC_TOKEN.finditer(line)
        if _names_a_method(match.group())
    )


@lru_cache(maxsize=1024)
def _unit_token_spans(line: str) -> Tuple[Tuple[int, int], ...]:
    """Where on `line` a COMPOUND UNIT is printed.

    `mg` IS BOTH MAGNESIUM AND A MILLIGRAM. `_analyte_keyword_pattern`
    answers 「is this hit inside a longer word」 and both readings clear
    that: 「mg/dL」 puts a token boundary right after the `mg`. So the
    unit column of any row reporting in milligrams named itself
    magnesium, and on the cell-per-line layout it then read forward for
    a number — measured, 「血清铁 12.0 mg/dL 200」 published
    `magnesium: 200`, which is a serum iron's neighbouring cell.

    THE SAME SHAPE AS `_names_a_method`, one column further right: a
    token that is a unit is not a result label. Only a hit STRICTLY
    INSIDE the token is refused, which is what keeps a report that
    prints its analyte column in Latin readable — a lone 「CK」 cell is
    unit-shaped too, and it spans its whole token, so it still names
    creatine kinase.
    """
    return tuple(
        (match.start(), match.end())
        for match in _NON_NUMERIC_TOKEN.finditer(line)
        if len(match.group()) > 1 and _UNIT_CELL.match(match.group())
    )


#: THE LABORATORY'S OWN VERDICT ON THE ROW, which the captured snippet
#: has always contained and nothing ever read. See `_read_row_flag`.
#:
#: Arrows and words. These are matched as SUBSTRINGS of the row, which
#: none of them can be inside anything else; the single-letter flags are
#: a different shape and live in `_LETTER_FLAG_CELLS`.
_ROW_FLAG_MARKERS: Tuple[Tuple[str, str], ...] = (
    ("↑", "high"), ("偏高", "high"), ("升高", "high"), ("增高", "high"),
    ("↓", "low"), ("偏低", "low"), ("降低", "low"), ("减低", "low"),
)

#: THE SAME FLAG, PRINTED AS ONE LETTER — the Sysmex and Beckman
#: convention, and the one every analyser exporting a Western LIS format
#: uses. It is a WHOLE CELL, never a substring, and that is the whole of
#: what makes it readable: 「U/L」 — the unit on every enzyme row an FSHD
#: report is uploaded for — contains an `L`, and 「HDL-C」 an `H`.
#:
#: THE COST OF NOT KNOWING THEM WAS NOT ONLY THE LOST FLAG. `is_unit_only`
#: in `_extract_lab_value` accepts any Latin run, so on the ordinary
#: cell-per-line order 项目 / 结果 / 提示 / 单位 the flag cell was taken
#: as the row's UNIT: measured on a synthetic 心肌酶谱 in exactly that
#: layout, a CK of 693 was published as 「693H」 with the laboratory's
#: 「U/L」 dropped and its abnormal marker nowhere in the payload — on the
#: marker this disease is monitored by.
#:
#: 「HH」 and 「LL」 are the panic spellings of the same two directions; a
#: bare 「N」 or 「A」 is deliberately absent, because a report that prints
#: 「N」 for normal also prints 「N」 for nothing at all and 「A」 opens
#: 「ALT」 as often as it means abnormal.
_LETTER_FLAG_CELLS: Dict[str, str] = {
    "h": "high",
    "hh": "high",
    "l": "low",
    "ll": "low",
}

#: A two-sided reference interval inside a row. The lookarounds stop the
#: scan starting or ending in the middle of a number, so 「1.41 1.2-1.6」
#: reads the interval and not 「41 1」.
_ROW_RANGE = re.compile(
    r"(?<![\d.])(\d+(?:\.\d+)?)\s*[-~—～]\s*(\d+(?:\.\d+)?)(?![\d.])"
)

#: A number on a row, with whatever unit is glued to its right.
_LAB_NUMBER = re.compile(r"([<>≤≥]?\d+(?:\.\d+)?)\s*([A-Za-z/%μµ·/\-]+)?")

#: A ONE-SIDED reference limit — 「<25」, 「>1.04」. Recorded as one-sided
#: rather than dropped: an upper limit with no lower one is the whole of
#: what a CKMB or a cholesterol row prints, and dropping it leaves the
#: reading with nothing to be abnormal against.
_ROW_BOUND = re.compile(r"([<>≤≥])\s*(\d+(?:\.\d+)?)(?![\d.])")


def _read_row_flag(row_text: str) -> Optional[str]:
    """The abnormal marker the laboratory printed on this row.

    THE ARROWS AND THE WORDS ARE SUBSTRINGS; THE LETTERS ARE CELLS. A
    row is either a run of cells joined by spaces or a flattened line
    whose columns are separated by them, so in both shapes the flag
    column is a whitespace-delimited token — which is the only reading
    of 「H」 that does not also fire on the `L` of 「U/L」 or the `H` of
    「HDL-C」. See `_LETTER_FLAG_CELLS`.
    """
    for marker, direction in _ROW_FLAG_MARKERS:
        if marker in row_text:
            return direction
    for token in row_text.split():
        direction = _LETTER_FLAG_CELLS.get(token.strip().lower())
        if direction:
            return direction
    return None


def _is_row_flag_cell(cell: str) -> bool:
    """`cell` is nothing but this row's abnormal marker.

    A FLAG BELONGS TO THE ROW IT FLAGS. 「偏高」 has CJK in it, no digits
    and no method word, so `_looks_like_analyte` calls it an analyte name
    — which is harmless where that function is used, and not harmless as
    a row boundary: a laboratory that spells the flag out instead of
    printing 「↑」 ended the row between the reading and its reference
    interval, and the row lost both its unit and the interval this round
    exists to record.

    A ONE-LETTER FLAG IS UNIT-SHAPED, which is the other half of the
    same statement: this predicate is what `is_unit_only` and
    `extract_numeric_value` ask before they let a cell be the row's unit,
    so 「H」 stops being published as the unit of a creatine kinase.
    """
    stripped = cell.strip()
    if not stripped:
        return False
    if re.fullmatch(r"[↑↓→]+", stripped):
        return True
    if stripped.lower() in _LETTER_FLAG_CELLS:
        return True
    return any(stripped == marker for marker, _ in _ROW_FLAG_MARKERS)


def _read_row_reference(
    row_text: str, value: Optional[str]
) -> Tuple[Optional[str], Optional[float], Optional[float]]:
    """The reference interval printed on this row, as `(raw, low, high)`.

    A two-sided interval wins over a one-sided limit, and a one-sided
    limit that IS the reading — the row printed 「<0.01」 and nothing else
    — is not also reported as that reading's reference.
    """
    interval = _ROW_RANGE.search(row_text)
    if interval:
        return (
            interval.group(0).strip(),
            _safe_float(interval.group(1)),
            _safe_float(interval.group(2)),
        )
    reading = (value or "").replace(" ", "")
    for bound in _ROW_BOUND.finditer(row_text):
        raw = f"{bound.group(1)}{bound.group(2)}"
        if raw == reading:
            continue
        limit = _safe_float(bound.group(2))
        if bound.group(1) in "<≤":
            return raw, None, limit
        return raw, limit, None
    return None, None, None


def _unit_from_row(row_text: str, value: Optional[str]) -> Optional[str]:
    """The unit printed to the RIGHT of the reading, as its own cell.

    `_LAB_NUMBER` only takes a unit GLUED to the number, so a row that
    prints its columns apart — 「血红蛋白量(HGB) 98 ↓ 130-175 g/L」, the
    ordinary 项目 / 结果 / 提示 / 参考区间 / 单位 order — came back with
    no unit at all, and the panel path then shipped whatever unit was
    hard-coded in the definition or none. This reads the cell.

    To the right of the reading, because that is where a unit column
    sits and because the cells to its LEFT are the analyte's own name.
    A flag, a bare number, a bound and an interval are each excluded by
    name: 「98」 is unit-shaped to `_UNIT_CELL` on its own, and so is
    「H」.
    """
    tokens = row_text.split()
    start = 0
    if value:
        wanted = value.strip()
        for position, token in enumerate(tokens):
            if token.strip() == wanted:
                start = position + 1
                break
    for token in tokens[start:]:
        cell = token.strip()
        if not cell or _is_row_flag_cell(cell):
            continue
        if _VALUE_CELL.match(cell) or _BOUND_CELL.match(cell) or _RANGE_CELL.match(cell):
            continue
        if _UNIT_CELL.match(cell):
            return cell
    return None


class _LabReading(NamedTuple):
    """One analyte's row: what it read, and what the row said about it."""

    value: Optional[str] = None
    unit: Optional[str] = None
    source_text: Optional[str] = None
    flag: Optional[str] = None
    reference_raw: Optional[str] = None
    reference_low: Optional[float] = None
    reference_high: Optional[float] = None


_NO_LAB_READING = _LabReading()


def _extract_lab_value(
    lines: List[str],
    keywords: Iterable[str],
    competing: Tuple[str, ...] = (),
) -> _LabReading:
    keyword_tokens = [keyword.lower().strip() for keyword in keywords if keyword and keyword.strip()]

    def matched_span(lowered_line: str) -> Optional[Tuple[int, int]]:
        """Where this analyte is named on the line, if it really is.

        A hit COVERED BY a competing analyte's longer name is that other
        analyte's row, not this one — 肌酸激酶 inside 肌酸激酶同工酶. The
        line is not refused outright, only that hit: a flattened OCR row
        naming both still lets each find its own.

        A hit covered by a METHOD NAME is not a row at all — 乳酸脱氢酶
        inside 乳酸脱氢酶法, the assay printed in the ALT row's method
        column. Same mechanism, same reason, one more list of spans; see
        `_names_a_method` for the reading it cost.

        A hit STRICTLY INSIDE a unit is that unit — `mg` inside 「mg/dL」.
        Strictly, because a whole token may legitimately be both: see
        `_unit_token_spans`.
        """
        covering: List[Tuple[int, int]] = list(_method_name_spans(lowered_line))
        for token in competing:
            covering.extend(
                (other.start(), other.end())
                for other in _analyte_keyword_pattern(token).finditer(lowered_line)
            )
        units = _unit_token_spans(lowered_line)
        for keyword in keyword_tokens:
            for hit in _analyte_keyword_pattern(keyword).finditer(lowered_line):
                covered = any(
                    start <= hit.start() and end >= hit.end() for start, end in covering
                ) or any(
                    start <= hit.start()
                    and end >= hit.end()
                    and (end - start) > (hit.end() - hit.start())
                    for start, end in units
                )
                if not covered:
                    return hit.start(), hit.end()
        return None

    def extract_numeric_value(line: str) -> Tuple[Optional[str], Optional[str]]:
        """The row's READING — never a number belonging to its interval.

        `re.search` took the first number on the text, and on a row whose
        result column the OCR did not recover that number is the
        reference interval's lower bound. Measured on a second archived
        copy of the same panel, read by the Tesseract fallback
        (patient_documents 0dcab9e5): 「# 14 肌酸激酶(CK) 人 50-310 U/L
        速率法」 published `ck: 50` — the bottom of the normal range,
        presented as this patient's creatine kinase, on a patient whose
        CK is 693. LDH published 120 the same way.

        `_BOUND_CELL` states this rule for the cell-per-line reader — a
        limit is a reference by default, and is the reading only when the
        row prints no bare number at all. Here it also has to cover the
        two-sided interval, because a flattened row keeps 「50-310」 in
        one piece where the cell reader would have seen a `_RANGE_CELL`.
        """
        reserved = [match.span() for match in _ROW_RANGE.finditer(line)]

        def outside_the_interval(span: Tuple[int, int]) -> bool:
            return not any(start <= span[0] and end >= span[1] for start, end in reserved)

        candidates = [
            match for match in _LAB_NUMBER.finditer(line) if outside_the_interval(match.span(1))
        ]
        bare = [match for match in candidates if match.group(1)[0] not in "<>≤≥"]
        chosen = next(iter(bare or candidates), None)
        if chosen is None:
            return None, None
        unit = (chosen.group(2) or "").strip() or None
        # THE CELL AFTER THE NUMBER IS NOT ALWAYS THE UNIT. On a
        # flattened row 「肌酸激酶(CK) 693 H 50-310 U/L」 the trailing
        # group takes the `H`, which is the laboratory's abnormal flag.
        # Same statement as `is_unit_only` makes for the cell-per-line
        # layout, one column earlier.
        if unit and _is_row_flag_cell(unit):
            unit = None
        return chosen.group(1), unit

    def search_segment(line: str) -> str:
        span = matched_span(line.lower())
        if span is None:
            return line
        return re.sub(r"^\s*\([^)]+\)\s*", "", line[span[1] :])

    def is_reference_range(line: str) -> bool:
        return bool(
            re.fullmatch(
                r"[<>]?\d+(?:\.\d+)?\s*[-~]\s*[<>]?\d+(?:\.\d+)?(?:\s*[A-Za-z/%μµ·/\-]+)?",
                line.strip(),
            )
        )

    def is_unit_only(line: str) -> bool:
        """`line` is a cell holding this row's unit and nothing else.

        A ONE-LETTER ABNORMAL FLAG IS A LATIN RUN. 「H」 and 「L」 passed
        this test, so on 项目 / 结果 / 提示 / 单位 the flag cell became
        the unit, the laboratory's own 「U/L」 was never reached, and the
        flag was lost with it. See `_LETTER_FLAG_CELLS`.
        """
        stripped = line.strip()
        if _is_row_flag_cell(stripped):
            return False
        return bool(re.fullmatch(r"[A-Za-z/%μµ·/\-]+", stripped))

    def ends_the_row(candidate: str) -> bool:
        """`candidate` belongs to the NEXT analyte's row, not this one.

        THE VALUE FOR AN ANALYTE COMES OFF THAT ANALYTE'S OWN ROW. The
        forward scan had no boundary at all, so on the cell-per-line
        layout it read four cells ahead whatever they belonged to — and
        what it found first, past the end of the row it started on, was
        the next row's INDEX. `extract_lab_table_rows` has stated the
        rule since it was written («The next analyte ends this row»);
        this scan is the other reader of the same layout and never had
        it.

        Four ways a row ends, all of them the next row starting: the next
        analyte's name, a table header printed as one line, a metadata
        or column label, and the next row's marked index. A flag is none
        of those — it is part of the row it flags, whatever
        `_looks_like_analyte` makes of it.

        `_is_header_only` IS IN HERE BECAUSE `_looks_like_analyte` IS NOT
        ENOUGH ON ITS OWN. It refuses 「碱性磷酸酶(ALP)」 — a Chinese name
        with a Latin abbreviation, which is how the majority of rows on a
        Chinese biochemistry panel are printed — because that shape is
        also how a column header looks. Both readings agree the cell is a
        LABEL; for a row boundary a label is a boundary either way, and
        without this the CK row read the ALP row's reference interval.
        """
        if _is_row_flag_cell(candidate):
            return False
        return bool(
            _looks_like_analyte(candidate)
            or _is_header_row(candidate)
            or _is_header_only(candidate)
            or _ROW_INDEX_CELL.match(candidate)
        )

    def finish(
        raw_value: Optional[str],
        unit: Optional[str],
        source_parts: List[str],
        row_cells: List[str],
    ) -> _LabReading:
        """The row, read for everything it prints — not only its number.

        THE FLAG AND THE REFERENCE INTERVAL WERE ALREADY INSIDE THE
        CAPTURED SNIPPET AND NEITHER WAS RECORDED. On the archived
        biochemistry report the CK row was captured whole —
        「*14肌酸激酶(CK) 693 ↑ 50-310 U/L」 — and published as an
        ordinary 693 with `is_abnormal: false` and an empty reference,
        for the marker this disease is monitored by, on the passport a
        patient hands to a clinician. `row_cells` is this row's own
        cells, bounded by `ends_the_row`, so nothing here can read the
        interval off the row below.
        """
        row_text = " ".join(cell for cell in row_cells if cell.strip())
        reference_raw, low, high = _read_row_reference(row_text, raw_value)
        return _LabReading(
            value=raw_value,
            unit=unit or _unit_from_row(row_text, raw_value),
            source_text=" ".join(source_parts),
            flag=_read_row_flag(row_text),
            reference_raw=reference_raw,
            reference_low=low,
            reference_high=high,
        )

    for index, line in enumerate(lines):
        if matched_span(line.lower()) is None:
            continue

        segment = search_segment(line)
        raw_value, unit = extract_numeric_value(segment)
        if raw_value is not None and not is_reference_range(line):
            return finish(raw_value, unit, [line], [segment])

        # THE ROW WAS PRINTED ON THIS LINE AND ITS RESULT COLUMN IS
        # EMPTY. The forward scan exists for the cell-per-line layout,
        # where the name is alone on its line and its figures are on the
        # lines below. A line that already carries this row's REFERENCE
        # column is not that layout — it is a flattened row the OCR read
        # short — and reading on from it lands in the next row, which is
        # how 「# 14 肌酸激酶(CK) 人 50-310 U/L」 reached for a number at
        # all. Nothing is the right answer for a result the page does not
        # show.
        if _ROW_RANGE.search(segment) or _ROW_BOUND.search(segment):
            continue

        # THE ROW IS READ TO ITS END, NOT TO ITS UNIT.
        #
        # This loop used to return the moment it had a value and a unit,
        # and on the ordinary Chinese column order 项目 / 结果 / 单位 /
        # 参考区间 the unit cell is the THIRD of four. So every cell to
        # the right of it was abandoned unread, and what sits there is
        # the reference interval — measured on a synthetic 心肌酶谱 in
        # that layout, a CK of 693 and an LDH of 319 came back with
        # 「50-310」 and 「120-250」 nowhere in the payload, which is the
        # column the whole of `finish` exists to record and the only
        # thing either number can be abnormal against.
        #
        # Nothing else bounds the row: `ends_the_row` and the four-cell
        # window are the same boundary the value search already ran
        # under, so reading on cannot reach the next analyte's cells.
        source_parts = [line]
        row_cells: List[str] = [segment]
        for offset in range(1, 5):
            next_index = index + offset
            if next_index >= len(lines):
                break
            candidate = lines[next_index].strip()
            if not candidate:
                continue
            if ends_the_row(candidate):
                break
            source_parts.append(candidate)
            row_cells.append(candidate)

            if re.fullmatch(r"[↑↓→]+", candidate):
                continue

            if raw_value is None:
                candidate_value, candidate_unit = extract_numeric_value(search_segment(candidate))
                if candidate_value is not None and not is_reference_range(candidate):
                    raw_value = candidate_value
                    unit = candidate_unit or unit
                continue

            if unit is None and is_unit_only(candidate):
                unit = candidate

        if raw_value is not None:
            return finish(raw_value, unit, source_parts, row_cells)
    return _NO_LAB_READING


def _same_reading(row_value: str, panel_value: str) -> bool:
    """The two readers are talking about the same printed number."""
    left, right = _safe_float(row_value), _safe_float(panel_value)
    if left is not None and right is not None:
        return left == right
    return row_value.strip() == panel_value.strip()


def _row_context(
    vocabulary: Dict[str, List[str]],
    field_name: str,
    lines: List[str],
    raw_value: Optional[str],
) -> _LabReading:
    """What the ROW said about a number a panel pattern read off the page.

    THE FLAG AND THE REFERENCE WORK LANDED IN ONE PANEL ONLY. Round 32
    taught `_extract_lab_value` to read the abnormal marker and the
    reference interval off the row, and that reader serves exactly one
    caller — `_extract_labs`, the muscle-enzyme and biochemistry map.
    Every other laboratory panel this platform parses — 血常规, 甲功,
    凝血, 尿常规, 感染筛查, 粪便 — reaches `_append_panel_number` from
    `_extract_numeric_panel`, which passed no flag, no interval, and a
    unit only where someone had hard-coded one in the definition. So a
    haemoglobin of 98 that the laboratory printed 「↓ 130-175 g/L」
    beside reached the patient as a bare 98: `is_abnormal: false`, an
    empty reference, and no unit, on the same payload where a CK on a
    biochemistry panel carries all three.

    THE PATTERN FINDS THE NUMBER; THIS FINDS THE ROW IT CAME OFF. The
    panel patterns match across a two-line window (`_panel_haystacks`)
    and know nothing about columns, so they cannot answer 「what else is
    on this row」. Rather than teach them, the row reader is asked the
    same question about the same analyte and its answer is accepted ONLY
    IF THE TWO NUMBERS AGREE. Where they disagree the row reader found a
    different row, and the honest answer is the one this function
    returns empty — the field keeps exactly the shape it had before.

    The competing names come from the panel's own definitions, which is
    what keeps 白细胞 off 白细胞酯酶's row inside 尿常规; see
    `_competing_analyte_keywords`.
    """
    keywords = [word for word in vocabulary.get(field_name, ()) if word and word.strip()]
    if not keywords or raw_value is None:
        return _NO_LAB_READING
    reading = _extract_lab_value(
        lines, keywords, _competing_analyte_keywords(vocabulary, field_name)
    )
    if reading.value is None or not _same_reading(reading.value, raw_value):
        return _NO_LAB_READING
    return reading


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
#:
#: 参考范围 IS HERE BECAUSE ITS TWO SYNONYMS ALREADY WERE. This tuple is
#: now what stops a bare column heading from opening a method section in
#: `_row_label`, so a heading missing from it is not merely unread as
#: a heading — it refuses every data row printed below it. 参考区间 and
#: 参考值 were listed and 参考范围, the third spelling of the same column,
#: was not, which made the fix depend on which synonym a laboratory
#: happens to print.
_TABLE_HEADER_CELLS: Tuple[str, ...] = (
    "项目", "结果", "参考区间", "参考值", "参考范围", "单位", "方法",
    "提示", "结果值", "检验项目", "检测项目", "英文缩写", "No", "NO", "序号",
)

#: A cell holding a measurement: digits and nothing else. 「6.000」 yes;
#: 「3.5-6.59」 no (that is a range); 「>10」 no (see `_BOUND_CELL`).
_VALUE_CELL = re.compile(r"^\d+(?:\.\d+)?$")

#: A ONE-SIDED LIMIT — 「>10」, 「<0.5」, 「≥11」. IT IS NOT A RESULT WHEN A
#: RESULT IS ALSO ON THE ROW.
#:
#: This shape used to be part of `_VALUE_CELL`, and `extract_lab_table_rows`
#: takes the FIRST value cell after the analyte name. On the column order
#: 项目 / 参考区间 / 结果 — ordinary on Chinese laboratory reports, and
#: the one a genetics table uses because the FSHD1 reference IS one-sided
#: — the reference limit is that first cell. So on
#:
#:     D4Z4重复单元数 | >10 | 3 | 个
#:
#: the row came back `value: 「>10」, unit: 「3」`: the limit became this
#: patient's reading, the patient's reading became the row's unit, and
#: `_table_row_lines` rebuilt it as 「D4Z4重复单元数 >10 3」, off which
#: the repeat count read 10 — the comparator dropped, and 10 is the
#: boundary that sends a reader off to evaluate FSHD2 while the report's
#: real count of 3 is squarely inside the FSHD1 range.
#:
#: A bound is therefore a REFERENCE by default, and is accepted as the
#: value only when the row prints no bare number at all — which is what
#: keeps a genuinely one-sided result such as 「<0.01」 readable.
_BOUND_CELL = re.compile(r"^[<>≤≥]\s*\d+(?:\.\d+)?$")

#: A reference range rather than a result.
_RANGE_CELL = re.compile(r"^[<>≤≥]?\s*\d+(?:\.\d+)?\s*[-~—]\s*\d+(?:\.\d+)?$")

#: A unit. Deliberately loose — units vary wildly — but never CJK, and
#: NEVER A BARE NUMBER: the class used to admit `\d` unguarded, so the
#: result cell of the row above became the unit of the row being read.
_UNIT_CELL = re.compile(r"^(?=.*[A-Za-zμµ%/·\^])[A-Za-zμµ%/·\^\d\.\*]{1,14}$")


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


def _is_header_row(cell: str) -> bool:
    """A HEADER ROW PRINTED ON ONE LINE IS STILL A HEADER ROW.

    `_TABLE_HEADER_CELLS` is matched cell by cell, so 「No 项目 结果
    参考区间 单位 方法」 — how the OCR renders the header when it
    recovers the row rather than its cells — passed every test in
    `_looks_like_analyte` and was published as an analyte whose result
    was the first data row's INDEX: `table_no: 1` on the patient's own
    report screen.

    It is not only refused as a name. It still ENDS a row, the way the
    next analyte does, because it is the boundary between the heading
    and the data — without that the title line above it would reach past
    it and claim the same index as its value.
    """
    tokens = cell.split()
    return len(tokens) > 1 and all(token in _TABLE_HEADER_CELLS for token in tokens)


def _looks_like_analyte(cell: str) -> bool:
    """A cell naming a test: has letters or CJK, is not a header, is short."""
    if not cell or len(cell) > 28:
        return False
    if cell in _TABLE_HEADER_CELLS or _is_header_only(cell) or _is_header_row(cell):
        return False
    if _VALUE_CELL.match(cell) or _RANGE_CELL.match(cell) or _BOUND_CELL.match(cell):
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
    unit-shaped cell after it.

    THE ROW'S CELLS ARE COLLECTED FIRST AND CLASSIFIED AFTERWARDS,
    because 「first cell that looks like a value」 is decided by the
    column ORDER and the order varies. On 项目 / 参考区间 / 结果 the
    first numeric-looking cell is the reference limit, so a single
    forward scan handed back the limit as the reading and the reading as
    the unit — see `_BOUND_CELL`. Collecting the row and then asking
    which cell is which is order-independent: a bare number is the
    result wherever it sits, a range and a one-sided limit are the
    reference, and the unit is the first unit-shaped cell to the right
    of the result.

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

        cells: List[str] = []
        cursor = index + 1
        end = min(len(body), index + 6)
        while cursor < end:
            cell = body[cursor].strip()
            # The next analyte ends this row, whether or not this one
            # found a value. Scanning past it skipped every other row:
            # the cursor landed beyond the next name, so a table read as
            # rows 1, 3, 5.
            #
            # A FLAG IS NOT THE NEXT ANALYTE. 「偏高」 is CJK with no
            # digits, so `_looks_like_analyte` calls it a name and the
            # row ended between the reading and its unit — the same
            # statement `ends_the_row` makes for the other reader of this
            # layout, and this one never had it.
            if (_looks_like_analyte(cell) or _is_header_row(cell)) and not _is_row_flag_cell(cell):
                break
            cells.append(cell)
            cursor += 1

        value = next((cell for cell in cells if _VALUE_CELL.match(cell)), None)
        bounds = [cell for cell in cells if _BOUND_CELL.match(cell)]
        if value is None:
            # No bare number on the row: a one-sided limit is all the
            # laboratory printed, so it IS the reading.
            value = bounds[0] if bounds else None
            bounds = bounds[1:]
        ref = next((cell for cell in cells if _RANGE_CELL.match(cell)), None) or (
            bounds[0] if bounds else None
        )
        unit = None
        if value is not None:
            after = cells[cells.index(value) + 1 :]
            # A ONE-LETTER FLAG IS UNIT-SHAPED, and on 项目 / 结果 / 提示
            # / 单位 it is the cell immediately after the reading — so
            # 「H」 was published as the unit of every analyte this reader
            # exists to cover, and the laboratory's own unit, sitting one
            # cell further right, was never reached.
            unit = next(
                (
                    cell
                    for cell in after
                    if _UNIT_CELL.match(cell) and not _is_row_flag_cell(cell)
                ),
                None,
            )

        if value is None:
            index += 1
            continue

        clean = _ROW_NUMBER_PREFIX.sub("", name).strip()
        key = clean.lower()
        if clean and key not in seen:
            seen.add(key)
            rows.append({
                "name": clean,
                "value": value,
                "unit": unit,
                "reference": ref,
                # The laboratory's own verdict on the row, read the same
                # way `_extract_lab_value` reads it — off the row's
                # cells, which is where the letter flags can be told from
                # a unit. `_append_generic_table_fields` is what carries
                # it onto the field.
                "flag": _read_row_flag(" ".join(cells)),
            })
        # Resume at the cell that ended the row — the next analyte, or
        # the first cell this row did not claim.
        index = max(cursor, index + 1)

    return rows


def _table_row_lines(lines: List[str]) -> List[str]:
    """Every table row rebuilt as a single 「name value unit」 line.

    The rebuilt lines carry no row label of their own, and
    `_page_rows` labels them `_KIND_TABLE` for exactly that reason: an
    analyte cell paired with its own value cell IS the report's
    dedicated result row, and ranking it as unlabelled — which is what a
    label-position rank had to do — put the patient's real count below
    any conclusion sentence that quoted a threshold.
    `extract_lab_table_rows` has already
    dropped the boilerplate tail, the header cells, the method column
    and the reference intervals, so what comes back is analyte and
    reading.

    Only the cell-per-line layout produces anything here: a row printed
    on one line has its value on the same line as its name, which
    `_looks_like_analyte` never accepts as a name cell. So this adds
    text to the document exactly where a pattern could not otherwise
    reach, and duplicates nothing.
    """
    rebuilt: List[str] = []
    for row in extract_lab_table_rows(lines):
        parts = [row["name"], row["value"]]
        if row["unit"]:
            parts.append(row["unit"])
        rebuilt.append(" ".join(parts))
    return rebuilt


def _extract_labs(lines: List[str], fields: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    analytes = {
        # 磷酸肌酸激酶 IS CK'S OTHER PRINTED NAME, and listing it here
        # rather than in `_FOREIGN_ANALYTE_NAMES` is what lets the row be
        # both read and protected: the map-derived competitors then keep
        # 磷 out of it, the way 肌酸激酶同工酶 keeps `ck` out of the CK-MB
        # row. A phosphorus of 693 was one printing order away.
        "ck": ["磷酸肌酸激酶", "肌酸激酶", "ck"],
        "mb": ["肌红蛋白", " myo ", " mb "],
        "ldh": ["乳酸脱氢酶", "ldh"],
        # 肌酸激酶同工酶 IS THE ROW'S PRINTED NAME, and it was absent
        # here — so nothing in the map said the CK-MB row is not the CK
        # row. See `_competing_analyte_keywords`.
        "ckmb": ["ckmb", "ck-mb", "肌酸激酶同工酶"],
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
        # 白蛋白/球蛋白 IS THE RATIO ROW'S OTHER SPELLING, and it names
        # both of the cells it is a ratio of — so without it here the
        # ratio 1.5 was published as this patient's ALBUMIN, and as their
        # globulin, on the row that states neither.
        "a_g_ratio": ["白蛋白/球蛋白", "白球比例", "a/g"],
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
        reading = _extract_lab_value(
            lines, keywords, _competing_analyte_keywords(analytes, field_name)
        )
        if reading.value is None:
            continue
        numeric_value = _safe_float(reading.value)
        panel[field_name] = numeric_value if numeric_value is not None else reading.value
        _append_field(
            fields,
            _build_field(
                field_name,
                reading.value,
                normalized_value=numeric_value,
                unit=reading.unit,
                source_text=reading.source_text,
                confidence=0.93,
                abnormal_flag=reading.flag,
                reference_range_raw=reading.reference_raw,
                reference_low=reading.reference_low,
                reference_high=reading.reference_high,
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


#: Substrings the API's redactor dispatches its genetics readers on, in
#: apps/api/src/modules/ai-agents/security/pii-redactor.ts. A key
#: carrying one is read as the cell it names — and graded — wherever it
#: came from. See `_append_generic_table_fields`.
_GENETICS_DISPATCH_SUBSTRINGS: Tuple[str, ...] = (
    "d4z4",
    "ecori",
    "methylation",
    "haplotype",
)

#: THE NAME OF A GENETICS CELL, IN EITHER SCRIPT.
#:
#: `_GENETICS_DISPATCH_SUBSTRINGS` is the API's dispatch contract and is
#: all Latin, and `_append_generic_table_fields` was refusing to mint a
#: `table_*` key on that list alone — so it refused nothing at all on a
#: Chinese-named genetics row. 「甲基化水平」 slugs to `table_甲基化水平`,
#: carries none of the four, and was published beside the canonical
#: `methylation_value` read off THE IDENTICAL CELL: one laboratory
#: reading, two analytes, both on `observations` and
#: `latest_summary.by_analyte`, on a report that measured the level once.
#:
#: The docstring stated the guarantee generally — 「a slug is not allowed
#: to collide with a canonical genetics cell」 — so this is the general
#: version of the list. It is the union of the API's dispatch substrings
#: and the Chinese names this file's own genetics readers key on, which
#: is exactly the set of rows `_extract_genetic` publishes under a
#: canonical name with the refusals attached.
_GENETICS_CELL_NAME_WORDS: Tuple[str, ...] = _GENETICS_DISPATCH_SUBSTRINGS + (
    "甲基化",
    "单倍型",
    "重复单元",
    "重复数",
    "重复拷贝",
    "片段长度",
    "等位基因",
    "4q35",
    "p13e-11",
    "p13e11",
)


def _append_generic_table_fields(lines: List[str], fields: List[Dict[str, Any]]) -> None:
    """Add table rows the type-specific extractors did not already cover.

    Keys are prefixed `table_` and slugged from the printed analyte
    name. They are NOT canonical keys, and the `table_` prefix is what
    says so: the API's OCR projection excludes a key carrying it from
    every genetics reader and from the safe-key list, so these reach the
    patient's own report screen and not a model prompt until someone
    reviews the name.

    WHAT THIS DOCSTRING USED TO CLAIM WAS NOT TRUE, and both halves of
    why have been fixed — the API's half there, this one here.

    It said the prompt allowlist was 「deny-by-default, so these reach
    the patient's own report screen but not a model prompt」. The
    allowlist admits the OCR blob as one key, `fields`; inside it the
    projection dispatched its genetics readers on the SUBSTRINGS
    `d4z4` / `ecori` / `methylation`, and a slug is arbitrary printed
    text. So a `table_*` key containing one reached the assistant prompt
    in BOTH modes carrying this platform's grade — measured:
    `tableD4z4_clinical: above_fshd1_repeat_range`, the label whose
    documented meaning is 「go and evaluate FSHD2」, minted off a
    METHYLATION percentage, because the d4z4 branch is tested before the
    methylation one.

    THIS HALF IS THE NAME. A slug is not allowed to collide with a
    canonical genetics cell, and it used to do it two ways at once:

      - the slug regex deleted EVERY CJK CHARACTER, so every Chinese
        genetics analyte whose only Latin content is D4Z4 collapsed onto
        the single key `table_d4z4` and the `existing_names` guard
        silently dropped all but the first. On the cell-per-line OCR
        layout that meant a methylation row printed above the count row
        took the key and THE PATIENT'S REPEAT COUNT WAS DISCARDED.
        The slug keeps CJK now, so two analytes are two keys.
      - a name that NAMES A GENETICS CELL is not minted here at all.
        Those cells belong to `_extract_genetic`, which reads them under
        canonical keys with the refusals attached — and reads them off
        the cell-per-line layout too, since `_table_row_lines`. Nothing
        is lost by declining to publish them a second time under a name
        the printer chose.

        THAT TEST WAS THE FOUR LATIN SUBSTRINGS ALONE, and this
        paragraph claimed it generally while a Chinese-named row met
        none of them: 「甲基化水平」 was published as `table_甲基化水平`
        beside the canonical `methylation_value` read off the identical
        cell. `_GENETICS_CELL_NAME_WORDS` is the general list, and it is
        matched against the PRINTED NAME rather than the slug — the slug
        lower-cases and punctuation-folds, which is one more place a
        name can stop looking like itself.
    """
    #: THE ROWS A CANONICAL EXTRACTOR HAS ALREADY PUBLISHED. A field's
    #: `source_text` is the row it was read off, so a table row whose
    #: printed name AND reading both appear in one of them is that same
    #: row, coming round a second time.
    #:
    #: THE GUARD BELOW USED TO BE `row["value"] in existing` — a bare
    #: reading tested for membership in a set of whole row snippets,
    #: which is never true. So the archived 生化全套 published its CK row
    #: twice: `ck: 693` from the map and `table_肌酸激酶_ck: 693` from
    #: this reader, both on `observations`, both in
    #: `latest_summary.by_analyte`, and — once the row's flag started
    #: being carried — the SAME creatine kinase named twice in
    #: `abnormal_list`, which is the list a clinician reads to see what
    #: this report flagged. 「一份报告里同一个指标出现两次」 is the
    #: complaint `_GENETICS_CELL_NAME_WORDS` closes for the genetics
    #: cells; this is the laboratory half of it.
    published_rows = [
        str(field.get("source_text") or "")
        for field in fields
        if field.get("source_text")
    ]
    existing_names = {str(f.get("field_name") or "").lower() for f in fields}

    def already_published(name: str, value: str) -> bool:
        return any(name in row and value in row for row in published_rows)

    for row in extract_lab_table_rows(lines):
        printed_name = str(row["name"]).lower()
        if any(word in printed_name for word in _GENETICS_CELL_NAME_WORDS):
            continue
        slug = re.sub(r"[^a-z0-9\u4e00-\u9fa5]+", "_", row["name"].lower()).strip("_")
        if not slug:
            slug = re.sub(r"\s+", "_", row["name"])[:24]
        key = f"table_{slug}"[:48]
        if any(token in key.lower() for token in _GENETICS_DISPATCH_SUBSTRINGS):
            continue
        if key.lower() in existing_names or already_published(row["name"], row["value"]):
            continue
        existing_names.add(key.lower())
        reference_raw, reference_low, reference_high = _read_row_reference(
            row.get("reference") or "", None
        )
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
                # THE ROW'S OWN COLUMNS, on the reader that exists for
                # the analytes nobody wrote a pattern for. The row dict
                # has carried the reference since it was written and
                # nothing passed it on, so a `table_*` cell reached
                # `observations` with an empty reference and
                # `is_abnormal: false` however the laboratory flagged it.
                # `_read_row_reference` re-reads the interval only to
                # split it, so the two ends are typed the same way here
                # as they are on every other laboratory field.
                abnormal_flag=row.get("flag"),
                reference_range_raw=reference_raw,
                reference_low=reference_low,
                reference_high=reference_high,
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
                # THE THREE `None`s WERE NOT A SCHEMA, THEY WERE A GAP.
                # Every extractor that captures a laboratory row captures
                # its reference column with it — 「50-310」 sits inside the
                # CK row's own snippet — and this dictionary threw it
                # away, so `latest_summary.by_analyte…reference_high` was
                # empty for every analyte on every report and a CK of 693
                # had nothing to be abnormal against.
                "reference": {
                    "range_raw": field.get("reference_range_raw"),
                    "low": field.get("reference_low"),
                    "high": field.get("reference_high"),
                    "unit": field.get("unit"),
                },
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

    def _run_extractor(kind: str) -> None:
        if kind == "genetic_report":
            _extract_genetic(lines, structured_fields, findings, normalized_summary)
        elif kind == "medical_summary":
            _extract_medical_summary(lines, structured_fields, normalized_summary)
            # A TRANSCRIPTION IS STILL READ. For some patients the 病历
            # 摘要 is the only page in the account that carries the D4Z4
            # count, and the platform's answer to that has always been
            # 「display it with its origin, never grade it」 — the origin
            # being this classification, which now says 病历摘要 rather
            # than genetic_report. Skipping the genetics extractor here
            # would not make the value ungradeable, it would make it
            # invisible: the API's `pickGeneticEvidenceDocument` only
            # reaches a non-report document THROUGH the genetic result
            # keys, and the redactor can only stamp
            # `not_read_off_a_laboratory_report` onto a cell that
            # exists. The refusal is the API's job; producing the cell
            # to refuse is this one's.
            _extract_genetic(lines, structured_fields, findings, normalized_summary)
        elif kind == "physical_exam":
            _extract_physical_exam(lines, structured_fields, normalized_summary)
        elif kind == "muscle_mri":
            _extract_mri(lines, structured_fields, findings, normalized_summary)
        elif kind == "pulmonary_function":
            _extract_pulmonary(lines, structured_fields, findings, normalized_summary)
        elif kind == "diaphragm_ultrasound":
            _extract_diaphragm_ultrasound(lines, structured_fields, findings, normalized_summary)
        elif kind == "ecg":
            _extract_ecg(lines, structured_fields, findings, normalized_summary)
        elif kind == "echocardiography":
            _extract_echo(lines, structured_fields, findings, normalized_summary)
        elif kind == "blood_routine":
            _extract_blood_routine(lines, structured_fields, normalized_summary)
        elif kind == "thyroid_function":
            _extract_thyroid_function(lines, structured_fields, normalized_summary)
        elif kind == "coagulation":
            _extract_coagulation(lines, structured_fields, normalized_summary)
        elif kind == "urinalysis":
            _extract_urinalysis(lines, structured_fields, normalized_summary)
        elif kind == "infection_screening":
            _extract_infection_screening(lines, structured_fields, normalized_summary)
        elif kind == "stool_test":
            _extract_stool_test(lines, structured_fields, normalized_summary)
        elif kind == "abdominal_ultrasound":
            _extract_abdominal_ultrasound(lines, structured_fields, findings, normalized_summary)

        if kind in {"muscle_enzyme", "biochemistry", "other"}:
            _extract_labs(lines, structured_fields, normalized_summary)

    _run_extractor(report_type)

    # A DEMOTED DOCUMENT KEEPS ITS VALUES.
    #
    # `_classify_report` relabels any document whose own layout shows a
    # clinical narrative as `medical_summary`, whatever vocabulary won —
    # a 出院小结 that quotes the patient's muscle MRI scores `muscle_mri`
    # on keywords and is still an 出院小结. THE LABEL is what the API's
    # gates read as permission, and it has to say 病历摘要. THE VALUES
    # are a different question: the MRI rows that 出院小结 quotes are the
    # patient's only copy as often as the D4Z4 count is, and dropping
    # them would trade one silent erasure for another.
    #
    # So the quoted document's own extractor runs too, and the values it
    # produces carry the narrative label — which is precisely the
    # arrangement 病历摘要 + `_extract_genetic` above has always had,
    # generalised to the label that was actually demoted.
    if report_type == "medical_summary":
        quoted_type, _, _ = _classify_report(
            normalized_text,
            document_type_hint,
            report_name,
            demote_narrative=False,
        )
        if quoted_type != "medical_summary":
            _run_extractor(quoted_type)

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
