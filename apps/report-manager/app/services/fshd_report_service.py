# THE PRODUCTION INTERPRETER IS 3.11 AND ANNOTATIONS ARE EVALUATED AT
# DEFINITION TIME THERE.
#
# `_TableColumns` is annotated on a reader 2049 lines before the class
# is defined, and on 3.11 that is a NameError raised while the module is
# still importing - so the parser did not load AT ALL in either Docker
# image (both are python:3.11-slim) and the whole test suite failed
# during collection. It was invisible locally because this machine runs
# 3.14, where PEP 649 defers annotation evaluation.
#
# The future import defers them everywhere, which covers the forward
# references nobody has tripped over yet as well as this one. Do not
# remove it without moving every forward-referenced definition above its
# first use - and do not trust `python3` to tell you: run the suite on
# 3.11, which is what ci.yml pins and what ships.
from __future__ import annotations

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


#: `_ASCII_WORD_BOUNDARY` with the hyphen inside the word, for analyte
#: abbreviations. See `_analyte_keyword_pattern`.
#:
#: IT LIVES AT THE TOP OF THE FILE BECAUSE IT HAS TWO USERS NOW. It was
#: written for the keyword matcher that reads a ROW, and the panel
#: PATTERNS — declared hundreds of lines above it — needed the identical
#: rule and had none: see `_anchored_keyword_source`.
_ANALYTE_TOKEN_BOUNDARY = r"(?:(?<![0-9A-Za-z_-])|(?![0-9A-Za-z_-]))"


@lru_cache(maxsize=1024)
def _anchored_keyword_source(keyword: str) -> str:
    """`keyword` as regex source, anchored at whichever end is Latin.

    THE ONE STATEMENT OF WHERE AN ANALYTE ABBREVIATION BEGINS AND ENDS.
    `_analyte_keyword_pattern` compiles it for the row reader and
    `_numeric_analyte` embeds it in the panel patterns, so a report that
    prints 「活化部分凝血活酶时间(APTT)」 cannot answer for PT or for TT
    through either reader.

    A Latin end needs a boundary; a Chinese one needs none, because 钾
    does not occur inside a longer Latin token. The hyphen counts as
    part of the word, so 「RDW」 is not read inside 「RDW-SD」 and 「mb」
    is not read inside 「CK-MB」 — which is the difference between this
    and `\\b`, on top of `\\b` not firing after a Chinese character at
    all.
    """
    stripped = keyword.strip()
    pattern = re.escape(stripped)
    if re.match(r"[0-9A-Za-z_-]", stripped):
        pattern = _ANALYTE_TOKEN_BOUNDARY + pattern
    if re.search(r"[0-9A-Za-z_-]$", stripped):
        pattern = pattern + _ANALYTE_TOKEN_BOUNDARY
    return pattern


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
        # ROWS ONLY A URINE REPORT PRINTS. Without them the sediment
        # counts — 白细胞 and 红细胞, which a 血常规 also prints — were the
        # loudest thing on the page, and 血常规 won a urine report.
        ("尿沉渣", 6),
        ("小便常规", 6),
        ("尿液", 3),
        ("白细胞酯酶", 5),
        ("亚硝酸盐", 5),
        ("尿胆原", 5),
        ("尿比重", 4),
        ("管型", 4),
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
    # THE THIGH, NAMED MUSCLE BY MUSCLE — WHICH IS HOW A MUSCLE MRI
    # NAMES IT.
    #
    # 股四头肌 and 腘绳肌 are GROUPS, and a radiologist reporting a
    # 双大腿MRI does not report groups: the report reads 「股外侧肌、
    # 股中间肌脂肪浸润，股直肌相对保留」, because WHICH heads of the
    # quadriceps are involved and which are spared is the finding. Every
    # one of those names fell outside the map, `_muscle_from_sentence`
    # answered None, and the sentence produced NOTHING AT ALL — no
    # fatty-infiltration field, no map entry, no trace in the payload
    # that the page had said anything. On the imaging this disease is
    # followed by.
    #
    # Listing them does not close the class — see `_MUSCLE_TERM` for
    # what happens to a name that is still not here — but these are the
    # muscles the standard thigh protocol scores, so they are the ones
    # worth reading as themselves rather than as unread terms.
    "rectus_femoris": {"keywords": ["股直肌", "rectus femoris"], "region": "thigh"},
    "vastus_lateralis": {"keywords": ["股外侧肌", "vastus lateralis"], "region": "thigh"},
    "vastus_medialis": {"keywords": ["股内侧肌", "vastus medialis"], "region": "thigh"},
    "vastus_intermedius": {"keywords": ["股中间肌", "vastus intermedius"], "region": "thigh"},
    "biceps_femoris": {"keywords": ["股二头肌", "biceps femoris"], "region": "thigh"},
    "semitendinosus": {"keywords": ["半腱肌", "semitendinosus"], "region": "thigh"},
    "semimembranosus": {"keywords": ["半膜肌", "semimembranosus"], "region": "thigh"},
    "sartorius": {"keywords": ["缝匠肌", "sartorius"], "region": "thigh"},
    "gracilis": {"keywords": ["股薄肌", "gracilis"], "region": "thigh"},
    "adductor_magnus": {"keywords": ["大收肌", "adductor magnus"], "region": "thigh"},
    "adductor_longus": {"keywords": ["长收肌", "adductor longus"], "region": "thigh"},
    "adductor_brevis": {"keywords": ["短收肌", "adductor brevis"], "region": "thigh"},
    "tensor_fasciae_latae": {
        "keywords": ["阔筋膜张肌", "tensor fasciae latae"],
        "region": "thigh",
    },
    "peroneus": {"keywords": ["腓骨长肌", "腓骨短肌", "peroneus"], "region": "ankle"},
    "paraspinal": {"keywords": ["竖脊肌", "椎旁肌", "paraspinal"], "region": "trunk"},
    "abdominal_muscles": {"keywords": ["腹直肌", "腹外斜肌", "腹内斜肌"], "region": "trunk"},
    "trapezius": {"keywords": ["斜方肌", "trapezius"], "region": "shoulder_girdle"},
    "latissimus_dorsi": {"keywords": ["背阔肌", "latissimus"], "region": "shoulder_girdle"},
    "pectoralis_major": {"keywords": ["胸大肌", "pectoralis"], "region": "shoulder_girdle"},
}

#: A MUSCLE NAMED IN CHINESE, WHATEVER MUSCLE IT IS — the shape the
#: lexicon above cannot have.
#:
#: THE ANSWER TO 「CAN THIS BE GROUNDED IN SOMETHING THE CORPUS ALREADY
#: HOLDS」 IS NO, AND IT WAS WORTH CHECKING. Every other muscle
#: vocabulary in this repository is a SUBSET of the map above —
#: `MUSCLE_GROUP_LABELS` in the API's export labels carries nine coarse
#: groups, `strengthAliases` in the OCR bridge carries five, and the
#: app's own list is the same nine. Grounding this reader in any of them
#: would make it read LESS, not more. There is no anatomical dictionary
#: in the payload, in the knowledge base, or on the wire.
#:
#: SO THE MISS IS MADE LOUD INSTEAD. A Chinese muscle name ends in 肌 —
#: that is the language, not a list — so a sentence that names an
#: anatomical term this module does not carry is recognisable AS a
#: muscle name even when it cannot be identified. Such a sentence now
#: produces a finding with `muscle_name: null`, the printed term on
#: `muscle_term`, and a confidence low enough to put it in
#: `review_queue`; the term is also collected on
#: `mri_summary.unread_muscle_terms`. An unread muscle is visible; a
#: skipped sentence was not.
#:
#: THE LOOKAHEAD IS WHAT KEEPS 肌 A SUFFIX. 肌力, 肌肉, 肌张力, 肌酶,
#: 肌电图 and 肌病 all begin with it, and in each of those the character
#: this pattern anchors on is the head of the NEXT word rather than the
#: tail of a name.
_MUSCLE_TERM = re.compile(r"[一-龥]{2,6}肌(?:群)?(?![肉力张电酶酸病炎营腱])")

#: The qualifiers a report prints in front of a muscle name. Stripped so
#: that 「双侧股直肌」 and 「股直肌」 are one term rather than two.
_MUSCLE_TERM_QUALIFIERS = re.compile(
    r"^(?:双侧|两侧|左侧|右侧|对侧|患侧|健侧|以|及|和|与|、|,|其余|部分|余|各|双|左|右)+"
)

#: TERMS THAT END IN 肌 AND NAME NO MUSCLE. A tissue type (心肌, 骨骼肌)
#: and a body region (大腿肌群, 下肢肌) are not muscles this module
#: failed to identify — reporting them as unread would be a false alarm
#: on every 双大腿MRI ever written, since 「双大腿肌群脂肪浸润」 is the
#: standard impression line. Anything ending 肌群 is a group by
#: construction and is refused by shape rather than by name.
_NOT_A_MUSCLE_NAME: Tuple[str, ...] = (
    "心肌", "骨骼肌", "平滑肌", "横纹肌",
    "下肢肌", "上肢肌", "四肢肌", "肢体肌", "全身肌", "躯干肌",
    "大腿肌", "小腿肌", "近端肌", "远端肌", "肩带肌", "骨盆带肌",
)

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
_SENTENCE_BREAK_SOURCE = r"[。;；\n]|(?<!\d)\.|\.(?!\d)"
_SENTENCE_BREAK = re.compile(_SENTENCE_BREAK_SOURCE)

#: A CLAUSE END. The same breaks, plus the ordinary comma.
#:
#: THE TWO COMMAS ARE NOT THE SAME COMMA, which `_read_mri_sentence`
#: already argues one reader over: 「、」 is the ENUMERATION comma and
#: separates items INSIDE one statement, so it is deliberately absent
#: here; 「，」 (folded to 「,」 by `_normalize_text`) separates the
#: statements themselves, and a Chinese conclusion uses it to say what
#: was found and what was not in one breath.
#:
#: THIS IS THE SCOPE AN ABSENCE TEST HAS TO RUN AT. Asked of the whole
#: LINE, a negator belonging to one clause cancelled a finding that the
#: other clause stated positively — measured on the ordinary two-clause
#: conclusion 「检出 D4Z4 阵列缩短, 符合 FSHD1 分子诊断标准, 未见其他致
#: 病变异」, which published `diagnosis_type: None` on a genetically
#: confirmed report, and on 「4q35 单倍型: 4qA, 未见 4qB」, which published
#: no haplotype at all. Both sentences state a result and then deny a
#: DIFFERENT one; the denial is the second clause's, and reading it
#: against the first is how a positive report came out blank.
#:
#: WHAT IT COSTS, STATED PLAINLY: a report that enumerates two subjects
#: of one denial across 「，」 rather than 「、」 — 「未检出致病变异, 未见
#: 缩短」 is fine, 「未检出 FSHD1, FSHD2 相关变异」 is not — now has the
#: second one unguarded. That is the same trade `_read_mri_clause` took
#: and it is the narrower error: the enumerating spelling is the one a
#: laboratory writes with 、, and the two-clause spelling is the one it
#: writes on every report.
_CLAUSE_BREAK = re.compile(rf",|{_SENTENCE_BREAK_SOURCE}")


def _clause_span(text: str, index: int) -> Tuple[str, int]:
    """The clause `index` falls on, and the offset it starts at."""
    start, end = 0, len(text)
    for match in _CLAUSE_BREAK.finditer(text):
        if match.end() <= index:
            start = match.end()
        elif match.start() >= index:
            end = match.start()
            break
    return text[start:end], start


def _clause_around(text: str, index: int) -> str:
    """The clause `index` falls on — the span between clause breaks."""
    return _clause_span(text, index)[0]


def _extract_sentences(text: str) -> List[str]:
    chunks = _SENTENCE_BREAK.split(_normalize_text(text))
    return [chunk.strip() for chunk in chunks if chunk and chunk.strip()]


#: WHAT A PRINTED NUMBER IS, INCLUDING THE SEPARATORS THAT GROUP IT.
#:
#: THE NUMBER CLASSES SAID 「digits and a decimal point」 AND A CHINESE
#: LABORATORY PRINTS 「3,250」. Every reader in this file agreed on that
#: spelling, so every one of them stopped at the first group: a creatine
#: kinase of 3,250 U/L against an interval of 50-310 was published as
#: `ck: 3` — and the row's own 偏高 was read separately and correctly, so
#: the payload carried a reading BELOW its lower bound flagged HIGH, on
#: the marker this disease is monitored by. 「1 180」 lost its LDH the
#: same way.
#:
#: THIS IS THE POSITIVE FORM OF THE SAME FIX `_UNIT_CELL` AND
#: `_BOUND_CELL` GOT. Neither of those rounds added an exclusion — they
#: stated what the cell IS — and the reason to do it here rather than
#: teach each reader to strip commas is that there is then ONE grammar:
#: a class that matches a number matches the grouped spelling too, and
#: the readers keep asking the question they already ask.
#:
#: THE COMMA IS ADMITTED EVERYWHERE AND THE SPACE ONLY INSIDE A WHOLE
#: CELL. A comma between two digits is never a column separator on these
#: tables, so `_NUMBER_SOURCE` can be scanned across a flattened row. A
#: SPACE is exactly what separates columns there — 「50 310」 is a row
#: printing two cells at least as often as it is one number — so the
#: spaced spelling is only read where the cell boundary itself proves
#: the space is inside the number: the cell-per-line layout, through
#: `_NUMBER_CELL_SOURCE`. Both forms require the groups to be three
#: digits, which is what a thousands separator is.
_DIGIT_GROUPS = r"\d{1,3}(?:[,，]\d{3})+"
_SPACED_DIGIT_GROUPS = "\\d{1,3}(?:[ \u00a0]\\d{3})+"
_NUMBER_SOURCE = rf"(?:{_DIGIT_GROUPS}|\d+)(?:\.\d+)?"
_NUMBER_CELL_SOURCE = rf"(?:{_DIGIT_GROUPS}|{_SPACED_DIGIT_GROUPS}|\d+)(?:\.\d+)?"

#: A separator INSIDE a number — never the one between two of them,
#: because both sides have to be a digit.
_GROUP_SEPARATOR = re.compile("(?<=\\d)[,\uff0c \u00a0](?=\\d)")

#: EVERY DASH AN INTERVAL IS PRINTED WITH, AND EVERY COMPARATOR A LIMIT
#: IS PRINTED WITH — ONE GRAMMAR, THE WAY `_NUMBER_SOURCE` IS ONE.
#:
#: The interval readers listed the ASCII hyphen, the ASCII tilde and two
#: of the CJK dashes, and the bound readers listed the four ASCII/维基
#: comparators. A Chinese laboratory does not type them: an IME gives
#: 「－」 (U+FF0D, full-width hyphen-minus) for a hyphen keyed in Chinese
#: mode and 「＜」 (U+FF1C) for a less-than, and an OCR pass hands back
#: 「–」 (U+2013) for a printed en dash at least as often as it hands
#: back the ASCII one. Each of those spellings lost the row its
#: reference interval ENTIRELY — `_ROW_RANGE` did not match, `_ROW_BOUND`
#: did not match, and `_read_row_reference` returned three Nones.
#:
#: AND THE INTERVAL IS NOW WHAT DRIVES THE ABNORMAL COMPARISON. Since
#: `observations[].reference` started carrying it, a missing interval is
#: not a missing decoration: `latest_summary.by_analyte…reference_high`
#: is empty, the read-path comparison that marks a reading above its own
#: ceiling has nothing to fire on, and a creatine kinase of 693 printed
#: 「50－310」 reaches a clinician looking exactly like a normal one. It
#: also costs the READING on the flattened row, because
#: `extract_numeric_value` refuses a number it can see is an interval
#: bound — an interval it cannot see is one it cannot refuse, so 50 was
#: publishable as the patient's own result.
#:
#: `-` IS FIRST IN BOTH CLASSES so it is a literal and not a range.
#:
#: 「≦」 (U+2266) AND 「≧」 (U+2267) ARE NOT 「≤」 AND 「≥」. They are the
#: CJK-typeset spellings of the same two comparators — the ones a
#: Chinese LIS emits and an OCR pass returns for a printed 「≤」 — and
#: the class had the Unicode-mathematical pair and not this one. A
#: reference limit printed 「≦25」 matched no comparator anywhere in this
#: file: `_ROW_BOUND` did not see a limit, so the row published no
#: ceiling at all, and `_BOUND_CELL` did not see one either, so on the
#: 项目 / 参考区间 / 结果 order the limit cell became the patient's own
#: reading. Both TypeScript readers carry the pair; this file did not.
_RANGE_DASHES = "-~—～－–‐‑‒―−〜﹣"
_COMPARATORS = "<>≤≥＜＞≦≧⩽⩾﹤﹥"

#: AND THE TWO-CHARACTER SPELLINGS, WHICH A CHARACTER CLASS CANNOT HOLD.
#:
#: 「<=」, 「>=」 and the reversed 「=<」, 「=>」 are what a LIS text export
#: prints where the report shows 「≤」 and 「≥」, and a class of single
#: characters can only ever see the first half of one. On 「<=0.01」 the
#: comparator was not matched, the scan simply started one character
#: later, and a below-detection reading the laboratory refused to state
#: was published as a determinate 0.01; on 「D4Z4重复单元数 >=11」
#: `_BOUND_BEFORE_VALUE` saw no bound and the count 11 was published as
#: this patient's own array size. Longest spelling first, so 「<=」 is
#: never read as a bare 「<」 with a stray 「=」 left over.
_COMPARATOR_DIGRAPHS: Tuple[str, ...] = ("<=", "=<", ">=", "=>")

#: THE WHOLE GRAMMAR OF A COMPARATOR, AS ONE REGEX SOURCE — THIS IS THE
#: ONE PLACE A COMPARATOR IS SPELLED, exactly as `_RANGE_SEPARATOR` is
#: the one place a separator is. Every reader interpolates this rather
#: than the bare class, which is what keeps the digraphs from being a
#: spelling only half the file knows.
_COMPARATOR = (
    rf"(?:{'|'.join(re.escape(digraph) for digraph in _COMPARATOR_DIGRAPHS)}"
    rf"|[{_COMPARATORS}])"
)

#: AND THE TWO WORDS AN INTERVAL IS ALSO PRINTED WITH. 「1至10」 and
#: 「1到10」 are the same interval as 「1-10」, written out; they are not
#: punctuation, so they cannot live in `_RANGE_DASHES`, and every reader
#: that needs one needs the other.
_RANGE_WORDS: Tuple[str, ...] = ("至", "到")

#: THE WHOLE GRAMMAR OF 「A TO B」, AS ONE REGEX SOURCE — THIS IS THE ONE
#: PLACE A SEPARATOR IS SPELLED.
#:
#: `_RANGE_DASHES` was already the single statement for the interval
#: readers, and the D4Z4 branch — the one cell this whole product turns
#: on — carried its OWN list of five: 「-–—~～」 plus 至 and 到. The eight
#: spellings it did not carry are the eight a Chinese report is most
#: likely to be printed with: 「－」 (U+FF0D) is what a Chinese IME gives
#: for a hyphen, and an OCR pass returns 「‐」 (U+2010), 「‑」 (U+2011),
#: 「‒」 (U+2012), 「―」 (U+2015), 「−」 (U+2212), 「〜」 (U+301C) and
#: 「﹣」 (U+FE63) for the printed dashes it cannot tell apart.
#:
#: The cost was not a missing interval, it was a WRONG COUNT. The
#: determinate-count pattern refuses a number that is the left edge of a
#: printed interval — the refusal is spelled as this separator class —
#: so on 「D4Z4重复单元数 1－10」 the refusal did not fire, and the range
#: branch it hands off to did not match either: the report's stated
#: uncertainty was published as a confident repeat count of 1, inside
#: the 1–4 window that gates this platform's ophthalmology
#: recommendation. Measured on every spelling: the eight above all
#: published 1.
_RANGE_SEPARATOR = rf"(?:[{_RANGE_DASHES}]|{'|'.join(_RANGE_WORDS)})"

#: The comparators that name a CEILING. Read as a set rather than by
#: `in "<≤"`, which was a substring test over the two ASCII spellings —
#: so 「＜25」 was recorded as a LOWER limit of 25 the moment the
#: full-width spelling started matching at all.
#:
#: IT HOLDS STRINGS, NOT CHARACTERS, because `_COMPARATOR` can match
#: two of them. 「≦」 was missing here for as long as it was missing from
#: `_COMPARATORS`, and a set that lists the ten single characters and
#: not the digraphs reads 「<=25」 BACKWARDS — `_read_row_reference` asks
#: this set and takes the else branch, so a ceiling of 25 is recorded as
#: a FLOOR of 25 and every reading under it is marked abnormal-low.
_UPPER_LIMIT_COMPARATORS: frozenset = frozenset({*"<≤＜≦⩽﹤", "<=", "=<"})

#: A leading comparator, for the readers that ask 「is this cell a bare
#: number」 of a string rather than of a match. `text[0] in _COMPARATORS`
#: was that test, and it cannot see the second half of a digraph — 「=<5」
#: begins with a character no class holds.
_LEADING_COMPARATOR = re.compile(rf"^\s*{_COMPARATOR}")

#: A whole cell that is one number, with or without a comparator.
_NUMBER_CELL = re.compile(rf"^{_COMPARATOR}?\s*{_NUMBER_CELL_SOURCE}$")


def _strip_group_separators(text: str) -> str:
    """「3,250」 and 「3 250」 as the one number they print."""
    return _GROUP_SEPARATOR.sub("", text.strip())


def _canonical_number(cell: Any) -> Optional[str]:
    """`cell` as a bare number, or None when the whole cell is not one.

    The one place the grouped spellings are folded away. What comes back
    is what every consumer of a reading expects to parse — the API and
    the app read `field_value` as a number, and `Number("3,250")` is not
    one — while `source_text` keeps the row exactly as it was printed.
    """
    if cell is None:
        return None
    text = str(cell).strip()
    if not text or not _NUMBER_CELL.match(text):
        return None
    return _strip_group_separators(text).replace(" ", "")


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
    # THE GROUPED SPELLING IS THE WHOLE CELL BEING A NUMBER, not a digit
    # scraped out of prose — so it is folded here, where 「the whole cell
    # is one」 is exactly the question being asked. See `_canonical_number`.
    text = _canonical_number(value) or str(value).strip().replace(",", "")
    if not re.fullmatch(r"[+-]?\d+(?:\.\d+)?", text):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    text = _canonical_number(value) or str(value).strip().replace(",", "")
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
#:
#: AND THE TWO OTHER THINGS PRINTED IN THE SAME PLACE AND THE SAME
#: VOICE. A laboratory page carries three kinds of prose that NAME an
#: analyte and PRINT a number without either belonging to this patient:
#:
#:   - the footnote proper — 「注: 血红蛋白低于 60 g/L 为危急值」
#:   - the critical-value banner — 「危急值提示: 血小板计数低于 20…」
#:   - the unit-conversion legend — 「单位换算: 血红蛋白 1 g/dL = 10 g/L」
#:
#: and only the first was recognised. Measured on a synthetic 血常规
#: carrying each: `hgb: 60` on a patient whose haemoglobin is 155,
#: `plt: 20` on a patient whose platelet count is 249, and `hgb: 1` off
#: the conversion factor — the panic threshold and the arithmetic
#: constant published as the patient's own results, on the panel a
#: clinician scans for exactly those two analytes.
#:
#: 危急值 IS A PREFIX AND NOT A SUBSTRING, and that is the whole care
#: this list needs: a Chinese laboratory also prints 危急值 in the 提示
#: COLUMN of a row that is a genuine result — 「血钾 6.8 H 危急值」 — and
#: a contains-test would refuse the very row the banner exists to draw
#: attention to.
_NOTE_ROW_PREFIXES: Tuple[str, ...] = (
    "附注", "备注", "注释", "说明", "注:",
    "危急值", "警戒值", "单位换算", "换算", "折算", "计算公式",
)

#: Decoration a page puts in front of a footnote — 「★危急值:…」,
#: 「※注:…」. Stripped before the prefix test, because a bullet is not a
#: different kind of row.
#:
#: NO DASH IN THE CLASS. A dash is a RANGE SEPARATOR in this file and it
#: is spelled in exactly one place — `_RANGE_DASHES` — which
#: `test_no_reader_spells_a_separator_or_comparator_by_hand` enforces.
#: A leading dash on a footnote is not worth an exception to that.
_ROW_MARKER_PREFIX = re.compile(r"^[\s*※★☆#·•◆■]+")

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
    # 5. A footnote, a critical-value banner or a unit-conversion
    #    legend carrying its own content. See `_NOTE_ROW_PREFIXES`.
    undecorated = _ROW_MARKER_PREFIX.sub("", line.strip())
    if any(undecorated.startswith(prefix) for prefix in _NOTE_ROW_PREFIXES):
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
    kinds = _row_kinds(lines)
    rows = [
        _Row(line.strip(), kind)
        for line, kind in zip(lines, kinds)
        if line.strip()
    ]
    rows.extend(_Row(text, _KIND_TABLE) for text in _table_row_lines(lines))
    return rows


def _row_kinds(lines: List[str], *, sections: bool = True) -> List[str]:
    """The kind of each line of `lines`, BY POSITION.

    THE SAME LABELLING `_page_rows` APPLIES, ANSWERED WITHOUT DROPPING
    THE INDEX. `_page_rows` returns a compacted list — blank lines gone,
    the rebuilt table rows appended at the end — which is exactly what
    the genetics readers want and exactly what the LABORATORY row reader
    cannot use: `_extract_lab_value` reads the cell-per-line layout by
    walking forward from `index` to `index + 4`, so it needs to ask
    「what kind is line N」 with N still meaning the same thing.

    So the loop lives here and `_page_rows` is a projection of it. Two
    readers deciding row kinds separately is how this file got into the
    state the section above describes.

    `sections=False` TURNS OFF RUN PROPAGATION, and it exists because
    the propagation is a statement about the GENETICS page. There a bare
    检测结果 heads data rows that carry no label of their own, so a label
    has to reach down the page. A laboratory results table is the same
    shape with the opposite consequence: its rows are ALSO unlabelled,
    so a bare 检测方法 line printed above one — with no column-header row
    after it to close the run — labels the entire table METHOD and every
    reading on the page disappears. Measured on a synthetic 生化 laid out
    that way: `lab_panel: {}` where CK 693 and LDH 319 are both printed.

    A label that reaches exactly one row (`_SCOPE_NEXT`) still reaches
    it: that row is the value cell of the label above it, it is bounded,
    and it cannot run away. What a laboratory page needs refused is a
    row that labels ITSELF — a title, a footnote, a critical-value
    banner, a unit-conversion legend — and each of those does.
    """
    kinds: List[str] = [_KIND_PLAIN] * len(lines)
    section: Optional[str] = None
    pending: Optional[str] = None
    seen_content = False
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        label = _row_label(stripped, first_content_line=not seen_content)
        seen_content = True
        if label is None:
            kinds[index] = pending or section or _KIND_PLAIN
            pending = None
            continue
        kind, scope = label
        if scope == _SCOPE_RUN:
            section = kind if sections else None
            pending = None
        elif scope == _SCOPE_NEXT:
            section = None
            pending = kind
        else:
            section = None
            pending = None
        kinds[index] = kind
    return kinds


def _result_row_mask(lines: List[str]) -> List[bool]:
    """Which lines of `lines` can carry a reading of THIS patient.

    THE ROW MODEL, ASKED BY THE LABORATORY READERS TOO. Every genetics
    reader in this file has consulted `_REFUSED_ROW_KINDS` since the
    page was segmented into labelled rows; the lab-panel readers never
    did, and they are the ones that publish the numbers a clinician
    reads off a 血常规 or a 生化. See `_NOTE_ROW_PREFIXES` for the three
    prose shapes that were being read as results.

    WITHOUT SECTION PROPAGATION — see `_row_kinds`. A laboratory table
    is a run of rows that label nothing, and letting one stray heading
    reach down the page would trade a threshold published as a reading
    for every reading on the page erased: the same defect with a much
    larger blast radius.
    """
    return [
        kind not in _REFUSED_ROW_KINDS
        for kind in _row_kinds(lines, sections=False)
    ]


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


def _find_reading_regex(
    text: str,
    patterns: Iterable[str],
    flags: int = re.IGNORECASE,
    *,
    crossings: Optional["re.Pattern"] = None,
) -> Tuple[Optional[re.Match], Optional[str]]:
    """`_find_regex`, refusing a hit whose number is a reference bound.

    THE LOWER BOUND OF THE INTERVAL IS THE FIRST NUMBER AFTER THE NAME on
    the 项目 / 参考区间 / 结果 column order, which this module's own
    `_BOUND_CELL` note calls ordinary on Chinese laboratory reports. The
    row reader learned that rule; the panel patterns never did, and they
    are written 「name, then the first number」 — so on

        白细胞计数(WBC)  3.5-9.5  6.69  10^9/L

    every panel driven by `_extract_numeric_panel` published 3.5 as this
    patient's white cell count, with the report's own 6.69 nowhere in
    the payload. `_extract_numeric_panel` now reads the ROW first and
    only falls back to these patterns; this is the same rule stated for
    the fallback, so a report the row reader cannot see is not published
    with its intervals read as its results.

    AND IT REFUSES A NUMBER THAT IS PART OF A PRINTED UNIT, which is the
    other half of the same rule and the half only the row reader had.
    `extract_numeric_value` reserves `_unit_digit_spans` — the 10 of
    「10E9/L」, 「10^9/L」, 「×10⁹/L」, the 2 of 「cmH2O」 — and this fallback
    reserved nothing, so it read the exponent's BASE as the patient's
    result the moment the row reader declined to answer. The row reader
    declines whenever the 结果 column is not a number, which a
    laboratory prints often: a blank, 「---」, 「未见」, 「少量」, or a
    rejection note such as 「标本凝集」 or 「溶血」. Measured on a synthetic
    血常规 in the 项目 / 单位 / 结果 order,

        白细胞计数(WBC) 10E9/L 标本凝集 3.5-9.5

    published `wbc: 10` — a leucocytosis a clinician acts on, invented
    out of the unit column, on a row whose specimen was never counted.
    A row whose result is not a number must publish NO number.

    AND IT REFUSES A NUMBER PRINTED ON ANOTHER ANALYTE'S ROW. The gap
    class between a name and its reading excludes `\\n` so that it cannot
    leave its own line — and `_panel_haystacks` joins two adjacent lines
    WITHOUT a separator, which deletes the newline the gap was refusing.
    So a row whose result is a Chinese word reached over the seam and
    took the NEXT ROW'S figure. Measured on a synthetic 尿常规 whose
    sediment rows read the way a laboratory prints them,

        白细胞 少量 /HP
        红细胞 8 个/uL

    published `urine_wbc: 8` — the red cell count, under the white cell
    key, with 「白细胞 少量 /HP」 shipped as its evidence: the value and
    its own provenance disagreeing on the same field. 「细菌 未见 /HP」
    took the 上皮细胞 count the same way.

    AND IT REFUSES THE DIGIT OF A SEMI-QUANTITATIVE GRADE, which is the
    third half of the same rule and, again, the half only the row reader
    had. `extract_numeric_value` reserves `_grade_cell_spans` — the 「3」
    of 「3+」 — and a fallback that reserved nothing would publish that
    grade as a count the moment the row reader declined, which on a
    graded row is now every time. See `_grade_cell_spans` for why a
    grade of 3+ and a count of 3 are opposite findings.

    `crossings` is the panel's other declared analyte names. A name
    printed between the matched name and the captured number means the
    scan walked off its own row, and the honest answer there is the one
    the row reader already gives — nothing.
    """
    for pattern in patterns:
        for match in re.finditer(_cjk_safe(pattern), text, flags):
            if match.lastindex and (
                _inside_a_reference_interval(text, match.span(1))
                or _inside_a_printed_unit(text, match.span(1))
                or _inside_a_printed_grade(text, match.span(1))
                or _crosses_another_row(text, match, crossings)
            ):
                continue
            return match, pattern
    return None, None


def _crosses_another_row(
    text: str, match: "re.Match", crossings: Optional["re.Pattern"]
) -> bool:
    """Is another analyte's name printed between this name and its number?"""
    if crossings is None:
        return False
    return bool(crossings.search(text[match.start() : match.start(1)]))


def _inside_a_reference_interval(text: str, span: Tuple[int, int]) -> bool:
    """`span` is one end of a two-sided interval printed on the page."""
    return any(
        interval.start() <= span[0] and interval.end() >= span[1]
        for interval in _ROW_RANGE.finditer(text)
    )


def _inside_a_printed_unit(text: str, span: Tuple[int, int]) -> bool:
    """`span` is a digit a UNIT spells itself with. See `_unit_digit_spans`."""
    return any(
        start <= span[0] and end >= span[1] for start, end in _unit_digit_spans(text)
    )


def _extract_named_number(
    text: str,
    patterns: Iterable[str],
    unit: Optional[str] = None,
    *,
    avoid_reference_intervals: bool = False,
    crossings: Optional["re.Pattern"] = None,
) -> Tuple[Optional[str], Optional[float], Optional[str]]:
    if avoid_reference_intervals:
        match, _ = _find_reading_regex(text, patterns, crossings=crossings)
    else:
        match, _ = _find_regex(text, patterns)
    if not match:
        return None, None, None
    # The reading leaves canonical, grouped spelling folded away: this
    # is the fallback path, and it may not read 「3,250」 as a 3 where the
    # row reader no longer does. See `_canonical_number`.
    raw_value = match.group(1).strip()
    raw_value = _canonical_number(raw_value) or raw_value
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
    # THE FIELD IS BUILT BEFORE THE PANEL IS WRITTEN, because
    # `_build_field` is where a row whose flag contradicts its own
    # interval is refused — and a refusal that still wrote
    # `panel[field_name]` would withhold the number from
    # `structured_fields` and publish it on `normalized_summary`, which
    # is the same screen.
    field = _build_field(
        field_name,
        raw_value,
        normalized_value=normalized_value,
        unit=unit,
        source_text=source_text,
        confidence=confidence,
        # PASSED THROUGH RATHER THAN READ HERE. `_build_field` writes
        # each of these only when the row printed one, so a caller that
        # reads no reference column produces exactly the shape it always
        # did. See `_row_context` for what the row said.
        abnormal_flag=abnormal_flag,
        reference_range_raw=reference_range_raw,
        reference_low=reference_low,
        reference_high=reference_high,
    )
    if field is None:
        return
    panel[field_name] = normalized_value if normalized_value is not None else raw_value
    _append_field(fields, field)


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


def _panel_haystacks(lines: List[str]) -> List[str]:
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

    AND NEITHER THE WHOLE TEXT NOR A WINDOW MAY HOLD A ROW THAT IS NOT
    A RESULT ROW. This is the same defect `_extract_lab_value` carries
    one layer up, and fixing it there alone fixed nothing: the row
    reader declines, the panel PATTERN then runs over a haystack that
    still holds the page's footnotes, and the threshold quoted in one of
    them is published under the analyte's key — with `_row_context`
    finding no row to contradict it, because the row it would have read
    is the footnote. Measured on the same synthetic 血常规: `hgb: 60`
    off 「注: 血红蛋白低于 60 g/L 为危急值」 and `hgb: 1` off 「单位换算:
    血红蛋白 1 g/dL = 10 g/L」.

    A REFUSED ROW IS BLANKED, NOT DROPPED. Removing the line would let
    the two-line window join the rows on either side of it — the exact
    seam the paragraphs above spend their length arguing against — so
    the line keeps its slot and loses its content: the whole-text
    haystack gets a bare newline there, which no gap class in this
    module can cross, and a window spanning it holds one real row and
    nothing else.

    `text` is gone from the signature. It was the normalized page and
    `lines` is that same page split, so the haystack is rebuilt from the
    lines that survive rather than from a copy that never knew of them.
    """
    kept = [
        line if usable else ""
        for line, usable in zip(lines, _result_row_mask(lines))
    ]
    return ["\n".join(kept), *_build_line_windows(kept, max_window=2)]


def _extract_numeric_panel(
    text: str,
    lines: List[str],
    fields: List[Dict[str, Any]],
    panel: Dict[str, Any],
    definitions: Dict[str, Dict[str, Any]],
    *,
    confidence: float = 0.93,
    neighbours: Optional[Dict[str, Dict[str, Any]]] = None,
) -> None:
    """Every numeric laboratory panel, read off the ROW.

    ONE ROW READER FOR ALL OF THEM, WHICH IS THE POINT OF THIS FUNCTION.
    `_extract_labs` — the biochemistry and muscle-enzyme map — has read
    its analytes with `_extract_lab_value` since that reader was
    written, and every fix the row reader has had since landed there and
    nowhere else: the reference interval, the abnormal flag, the unit
    column, the reading that is not the interval's lower bound, the row
    that does not end at its own 提示 cell. The other six panels — 血常规,
    甲功, 凝血, 尿常规, 感染筛查, 粪便 — reached this function instead and
    read their numbers with a per-analyte regex, which knows nothing
    about columns. So the SAME haemoglobin row was read one way on a
    biochemistry report and another way on a 血常规.

    They are not different problems. A Chinese laboratory prints one
    table: the column orders, the flag conventions, the unit forms and
    the interval forms are the same on all six, and what differs is the
    analyte names. So the names are what a panel declares, and the row
    reader is shared — the fix for a column order is then a fix
    everywhere, rather than a fix in whichever panel it was measured on.

    THE PATTERNS STAY, DEMOTED TO A FALLBACK. They read the shapes a
    table reader cannot see — a name and its value in one sentence, a
    result the OCR recovered as prose — and on the layouts where both
    can read, the row reader is the one that also answers 「what else is
    on this row」. Where the fallback is what found the number,
    `_row_context` corroborates it exactly as before.

    `neighbours` are the panel's OTHER declared analytes — the
    qualitative rows of a 尿常规, declared in a second dict — named here
    so that 白细胞 knows 白细胞酯酶's row is not its own.
    """
    haystacks = _panel_haystacks(lines)
    #: The panel's own analyte vocabulary, which is what tells one row
    #: from another inside it — see `_row_context`.
    vocabulary: Dict[str, List[str]] = {
        name: list(meta.get("keywords", [])) for name, meta in definitions.items()
    }
    context: Dict[str, List[str]] = dict(vocabulary)
    for name, meta in (neighbours or {}).items():
        context.setdefault(name, list(meta.get("keywords", [])))
    frozen_context = _freeze_vocabulary(context)
    for field_name, meta in definitions.items():
        row = _read_analyte_row(context, field_name, lines)
        raw_value = row.value
        normalized_value = _safe_float(raw_value) if raw_value is not None else None
        unit = meta.get("unit")
        if raw_value is None:
            # THE OTHER ROWS OF THIS PANEL, so a pattern that reaches
            # across a window seam cannot publish one of their figures
            # under this analyte's key. See `_find_reading_regex`.
            crossings = _analyte_crossing_pattern(frozen_context, field_name)
            for haystack in haystacks:
                raw_value, normalized_value, unit = _extract_named_number(
                    haystack,
                    meta.get("patterns", []),
                    meta.get("unit"),
                    avoid_reference_intervals=True,
                    crossings=crossings,
                )
                if raw_value is not None:
                    break
            if raw_value is None:
                continue
            row = _row_context(context, field_name, lines, raw_value)
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
    """Every qualitative laboratory panel, read off the ROW.

    THE SAME MIGRATION `_extract_numeric_panel` MADE, ONE COLUMN OVER.
    The numeric panels stopped scanning for 「the name, then the first
    number」 because on 项目 / 参考区间 / 结果 that number is the
    interval's lower bound. These panels went on scanning for 「the name,
    then the first 阴性/阳性」 — which is the identical assumption about
    the identical column order, and on that order the verdict it finds
    is the laboratory's REFERENCE. A 尿常规 reporting 蛋白质 阳性
    published 阴性; so did 潜血, 葡萄糖 and every other qualitative row on
    the page, and so did a hepatitis or HIV screen printed the same way.

    `_read_qualitative_row` CORROBORATES THE PATTERN, WHICH IS THE SHAPE
    `_row_context` ALREADY USES one panel over. The patterns keep their
    reading wherever the row agrees with it, so a report this module
    already read correctly is published exactly as before, down to which
    half of 「阴性(-)」 the alternation stopped at. The row's answer
    replaces it only where the two say DIFFERENT THINGS — a positive
    against a negative — because that disagreement is the defect: the
    pattern took the reference column and the row reader did not. Where
    the row was found and could not be read at all, nothing is
    published; falling back would publish the very cell the refusal
    exists to withhold.
    """
    haystacks = _panel_haystacks(lines)
    columns = _page_columns(lines)
    vocabulary: Dict[str, List[str]] = {
        name: list(meta.get("keywords", [])) for name, meta in definitions.items()
    }
    for field_name, meta in definitions.items():
        row_value = _read_qualitative_row(vocabulary, field_name, lines, columns)
        if row_value is _AMBIGUOUS_QUALITATIVE:
            continue
        # THE ROWS THE CLOSED VOCABULARY WAS NEVER GOING TO REACH. A
        # colour and a consistency are printed in the same two columns
        # as a 阴性/阳性, in the same order, and were still being read
        # out of the reference one. See `_read_free_text_row`.
        free_text = None
        if row_value is None:
            free_text = _read_free_text_row(vocabulary, field_name, lines, columns)
            if free_text is _AMBIGUOUS_QUALITATIVE:
                continue
        raw_value = None
        for haystack in haystacks:
            raw_value = _extract_named_text(haystack, meta.get("patterns", []))
            if raw_value is not None:
                break
        if row_value is not None and (
            raw_value is None
            or _qualitative_polarity(row_value) != _qualitative_polarity(raw_value)
        ):
            raw_value = row_value
        # THE ROW WINS OUTRIGHT HERE, unlike the qualitative branch
        # above. There the pattern's answer is kept wherever the two
        # AGREE IN MEANING, so that a report this module already read
        # correctly keeps the exact spelling its alternation stopped at;
        # a free-text cell has no meaning to compare, only a printed
        # form, and the row reader is the one that read it out of the
        # right column.
        elif free_text is not None:
            raw_value = free_text
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
) -> Optional[Dict[str, Any]]:
    """One published field, or `None` where the row contradicts itself.

    NOTHING ANYWHERE IN THIS FILE COMPARED THE FLAG AGAINST THE
    INTERVAL, and this is the one place both halves of the row arrive
    together. A reading below its own printed reference floor carrying
    the laboratory's own HIGH marker is not a reading — it is a row
    whose columns were read out of order, shipped at the confidence of
    one that was read correctly. See `_row_contradicts_itself` for what
    counts and, just as importantly, what does not.

    Returning `None` is how the refusal reaches the payload: every
    caller in this module hands the result to `_append_field`, which has
    always dropped a field it is given nothing for. The two callers that
    also write the panel dict — `_append_panel_number` and
    `_extract_labs` — build the field FIRST and write the panel only if
    one came back, so a refused reading is absent from both.
    """
    if normalized_value is NO_NORMALIZED_VALUE:
        normalized: Any = None
    elif normalized_value is not None:
        normalized = normalized_value
    else:
        normalized = field_value
    typed = (
        float(normalized)
        if isinstance(normalized, (int, float)) and not isinstance(normalized, bool)
        else _exact_float(field_value)
    )
    if _row_contradicts_itself(typed, abnormal_flag, reference_low, reference_high):
        return None
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


class _NamedMuscle(NamedTuple):
    """One muscle a sentence names — identified, or merely recognised."""

    canonical_name: Optional[str] = None
    region: Optional[str] = None
    #: The term as the report printed it, set ONLY when the module could
    #: not identify it. See `_MUSCLE_TERM`.
    unread_term: Optional[str] = None


def _trim_muscle_term(term: str) -> str:
    """A printed muscle term without the side and the conjunction on its front."""
    return _MUSCLE_TERM_QUALIFIERS.sub("", term.strip()).strip()


def _names_no_muscle(term: str) -> bool:
    """`term` ends in 肌 and is a region or a tissue, not a muscle."""
    return term.endswith("肌群") or term in _NOT_A_MUSCLE_NAME


def _muscles_in_sentence(sentence: str) -> List[_NamedMuscle]:
    """EVERY muscle the sentence names, identified where it can be.

    TWO THINGS CHANGED HERE AND THEY ARE THE SAME THING.

    IT READS EVERY MUSCLE, NOT THE FIRST. `_muscle_from_sentence`
    returns on its first hit, and a radiology sentence names muscles in
    a LIST — 「右侧腓肠肌内侧头、双侧胫骨前肌与趾长伸肌脂肪浸润」 is one
    sentence (a Chinese enumeration comma is not a sentence break), so
    two of its three muscles were dropped without trace. WHICH muscles
    are involved and which are spared IS the finding on this modality;
    a map holding one of them is a different report.

    AND IT RECOGNISES A MUSCLE IT CANNOT IDENTIFY. See `_MUSCLE_TERM`:
    a term this module does not carry comes back with no canonical name
    and the printed term instead, so the caller can publish it as unread
    rather than publish nothing.

    A term OVERLAPPING a name the lexicon already matched is that same
    muscle under its qualifiers — 「双侧股直肌」 covers 股直肌 — and is
    not reported twice.
    """
    lowered = sentence.lower()
    hits: List[Tuple[int, _NamedMuscle]] = []
    claimed: List[Tuple[int, int]] = []
    for canonical_name, meta in MUSCLE_KEYWORDS.items():
        for keyword in meta["keywords"]:
            token = keyword.lower().strip()
            if not token:
                continue
            # EVERY occurrence is claimed, not the first. A name printed
            # twice in one clause would otherwise have its second
            # printing fall through to `_MUSCLE_TERM` and be reported as
            # an UNREAD muscle — a false alarm on a muscle this module
            # had just identified.
            spans = [(m.start(), m.end()) for m in re.finditer(re.escape(token), lowered)]
            if not spans:
                continue
            claimed.extend(spans)
            hits.append((spans[0][0], _NamedMuscle(canonical_name, meta["region"], None)))
            break
    seen_terms: set = set()
    for match in _MUSCLE_TERM.finditer(sentence):
        if any(start < match.end() and match.start() < end for start, end in claimed):
            continue
        term = _trim_muscle_term(match.group())
        if not term or _names_no_muscle(term) or term in seen_terms:
            continue
        seen_terms.add(term)
        hits.append((match.start(), _NamedMuscle(None, None, term)))
    # In the order the report printed them, which is the order a reader
    # of `mri_map` is looking at the sentence in.
    return [muscle for _, muscle in sorted(hits, key=lambda hit: hit[0])]


#: HOW A CHINESE MUSCLE MRI SAYS ONE SIDE IS WORSE.
#:
#: The reader carried four spellings — 左侧较重, 左侧更重 and the two
#: English ones — and a Chinese radiologist writes 「右侧著」, 「以右侧为
#: 著」, 「右侧较左侧明显」 or 「左右不对称」. FSHD IS CHARACTERISTICALLY
#: ASYMMETRIC: this is the descriptor that distinguishes it from the
#: limb-girdle dystrophies it is confused with, and every one of those
#: spellings produced `asymmetry: none` — which is not 「we did not
#: read it」, it is the report's own signature finding contradicted.
#:
#: IT IS NOT GROUNDABLE EITHER, AND IT DOES NOT NEED A LIST. There is no
#: descriptor vocabulary in the payload — the wire holds this module's
#: own two tokens and nothing to read them from. What it has instead is
#: COMPOSITION: 「side + (optional comparison) + emphasis word」 is the
#: grammar all of these are built out of, so the two patterns below
#: cover the phrasings nobody has written down yet, which a list of four
#: could not.
#:
#: THE COMPARISON IS TRIED FIRST, because it is the only form in which
#: the OTHER side is also named — 「右侧脂肪浸润较左侧明显」 mentions 左侧
#: second, and an emphasis reader scanning for 「左侧…明显」 would find it
#: and answer with the wrong side. The lookbehind on the emphasis
#: pattern refuses a side that a comparison word introduces for the same
#: reason.
#:
#: 「为主」 AND 「甚」 ARE EMPHASIS WORDS, NOT LINKING ONES. 「以右侧为
#: 主」 is the commonest way a Chinese radiologist names the heavier
#: side after 「以…为著」, and 「以左侧为甚」 is the next; both came back
#: `asymmetry: none`. 甚 was listed in `_ASYMMETRY_LINKING` — the class
#: of characters that may sit BETWEEN the side and the emphasis word —
#: where it can never be reached, because 「右侧为甚」 ends on it and the
#: pattern then requires an emphasis word that is not there.
_ASYMMETRY_EMPHASIS_WORDS = "著|重|明显|显著|突出|严重|为主|甚"
_ASYMMETRY_COMPARISON = re.compile(
    rf"([左右])侧[^,\n]{{0,12}}?[较比]([左右对健])侧[^,\n]{{0,8}}?"
    rf"(?:{_ASYMMETRY_EMPHASIS_WORDS})"
)
#: WHAT A RADIOLOGIST PUTS BETWEEN THE SIDE AND THE EMPHASIS WORD.
#:
#: The pattern allowed ONE optional character — 「为」, 「更」 or 「较」 —
#: and the ordinary comparative forms are two: 「右侧较为明显」,
#: 「左侧更为明显」, 「右侧尤为明显」, 「左侧相对更重」. Each of those is a
#: report stating the asymmetry FSHD is characterised by, and each came
#: back `asymmetry: none` — the study's own signature finding
#: contradicted, on the modality this disease is followed by.
#:
#: A CLOSED CLASS AND NOT A GAP. Widening this to 「any few characters」
#: reads 「左侧膈肌运动明显减弱」 — a diaphragm moving poorly, which says
#: nothing about which side is more infiltrated — as a left-heavy
#: asymmetry. These are the linking words themselves, so a clause that
#: changes subject between the side and the emphasis word cannot be
#: joined back up.
_ASYMMETRY_LINKING = "为更较相对尤稍略"
_ASYMMETRY_SIDE_EMPHASIS = re.compile(
    rf"(?<![较比于和与及])([左右])侧?(?:受累|病变|改变)?[{_ASYMMETRY_LINKING}]{{0,3}}"
    rf"(?:{_ASYMMETRY_EMPHASIS_WORDS})"
)

#: THE STUDY SAYS IT IS ASYMMETRIC AND DOES NOT SAY WHICH SIDE. 「左右不
#: 对称」 and a bare 「不对称」 are the commonest asymmetry sentences on a
#: Chinese muscle MRI and neither names a heavier side.
_ASYMMETRY_MARKERS: Tuple[str, ...] = (
    "不对称", "欠对称", "不完全对称", "非对称", "asymmetr",
)

#: RECORDED RATHER THAN DISCARDED, and spelled the way this file already
#: spells 「the report said so and did not say which」 — see
#: `abnormal_unspecified` in `_WORD_FLAG_CELLS`. Rounding it down to
#: `none` would publish 「左右对称」 off a report that said the opposite.
ASYMMETRY_UNSPECIFIED = "asymmetric_unspecified"


#: WHAT A MUSCLE MRI SAYS ABOUT A MUSCLE. Keyed by the field each
#: descriptor is published under. The `_build_field` calls in
#: `_extract_mri` spell the same three names as literals on purpose —
#: see the note there — so this table is the reader's half only.
_MRI_DESCRIPTORS: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    ("fatty_infiltration", ("脂肪浸润", "脂肪变", "脂肪替代", "fatty")),
    ("inflammatory_change", ("炎性改变", "炎症", "水肿", "edema")),
    ("atrophy", ("萎缩", "atrophy")),
)


class _MriClause(NamedTuple):
    """One clause of a radiology sentence: what it names, what it says.

    `descriptors` holds the FIELD NAMES the clause asserts, which is
    what keeps this reader and `_extract_mri`'s writer from drifting.
    """

    muscles: Tuple[_NamedMuscle, ...] = ()
    descriptors: Tuple[str, ...] = ()


def _mri_clauses(sentence: str) -> List[_MriClause]:
    """`sentence` split where a radiologist changes subject.

    THE TWO COMMAS ARE NOT THE SAME COMMA. 「、」 is the enumeration
    comma and separates the muscles INSIDE one statement —
    「股外侧肌、股中间肌脂肪浸润」 is one finding about two muscles. 「，」
    (folded to 「,」 by `_normalize_text`) separates the statements, and
    a radiologist uses it to say what is NOT involved as often as what
    is: 「…脂肪浸润,股直肌相对保留」. Reading the descriptor against the
    whole sentence published that spared muscle as infiltrated, which is
    the opposite of what the page says, on the modality this disease is
    followed by.
    """
    return [
        _read_mri_clause(part)
        for part in re.split(r"[,]", sentence)
        if part and part.strip()
    ]


def _read_mri_clause(clause: str) -> _MriClause:
    """The muscles a clause names and the descriptors it asserts of them.

    A CLAUSE THAT SAYS THE THING WAS NOT FOUND ASSERTS NOTHING.
    「未见明显脂肪浸润」 contains 脂肪浸润, and a substring test on it
    published `fatty_infiltration: yes` off a sentence stating the
    opposite. `_states_an_absence` is the test this file already keeps
    for that question; the clause is the right scope for it, because
    「…脂肪浸润,未见炎性改变」 asserts one and denies the other.
    """
    stripped = clause.strip()
    lowered = stripped.lower()
    denies = _states_an_absence(stripped) or "相对保留" in stripped
    descriptors: Tuple[str, ...] = ()
    if not denies:
        descriptors = tuple(
            field_name
            for field_name, keywords in _MRI_DESCRIPTORS
            if any(keyword.lower() in lowered for keyword in keywords)
        )
    return _MriClause(tuple(_muscles_in_sentence(stripped)), descriptors)


def _read_asymmetry(sentence: str) -> str:
    """Which side this sentence says is worse, or that it only says they differ."""
    lowered = sentence.lower()
    if "left greater than right" in lowered:
        return "left_gt_right"
    if "right greater than left" in lowered:
        return "right_gt_left"
    comparison = _ASYMMETRY_COMPARISON.search(sentence)
    if comparison and (
        comparison.group(2) in "对健" or comparison.group(1) != comparison.group(2)
    ):
        return "left_gt_right" if comparison.group(1) == "左" else "right_gt_left"
    if not comparison:
        emphasis = _ASYMMETRY_SIDE_EMPHASIS.search(sentence)
        if emphasis:
            return "left_gt_right" if emphasis.group(1) == "左" else "right_gt_left"
    if any(marker in lowered for marker in _ASYMMETRY_MARKERS):
        return ASYMMETRY_UNSPECIFIED
    return "none"


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


#: THE SPECIMEN, WHERE TWO PANELS COUNT THE SAME CELLS. Full spellings
#: only: a bare 尿 is inside 尿素 and 尿酸, which are biochemistry rows
#: drawn from blood.
_URINE_SPECIMEN_MARKERS: Tuple[str, ...] = (
    "尿常规", "尿液分析", "尿液", "尿沉渣", "小便常规", "中段尿", "晨尿",
    "尿标本", "尿液检查", "urinalysis", "urine",
)

#: Cells that exist only in a blood tube. A page printing any of them is
#: not a urine report however much urine vocabulary it also carries.
_BLOOD_SPECIMEN_MARKERS: Tuple[str, ...] = (
    "血常规", "血细胞分析", "全血细胞", "血液分析", "血红蛋白", "血小板",
    "静脉血", "末梢血", "hgb", "plt", "mcv", "mchc", "hct",
)


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

    # A URINE REPORT IS NOT A BLOOD COUNT, AND THE SPECIMEN IS WHAT SAYS
    # SO.
    #
    # 白细胞 and 红细胞 are rows of a 血常规 AND rows of a 尿常规, and the
    # blood rules score the bare words plus 「WBC」 — so an ordinary
    # 尿液分析报告单 printing 「白细胞(WBC)」 and 「红细胞(RBC)」 came out
    # `blood_routine` (8 against 5). Nothing downstream can tell: the
    # payload says 血常规报告, `_extract_urinalysis` never runs, and the
    # sediment counts are published as `wbc` and `rbc` — the keys the
    # mobile 血常规 section reads. A urine white cell count of 25/µL
    # displayed as a blood white cell count of 25 is a leukaemic figure.
    #
    # DECIDED ON THE SPECIMEN RATHER THAN ON THE SCORE, because the score
    # is exactly what cannot separate them: both panels count the same
    # two cells. A report naming urine is a urine report unless it also
    # prints something only whole blood has — haemoglobin, platelets,
    # the red cell indices — which is the shape of every genuinely
    # ambiguous page.
    if (
        best_type == "blood_routine"
        and any(marker in normalized for marker in _URINE_SPECIMEN_MARKERS)
        and not any(marker in normalized for marker in _BLOOD_SPECIMEN_MARKERS)
    ):
        best_type = "urinalysis"
        best_score = max(scores.get("urinalysis", 0), best_score)
        confidence = min(0.99, 0.45 + best_score / 18.0)
        reasons["urinalysis"] = reasons.get("urinalysis", []) + [
            "specimen:标本为尿液，白细胞/红细胞按尿沉渣判读"
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
    `_states_an_absence`, what was NOT found, and `_FINDING_MARKERS`, what
    was. Either of them present means the line is reporting, and a
    reporting line is not a signature whatever its length. Both are
    defined below this point in the file and resolved when this runs.
    """
    stripped = text.strip()
    if not _BARE_NAME.match(stripped) or stripped in _NOT_A_NAME:
        return False
    lowered = stripped.lower()
    if _states_an_absence(stripped):
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


# --------------------------------------------------------------------
# THE NEGATOR, PARSED ONCE — NOT REMEMBERED PER LIST
#
# THIS FILE HAS NOW HAD THE SAME DEFECT ON THREE SEPARATE LISTS, and
# every time it was a NEGATOR FUSED INTO A WORD THAT A LIST READ AS THE
# WORD'S OPPOSITE:
#
#   - `_ABSENCE_MARKERS` held the bare 排除 and was asked with a
#     substring test, so 「不排除」 and 「不能排除」 — the laboratory
#     saying it CANNOT rule the thing out, which is the opposite of an
#     absence — were read as the report denying the finding. Measured:
#     「4q35 单倍型: 4qA, 不能排除低比例嵌合」 published `haplotype:
#     None`, and 「D4Z4重复单元数为 3, 不排除嵌合体可能」 published no
#     count at all — the stated allele and the one number this whole
#     product turns on, both erased by a caveat that asserts neither.
#   - `_BOUND_BEFORE_VALUE` held the bare 超过 and not 不超过, and it is
#     applied with `.search`, so the engine skipped the 不 and matched
#     超过 alone. The refusal string this file PRINTS back to the
#     reviewer was then 「超过10」 on a report that said 「不超过10」 —
#     the bound read in the opposite direction, on the FSHD1 boundary.
#   - the round before that, 不过 (「however」) was parsed as a negator
#     plus an aspect particle and flipped the bound behind it.
#
# A list cannot be kept correct by remembering to add each negated form
# to it, because the negated forms are not a list: 不 / 未 / 没 / 无
# combine with a bounded run of closed-class function words and then
# with whatever word follows. So the negator is parsed HERE, once, and
# every reader that cares combines it with a polarity of its own — the
# same shape `answer-guard.ts` settled on in apps/api, where a bound is
# 「a direction, optionally negated, and the negation flips it」.
#
# THE TWO USES DIFFER ONLY IN WHAT THEY COMBINE IT WITH:
#
#   - the absence readers combine it with the POLARITY OF A VERB —
#     `_states_an_absence`. 见 / 检出 / 发现 are FINDING verbs and become
#     an absence when negated; 排除 / 除外 are EXCLUSION verbs and are an
#     absence UNNEGATED and stop being one when negated. One XOR, and
#     「未见」 and 「不排除」 stop having to be separately remembered.
#   - the bound guard combines it with a DIRECTION — `_BOUND_WORD`.
#     Direction is not what that guard publishes (it prints the bound
#     back exactly as the report spelled it and normalises nothing), so
#     it needs no flip; what it needs is that the negator be part of the
#     match instead of being skipped over.
#
# WHICH DIRECTION AN ERROR HERE FAILS IN. Failing to SEE a negator makes
# 不排除 an absence — data is dropped, which this file has always
# preferred to inventing any. Seeing one that is not there makes an
# absence into an assertion, which publishes a finding the report
# denied. So the gap between the negator and its verb is a CLOSED class
# of function words, never a content word, and it is bounded.
# --------------------------------------------------------------------

#: 不 / 未 / 没 / 无 — the negator core.
_NEGATOR_HEAD = "(?:不|未|没|无)"

#: The closed function words that may stand between the negator and the
#: word it negates: modals, the degree adverbs a 「cannot COMPLETELY
#: exclude」 puts there, and the link verbs that make a negator and its
#: predicate one clause. Longest alternative first, so 能够 is never
#: read as a bare 能 with a stray 够 left over.
#:
#: 过 AND 得 ARE DELIBERATELY ABSENT, and the previous round is why. 过
#: is the experiential aspect and FOLLOWS its verb, so against 不 it is
#: not a particle at all — 不过 is one word, the connective 「however」,
#: and admitting it made 「不过大于 10 个就要考虑 FSHD2」 read as the
#: complement of the band that sentence states. 得 is preverbal only in
#: the fused modal 不得; elsewhere it is a potential complement, and
#: admitting it made 不见得 (「not necessarily」) parse as a negation.
#: A content word is absent for the reason stated above the block: it
#: would let the negator reach across a word boundary that is not there.
_NEGATOR_LINK = (
    "(?:能够|可以|应当|应该|必须|完全|彻底|绝对|全然|曾经"
    "|能|可|会|应|须|要|法|予|曾|再|有)"
)

#: A negator and its gap — 「不」「不能」「无法」「没有」「不能完全」.
#: Bounded, so it is a grammatical join and not a reach across a
#: sentence, and so the engine cannot backtrack pathologically.
_NEGATION = rf"{_NEGATOR_HEAD}(?:\s*{_NEGATOR_LINK}){{0,3}}\s*"

#: Verbs of FINDING. Negating one is what makes a statement an absence,
#: and an un-negated one asserts the opposite — which is why the bare
#: forms could never have been listed as absence markers, and why the
#: negated forms no longer have to be.
#:
#: Longest first: 查见 contains 见, 检测到 stands whole.
_FINDING_VERBS: Tuple[str, ...] = (
    "检测到", "检出", "测出", "发现", "查见", "提示", "支持", "见",
)

#: Verbs of EXCLUSION. These are the mirror image: 「排除 FSHD1」 IS the
#: report denying the finding, and 「不排除 FSHD1」 is the report saying
#: it cannot. Same negator, opposite starting polarity.
_EXCLUSION_VERBS: Tuple[str, ...] = ("排除", "除外")

#: An absence with no verb in it to negate. 「阴性」 is the whole
#: statement, so it is an atom and the negator grammar must not be let
#: near it.
_ABSENCE_ATOMS: Tuple[str, ...] = ("阴性", "not detected", "negative")

#: A VERB FOLLOWED BY 得 IS NOT THAT VERB. 得 after a verb opens the
#: potential complement, and 不见得 is 「not necessarily」 — a HEDGE that
#: asserts no absence at all. Without this the negator grammar read it
#: as 不 + 见 and called the clause a denial, which is the mirror image
#: of the defect `_NEGATOR_LINK` refuses 得 for on the bound side. One
#: hedge, one reading, both sides of the file.
#: Only the negator and the EXCLUSION side are named: the finding
#: branch is the else of the same alternation, so a group for it would
#: be a field nothing reads.
_ABSENCE_CLAUSE = re.compile(
    rf"(?P<neg>{_NEGATION})?"
    rf"(?:(?:{'|'.join(_FINDING_VERBS)})"
    rf"|(?P<excl>{'|'.join(_EXCLUSION_VERBS)}))"
    r"(?!\s*得)"
)


def _states_an_absence(text: str) -> bool:
    """Does `text` say the laboratory did NOT find the thing?

    THE XOR IS THE WHOLE RULE. A finding verb asserts an absence only
    when it is negated; an exclusion verb asserts one only when it is
    NOT. 「未见」 and 「排除」 are both absences, 「见」 and 「不排除」 are
    neither, and nobody has to keep two lists in step for that to hold.

    `finditer` rather than a search, so the leftmost match at a negator
    CONSUMES the verb behind it — that is what stops 「不能排除」 from
    being re-read one character later as a bare 排除, which is exactly
    how the substring test got the sentence backwards.

    GIVEN A CLAUSE, NOT A LINE, by every caller that has a clause to
    give — see `_clause_around`.
    """
    lowered = text.lower()
    if any(atom in lowered for atom in _ABSENCE_ATOMS):
        return True
    return any(
        (match.group("neg") is not None) != (match.group("excl") is not None)
        for match in _ABSENCE_CLAUSE.finditer(lowered)
    )


#: The report naming a type it is asking someone else to confirm.
#: Separate from absence because the wording differs, and because only
#: the graded fields care — a hedged sentence is still DISPLAYED, via
#: `interpretation_summary`; it just does not become a diagnosis.
#:
#: 不排除 / 不能排除 BELONG HERE AND NOWHERE ELSE. 不除外 — the same
#: sentence in different characters — has been on this list since it was
#: written, while its two synonyms were on the ABSENCE list, so one
#: hedge had two opposite readings depending on which characters the
#: laboratory happened to print. `_states_an_absence` no longer calls
#: them absences; this is what they are instead.
_HEDGE_MARKERS = (
    "怀疑",
    "疑似",
    "待排",
    "待查",
    "拟诊",
    "不除外",
    "不排除",
    "不能排除",
    "可能为",
    "rule out",
    "suspected",
)

#: A TYPE NAMED IN A RECOMMENDATION IS NEITHER STATED NOR DENIED.
#:
#: 「本次检测不支持 FSHD1, 建议评估 FSHD2」 is the ordinary negative
#: conclusion, and its second clause NAMES the type it is asking someone
#: else to look at. That clause was only ever suppressed by accident —
#: by the 不支持 in the FIRST clause reaching across the comma — so the
#: moment the absence test was given the scope it should always have
#: had, 建议评估 FSHD2 became this patient's 分型.
#:
#: THIS IS NOT A HEDGE AND MUST NOT BE ONE. `_read_diagnosis_type`
#: collects hedged and denied tokens into one set that refuses the token
#: EVERYWHERE ON THE PAGE, and a positive report says 「符合 FSHD1 分子
#: 诊断标准.」 and then 「建议按 FSHD1 进行随访管理」 — measured, with
#: 建议 on the hedge list: `diagnosis_type: None` on a genetically
#: confirmed report, which is the whole field lost to a follow-up
#: sentence. A recommendation clause asserts nothing in either
#: direction, so the token in it is simply not a candidate.
#:
#: A MARKER GOVERNS WHAT FOLLOWS IT, which is the rule
#: `_haplotype_tokens_on` and `_inline_row_rank` already apply to a
#: label. 「建议评估 FSHD2」 puts the marker in front of the type and is a
#: recommendation; 「符合 FSHD1 分子诊断标准并建议遗传咨询」 puts it
#: behind, where it recommends the counselling and not the diagnosis.
_RECOMMENDATION_MARKERS: Tuple[str, ...] = (
    "建议", "推荐", "进一步", "有待", "拟行", "转诊",
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
#:
#: AND THE NEGATED SPELLINGS ARE NOT A LIST. This pattern used to
#: enumerate six of them — 不小于 / 不大于 / 不少于 / 不多于 / 不低于 /
#: 不高于 — beside the bare 超过, and it is applied with `.search`, so on
#: 「D4Z4重复单元数为不超过10个」 the engine simply started one character
#: later and matched 超过 alone. The bound was still refused as a bound,
#: which is not the harm: the harm is that this guard PRINTS the bound
#: back the way the report spelled it, so `d4z4_repeat_pathogenic` came
#: out 「超过10」 on a report that says 「不超过10」 — the FSHD1 boundary
#: read in the opposite direction, on the passport, in the exports and
#: in `latest_summary.by_analyte…value_text`.
#:
#: So the negator is `_NEGATION` — the one the absence readers parse —
#: and the direction is parsed separately behind it. Every negated
#: spelling the old list held is now a consequence of the grammar rather
#: than an entry, and so are 不能超过 / 无法达到 / 未能低于 and the rest
#: of a set nobody was going to finish enumerating.
#:
#: THE DIRECTION IS NOT FLIPPED HERE, deliberately. This guard answers
#: one question — 「is the number a THRESHOLD rather than this patient's
#: reading」 — and a threshold is a threshold in either direction. It
#: normalises nothing and computes nothing; `normalized_value` is
#: already `NO_NORMALIZED_VALUE` for every refusal. `intervalsIn` in
#: apps/api is the reader that needs the flip, and it does the XOR.
#:
#: 低于 AND 高于 ARE HERE NOW BECAUSE THEIR NEGATIONS ALWAYS WERE. The
#: list carried 不低于 and 不高于 and not the affirmative pair, which is
#: the one spelling a reference sentence is most likely to use —
#: measured: 「D4Z4重复单元数为低于10个」 published
#: `d4z4_repeat_pathogenic: 10` at 0.97, the confidence reserved for a
#: cell read off a result row, on a report stating no count at all.
_BOUND_DIRECTION = "(?:大于|高于|多于|超过|超出|小于|低于|少于)"

#: 大于等于 / 小于或等于 — the inclusive tail. It changes no direction
#: and therefore nothing this guard does; it is here so the whole
#: printed bound is captured rather than half of it.
_BOUND_OR_EQUAL = "(?:或?等于)?"

#: THE WHOLE 「FALLS SHORT OF N」 FAMILY, AS ATOMS — and the family was
#: missing outright.
#:
#: 不足 / 不到 / 不下 / 不满 / 不及 / 未达 / 未满 are how a Chinese report
#: states a floor, and NONE of them is a negated direction word: 足, 到,
#: 下, 满, 及, 达 are attainment verbs, not directions, so the negator
#: rule must not be allowed to take them apart. They are whole words and
#: they are listed as whole words — the same split `answer-guard.ts`
#: makes with its `BELOW_ATOM`.
#:
#: Measured, on 「D4Z4重复单元数为{word}10个」 for every one of the seven:
#: `d4z4_repeat_pathogenic: 10` with `normalized_value: 10` at 0.97 on a
#: report that prints no count for this patient anywhere. Ten is the top
#: of the FSHD1 range — the number that decides whether this platform
#: shows a contracted-array reading at all — and it was being invented
#: out of the sentence that DEFINES that boundary.
_BOUND_ATOM = "(?:不足|不到|不下|不满|不及|未达|未满|至少|最少|起码|至多|最多)"

#: An atom first, so 不足 is never taken apart as a negated 足; then a
#: direction with its optional negator and its optional inclusive tail.
_BOUND_WORD = rf"(?:{_COMPARATOR}|{_BOUND_ATOM}|(?:{_NEGATION})?{_BOUND_DIRECTION}{_BOUND_OR_EQUAL})"

_BOUND_BEFORE_VALUE = re.compile(rf"{_BOUND_WORD}\s*$")

#: AND A COMPARATOR STANDS AFTER THE NUMBER JUST AS OFTEN.
#:
#: 「11以上」 and 「10以下」 are how Chinese states a threshold — the same
#: sentence as 「>11」 and 「<10」, with the comparator SUFFIXED. The guard
#: above asks only what precedes the value, so the suffix form was not a
#: bound to this reader at all, and a sentence stating where the
#: laboratory's range begins became the patient's own array size:
#:
#:     检测结果: D4Z4重复单元数 11以上为正常参考范围
#:
#: published `d4z4_repeat_pathogenic: 11` with `normalized_value: 11` at
#: 0.97 — the confidence reserved for a cell actually read off a result
#: row — on a report that states no count for this patient anywhere. It
#: is the cell the whole product turns on: the passport prints it, the
#: exports carry it, and `applyGeneticReportAutofill` writes it into
#: `patient_profiles`. A count of 11 sits one repeat above the FSHD1
#: ceiling, so the invented number also types the patient as NOT
#: contracted.
#:
#: 以内 IS THE THIRD SPELLING OF THE SAME THING — 「10以内」 bounds from
#: above exactly as 「10以下」 does. A counter (「11个以上」) and 及/或
#: (「11及以上」, 「11或以上」) may stand between the number and the
#: comparator; nothing else may, because a gap that admits arbitrary
#: characters would let a threshold sentence FURTHER DOWN the row make
#: this row's genuine reading unpublishable.
#: No `^`: this is asked with `.match(row, pos)` from where the number
#: ends, and `^` would anchor at the start of the row instead.
_BOUND_AFTER_VALUE = re.compile(r"\s*[个条次]?\s*(?:及|或)?\s*(?:以上|以下|以内)")


def _line_around(text: str, index: int) -> str:
    """The single line `index` falls on, newline excluded."""
    return _line_span(text, index)[0]


def _match_clause(text: str, match: "re.Match") -> str:
    """The clause of `text` this match sits in — see `_CLAUSE_BREAK`.

    THE LINE WAS THE WRONG SCOPE AND THE WHOLE REPORT WAS THE WRONG
    SCOPE BEFORE IT. A line of a Chinese conclusion carries two or three
    clauses and they make DIFFERENT claims; the one governing a token is
    the one the token is in.
    """
    line, line_start = _line_span(text, match.start())
    return _clause_around(line, match.start() - line_start)


def _asserts_absence(text: str, match: "re.Match") -> bool:
    """Does the clause this match sits in say the thing was NOT found?"""
    return _states_an_absence(_match_clause(text, match))


def _only_recommends(text: str, match: "re.Match") -> bool:
    """Does this match's clause merely RECOMMEND looking at the type?

    Neither a statement nor a denial — see `_RECOMMENDATION_MARKERS`.
    Positional: a marker counts only where it stands in FRONT of the
    token, because that is where it governs it.
    """
    line, line_start = _line_span(text, match.start())
    at = match.start() - line_start
    clause, clause_start = _clause_span(line, at)
    ahead = clause[: at - clause_start].lower()
    return any(marker in ahead for marker in _RECOMMENDATION_MARKERS)


def _is_hedged(text: str, match: "re.Match") -> bool:
    """Does the clause this match sits in merely suspect the thing?

    THE SAME SCOPE THE ABSENCE TEST USES, because it is the same
    question about the same token and the two disagreeing on scope is
    how one hedge ends up with two readings. 「符合 FSHD1 分子诊断标准,
    待排合并其他肌病」 states one type and defers a second one.
    """
    lowered = _match_clause(text, match).lower()
    return any(marker in lowered for marker in _HEDGE_MARKERS)


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
            # A RECOMMENDATION IS NOT A REFUSAL. It contributes no
            # candidate and adds nothing to `refused`, so a follow-up
            # sentence naming the type cannot unpublish the conclusion
            # that stated it. See `_RECOMMENDATION_MARKERS`.
            if _only_recommends(row.text, match):
                continue
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
    an allele the report says it did NOT find.

    THAT REFUSAL IS PER TOKEN AND PER CLAUSE, NOT PER LINE. It used to
    empty every bucket the moment an absence marker appeared anywhere on
    the line, and the ordinary Chinese conclusion states one allele and
    denies the other in one breath: 「4q35 单倍型: 4qA, 未见 4qB」
    published NO haplotype at all — the 未见 belongs to the second
    clause, and reading it against the first threw away the allele the
    report had just stated. See `_CLAUSE_BREAK`.
    """
    lowered = line.lower()
    if any(label in lowered for label in _HAPLOTYPE_METHOD_LABELS):
        return [], [], []
    dedicated: List[str] = []
    result: List[str] = []
    unlabelled: List[str] = []
    for match in _HAPLOTYPE_TOKEN.finditer(line):
        if _states_an_absence(_clause_around(line, match.start())):
            continue
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
                + rf"(?P<value>\d+)(?!\s*{_RANGE_SEPARATOR}\s*\d)"
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
                    + rf"(?P<value>\d+\s*{_RANGE_SEPARATOR}\s*\d+)"
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
    #
    # AND THE COMPARATOR IS AS OFTEN PRINTED AFTER THE NUMBER AS BEFORE
    # IT. 「D4Z4重复单元数 11以上为正常参考范围」 is the same sentence as
    # 「>11」 and the guard read only what came BEFORE the value, so this
    # spelling was not a bound at all: a threshold sentence was published
    # as this patient's own count at 0.97. See `_BOUND_AFTER_VALUE`.
    d4z4_refusal: Optional[str] = None
    d4z4_bound: Optional[str] = None
    d4z4_bound_after: Optional[str] = None
    if d4z4_match is not None and d4z4_pathogenic and not d4z4_is_range:
        value_at = (
            d4z4_match.start("value")
            if "value" in d4z4_match.groupdict()
            else d4z4_match.start()
        )
        bound_before = _BOUND_BEFORE_VALUE.search((d4z4_row or "")[:value_at])
        # From the end of the whole match, which is where the number
        # stops on every one of these patterns — the single count ends on
        # its value, the pair and the range on their second number.
        bound_after = _BOUND_AFTER_VALUE.match(d4z4_row or "", d4z4_match.end())
        if _asserts_absence(d4z4_row or "", d4z4_match):
            d4z4_refusal = "negated"
        elif _LENGTH_UNIT_AFTER.match(d4z4_row or "", d4z4_match.end()):
            d4z4_refusal = "length_in_kb"
        elif bound_before is not None:
            d4z4_refusal = "reference_bound"
            d4z4_bound = bound_before.group(0).strip()
        elif bound_after is not None:
            d4z4_refusal = "reference_bound"
            d4z4_bound_after = bound_after.group(0).strip()
        elif d4z4_pathogenic.isdigit() and int(d4z4_pathogenic) == 0:
            d4z4_refusal = "zero"
    if d4z4_refusal in {"negated", "length_in_kb"}:
        # `d4z4_other` only ever comes off the pair match, which is the
        # same match just judged, so it goes with it.
        d4z4_pathogenic = None
        d4z4_other = None
        d4z4_source_text = None
    elif d4z4_refusal == "reference_bound" and (d4z4_bound or d4z4_bound_after):
        # Shown as the report printed it, on the side the report printed
        # it. `normalized_value` is already `NO_NORMALIZED_VALUE` for any
        # refusal, so nothing downstream does arithmetic on either half
        # of this string.
        d4z4_pathogenic = f"{d4z4_bound or ''}{d4z4_pathogenic}{d4z4_bound_after or ''}"
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
    unread_terms: List[str] = []

    for sentence in sentences:
        side = _canonical_side(sentence)
        # THE ASYMMETRY BELONGS TO THE SENTENCE, THE DESCRIPTORS TO THE
        # CLAUSE. 「右侧较重」 is printed as a clause of its own about the
        # muscles the clause before it named, so it is read whole;
        # 「脂肪浸润」 is printed against the muscles standing beside it,
        # and reading THAT against the whole sentence is what put
        # 「双侧股外侧肌、股中间肌脂肪浸润,股直肌相对保留」 on record as a
        # fatty infiltration of the very muscle the radiologist wrote
        # down as SPARED. See `_mri_clauses`.
        asymmetry = _read_asymmetry(sentence)
        clauses = [
            clause for clause in _mri_clauses(sentence) if clause.muscles and clause.descriptors
        ]
        if not clauses:
            # NOTHING SURVIVED THE SPLIT, so the sentence is read whole:
            # a report that names the muscle in one clause and its
            # finding in the next keeps behaving exactly as it did.
            whole = _read_mri_clause(sentence)
            if whole.muscles and (whole.descriptors or asymmetry != "none"):
                clauses = [whole]
        if not clauses:
            continue

        for clause in clauses:
            fatty = "yes" if "fatty_infiltration" in clause.descriptors else None
            inflammation = "yes" if "inflammatory_change" in clause.descriptors else None
            atrophy = "yes" if "atrophy" in clause.descriptors else None
            for muscle in clause.muscles:
                canonical_name = muscle.canonical_name
                body_region = muscle.region
                # AN UNREAD MUSCLE IS PUBLISHED AS UNREAD. Below the
                # 0.75 `review_queue` threshold on purpose: the
                # descriptor was read off the page and the anatomy was
                # not, and a reader has to be able to see which half is
                # which. See `_MUSCLE_TERM`.
                confidence = (
                    0.7
                    if canonical_name is None
                    else (0.8 if asymmetry != "none" else 0.86)
                )
                item: Dict[str, Any] = {
                    "region": body_region,
                    "muscle_name": canonical_name,
                    "side": side,
                    "fatty_infiltration": fatty,
                    "inflammatory_change": inflammation,
                    "atrophy": atrophy,
                    "asymmetry": asymmetry,
                    "source_text": sentence,
                    "confidence": confidence,
                }
                extra: Dict[str, Any] = {
                    "muscle_name": canonical_name,
                    "region": body_region,
                }
                if muscle.unread_term:
                    item["muscle_term"] = muscle.unread_term
                    item["muscle_name_unread"] = True
                    extra["muscle_term"] = muscle.unread_term
                    extra["muscle_name_unread"] = True
                    if muscle.unread_term not in unread_terms:
                        unread_terms.append(muscle.unread_term)
                mri_map.append(item)

                # THE THREE CALLS ARE WRITTEN OUT, NOT LOOPED. The
                # allowlist parity test on the API side reads this
                # module's field names by scraping `_build_field("…"`
                # literals out of the source — see
                # `allowlist.parity.test.ts` — so a name that only ever
                # exists as a loop variable disappears from the
                # inventory the model's own field allowlist is checked
                # against, and the cell silently stops being renderable.
                if fatty:
                    _append_field(
                        fields,
                        _build_field(
                            "fatty_infiltration",
                            fatty,
                            side=side,
                            body_region=body_region,
                            source_text=sentence,
                            confidence=confidence,
                            extra=dict(extra),
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
                            confidence=confidence,
                            extra=dict(extra),
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
                            confidence=confidence,
                            extra=dict(extra),
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
                            confidence=min(0.8, confidence),
                            extra=dict(extra),
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
        # THE ANATOMY THIS MODULE COULD NOT NAME, listed rather than
        # dropped. Empty on a report whose every muscle is in the map,
        # which is what makes a non-empty list mean something. See
        # `_MUSCLE_TERM`.
        "unread_muscle_terms": unread_terms,
    }


#: A PULMONARY METRIC'S NAME, ANCHORED SO IT IS NOT READ INSIDE THE
#: RATIO'S NAME.
#:
#: `\b` FIRES ON BOTH SIDES OF THE SOLIDUS IN 「FEV1/FVC」, so on the
#: ordinary Chinese layout — 项目 / 单位 / 实测值 / 占预计值 on one line,
#: one row per metric — the ratio row answered for THREE fields. Both
#: 占预计值 patterns reached it: `FVC` matched the second half of the
#: ratio's name and `FEV1` the first, and each then took the first
#: percentage on THAT row. Measured on a synthetic 肺通气功能检查报告
#: whose FVC row reads 70.6% of predicted and whose FEV1 row reads
#: 64.1%, both were published as 75.4% — the FEV1/FVC ratio — and 75.4%
#: of predicted FVC is a different clinical picture from 70.6%, on the
#: surveillance this disease is monitored by.
#:
#: The lookarounds refuse the solidus specifically, which is the
#: character `\b` cannot see across. `DLCO` gets the same treatment for
#: the same reason: 「DLCO/VA」 is a row of every diffusion report.
_PFT_FVC = r"(?<![A-Za-z0-9/])FVC(?![A-Za-z0-9/])"
_PFT_FEV1 = r"(?<![A-Za-z0-9/])FEV ?1(?![A-Za-z0-9/])"
_PFT_TLC = r"(?<![A-Za-z0-9/])TLC(?![A-Za-z0-9])"
_PFT_DLCO = r"(?<![A-Za-z0-9/])DLCO(?![A-Za-z0-9/])"

#: Between a metric's name and its first figure: the Chinese name and
#: the unit column, never another number.
_PFT_NAME_TO_VALUE = r"[^\d\n(]{0,16}"


def _pft_pred_pct_patterns(name: str) -> List[str]:
    """占预计值 for one metric, read off that metric's OWN row.

    THE PERCENTAGE IS NOT THE FIRST NUMBER ON THE ROW. On the layout
    where 实测值 precedes 占预计值 the first number is the reading in
    litres, and the old pattern could not see past it — it forbade
    digits between the name and its capture — so it matched nothing on
    the metric's own row and went looking further down the page, where
    the only row it could match was the ratio's. Two failures compounded:
    what it found was the wrong row (see `_PFT_FVC`) and what it wanted
    was the wrong column.

    So the row is scanned for the figure that carries the PERCENT SIGN,
    which is what the 占预计值 column prints and what the litre column
    does not. The labelled spelling is tried first, because a report
    that names the column outright is not guessing.
    """
    return [
        rf"{name}\s*(?:[% ]*Pred|占预计值[%％]?|预计值[%％]?|预计%)"
        rf"[^\d\n]{{0,10}}({_NUMBER_SOURCE})\s*([%％])?",
        rf"{name}[^\n]{{0,40}}?({_NUMBER_SOURCE})\s*([%％])",
    ]


#: One printed figure on a pulmonary row, with the percent sign it
#: carries if it carries one. The sign is a SHAPE, and it is the first
#: of the three ways this reader tells the columns apart.
_PFT_FIGURE = re.compile(rf"({_NUMBER_SOURCE})\s*([%％])?")

#: Every metric name this reader knows, for cutting a row off where the
#: NEXT metric begins — the same statement `_ends_the_row` makes for a
#: laboratory table. Without it 「肺功能 FVC 62%,FEV1 下降」 handed the
#: FVC reader the 1 of 「FEV1」 as a second figure of its own row.
_PFT_METRIC_NAMES: Tuple[str, ...] = (
    _PFT_FVC,
    _PFT_FEV1,
    _PFT_TLC,
    _PFT_DLCO,
    r"FEV ?1\s*/\s*FVC",
    r"DLCO\s*/\s*VA",
)


def _pft_row_figures(line: str, name_source: str) -> Optional[List[Tuple[str, bool]]]:
    """The figures printed on `line` after this metric's name.

    `None` where the metric is not named on the line at all — which is
    what lets the caller tell 「this row says nothing I can read」 from
    「this metric has no row here」. Bracketed runs are dropped first
    because that is where the unit is printed, 「[mmol/min/kPa]」, and a
    unit is not a figure.
    """
    match, _ = _find_regex(line, [name_source])
    if not match:
        return None
    tail = line[match.end() :]
    cuts = [
        found.start()
        for pattern in _PFT_METRIC_NAMES
        for found in [re.search(_cjk_safe(pattern), tail, re.IGNORECASE)]
        if found
    ]
    if cuts:
        tail = tail[: min(cuts)]
    tail = re.sub(r"[\[(（][^\])）]*[\])）]", " ", tail)
    return [
        (figure.group(1), bool(figure.group(2)))
        for figure in _PFT_FIGURE.finditer(tail)
    ]


def _pft_measured_index(values: List[float]) -> Optional[int]:
    """Which figure is 实测值, from the identity the three of them obey.

    实测值 = 预计值 × 占预计值 ÷ 100. THAT IS AN EQUATION THE ROW ITSELF
    ANSWERS, and it is the reason a three-figure pulmonary row does not
    need anyone to assume a column order: exactly one of the three
    figures is the product of the other two over a hundred, and it is
    the patient's measurement whichever position the printer put it in.
    So 「FVC 5.55 3.45 62.1」 and 「FVC 2.31 3.72 62.1」 — 预计值 first on
    one report, 实测值 first on the other — are both read correctly, and
    the reader that took 「the second group, always」 published a
    predicted FVC as the patient's own on the second.

    Which is not a small thing to get wrong. Pulmonary function is the
    surveillance FSHD is monitored by, and a predicted value is by
    construction a normal-looking number: it is what this patient's
    lungs would do if they were well.

    The tolerance is absolute-or-relative because a laboratory prints
    the percentage rounded. `None` where more than one figure satisfies
    the identity, or none does — the row is then read by the header, or
    not at all.
    """
    # A cubic search, bounded by the fact that a pulmonary row prints
    # three or four columns. A line carrying more figures than that is
    # not a metric row and is refused rather than searched.
    if len(values) > 6:
        return None
    hits = set()
    span = range(len(values))
    for index in span:
        for other in span:
            for third in span:
                if len({index, other, third}) < 3:
                    continue
                product = values[other] * values[third] / 100.0
                if abs(product - values[index]) <= max(0.05, abs(values[index]) * 0.015):
                    hits.add(index)
    return hits.pop() if len(hits) == 1 else None


def _pft_percent_index(values: List[float], measured: int) -> Optional[int]:
    """Which of the two remaining figures is 占预计值 rather than 预计值.

    THE IDENTITY CANNOT ANSWER THIS ONE and it is honest to say so:
    m = p × c ÷ 100 holds just as well with p and c exchanged, so the
    arithmetic that pins 实测值 leaves these two tied. What separates
    them is that 预计值 IS THE SAME MEASURAND AS 实测值 — the same
    litres, the same mmol/min/kPa — and a percentage is not. A predicted
    FVC beside a measured 3.45 L is 5.55 L; the 62.1 beside them is not
    a volume any lung has.

    So the percentage is the figure whose magnitude is FAR from the
    reading where the predicted value's is NEAR, and it is required to
    be at least twice as far before either is named. Where the two are
    comparably close the row is not readable this way and nothing is
    published — 占预计值 is a number a clinician acts on, and the wrong
    one is worse than none.
    """
    others = [index for index in range(len(values)) if index != measured]
    if len(others) != 2:
        return None
    reading = abs(values[measured])
    if reading == 0:
        return None

    def distance(index: int) -> float:
        figure = abs(values[index])
        if figure == 0:
            return float("inf")
        return max(figure, reading) / min(figure, reading)

    far, near = sorted(others, key=distance, reverse=True)
    if distance(far) < 2 * distance(near):
        return None
    return far


def _read_pft_row(
    lines: List[str],
    name_source: str,
    columns: _TableColumns,
    *,
    percent_is_the_reading: bool = False,
) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """This metric's row, as `(measurement, 占预计值, the row itself)`.

    THREE WAYS TO TELL THE COLUMNS APART AND NOT ONE ASSUMPTION AMONG
    THEM: the percent sign a figure carries (shape), the identity the
    three figures obey (`_pft_measured_index`), and the header the page
    printed (`_TableColumns`). Where none of them answers, the
    measurement comes back `None` and the caller publishes nothing for
    it — the row was found, so falling back to 「the first number after
    the name」 would be reinstating the assumption this function exists
    to remove.

    `percent_is_the_reading` is FEV1/FVC and nothing else: the ratio's
    own unit is a percent, so a percent sign on its row marks the
    reading rather than a proportion of predicted.
    """
    #: A row printing two or more figures, or one figure carrying a
    #: percent sign, is a TABLE row for this metric. A row printing a
    #: single bare figure may be one — 「FVC 3.45 L」 — or may be a title
    #: or a requisition that happens to name the metric beside a date,
    #: so it is held back and used only if no table row is found.
    strong: Optional[Tuple[Optional[str], Optional[str], str]] = None
    weak: Optional[Tuple[Optional[str], Optional[str], str]] = None
    fallback: Optional[str] = None
    for line in lines:
        figures = _pft_row_figures(line, name_source)
        if not figures:
            continue
        if fallback is None:
            fallback = line.strip()
        values = [_safe_float(raw) for raw, _ in figures]
        if any(value is None for value in values):
            continue
        typed: List[float] = [value for value in values if value is not None]
        marked = [index for index, (_, percent) in enumerate(figures) if percent]
        plain = [index for index in range(len(figures)) if index not in marked]

        measured_index: Optional[int] = None
        percent_index: Optional[int] = None

        if percent_is_the_reading:
            if len(figures) == 1:
                measured_index = 0
        else:
            if len(marked) == 1:
                percent_index = marked[0]
                if len(plain) == 1:
                    measured_index = plain[0]
            elif len(figures) == 1:
                measured_index = 0

        if measured_index is None and len(figures) >= 3:
            measured_index = _pft_measured_index(typed)
            if measured_index is not None and percent_index is None and not percent_is_the_reading:
                percent_index = _pft_percent_index(typed, measured_index)

        if measured_index is None:
            roles = columns.value_roles()
            if len(roles) == len(figures) and len(set(roles)) == len(roles):
                if "result" in roles:
                    measured_index = roles.index("result")
                if percent_index is None and "pred_pct" in roles:
                    percent_index = roles.index("pred_pct")

        measured = figures[measured_index][0] if measured_index is not None else None
        percent = (
            figures[percent_index][0]
            if percent_index is not None and percent_index != measured_index
            else None
        )
        # THE FIRST ROW THAT CAN BE READ, NOT THE FIRST ROW THAT CARRIES
        # A DIGIT. A metric named on a title or a requisition line —
        # 「肺功能检查报告 FVC 2024」 — carries a figure and determines
        # nothing, and stopping there leaves the table below it unread.
        if len(figures) >= 2 or figures[0][1]:
            if measured is not None or percent is not None:
                return measured, percent, line.strip()
            if strong is None:
                strong = (None, None, line.strip())
        elif weak is None and measured is not None:
            weak = (measured, percent, line.strip())
    if strong is not None:
        return strong
    if weak is not None:
        return weak
    return None, None, fallback


def _extract_pulmonary(lines: List[str], fields: List[Dict[str, Any]], findings: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    """Pulmonary function, read off the ROW rather than off a column index.

    THE TABLE PATTERNS TOOK GROUP 2, ALWAYS. They were written
    「name, then three figures」 and hard-coded the second as the
    measurement and the third as 占预计值, which is one printed order —
    预计值 / 实测值 / 占预计值 — asserted as if it were the only one. On
    the equally ordinary 实测值 / 预计值 / 占预计值 the second figure is
    the PREDICTED value, so this platform published, as a patient's own
    FVC, the number describing the lungs that patient does not have.

    A predicted value is by construction a normal-looking one, and
    pulmonary function is the surveillance FSHD is monitored by: the
    reading that decides whether a patient is referred for ventilation
    was being replaced by a reading that never triggers a referral.

    `_read_pft_row` determines the columns instead — percent sign,
    then the identity 实测值 = 预计值 × 占预计值 ÷ 100, then the page's
    own header — and where none of the three answers it publishes
    nothing. The name patterns stay as the fallback for the shapes a row
    has none of: a metric quoted in a sentence, a value the OCR
    recovered as prose. They are NOT tried for a metric whose row was
    found and refused, because 「the first number after the name」 is the
    assumption being removed.
    """
    text = "\n".join(lines)
    columns = _page_columns(lines)
    panel: Dict[str, Any] = {}

    #: Each metric: its anchored name, the 占预计值 field it feeds, and
    #: whether a percent sign on its row marks its OWN reading — true of
    #: FEV1/FVC alone, whose unit is a percent.
    metrics: Tuple[Tuple[str, str, Optional[str], bool], ...] = (
        ("fvc", _PFT_FVC, "fvc_pred_pct", False),
        ("fev1", _PFT_FEV1, "fev1_pred_pct", False),
        ("tlc", _PFT_TLC, "tlc_pred_pct", False),
        ("dlco", _PFT_DLCO, "dlco_pred_pct", False),
        ("fev1_fvc", r"FEV ?1\s*/\s*FVC", None, True),
        ("dlco_va", r"DLCO\s*/\s*VA", None, False),
    )

    #: field -> (printed value, unit, the row it was read off, confidence)
    resolved: Dict[str, Tuple[str, Optional[str], str, float]] = {}
    #: Metrics whose row was found and could not be read. The fallback
    #: patterns are not tried for these: the row is there, and a pattern
    #: reading it would be reading it by position.
    refused: set = set()

    for field_name, name_source, pct_field, percent_reading in metrics:
        measured, percent, row_text = _read_pft_row(
            lines, name_source, columns, percent_is_the_reading=percent_reading
        )
        if row_text is None:
            continue
        if measured is not None:
            resolved[field_name] = (
                measured,
                "%" if percent_reading else None,
                row_text,
                0.96,
            )
        else:
            refused.add(field_name)
        if pct_field and percent is not None:
            resolved[pct_field] = (percent, "%", row_text, 0.95)

    metric_patterns = {
        "fvc": [rf"{_PFT_FVC}{_PFT_NAME_TO_VALUE}({_NUMBER_SOURCE})\s*(L|%)?"],
        "fvc_pred_pct": _pft_pred_pct_patterns(_PFT_FVC),
        "fev1": [rf"{_PFT_FEV1}{_PFT_NAME_TO_VALUE}({_NUMBER_SOURCE})\s*(L|%)?"],
        "fev1_pred_pct": _pft_pred_pct_patterns(_PFT_FEV1),
        "fev1_fvc": [rf"FEV ?1\s*/\s*FVC[^\d\n(]{{0,12}}({_NUMBER_SOURCE})\s*(%)"],
        "tlc": [rf"{_PFT_TLC}{_PFT_NAME_TO_VALUE}({_NUMBER_SOURCE})\s*(L|%)?"],
        "tlc_pred_pct": _pft_pred_pct_patterns(_PFT_TLC),
        "dlco": [rf"{_PFT_DLCO}{_PFT_NAME_TO_VALUE}({_NUMBER_SOURCE})\s*([A-Za-z/%·]+)?"],
        "dlco_pred_pct": _pft_pred_pct_patterns(_PFT_DLCO),
        "dlco_va": [rf"DLCO\s*/\s*VA[^\d\n(]{{0,12}}({_NUMBER_SOURCE})\s*([A-Za-z/%·]+)?"],
    }

    for field_name, patterns in metric_patterns.items():
        if field_name in resolved or field_name in refused:
            continue
        raw_value, _, unit = _extract_named_number(text, patterns)
        if raw_value is None:
            continue
        source_text = (
            _find_best_line(
                lines, [field_name.upper(), field_name.lower().replace("_", "/")]
            )
            or raw_value
        )
        resolved[field_name] = (raw_value, unit, source_text, 0.94)

    for field_name in metric_patterns:
        if field_name not in resolved:
            continue
        raw_value, unit, source_text, confidence = resolved[field_name]
        normalized_value = _safe_float(raw_value)
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


#: The gap between an analyte's printed name and its reading, and the
#: reading itself. Neither may cross a newline or open a bracket — see
#: `_panel_haystacks` for what each of those cost.
_PANEL_NAME_TO_VALUE = r"[^\d\n(]{0,16}"
#: THE READING A PANEL PATTERN CAPTURES, grouped spelling included —
#: the fallback path may not read 「3,250」 as a 3 where the row reader
#: no longer does. See `_NUMBER_SOURCE`.
#:
#: THE COMPARATOR COMES FROM `_COMPARATOR`, which is the same
#: one-source rule `_RANGE_SEPARATOR` states for the dashes. This class
#: was the two ASCII spellings while every other comparator reader in
#: the file had all ten, so a below-detection reading printed 「＜0.01」
#: or 「≤0.01」 would fall out of this capture as a bare 0.01 — a limit
#: the laboratory refused to state, shipped as a determinate
#: measurement. The row reader answers first on every layout measured,
#: so this is the fallback closing behind it rather than a live
#: reading; it is spelled from the shared class so that it stays shut.
_PANEL_READING = rf"({_COMPARATOR}?{_NUMBER_SOURCE})"


def _numeric_analyte(
    *names: str,
    unit: Optional[str] = None,
    confidence: Optional[float] = None,
    patterns: Iterable[str] = (),
) -> Dict[str, Any]:
    """One numeric analyte, from every spelling of its printed name.

    ONE LIST OF NAMES, NOT TWO. A panel definition carried a `patterns`
    list and a `keywords` list, written by hand and drifting apart — and
    the drift is not cosmetic, because `keywords` is what the shared ROW
    reader is given. 中性粒细胞数 was matched by the pattern 「NEUT#」 and
    handed to the row reader as 「NEUT」, which is the abbreviation the
    PERCENTAGE row prints; so the row reader answered with the ratio
    row, the two readers disagreed, and all five absolute differential
    counts on every 血常规 shipped with no flag, no unit and no
    interval. Deriving both from one list is what stops that happening
    again for an analyte added later.

    AND EVERY LATIN SPELLING IS ANCHORED. `_anchored_keyword_source` is
    the same boundary the row reader has used since the 「肌酸激酶(CK)
    published as a potassium of 890」 round; the panel patterns embedded
    their abbreviations bare, so 「PT」 and 「TT」 matched inside
    「APTT」 — one coagulation row published as three analytes, two of
    them times this patient never had measured.

    `patterns` takes the handful of shapes a name list cannot state: a
    spelling anchored to the start of a line, or one with an optional
    infix.
    """
    alternation = "|".join(_anchored_keyword_source(name) for name in names)
    meta: Dict[str, Any] = {
        "patterns": [
            f"(?:{alternation}){_PANEL_NAME_TO_VALUE}{_PANEL_READING}",
            *patterns,
        ],
        "keywords": list(names),
    }
    if unit is not None:
        meta["unit"] = unit
    if confidence is not None:
        meta["confidence"] = confidence
    return meta


def _extract_blood_routine(lines: List[str], fields: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    panel: Dict[str, Any] = normalized_summary.get("lab_panel", {})
    definitions = {
        "wbc": _numeric_analyte("白细胞计数", "WBC"),
        # THE PERCENTAGE ROW AND THE ABSOLUTE-COUNT ROW SHARE AN
        # ABBREVIATION AND DIFFER BY ONE CHARACTER OF IT. 「NEUT%」 and
        # 「NEUT#」 are two rows of every 血常规; a bare 「NEUT」 names
        # whichever the printer put first, which is the ratio.
        "neut_pct": _numeric_analyte(
            "中性粒细胞比率", "中性粒细胞百分比", "NEUT%", "%NEUT", unit="%"
        ),
        "neut_abs": _numeric_analyte(
            "中性粒细胞数", "中性粒细胞绝对值", "中性粒细胞计数", "NEUT#", "#NEUT"
        ),
        "lymph_pct": _numeric_analyte(
            "淋巴细胞比率", "淋巴细胞百分比", "LYMPH%", "%LYMPH", unit="%"
        ),
        "lymph_abs": _numeric_analyte(
            "淋巴细胞数", "淋巴细胞绝对值", "淋巴细胞计数", "LYMPH#", "#LYMPH"
        ),
        "mono_pct": _numeric_analyte(
            "单核细胞比率", "单核细胞百分比", "MONO%", "%MONO", unit="%"
        ),
        "mono_abs": _numeric_analyte(
            "单核细胞数", "单核细胞绝对值", "单核细胞计数", "MONO#", "#MONO"
        ),
        "eos_pct": _numeric_analyte(
            "嗜酸细胞百分比", "嗜酸性粒细胞百分比", "嗜酸细胞比率", "EOS%", "%EOS", unit="%"
        ),
        "eos_abs": _numeric_analyte(
            "嗜酸细胞数", "嗜酸性粒细胞绝对值", "嗜酸细胞绝对值", "EOS#", "#EOS"
        ),
        "baso_pct": _numeric_analyte(
            "嗜碱细胞百分比", "嗜碱性粒细胞百分比", "嗜碱细胞比率", "BASO%", "%BASO", unit="%"
        ),
        "baso_abs": _numeric_analyte(
            "嗜碱细胞数", "嗜碱性粒细胞绝对值", "嗜碱细胞绝对值", "BASO#", "#BASO"
        ),
        "rbc": _numeric_analyte("红细胞计数", "RBC"),
        "hgb": _numeric_analyte("血红蛋白量", "血红蛋白", "HGB"),
        "hct": _numeric_analyte("红细胞比积", "红细胞压积", "HCT"),
        "mcv": _numeric_analyte("平均红细胞体积", "MCV"),
        "mch": _numeric_analyte("平均血红蛋白含量", "MCH"),
        "mchc": _numeric_analyte("平均血红蛋白浓度", "MCHC"),
        "rdw_sd": _numeric_analyte("红细胞分布宽度标准差", "RDW-SD"),
        "rdw_cv": _numeric_analyte("红细胞分布宽度变异系数", "RDW-CV", "RDW"),
        "plt": _numeric_analyte("血小板计数", "PLT"),
        "mpv": _numeric_analyte("血小板平均体积", "MPV"),
        "pct": _numeric_analyte("血小板比积", "PCT"),
        "pdw": _numeric_analyte("血小板分布宽度", "PDW"),
        "plcr": _numeric_analyte("大型血小板比率", "P-LCR", "PLCR"),
        "nrbc": _numeric_analyte("有核红细胞", "NRBC"),
    }
    _extract_numeric_panel(text, lines, fields, panel, definitions)
    normalized_summary["lab_panel"] = panel


def _extract_thyroid_function(lines: List[str], fields: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    panel: Dict[str, Any] = normalized_summary.get("lab_panel", {})
    definitions = {
        "ft3": _numeric_analyte("游离T3", "FT3"),
        "ft4": _numeric_analyte("游离T4", "FT4"),
        "tsh": _numeric_analyte(
            "超敏促甲状腺素", "促甲状腺激素", "促甲状腺素", "TSH", "TSH3", "sTSH"
        ),
    }
    _extract_numeric_panel(text, lines, fields, panel, definitions)
    normalized_summary["lab_panel"] = panel


def _extract_coagulation(lines: List[str], fields: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    panel: Dict[str, Any] = normalized_summary.get("lab_panel", {})
    # 「PT」 AND 「TT」 ARE BOTH PRINTED INSIDE 「APTT」. Every name below
    # reaches `re` through `_anchored_keyword_source`, so an abbreviation
    # is read as a whole token or not at all — which is what stops one
    # activated-partial-thromboplastin row from being published as this
    # patient's prothrombin time and thrombin time as well, neither of
    # which the laboratory measured.
    definitions = {
        "pt": _numeric_analyte("凝血酶原时间", "PT"),
        "inr": _numeric_analyte("国际标准化比值", "PT-INR", "INR"),
        "aptt": _numeric_analyte("活化部分凝血活酶时间", "部分凝血活酶时间", "APTT"),
        "fibrinogen": _numeric_analyte("纤维蛋白原", "FIB", "Fg"),
        "tt": _numeric_analyte("凝血酶时间", "TT"),
        "d_dimer": _numeric_analyte(
            "D-二聚体定量", "D二聚体定量", "D-二聚体", "D二聚体", "D-Dimer", "DD二聚体"
        ),
    }
    _extract_numeric_panel(text, lines, fields, panel, definitions)
    normalized_summary["lab_panel"] = panel


#: THE ANALYTE'S OWN ABBREVIATION, PRINTED IN ITS NAME CELL — 「颜色(COL)」,
#: 「透明度(CLA)」. IT IS NOT THE PATIENT'S RESULT.
#:
#: A free-text row captures 「the first run of non-space after the name」,
#: and the separator gap admitted brackets while refusing Latin. So on
#: the commonest 尿常规 printing of all, the gap took the opening bracket
#: and the capture took what was inside it: 尿色 was published as
#: 「COL)」 and 透明度 as 「CLA)」 — the report's own 淡黄色 and 清亮 not
#: merely unread but REPLACED, on the panel's two rows a patient can
#: check by eye. The stool panel prints 颜色 the same way.
#:
#: Hopped over explicitly rather than excluded from the gap alone,
#: because a name cell may or may not carry it and the row after it is
#: the same either way.
#:
#: IT HAS TO BEGIN WITH A LETTER. 「(-)」 and 「(+)」 are brackets in the
#: RESULT column — 「尿胆原 (-)」 is a whole reading — and a hop that
#: swallowed those would step over the answer and capture the next row.
_OWN_ABBREVIATION = r"(?:\s*[(（][A-Za-z][A-Za-z0-9\-]{0,9}[)）])?"

#: What may sit between a name cell and its reading: punctuation and
#: spaces, and NEVER a bracket — see `_OWN_ABBREVIATION`.
_TEXT_VALUE_GAP = r"[^\n\u4e00-\u9fa5A-Za-z(（]{0,8}"

#: A free-text reading: one printed cell. It may CONTAIN a bracket —
#: 「阴性(-)」 is one cell — it just may not be reached through one.
_TEXT_VALUE = r"([^\s]+)"

#: WHAT MAY SIT BETWEEN A DIPSTICK ROW'S NAME AND ITS 阴性/阳性 — AND
#: WHY A DIGIT MAY NOT.
#:
#: This gap was `[^\n\u4e00-\u9fa5A-Za-z]{0,8}`: eight characters of
#: anything that is not CJK, Latin or a newline. Eight characters is a
#: whole COLUMN of a 尿常规 table, and the pattern reaches through them
#: into the next one — so on a page whose only white-cell row is the
#: sediment count,
#:
#:     白细胞 5 0-5 阴性 /HP
#:
#: the 阴性 the pattern found is that row's REFERENCE COLUMN, and it was
#: published as `urine_leukocyte`: a leukocyte-esterase dipstick that
#: this page shows was never run, reported to the patient as negative.
#: `_read_qualitative_row` gets this right already — it is given only
#: 白细胞酯酶 and LEU, finds no such row, and answers nothing — and the
#: bare 白细胞 stays in the PATTERN deliberately, so that a dipstick
#: block printing 「白细胞 阴性」 with no abbreviation is still read. What
#: was missing is the difference between the two: a dipstick verdict
#: sits in the cell NEXT TO its name, and a number standing between the
#: two proves at least one column intervenes.
#:
#: THE SAME GAP IS ON EVERY QUALITATIVE ROW OF THIS PANEL and the defect
#: is not 白细胞's. 「蛋白质 1+ 阴性」 reached over a 1+ proteinuria to
#: publish the reference column's 阴性 the same way — the row reader
#: catches that one, because 「1+」 is a verdict cell it can see, but the
#: pattern should not have been offering the wrong answer for it to
#: overrule.
_DIPSTICK_VERDICT_GAP = r"[^\n\u4e00-\u9fa5A-Za-z\d]{0,8}"


def _extract_urinalysis(lines: List[str], fields: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    panel: Dict[str, Any] = normalized_summary.get("lab_panel", {})
    text_definitions = {
        "urine_color": {"patterns": [rf"(?:颜色|尿色){_OWN_ABBREVIATION}{_TEXT_VALUE_GAP}{_TEXT_VALUE}"], "keywords": ["颜色", "尿色"]},
        "urine_clarity": {"patterns": [rf"(?:透明度|浊度|清晰度){_OWN_ABBREVIATION}{_TEXT_VALUE_GAP}{_TEXT_VALUE}"], "keywords": ["透明度", "浊度", "清晰度"]},
        # 尿糖 AND 尿蛋白 ARE THE ORDINARY CHINESE NAMES OF THESE TWO ROWS
        # AND NEITHER WAS READ. The readers matched 葡萄糖|GLU and
        # 蛋白质|PRO — what a laboratory prints when it prints the Latin
        # abbreviation beside the name. A 尿常规 that prints 「尿糖 阴性」
        # and 「尿蛋白 阳性(+)」, with no Latin anywhere on either row,
        # yielded NEITHER field, silently, on two of the rows a 尿常规 is
        # ordered for. The other 尿-prefixed spellings need nothing here:
        # 尿潜血, 尿胆红素, 尿酮体 and 尿亚硝酸盐 each CONTAIN the name
        # already listed, and these two do not.
        "urine_glucose": {"patterns": [rf"(?:葡萄糖(?:\(GLU\))?|尿糖(?:\(GLU\))?|GLU){_DIPSTICK_VERDICT_GAP}(阴性|\(-\)|阳性|\(\+\)|弱阳性)"], "keywords": ["葡萄糖", "尿糖", "GLU"], "normalize_qualitative": True},
        "urine_ketone": {"patterns": [rf"(?:酮体(?:\(KET\))?|KET){_DIPSTICK_VERDICT_GAP}(阴性|\(-\)|阳性|\(\+\)|弱阳性)"], "keywords": ["酮体", "KET"], "normalize_qualitative": True},
        "urine_bilirubin": {"patterns": [rf"(?:胆红素(?:\(BIL\))?|BIL){_DIPSTICK_VERDICT_GAP}(阴性|\(-\)|阳性|\(\+\)|弱阳性)"], "keywords": ["胆红素", "BIL"], "normalize_qualitative": True},
        "urine_protein": {"patterns": [rf"(?:蛋白质(?:\(PRO\))?|尿蛋白(?:\(PRO\))?|PRO){_DIPSTICK_VERDICT_GAP}(阴性|\(-\)|阳性|\(\+\)|弱阳性)"], "keywords": ["蛋白质", "尿蛋白", "PRO"], "normalize_qualitative": True},
        "urine_nitrite": {"patterns": [rf"(?:亚硝酸盐(?:\(NIT\))?|NIT){_DIPSTICK_VERDICT_GAP}(阴性|\(-\)|阳性|\(\+\)|弱阳性)"], "keywords": ["亚硝酸盐", "NIT"], "normalize_qualitative": True},
        "urine_occult_blood": {"patterns": [rf"(?:潜血(?:\(OB\)|\(BLD\))?|OB|BLD){_DIPSTICK_VERDICT_GAP}(阴性|\(-\)|阳性|\(\+\)|弱阳性)"], "keywords": ["潜血", "OB"], "normalize_qualitative": True},
        # THE BARE 白细胞 IS THE SEDIMENT ROW'S NAME, NOT THIS ONE'S.
        #
        # A 尿常规 prints TWO white-cell rows and they are DIFFERENT
        # TESTS: the dipstick's leukocyte esterase — 白细胞酯酶, or
        # 白细胞(LEU) — and the sediment's count, 白细胞计数 or a bare
        # 白细胞 carrying a 个/uL or /HP unit. This field's keyword list
        # carried the bare 白细胞, and `keywords` is what the shared ROW
        # reader is given, so the esterase field claimed the count row
        # and published whatever cell it found there:
        #
        #     白细胞 +++ /HP          →  urine_leukocyte: 「+++」
        #     白细胞酯酶(LEU) 阴性     →  never reached
        #
        # — a 3+ leukocyte esterase invented out of a microscopy field,
        # published over the top of the dipstick row that says 阴性. On
        # a sediment-only page, where no dipstick was run at all, the
        # same 「+++」 was published as a test that was never performed,
        # and 「白细胞 少量 /HP」 published 少量 the same way. It also took
        # the field's EVIDENCE: `_panel_source_line` searches on these
        # keywords, so even a correctly read esterase shipped with the
        # count row as its `source_text`.
        #
        # THE PATTERN KEEPS THE BARE SPELLING AND THE ROW READER DOES
        # NOT. The pattern requires a printed 阴性/阳性 within a few
        # non-CJK characters of the name, which a count row does not
        # have — so 「白细胞 阴性」 on a dipstick block that prints no
        # abbreviation is still read, while the row reader, which
        # accepts whatever cell the row happens to carry, can no longer
        # reach a count. The count is `urine_wbc`'s, which declares both
        # spellings; 白细胞酯酶 stays on this list so that
        # `_extract_numeric_panel`'s `neighbours` keeps 白细胞 off the
        # esterase row in the other direction, which is the collision
        # the note below this dict describes.
        "urine_leukocyte": {"patterns": [rf"(?:白细胞酯酶|白细胞(?:\(LEU\))?|LEU){_DIPSTICK_VERDICT_GAP}(阴性|\(-\)|阳性|\(\+\)|弱阳性)"], "keywords": ["白细胞酯酶", "LEU"], "normalize_qualitative": True},
        "urine_urobilinogen": {"patterns": [rf"(?:尿胆原|URO){_OWN_ABBREVIATION}{_TEXT_VALUE_GAP}{_TEXT_VALUE}"], "keywords": ["尿胆原", "URO"]},
    }
    numeric_definitions = {
        "urine_specific_gravity": _numeric_analyte("尿比重", "比重", "SG"),
        "urine_ph": _numeric_analyte("pH值", "pH", "酸碱度"),
        "urine_rbc": _numeric_analyte("红细胞计数", "红细胞", "RBC"),
        "urine_wbc": _numeric_analyte("白细胞计数", "白细胞", "WBC"),
        "urine_bacteria": _numeric_analyte("细菌计数", "细菌", "BACT"),
        "urine_epithelial_cells": _numeric_analyte("上皮细胞", "EC"),
        "urine_mucus": _numeric_analyte("粘液丝", "黏液丝", "MUCS"),
    }
    _extract_text_panel(text, lines, fields, panel, text_definitions)
    # THE QUALITATIVE ROWS ARE THIS PANEL'S NEIGHBOURS, NOT ANOTHER
    # PANEL'S. 白细胞酯酶 is a 尿常规 row like any other, and it is
    # declared in the dict above rather than this one — so the numeric
    # 白细胞 had no way to know that 白细胞酯酶's row is not its own.
    _extract_numeric_panel(
        text, lines, fields, panel, numeric_definitions, neighbours=text_definitions
    )
    normalized_summary["lab_panel"] = panel


#: A LINE THAT OPENS A PANEL'S SECTION on a page carrying more than one.
#: The panel's own name, printed as a heading — 「血常规」 over the counts,
#: 「尿常规」 over the sediment. Deliberately not the analyte vocabulary:
#: 尿素 and 白细胞 say nothing about which section they are in.
_BLOOD_ROUTINE_SECTION_MARKERS: Tuple[str, ...] = (
    "血常规", "血细胞分析", "全血细胞分析", "血液分析", "血细胞计数",
)
_URINALYSIS_SECTION_MARKERS: Tuple[str, ...] = (
    "尿常规", "尿液分析", "尿沉渣", "小便常规", "尿液检查",
)


def _split_blood_and_urine_sections(
    lines: List[str],
) -> Optional[Tuple[List[str], List[str]]]:
    """This page's 血常规 lines and its 尿常规 lines, or None.

    AN 入院常规 PRINTOUT IS TWO PANELS ON ONE PAGE and the parser had
    room for one. The page scores `blood_routine` — it prints
    haemoglobin and platelets, so the specimen rule that saves a pure
    urine report cannot fire — and from there two things followed. The
    urinalysis extractor never ran, so 尿蛋白, 尿糖, the colour, the
    clarity and the sediment counts were absent from a payload that
    named none of them missing. AND THE BLOOD EXTRACTOR READ DOWNWARDS:
    every row reader in this file scans the whole document for the first
    line naming its analyte, so a blood analyte the 血常规 section did
    not print was looked for in the 尿常规 section and found there.
    Measured on a synthetic page whose blood section prints no
    红细胞计数 row, `rbc` came back as the urine sediment's 8 个/uL —
    published under the key the app's 血常规 card reads, where 8 is a
    red cell count no living patient has.

    THE SECTION HEADING IS THE BOUNDARY, and there is no answer without
    one: two panels whose rows are interleaved, or a requisition line
    naming both with no headings under it, cannot be separated by
    anything this function can see. It returns None there and the
    caller keeps the single-extractor behaviour it always had — a
    wrong split would move a reading from one panel to the other, which
    is worse than the reading being missing.

    The preamble — everything above the first heading — belongs to both:
    it is the hospital, the patient and the column header row.
    """
    def names(line: str, markers: Tuple[str, ...]) -> bool:
        return any(marker in line for marker in markers)

    preamble: List[str] = []
    blood: List[str] = []
    urine: List[str] = []
    current: Optional[List[str]] = None
    for line in lines:
        is_blood = names(line, _BLOOD_ROUTINE_SECTION_MARKERS)
        is_urine = names(line, _URINALYSIS_SECTION_MARKERS)
        # 「检验目的: 血常规+尿常规」 names both and opens neither.
        if is_blood and not is_urine:
            current = blood
        elif is_urine and not is_blood:
            current = urine
        (current if current is not None else preamble).append(line)

    if not blood or not urine:
        return None
    # A heading with nothing under it is a mention, not a section.
    if len(blood) < 2 or len(urine) < 2:
        return None
    return preamble + blood, preamble + urine


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
        "trust_titer": _numeric_analyte("TRUST滴度", "TRUST效价"),
    }
    _extract_numeric_panel(
        text, lines, fields, panel, numeric_definitions, neighbours=text_definitions
    )
    normalized_summary["lab_panel"] = panel


def _extract_stool_test(lines: List[str], fields: List[Dict[str, Any]], normalized_summary: Dict[str, Any]) -> None:
    text = "\n".join(lines)
    panel: Dict[str, Any] = normalized_summary.get("lab_panel", {})
    text_definitions = {
        "stool_color": {"patterns": [rf"(?:颜色){_OWN_ABBREVIATION}{_TEXT_VALUE_GAP}{_TEXT_VALUE}"], "keywords": ["颜色"]},
        "stool_consistency": {"patterns": [rf"(?:硬度|性状){_OWN_ABBREVIATION}{_TEXT_VALUE_GAP}{_TEXT_VALUE}"], "keywords": ["硬度", "性状"]},
        "stool_blood": {"patterns": [r"(?:血液)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["血液"], "normalize_qualitative": True},
        "stool_mucus": {"patterns": [r"(?:粘液)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["粘液"], "normalize_qualitative": True},
        "stool_rbc": {"patterns": [r"(?:红细胞)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["红细胞"], "normalize_qualitative": True},
        "stool_wbc": {"patterns": [r"(?:白细胞)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["白细胞"], "normalize_qualitative": True},
        "stool_fat_globules": {"patterns": [r"(?:脂肪球)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["脂肪球"], "normalize_qualitative": True},
        "stool_occult_blood": {"patterns": [r"(?:隐血试验(?:\(OBT\))?|OBT)[^\n\u4e00-\u9fa5A-Za-z]{0,8}(阴性(?:\([-+]\))?|阳性(?:\([-+]\))?|\([-+]\))"], "keywords": ["隐血试验", "OBT"], "normalize_qualitative": True},
        "hp_result": {"patterns": [r"(?:检测结果|样本次检测结果为)(阴性\+?|阳性\+?)"], "keywords": ["检测结果", "样本次检测结果"]},
    }
    numeric_definitions = {
        "hp_dob": _numeric_analyte("DOB值", "DOB", "DPM值", "DPM"),
    }
    _extract_text_panel(text, lines, fields, panel, text_definitions)
    _extract_numeric_panel(
        text, lines, fields, panel, numeric_definitions, neighbours=text_definitions
    )
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

    THE ANCHORING ITSELF LIVES IN `_anchored_keyword_source`, because the
    panel patterns need the same rule and were written without it — 「PT」
    and 「TT」 both matched inside 「APTT」. One statement, two readers.
    """
    return re.compile(_anchored_keyword_source(keyword), re.IGNORECASE)


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


#: A panel's vocabulary as something an `lru_cache` can key on. The
#: panels are static, so the crossing pattern for a given analyte is
#: compiled once for the life of the process rather than rebuilt for
#: every field of every parse.
_FrozenVocabulary = Tuple[Tuple[str, Tuple[str, ...]], ...]


def _freeze_vocabulary(analytes: Dict[str, List[str]]) -> _FrozenVocabulary:
    return tuple((name, tuple(words)) for name, words in sorted(analytes.items()))


def _neighbouring_analyte_names(
    analytes: _FrozenVocabulary, field_name: str
) -> Tuple[str, ...]:
    """Every OTHER analyte this panel declares — the names of other rows.

    NOT `_competing_analyte_keywords`, WHICH ANSWERS A DIFFERENT
    QUESTION. That one lists the names that CONTAIN one of mine, because
    the collision it settles is 肌酸激酶 matching inside 肌酸激酶同工酶.
    The question here is 「did this reading come off somebody else's
    row」, and 红细胞 does not have to contain 白细胞 to be a different
    row — it only has to be printed between my name and the number.

    A name that is a PIECE of one of mine is dropped, because it occurs
    inside my own printed name and marks no crossing: 红细胞 sits inside
    红细胞计数 on the row that IS mine.
    """
    mine = [
        keyword.strip().lower()
        for name, keywords in analytes
        if name == field_name
        for keyword in keywords
        if keyword and keyword.strip()
    ]
    others: List[str] = []
    for name, keywords in analytes:
        if name == field_name:
            continue
        for keyword in keywords:
            token = (keyword or "").strip()
            if not token or any(token.lower() in m for m in mine):
                continue
            others.append(token)
    return tuple(dict.fromkeys(others))


@lru_cache(maxsize=512)
def _analyte_crossing_pattern(
    analytes: _FrozenVocabulary, field_name: str
) -> Optional["re.Pattern"]:
    """This panel's OTHER row names, as one anchored alternation.

    Anchored through `_anchored_keyword_source` for the reason every
    other reader is: 「EC」 and 「OB」 are analyte names on a 尿常规, and an
    unanchored substring test finds them inside the next Latin word.
    """
    names = _neighbouring_analyte_names(analytes, field_name)
    if not names:
        return None
    return re.compile(
        "|".join(_anchored_keyword_source(name) for name in names), re.IGNORECASE
    )


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


#: A Chinese character, and a run with none in it. See the seam note in
#: `_unit_digit_spans`.
_CJK_RUN = re.compile(r"[一-龥]")
_NON_CJK_RUN = re.compile(r"[^\s一-龥]+")


@lru_cache(maxsize=1024)
def _unit_digit_spans(line: str) -> Tuple[Tuple[int, int], ...]:
    """Where on `line` a UNIT SPELLS ITSELF WITH DIGITS.

    THE HAEMATOLOGY UNIT CONTAINS A 10. 「10^9/L」, 「10*9/L」 and the
    printed 「×10⁹/L」 are the 单位 cell of the first three rows of every
    血常规, and 「cmH2O」 is the 单位 of a respiratory pressure — and
    `_LAB_NUMBER` sees a number wherever there are digits. `_ROW_RANGE`
    was the only thing this scan refused, so on the column order
    项目 / 单位 / 结果 — which is how a laboratory prints its table
    whenever the 单位 column is placed beside the analyte's own name —
    the first number after the name is INSIDE THE UNIT. Measured on a
    synthetic 血常规 in that order, 「白细胞计数(WBC) 10^9/L 6.69
    3.5-9.5」 published `wbc: 10`: a white cell count of 10 is a mild
    leucocytosis a clinician acts on, and 6.69 — the reading the
    laboratory printed — was nowhere in the payload. The cell-per-line
    layout loses it the same way, one cell at a time.

    THE SHAPE, NOT THE HEADER. `_unit_token_spans` and
    `_method_name_spans` make the same statement about an analyte's
    NAME being read out of a unit or a method column; this is the same
    statement about its READING. It needs no column order because a
    unit that spells itself with digits is recognisable on its own —
    which is what the section on `_TableColumns` calls determination
    (1), and why the numeric readers need nothing from the header.

    `_CELL_NUMBER_THEN_UNIT` IS WHAT KEEPS A READING GLUED TO ITS UNIT
    READABLE. 「693U/L」 is unit-shaped to `_is_unit_cell` as surely as
    「10^9/L」 is, and the difference between them is exactly the split
    that regex already draws: a number followed by something that
    STARTS a unit is a reading with its unit attached, and a number
    followed by 「^9/L」 is not. A token that splits keeps its number.

    AND A WINDOW SEAM IS NOT A CELL BOUNDARY. `_panel_haystacks` joins
    two adjacent lines WITHOUT a separator, so the last cell of the
    first line and the first cell of the second arrive welded into one
    「token」 — 「10E9/L血红蛋白(HGB)」 — which is not a unit, so nothing
    was reserved and the panel fallback read the exponent's base as the
    reading. It costs a row whose 结果 column the laboratory left blank,
    which is the row the fallback is reached on. A unit never mixes CJK
    with a Latin run, so the seam is visible: where a token carries CJK,
    each of its non-CJK runs is asked the same question the whole token
    is asked.
    """
    spans: List[Tuple[int, int]] = []
    for token in re.finditer(r"\S+", line):
        cell = token.group()
        if not any(character.isdigit() for character in cell):
            continue
        if _is_unit_cell(cell) and not _CELL_NUMBER_THEN_UNIT.match(cell):
            spans.append((token.start(), token.end()))
            continue
        if not _CJK_RUN.search(cell):
            continue
        for piece in _NON_CJK_RUN.finditer(cell):
            run = piece.group()
            if not any(character.isdigit() for character in run):
                continue
            if not _is_unit_cell(run) or _CELL_NUMBER_THEN_UNIT.match(run):
                continue
            start = token.start() + piece.start()
            spans.append((start, start + len(run)))
    return tuple(spans)


@lru_cache(maxsize=1024)
def _grade_cell_spans(line: str) -> Tuple[Tuple[int, int], ...]:
    """Where on `line` a SEMI-QUANTITATIVE GRADE is printed.

    「3+」 IS NOT A THREE. It is the third of the four grades a 尿液分析仪
    prints, and on the sediment scale a grade of 3+ and a count of 3 are
    OPPOSITE FINDINGS: 3 red cells per high-power field is the top of
    normal, 3+ is frank haematuria. The numeric readers scan a row with
    `_LAB_NUMBER`, which sees digits and not cells, so on

        红细胞 3+ 0-3 /HP

    the plus was simply dropped and `urine_rbc: 3.0` published with a
    reference of 0-3 — the fabricated reading landing inside its own
    reference interval, so nothing downstream had anything to flag
    either. `_qualitative_polarity` would have called the same cell
    positive; the two readers were looking at one cell and only one of
    them knew what it was.

    THE CLASS IS `_is_qualitative_value_cell`, WHICH ALREADY KNOWS THIS
    SHAPE — 「1+」 through 「4+」 and 「(2+)」 were added to
    `_QUALITATIVE_SIGN` for exactly this printing. It is asked here as a
    RESERVATION rather than as a reading, in the same list as
    `_ROW_RANGE` and `_unit_digit_spans`, because the numeric reader's
    honest answer for a graded row is no number at all: the grade is
    published by the qualitative reader on the rows that declare one,
    and a numeric field must not restate it as a count.

    Only a grade that CARRIES A DIGIT is reserved. 「+++」 and 「(-)」 hold
    no number for a numeric scan to take, and reserving a span that
    contains no digit could only cost a reading.

    AND A WINDOW SEAM IS NOT A CELL BOUNDARY, which is the same
    correction `_unit_digit_spans` carries and for the same reason:
    `_panel_haystacks` joins two adjacent lines WITHOUT a separator, so
    「红细胞 3+」 over 「白细胞 8 个/uL」 arrives as the token 「3+白细胞」 —
    not a grade cell, nothing reserved, and the fallback published the
    grade as `urine_rbc: 3`. A grade never mixes CJK with its sign, so
    the seam is visible: where a token carries CJK, each of its non-CJK
    runs is asked the same question the whole token is asked.
    """
    spans: List[Tuple[int, int]] = []
    for token in re.finditer(r"\S+", line):
        cell = token.group()
        if not any(character.isdigit() for character in cell):
            continue
        if _is_qualitative_value_cell(cell):
            spans.append((token.start(), token.end()))
            continue
        if not _CJK_RUN.search(cell):
            continue
        for piece in _NON_CJK_RUN.finditer(cell):
            run = piece.group()
            if not any(character.isdigit() for character in run):
                continue
            if not _is_qualitative_value_cell(run):
                continue
            start = token.start() + piece.start()
            spans.append((start, start + len(run)))
    return tuple(spans)


def _inside_a_printed_grade(text: str, span: Tuple[int, int]) -> bool:
    """`span` is the digit of a semi-quantitative grade. See `_grade_cell_spans`."""
    return any(
        start <= span[0] and end >= span[1] for start, end in _grade_cell_spans(text)
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

#: THE SAME VERDICT, SPELLED AS A WHOLE 提示 CELL.
#:
#: `_ROW_FLAG_MARKERS` reads 偏高 / 升高 / 降低 as SUBSTRINGS, which is
#: safe because none of them occurs inside anything else. The bare forms
#: a 提示 column actually prints — 「高」, 「低」, 「异常」 — cannot be read
#: that way: 高 is inside 高密度脂蛋白 and 低 inside 低密度脂蛋白, both of
#: them rows of the same panel. As a whole CELL they are unambiguous,
#: which is the same shape `_LETTER_FLAG_CELLS` uses for 「H」 and 「L」.
#:
#: THE COST WAS NOT ONLY THE LOST FLAG. A cell that is not known to be a
#: flag is CJK with no digits, so `_looks_like_analyte` called it the
#: next analyte and ENDED THE ROW on it — the reading lost its unit and
#: its reference interval, and with the interval gone the read-path
#: check that compares a value against its own reference had nothing to
#: fire on.
#:
#: 「正常」 IS A FLAG CELL WITH NO DIRECTION, and it has to be listed for
#: exactly the row-boundary reason above: a row is not over because the
#: laboratory said this analyte was fine.
_WORD_FLAG_CELLS: Dict[str, Optional[str]] = {
    "高": "high",
    "低": "low",
    "偏高": "high",
    "偏低": "low",
    "升高": "high",
    "降低": "low",
    "增高": "high",
    "减低": "low",
    "异常": "abnormal_unspecified",
    "正常": None,
    "未见异常": None,
}

#: A two-sided reference interval inside a row. The lookarounds stop the
#: scan starting or ending in the middle of a number, so 「1.41 1.2-1.6」
#: reads the interval and not 「41 1」.
_ROW_RANGE = re.compile(
    rf"(?<![\d.])({_NUMBER_SOURCE})\s*{_RANGE_SEPARATOR}\s*({_NUMBER_SOURCE})(?![\d.])"
)

#: A number on a row, with whatever unit is glued to its right. THE
#: GROUPED SPELLING IS ONE NUMBER — see `_NUMBER_SOURCE`; without it this
#: scan stopped at the first group and published 「3,250」 as 3.
_LAB_NUMBER = re.compile(rf"({_COMPARATOR}?{_NUMBER_SOURCE})\s*([A-Za-z/%μµ·/\-]+)?")

#: A ONE-SIDED reference limit — 「<25」, 「>1.04」. Recorded as one-sided
#: rather than dropped: an upper limit with no lower one is the whole of
#: what a CKMB or a cholesterol row prints, and dropping it leaves the
#: reading with nothing to be abnormal against.
_ROW_BOUND = re.compile(rf"({_COMPARATOR})\s*({_NUMBER_SOURCE})(?![\d.])")


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
        cell = token.strip()
        direction = _LETTER_FLAG_CELLS.get(cell.lower()) or _WORD_FLAG_CELLS.get(cell)
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
    if stripped.lower() in _LETTER_FLAG_CELLS or stripped in _WORD_FLAG_CELLS:
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
    # Compared as numbers: the reading leaves the row readers canonical
    # and the row still prints its separators. See `_canonical_number`.
    reading = _canonical_number(value) or (value or "").replace(" ", "")
    for bound in _ROW_BOUND.finditer(row_text):
        raw = f"{bound.group(1)}{bound.group(2)}"
        if (_canonical_number(raw) or raw) == reading:
            continue
        limit = _safe_float(bound.group(2))
        if bound.group(1) in _UPPER_LIMIT_COMPARATORS:
            return raw, None, limit
        return raw, limit, None
    return None, None, None


def _reading_ends_at(tokens: List[str], value: Optional[str]) -> int:
    """Index just past the token(s) on which `value` is printed.

    COMPARED AS NUMBERS, NOT AS STRINGS. The reading leaves the row
    readers canonical — 「3,250」 is published as 3250 — so a literal
    token match no longer finds it on its own row, and a search that
    starts at 0 can hand back the analyte column as the unit: a row
    printed 「CK 3,250 U/L」 has a unit-shaped cell to the LEFT of its
    reading. A grouped number the printer spaced apart is several
    tokens, so a short run of them is joined before being compared.
    """
    wanted = _canonical_number(value)
    if wanted is None:
        return 0
    for start in range(len(tokens)):
        joined = ""
        for end in range(start, min(start + 4, len(tokens))):
            piece = _canonical_number(tokens[end])
            if piece is None:
                break
            joined += piece
            if joined == wanted:
                return end + 1
            if not wanted.startswith(joined):
                break
    return 0


def _unit_from_row(row_text: str, value: Optional[str]) -> Optional[str]:
    """The unit printed to the RIGHT of the reading, as its own cell.

    `_LAB_NUMBER` only takes a unit GLUED to the number, so a row that
    prints its columns apart — 「血红蛋白量(HGB) 98 ↓ 130-175 g/L」, the
    ordinary 项目 / 结果 / 提示 / 参考区间 / 单位 order — came back with
    no unit at all, and the panel path then shipped whatever unit was
    hard-coded in the definition or none. This reads the cell.

    To the right of the reading FIRST, because that is where a 单位
    column usually sits. THEN TO THE LEFT, because it does not always:
    项目 / 单位 / 结果 / 参考区间 puts it between the analyte's name and
    the reading, and a right-only scan came back with nothing at all on
    that order — the white cell count of a 血常规 printed that way
    shipped as a bare 6.69 with the report's own ×10⁹/L dropped. The
    analyte's own name is not among the cells searched: `row_text` is
    built from the row SEGMENT, which has the name taken off its front.
    Nearest-first on the left, so the cell adjacent to the reading wins.

    A flag, a bare number, a bound and an interval are each excluded by
    name: 「98」 is unit-shaped to `_UNIT_CELL` on its own, and so is
    「H」.

    AND A READING WITH ITS UNIT GLUED ON IS TWO CELLS, WHICH IS WHY THEY
    ARE SPLIT BEFORE ANYTHING IS ASKED. 「6.69×10⁹/L」 is unit-shaped as a
    whole, so the scan answered with the ENTIRE READING as this row's
    unit — the white cell count shipped with `unit: 「6.69×10⁹/L」`, a
    string a clinician reads as a unit and no reader can parse — and the
    reading was never located as a token either, so `_reading_ends_at`
    returned 0 and the scan started to the LEFT of it. `_split_data_cell`
    is the class that already draws this line, for
    `extract_lab_table_rows`; it is asked here too, and 「×10⁹/L」 — the
    half that really is the unit — is what comes back.
    """
    tokens = [
        piece for token in row_text.split() for piece in _split_data_cell(token)
    ]
    end = _reading_ends_at(tokens, value)
    to_the_left = list(reversed(tokens[: max(end - 1, 0)])) if end else []
    for token in list(tokens[end:]) + to_the_left:
        cell = token.strip()
        if not cell or _is_row_flag_cell(cell):
            continue
        if _VALUE_CELL.match(cell) or _BOUND_CELL.match(cell) or _RANGE_CELL.match(cell):
            continue
        if _is_unit_cell(cell):
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
        """Where this analyte is named on the line — `_analyte_match_span`.

        SHARED WITH THE QUALITATIVE ROW READER. Locating an analyte's own
        row is the same question whether the cell that follows is a
        number or a 阴性, and the two readers answering it separately is
        how they ended up with different ideas of where a row is.
        """
        return _analyte_match_span(lowered_line, keyword_tokens, competing)

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
        # A CELL THAT IS NOTHING BUT A NUMBER IS THAT NUMBER, WHOLE.
        # Asked first because it is the one place the SPACED thousands
        # separator can be read safely: the cell boundary is what says
        # the space is inside the number rather than between two
        # columns, and a scan across the line cannot see that boundary.
        # 「1 180」 is an LDH, and it was published as 1.
        whole_cell = _canonical_number(line)
        if whole_cell is not None:
            return whole_cell, None

        # THE SPANS THIS ROW'S READING CANNOT BE IN: the two ends of a
        # printed interval, the digits a unit spells itself with, and the
        # digit of a semi-quantitative grade. See `_unit_digit_spans` for
        # the count a 「10^9/L」 cell was published as, and
        # `_grade_cell_spans` for the 「3+」 published as a count of 3.
        reserved = [match.span() for match in _ROW_RANGE.finditer(line)]
        reserved.extend(_unit_digit_spans(line))
        reserved.extend(_grade_cell_spans(line))

        def is_a_reading(span: Tuple[int, int]) -> bool:
            return not any(start <= span[0] and end >= span[1] for start, end in reserved)

        candidates = [
            match for match in _LAB_NUMBER.finditer(line) if is_a_reading(match.span(1))
        ]
        bare = [
            match for match in candidates if not _LEADING_COMPARATOR.match(match.group(1))
        ]
        chosen = next(iter(bare or candidates), None)
        if chosen is None:
            return None, None
        unit = (chosen.group(2) or "").strip() or None
        # THE CELL AFTER THE NUMBER IS NOT ALWAYS THE UNIT. On a
        # flattened row 「肌酸激酶(CK) 693 H 50-310 U/L」 the trailing
        # group takes the `H`, which is the laboratory's abnormal flag.
        # Same statement as `is_unit_only` makes for the cell-per-line
        # layout, one column earlier.
        #
        # AND IT IS ASKED THE WAY `_is_unit_cell` ASKS IT, which is the
        # last path in this file that still asked 「is this cell NOT one
        # of the four flag letters we listed」. A 提示 column prints
        # 「HI」, 「LO」, 「N」, 「A」, 「AB」 and a laboratory's own house
        # spelling, and every one of those is a Latin run glued to the
        # reading by this scan — so 「谷丙转氨酶(ALT) 88 HI 9-50 U/L」
        # published `unit: 「HI」` with the laboratory's own 「U/L」 never
        # reached, on the same row shape `_is_unit_cell` was written for.
        # The flag test stays alongside it because 「L」 is a unit name
        # AND the low marker, and on a row that prints a 提示 column it
        # is the marker.
        if unit and (_is_row_flag_cell(unit) or not _is_unit_cell(unit)):
            unit = None
        # The reading leaves here as ONE number — see `_canonical_number`.
        return _strip_group_separators(chosen.group(1)), unit

    def search_segment(line: str) -> str:
        span = matched_span(line.lower())
        if span is None:
            return line
        return re.sub(r"^\s*\([^)]+\)\s*", "", line[span[1] :])

    def is_reference_range(line: str) -> bool:
        return bool(
            re.fullmatch(
                rf"{_COMPARATOR}?{_NUMBER_CELL_SOURCE}\s*{_RANGE_SEPARATOR}\s*"
                rf"{_COMPARATOR}?{_NUMBER_CELL_SOURCE}"
                r"(?:\s*[A-Za-z/%μµ·/\-]+)?",
                line.strip(),
            )
        )

    def is_unit_only(line: str) -> bool:
        """`line` is a cell holding this row's unit and nothing else.

        A ONE-LETTER ABNORMAL FLAG IS A LATIN RUN. 「H」 and 「L」 passed
        this test, so on 项目 / 结果 / 提示 / 单位 the flag cell became
        the unit, the laboratory's own 「U/L」 was never reached, and the
        flag was lost with it. See `_LETTER_FLAG_CELLS`.

        THE CLASS IS `_is_unit_cell`, WHICH IS THE ONE THE OTHER READERS
        ASK. This test carried a Latin-only run of its own, so the
        haematology unit 「×10⁹/L」 — the unit on the first three rows of
        every 血常规 — was not a unit here even after it became one
        everywhere else.

        AND IT ASKS WHAT THE CELL IS. Refusing the four flag letters was
        never enough: a 提示 column prints spellings nobody listed, and
        an unlisted one filled the unit slot so the real 单位 column one
        cell further right was never read. See `_is_unit_cell`.

        A READING WITH ITS UNIT GLUED ON IS NOT A UNIT CELL, which is
        the same split `_unit_digit_spans` already applies one reader
        over. 「6.69×10⁹/L」 is unit-shaped whole, so on the cell-per-line
        layout the RESULT cell filled the unit slot and the scan walked
        past it looking for a number — landing in the reference cell.
        See `_UNIT_OPENER`.
        """
        stripped = line.strip()
        if _is_row_flag_cell(stripped):
            return False
        if _CELL_NUMBER_THEN_UNIT.match(stripped):
            return False
        return _is_unit_cell(stripped)

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

    # WHICH LINES CAN CARRY A READING AT ALL, decided once by the row
    # model rather than re-derived from the characters around a match.
    # See `_result_row_mask`: a footnote, a critical-value banner and a
    # unit-conversion legend all NAME an analyte and PRINT a number, and
    # this reader returned the first line that did both — so a synthetic
    # 血常规 carrying 「注: 血红蛋白低于 60 g/L 为危急值」 published
    # `hgb: 60` for a patient whose haemoglobin is 155.
    is_result_row = _result_row_mask(lines)

    for index, line in enumerate(lines):
        if not is_result_row[index]:
            continue
        if matched_span(line.lower()) is None or _starts_no_row(line):
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
        # Nothing else bounds the row: `_ends_the_row` and the four-cell
        # window are the same boundary the value search already ran
        # under, so reading on cannot reach the next analyte's cells.
        source_parts = [line]
        row_cells: List[str] = [segment]
        for offset in range(1, 5):
            next_index = index + offset
            if next_index >= len(lines):
                break
            # AND A FOOTNOTE ENDS THE ROW. The forward scan is the
            # cell-per-line reader, and a banner printed between an
            # analyte cell and its value cell is not this row's next
            # column — reading through it takes the threshold it quotes.
            if not is_result_row[next_index]:
                break
            candidate = lines[next_index].strip()
            if not candidate:
                continue
            if _ends_the_row(candidate):
                break
            source_parts.append(candidate)
            row_cells.append(candidate)

            if re.fullmatch(r"[↑↓→]+", candidate):
                continue

            if raw_value is None:
                # THE 单位 COLUMN CAN BE PRINTED BEFORE THE 结果 COLUMN,
                # and this scan only ever looked for a unit AFTER it had
                # a reading — so on 项目 / 单位 / 结果 the unit cell was
                # passed over here and `_unit_from_row` then looked to
                # the right of the reading, where there is nothing. The
                # count shipped bare: 6.69 rather than 6.69×10⁹/L, which
                # is the difference this file already argues at
                # `_UNIT_CHARS`.
                if unit is None and is_unit_only(candidate):
                    unit = candidate
                    continue
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


def _read_analyte_row(
    vocabulary: Dict[str, List[str]],
    field_name: str,
    lines: List[str],
) -> _LabReading:
    """`field_name`'s row, read off the page by the ONE row reader.

    THE ENTRY POINT EVERY LABORATORY PANEL GOES THROUGH. `_extract_labs`
    called `_extract_lab_value` directly and `_extract_numeric_panel`
    reached it only through `_row_context`, which is how the two ended up
    with different answers to the same question. The competing names are
    computed from the vocabulary the caller declares, so an analyte
    added to any panel is protected by the same containment rule that
    keeps 肌酸激酶 off 肌酸激酶同工酶's row.
    """
    keywords = [word for word in vocabulary.get(field_name, ()) if word and word.strip()]
    if not keywords:
        return _NO_LAB_READING
    return _extract_lab_value(
        lines, keywords, _competing_analyte_keywords(vocabulary, field_name)
    )


def _row_context(
    vocabulary: Dict[str, List[str]],
    field_name: str,
    lines: List[str],
    raw_value: Optional[str],
) -> _LabReading:
    """What the ROW said about a number a panel PATTERN read off the page.

    THE FALLBACK'S CORROBORATION, AND ONLY THAT. `_extract_numeric_panel`
    reads the row itself now — `_read_analyte_row` — and reaches this
    function only where the row reader found nothing and a pattern
    found the number instead. That happens on the shapes a table reader
    cannot see: a name and its value in one sentence, a result the OCR
    recovered as prose.

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
    if raw_value is None:
        return _NO_LAB_READING
    reading = _read_analyte_row(vocabulary, field_name, lines)
    if reading.value is None or not _same_reading(reading.value, raw_value):
        return _NO_LAB_READING
    return reading


# --------------------------------------------------------------------
# WHICH COLUMN IS THE PATIENT'S RESULT — DETERMINED ONCE, NOT ASSUMED

# THIS FILE HAS NOW FIXED THE SAME DEFECT ON FIVE READERS. `_BOUND_CELL`,
# `_find_reading_regex`, `extract_lab_table_rows`, the qualitative panel
# patterns and the pulmonary table patterns each carried their own answer
# to 「which of these cells is the reading」, and each of them was taught
# separately — so a laboratory printing its columns the other way round
# was read correctly by whichever reader had been taught last, and read
# as its own reference interval by the rest.
#
# THE ORDER CAN BE DETERMINED, AND THERE ARE ONLY TWO WAYS TO DO IT.
# Neither of them is 「the reading is the Nth cell」:
#
#   1. THE ROW'S OWN SHAPES, WHERE THE COLUMNS DIFFER IN SHAPE. A
#      two-sided interval is not a reading; a one-sided limit is a
#      reference unless it is all the row prints; a unit is not a
#      number; a percentage is not a volume. `extract_lab_table_rows`
#      collects the row and classifies afterwards for exactly this
#      reason, and `_extract_lab_value` and `_find_reading_regex` refuse
#      an interval's own bounds for the same one. A reader that
#      classifies by shape is order-independent BY CONSTRUCTION and
#      needs nothing from this section — which is why the numeric
#      readers are not rewritten here.
#
#   2. THE TABLE'S OWN HEADER, WHERE THE COLUMNS DO NOT DIFFER IN SHAPE.
#      「阴性」 under 参考区间 and 「阳性」 under 结果 are the same shape,
#      and so are the three bare figures of a 实测值 / 预计值 / 占预计值
#      row. Nothing on the row separates them. The heading printed above
#      them does, it is printed once for the whole table, and it is read
#      here once for the whole page.
#
# So this section is (2): `_table_columns` reads the header ONCE and
# `_TableColumns` is handed to the readers that shape cannot serve. It
# RETIRED the two remaining per-reader assumptions —
# `_extract_text_panel` 「the first 阴性/阳性 after the name is the
# result」 and `_extract_pulmonary` 「group 2 of the table pattern is the
# measurement」 — and it is the one place a new spelling of a column
# heading is added.
#
# WHERE NEITHER (1) NOR (2) ANSWERS, NOTHING IS PUBLISHED. That is the
# rule the rest of this file already follows and the one both retired
# assumptions broke: an unread cell is visibly missing and a cell read
# out of the wrong column is not. The one exception is stated where it
# is taken — `_pick_qualitative_cell`, where every candidate on the row
# says the same thing and the choice cannot change what is published.

#: How a Chinese laboratory or pulmonary report spells each column
#: heading. Longest spelling first at any position: 占预计值 contains
#: 预计值, 检验项目 contains 项目, and 参考区间 contains 参考.
_COLUMN_ROLE_SPELLINGS: Tuple[Tuple[str, str], ...] = (
    ("序号", "index"), ("编号", "index"), ("No", "index"),
    ("检验项目", "name"), ("检测项目", "name"), ("项目名称", "name"),
    ("英文缩写", "name"), ("英文名称", "name"), ("项目", "name"), ("名称", "name"),
    ("检验结果", "result"), ("检测结果", "result"), ("本次结果", "result"),
    ("结果值", "result"), ("测定值", "result"), ("检测值", "result"),
    ("实测值", "result"), ("结果", "result"),
    ("生物参考区间", "reference"), ("正常参考值", "reference"),
    ("参考区间", "reference"), ("参考范围", "reference"), ("参考值", "reference"),
    ("正常值", "reference"), ("参考", "reference"),
    ("单位", "unit"),
    ("异常提示", "flag"), ("结果提示", "flag"), ("提示", "flag"), ("标志", "flag"),
    ("检测方法", "method"), ("方法", "method"),
    ("占预计值%", "pred_pct"), ("占预计值％", "pred_pct"), ("占预计值", "pred_pct"),
    ("实测/预计", "pred_pct"), ("预计值%", "pred_pct"), ("预计值％", "pred_pct"),
    ("%Pred", "pred_pct"), ("Pred%", "pred_pct"),
    ("预计值", "predicted"), ("预测值", "predicted"), ("Pred", "predicted"),
)

_COLUMN_ROLE_BY_SPELLING: Dict[str, str] = {
    spelling.lower(): role for spelling, role in _COLUMN_ROLE_SPELLINGS
}

_COLUMN_HEADER_CELL = re.compile(
    "|".join(
        re.escape(spelling)
        for spelling, _ in sorted(
            _COLUMN_ROLE_SPELLINGS, key=lambda item: -len(item[0])
        )
    ),
    re.IGNORECASE,
)

#: The columns that can hold a figure or a verdict — the ones an order
#: has to separate. 单位, 方法 and 提示 are told apart by shape.
_VALUE_BEARING_ROLES: frozenset = frozenset(
    {"result", "reference", "predicted", "pred_pct"}
)


class _TableColumns(NamedTuple):
    """The order this page's results table prints its columns in."""

    roles: Tuple[str, ...] = ()

    def position_of(self, role: str) -> Optional[int]:
        return self.roles.index(role) if role in self.roles else None

    def result_precedes(self, other: str) -> Optional[bool]:
        """Is 结果 printed to the LEFT of `other`? None where unknown.

        None is not False. A reader that cannot tell the two apart must
        publish nothing rather than fall back to either order — that
        fallback IS the defect this section exists to end.
        """
        here, there = self.position_of("result"), self.position_of(other)
        if here is None or there is None:
            return None
        return here < there

    def value_roles(self) -> Tuple[str, ...]:
        """The value-bearing columns, in printed order."""
        return tuple(role for role in self.roles if role in _VALUE_BEARING_ROLES)


_NO_TABLE_COLUMNS = _TableColumns()


def _header_roles_on(line: str) -> Tuple[str, ...]:
    """The column headings `line` is made of, or `()` if it is data.

    A HEADER ROW IS NOTHING BUT HEADINGS, which is the whole of the
    test: 「项目 参考区间 结果 单位」 is covered end to end by known
    spellings and 「检测结果: D4Z4 重复单元数 18」 is not. Requiring full
    coverage is what stops a 结果 anywhere on the page from being read
    as a declaration of the column order — see `_TABLE_HEADER_CELLS`,
    which makes the same distinction cell by cell for the row scanners.
    """
    stripped = line.strip()
    dense = re.sub(r"\s", "", stripped)
    if not dense:
        return ()
    matches = list(_COLUMN_HEADER_CELL.finditer(stripped))
    if not matches:
        return ()
    covered = sum(len(re.sub(r"\s", "", match.group(0))) for match in matches)
    if covered < len(dense):
        return ()
    return tuple(_COLUMN_ROLE_BY_SPELLING[match.group(0).lower()] for match in matches)


@lru_cache(maxsize=64)
def _table_columns(lines: Tuple[str, ...]) -> _TableColumns:
    """This page's column order, read off its header row. Once.

    BOTH SHAPES OF HEADER, because both shapes of table reach this
    module: PaddleOCR emits one cell per line, so the header arrives as
    a RUN of single-heading lines; a flattened row arrives as one line
    of several. Two headings are the minimum either way — a lone 「结果」
    line is a genetic report's section heading, not a table's column.
    """
    run: List[str] = []
    for line in lines:
        roles = _header_roles_on(line)
        if len(roles) >= 2:
            return _TableColumns(roles)
        if len(roles) == 1:
            run.append(roles[0])
            continue
        if len(run) >= 2:
            return _TableColumns(tuple(run))
        run = []
    if len(run) >= 2:
        return _TableColumns(tuple(run))
    return _NO_TABLE_COLUMNS


def _page_columns(lines: Iterable[str]) -> _TableColumns:
    """`_table_columns` for a caller holding a list."""
    return _table_columns(tuple(lines))


# --------------------------------------------------------------------
# The row boundary, shared

# `_extract_lab_value` grew these as closures and they capture nothing,
# so the qualitative reader below was about to grow a second copy of
# each. A row boundary that exists twice is a row boundary that gets
# fixed once; see `_extract_numeric_panel` for the same statement about
# the reading itself.


def _analyte_match_span(
    lowered_line: str, keyword_tokens: Iterable[str], competing: Iterable[str]
) -> Optional[Tuple[int, int]]:
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


def _ends_the_row(candidate: str) -> bool:
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


def _starts_no_row(line: str) -> bool:
    """`line` is the requisition, not a row of the results table.

    THE SAME TEST `_ends_the_row` ALREADY MAKES, ASKED OF THE LINE THE
    ROW WOULD START ON. 「检验目的: FT3、FT4、STSH」 names the tests
    that were ORDERED; it carries no reading, and reading forward
    from it lands in whatever follows. It cost a reading directly
    too: the next analyte's abbreviation is a number to a scan
    looking for one, so 「FT3、FT4」 published this patient's free T3
    as 4.

    ONLY THE REQUISITION FORMS, NOT EVERYTHING `_is_header_only`
    REFUSES. Its third branch calls any 「短词(拉丁内容)」 a label
    carrying a unit, and that is the shape most rows on a Chinese
    laboratory report are printed in — 「白细胞计数(WBC)」, 「镁(MG)」.
    Refusing those here would refuse the table itself.
    """
    stripped = line.strip()
    return bool(
        any(stripped.startswith(prefix) for prefix in _EXAM_METADATA_PREFIXES)
        or _LABEL_ONLY.match(stripped)
    )


def _row_segment_after_name(line: str, name_end: int) -> str:
    """The rest of the row, once the analyte's own name is off the front."""
    return re.sub(r"^\s*\([^)]+\)\s*", "", line[name_end:])


# --------------------------------------------------------------------
# The qualitative row: 阴性 under 参考区间 and 阳性 under 结果

#: What a QUALITATIVE cell can say. A closed vocabulary on purpose: it
#: is what lets a 阴性/阳性 cell be recognised without asking
#: `_looks_like_analyte`, which calls 「阴性」 a name and would end the
#: row on the very cell being read.
#:
#: 「微量」 AND 「痕量」 ARE READINGS, NOT HEDGES. They are what a urine
#: dipstick prints for a trace of protein, glucose or blood — the whole
#: of the row's result — and neither was in this vocabulary, so the cell
#: was not a qualitative reading to `_read_qualitative_row`, the row was
#: passed over, and the panel's own pattern took the 参考区间 column's
#: 阴性 instead. A trace of urinary protein published as a negative one.
_QUALITATIVE_WORDS: Tuple[str, ...] = (
    "弱阳性", "可疑阳性", "阳性", "阴性", "未检出", "检出", "未见异常", "未见",
    "微量", "痕量",
)

#: The same verdict printed as a sign — 「(-)」, 「+」, 「++」, 「±」.
#:
#: AND THE SPELLING A CHINESE DIPSTICK PRINTOUT ACTUALLY USES: 「1+」,
#: 「2+」, 「3+」, 「(2+)」. A 尿液分析仪 prints the grade as a digit before
#: the sign at least as often as it repeats the sign, and this class
#: accepted only the repeated form — so on 「蛋白质(PRO) 阴性 2+」 the
#: 「2+」 was not a qualitative cell at all: `_read_qualitative_row` found
#: exactly one candidate on the row, the reference column's 阴性, and
#: published it. A 2+ proteinuria reported to the patient as a negative
#: urinary protein, and the same for every graded row on the page —
#: glucose, blood, ketones. Where the page prints no reference column at
#: all the row was published as UNREAD instead, which is the same
#: reading lost the other way.
#:
#: THE GRADE IS 1 TO 4 and nothing else: a dipstick has four grades, and
#: leaving the digit unbounded would make 「0-5」-shaped cells and row
#: indices compete for a class whose whole job is to be closed.
_QUALITATIVE_SIGN = re.compile(r"^[(（]?\s*(?:[1-4]\s*)?[-+±]{1,4}\s*[)）]?$")


def _is_qualitative_value_cell(cell: str) -> bool:
    """`cell` is a qualitative READING — 「阴性」, 「阳性(+)」, 「(-)」.

    NOT A FLAG CELL. 「正常」 and 「异常」 say the same kind of thing and
    are printed in the 提示 column, where they are the laboratory's
    verdict on a row rather than the row's own result;
    `_is_row_flag_cell` owns them and this must not compete for them.
    """
    stripped = cell.strip().replace(" ", "")
    if not stripped or _is_row_flag_cell(stripped):
        return False
    if _QUALITATIVE_SIGN.match(stripped):
        return True
    for word in _QUALITATIVE_WORDS:
        if stripped.startswith(word):
            rest = stripped[len(word) :]
            if not rest or _QUALITATIVE_SIGN.match(rest):
                return True
    return False


def _qualitative_polarity(cell: str) -> Optional[str]:
    """Whether `cell` says positive, negative, or neither.

    A TRACE HAS NO POLARITY, WHICH IS THIS FILE'S EXISTING ANSWER FOR
    「±」 and is now also 微量's. 「阴性 微量」 is then two verdicts,
    neither positive, and `_pick_qualitative_cell` publishes that row as
    UNREAD where the page carries no header to read the columns off —
    the same treatment 「阴性 ±」 has always had, and the reason is the
    same: a trace read out of the wrong column is a finding this patient
    does not have, and an unread cell is visibly missing while a
    misread one is not. What changed is that 微量 is a RECOGNISED
    reading at all — it used to be no verdict of any kind, so
    「蛋白质 阴性 微量」 offered the row reader exactly ONE candidate, the
    参考区间 column's 阴性, and that was published as the patient's own
    result.
    """
    stripped = cell.strip().replace(" ", "")
    negative = "阴性" in stripped or stripped.startswith(("未检出", "未见"))
    positive = "阳性" in stripped or (
        "检出" in stripped and not stripped.startswith("未检出")
    )
    if "+" in stripped:
        positive = True
    if "-" in stripped and not positive:
        negative = True
    if positive and not negative:
        return "positive"
    if negative and not positive:
        return "negative"
    return None


#: Returned by `_pick_qualitative_cell` when the row prints more than one
#: verdict and nothing on the page says which column is which. It is not
#: `None`: `None` means 「this reader found no row」 and lets the caller
#: fall back to the panel patterns, which would then publish the very
#: cell this refusal exists to withhold.
_AMBIGUOUS_QUALITATIVE = object()


def _pick_qualitative_cell(candidates: List[str], columns: _TableColumns) -> Any:
    """Which of a row's verdict cells is the PATIENT'S, not the reference.

    ONE CANDIDATE IS THE WHOLE OF THE ORDINARY CASE — a 尿常规 that
    prints no reference column has one verdict per row and there is
    nothing to choose. It is the two-column printing that carries the
    defect: on 项目 / 参考区间 / 结果 the FIRST 阴性/阳性 after the name
    is the laboratory's reference, and every reader here took it.

    THE HEADER DECIDES WHERE THERE IS ONE. Failing that, the reference
    column of a qualitative row is the NORMAL one — no laboratory prints
    「阳性」 as the value a healthy result should take — so a row showing
    exactly one positive among its verdicts has told us which cell is
    the patient's. That is a determination, not a preference for
    positives: it reads the meaning the reference column has.

    AND WHERE EVERY CANDIDATE SAYS THE SAME THING, THE CHOICE CANNOT
    CHANGE WHAT IS PUBLISHED. 「抗梅毒螺旋体抗体(TPPA) 阴性(-) 阴性
    凝集法」 is a negative screen read off either cell, so the first is
    taken and nothing is withheld for a distinction with no consequence.
    Anything else — two different verdicts, no positive, no header — is
    a row this platform cannot read, and it is published as unread.
    """
    if len(candidates) == 1:
        return candidates[0]
    precedes = columns.result_precedes("reference")
    if precedes is not None:
        return candidates[0] if precedes else candidates[-1]
    positives = [cell for cell in candidates if _qualitative_polarity(cell) == "positive"]
    if len(positives) == 1:
        return positives[0]
    polarities = {_qualitative_polarity(cell) for cell in candidates}
    if len(polarities) == 1 and None not in polarities:
        return candidates[0]
    return _AMBIGUOUS_QUALITATIVE


def _read_qualitative_row(
    vocabulary: Dict[str, List[str]],
    field_name: str,
    lines: List[str],
    columns: _TableColumns,
) -> Any:
    """`field_name`'s verdict, read off its own ROW rather than scanned.

    THE QUALITATIVE PANELS WERE THE LAST ONES NOT READING A ROW.
    `_extract_numeric_panel` moved to the shared row reader precisely so
    that a fix for a column order lands everywhere; the text panels kept
    a per-analyte regex written 「the name, then the first 阴性/阳性」,
    which is an assumption about the column order spelled as a gap
    class. On 项目 / 参考区间 / 结果 that first verdict is the reference,
    so a 尿常规 with 蛋白质 阳性 published 阴性 — a positive urinary
    protein reported to the patient as a negative one, and the same for
    every other qualitative row on the page, and for a hepatitis or HIV
    screen printed the same way.

    Returns the cell, `None` where no row was found (the caller falls
    back to its patterns), or `_AMBIGUOUS_QUALITATIVE` where the row was
    found and could not be read.
    """
    keywords = [word.lower().strip() for word in vocabulary.get(field_name, ()) if word and word.strip()]
    if not keywords:
        return None
    competing = _competing_analyte_keywords(vocabulary, field_name)
    for index, line in enumerate(lines):
        span = _analyte_match_span(line.lower(), keywords, competing)
        if span is None or _starts_no_row(line):
            continue
        cells: List[str] = []
        for cell in _row_segment_after_name(line, span[1]).split():
            if _ends_the_row(cell) and not _is_qualitative_value_cell(cell):
                break
            cells.append(cell)
        # The cell-per-line layout, where the name is alone on its line
        # and its verdict is the line below. Bounded by the same
        # `_ends_the_row` the numeric scan uses, with the same exception
        # the flag cells needed: a verdict is not the next analyte,
        # however much `_looks_like_analyte` thinks 「阴性」 is a name.
        for offset in range(1, 5):
            next_index = index + offset
            if next_index >= len(lines):
                break
            candidate = lines[next_index].strip()
            if not candidate:
                continue
            if _ends_the_row(candidate) and not _is_qualitative_value_cell(candidate):
                break
            cells.append(candidate)
        candidates = [cell for cell in cells if _is_qualitative_value_cell(cell)]
        if not candidates:
            continue
        return _pick_qualitative_cell(candidates, columns)
    return None


# --------------------------------------------------------------------
# The FREE-TEXT row: 淡黄色 under 参考区间 and 深黄色 under 结果

#: A PRINTED FREE-TEXT READING: letters, and nothing else.
#:
#: 黄色, 淡黄色, 清亮, 微浊, 软便, 糊状 — the whole of what the four
#: free-text rows of a 尿常规 and a 粪便常规 can say. The class is a
#: SHAPE and not a vocabulary of colours on purpose: this file has spent
#: several rounds learning what a closed list of Chinese words costs
#: (see `MUSCLE_KEYWORDS`), and a colour nobody listed is exactly the
#: reading a laboratory prints when something is wrong. Punctuation is
#: what it excludes — a 「:」 left over from 「透明度: 微浊」 is not a
#: reading, and neither is a clause with a comma in it.
_FREE_TEXT_VALUE_CELL = re.compile(r"^[一-龥A-Za-z]{1,6}$")


def _is_free_text_value_cell(cell: str) -> bool:
    """`cell` could be a free-text row's printed reading.

    EVERYTHING THAT IS SOMETHING ELSE IS REFUSED BY NAME, because the
    positive test is only a shape: a flag cell (`正常`, `异常`), a unit,
    a number or interval in any of its printed forms, an assay method,
    and a column heading are each a cell of the same table and none of
    them is a reading. `_is_qualitative_value_cell` is the sibling test
    for the closed 阴性/阳性 vocabulary and owns those cells; this one
    covers the rows that vocabulary was never going to reach.
    """
    stripped = cell.strip()
    if not stripped or not _FREE_TEXT_VALUE_CELL.match(stripped):
        return False
    if _is_row_flag_cell(stripped) or _is_qualitative_value_cell(stripped):
        return False
    if _is_unit_cell(stripped) or _CJK_UNIT_CELL.match(stripped):
        return False
    if _NUMERIC_DATA_CELL.match(stripped) or _names_a_method(stripped):
        return False
    return stripped not in _TABLE_HEADER_CELLS and not _is_header_row(stripped)


def _read_free_text_row(
    vocabulary: Dict[str, List[str]],
    field_name: str,
    lines: List[str],
    columns: _TableColumns,
) -> Any:
    """`field_name`'s printed reading, off its own ROW. See `_read_qualitative_row`.

    THE 参考区间-READ-AS-结果 FIX LANDED ONLY FOR THE CLOSED QUALITATIVE
    VOCABULARY. `_read_qualitative_row` recognises a cell by asking
    `_is_qualitative_value_cell`, which knows 阴性, 阳性, 未检出 and the
    signs — and the free-text rows of the same two panels say none of
    those. 尿颜色, 尿透明度, 粪便颜色 and 粪便性状 therefore kept the
    behaviour the round before them removed everywhere else: the pattern
    takes the first cell after the name, and on 项目 / 参考区间 / 结果
    that cell is the laboratory's REFERENCE. A urine printed
    「颜色 淡黄色 深黄色」 published 淡黄色 — the value a healthy sample
    should take, presented as this patient's own — and a stool printed
    「颜色 黄褐色 黑色」 published 黄褐色, which is a melaena reported as
    an ordinary stool on the row a patient checks by eye.

    THE ROW ENDS AT THE NEXT ANALYTE THE PANEL ITSELF DECLARES, which is
    the one boundary available here. `_ends_the_row` cannot be reused:
    it asks `_looks_like_analyte`, and 「淡黄色」 is a short CJK cell with
    no digits, so the boundary would fall on the very cell being read.
    The panel's own definitions are what this reader has instead — a
    vocabulary that is not hand-written here but declared by the caller,
    so a row added to either panel bounds its neighbours automatically.

    Returns the cell, `None` where no row was found or nothing on it
    could be a reading (the caller falls back to its patterns), or
    `_AMBIGUOUS_QUALITATIVE` where the row was found and this platform
    cannot say which of its cells is the patient's.
    """
    keywords = [word.lower().strip() for word in vocabulary.get(field_name, ()) if word and word.strip()]
    if not keywords:
        return None
    competing = _competing_analyte_keywords(vocabulary, field_name)
    #: EVERY OTHER ROW THIS PANEL DECLARES, as the row boundary.
    #: `competing` is the containment rule and holds only the names that
    #: this analyte's own name is a substring of — a different question,
    #: and one that leaves 透明度 out of 颜色's boundary.
    others = tuple(
        word.lower().strip()
        for other, words in vocabulary.items()
        if other != field_name
        for word in words
        if word and word.strip()
    )

    def ends_the_row(cell: str) -> bool:
        stripped = cell.strip()
        if not stripped:
            return False
        lowered = stripped.lower()
        return bool(
            any(name in lowered for name in others)
            or _is_header_row(stripped)
            or _is_header_only(stripped)
            or _ROW_INDEX_CELL.match(stripped)
            or _starts_no_row(stripped)
        )

    for index, line in enumerate(lines):
        span = _analyte_match_span(line.lower(), keywords, competing)
        if span is None or _starts_no_row(line):
            continue
        cells: List[str] = []
        for cell in _row_segment_after_name(line, span[1]).split():
            if ends_the_row(cell):
                break
            cells.append(cell)
        for offset in range(1, 5):
            next_index = index + offset
            if next_index >= len(lines):
                break
            candidate = lines[next_index].strip()
            if not candidate:
                continue
            if ends_the_row(candidate):
                break
            cells.append(candidate)
        candidates = [cell for cell in cells if _is_free_text_value_cell(cell)]
        if not candidates:
            continue
        return _pick_free_text_cell(candidates, columns)
    return None


def _pick_free_text_cell(candidates: List[str], columns: _TableColumns) -> Any:
    """Which of a free-text row's cells is the PATIENT'S, not the reference.

    THE HEADER IS THE ONLY THING THAT CAN ANSWER IT. A colour and a
    colour are the same shape; `_pick_qualitative_cell` has a second
    determination available to it — no laboratory prints 阳性 as the
    value a healthy result should take — and there is no equivalent
    reading of 「淡黄色」. So this is determination (2) of the section
    above and nothing else, with the same exception taken for the same
    reason: where every cell on the row says the same thing, the choice
    cannot change what is published.

    Anything else — two different readings and no header — is a row this
    platform cannot read, and it is published as unread rather than as
    whichever cell came first.
    """
    if len(candidates) == 1:
        return candidates[0]
    precedes = columns.result_precedes("reference")
    if precedes is not None:
        return candidates[0] if precedes else candidates[-1]
    if len({cell.strip() for cell in candidates}) == 1:
        return candidates[0]
    return _AMBIGUOUS_QUALITATIVE


# --------------------------------------------------------------------
# The row that contradicts itself


def _row_contradicts_itself(
    value: Optional[float],
    flag: Optional[str],
    reference_low: Optional[float],
    reference_high: Optional[float],
) -> bool:
    """The laboratory's FLAG and the laboratory's INTERVAL disagree.

    THE CHEAPEST SELF-CHECK IN THIS FILE, AND NOTHING WAS MAKING IT.
    Both halves are printed on the row, both are already parsed onto the
    same field, and a reading that is BELOW its own reference interval
    while carrying the laboratory's HIGH marker cannot be a correct
    reading of that row — one of the two cells was read out of the wrong
    column. The row is mis-read whichever half is wrong, and a field
    that ships anyway ships a confident number that the page it came
    from contradicts.

    STRICTLY OUTSIDE, IN THE WRONG DIRECTION — that and nothing wider.
    A value INSIDE its interval carrying a flag is an ordinary sight on
    a real report: laboratories flag against age- and sex-specific
    limits they do not print, and against the previous result. Those are
    not contradictions and refusing them would withhold readings that
    are correct. Below the floor while marked high is not that; it is
    arithmetic.
    """
    if value is None or flag is None:
        return False
    if flag == "high" and reference_low is not None and value < reference_low:
        return True
    if flag == "low" and reference_high is not None and value > reference_high:
        return True
    return False


# --------------------------------------------------------------------
# Generic lab-table reader

# Everything above is per-analyte: someone wrote a regex for FT3, so FT3
# is extracted; nobody wrote one for 「游离甲状腺素指数」, so it is not.
# That is a list that can only ever cover reports we have already seen,
# and the user's ask was the opposite —「如果有其他格式的报告也可以识别
# 出来，不局限于我这几个」.

# The way out is that the *shape* is universal. Chinese lab reports put
# a header row over the results —「No 项目 结果 参考区间 单位 方法」— and
# PaddleOCR emits one cell per line, so a row is N consecutive lines
# where N is the header's width. Reading that structure extracts every
# analyte on the page, including ones nobody anticipated.

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
#: 「3,250」 and 「3 250」 ARE DIGITS AND NOTHING ELSE — a printed
#: thousands separator is part of the number, not a second cell. See
#: `_NUMBER_CELL_SOURCE` for why the spaced spelling is read here, where
#: the cell boundary proves it, and not by the row scanners.
_VALUE_CELL = re.compile(rf"^{_NUMBER_CELL_SOURCE}$")

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
_BOUND_CELL = re.compile(rf"^{_COMPARATOR}\s*{_NUMBER_CELL_SOURCE}$")

#: A reference range rather than a result.
_RANGE_CELL = re.compile(
    rf"^{_COMPARATOR}?\s*{_NUMBER_CELL_SOURCE}\s*{_RANGE_SEPARATOR}\s*{_NUMBER_CELL_SOURCE}$"
)

#: WHAT A PRINTED UNIT IS MADE OF, AND IT IS NOT ONLY ASCII.
#:
#: The haematology unit is 「×10⁹/L」 — a multiplication sign and a
#: superscript nine — and it is printed that way on every 血常规 this
#: platform receives. The unit classes admitted no character outside
#: ASCII plus `μ`, so the cell was not a unit to `is_unit_only`, not a
#: unit to `_unit_from_row` and not a unit to `extract_lab_table_rows`:
#: a white cell count, a red cell count and a platelet count all shipped
#: with no unit at all, which is the difference between 6.69 and
#: 6.69×10⁹/L on a screen a clinician reads. The ASCII spellings
#: 「10^9/L」 and 「10*9/L」 were already covered and the printed one was
#: not.
_UNIT_CHARS = "A-Za-zμµ%/·^×⁰¹²³⁴⁵⁶⁷⁸⁹⁻"

#: A unit. Deliberately loose — units vary wildly — but never CJK, and
#: NEVER A BARE NUMBER: the class used to admit `\d` unguarded, so the
#: result cell of the row above became the unit of the row being read.
#:
#: `-` IS DELIBERATELY ABSENT from the body. A hyphenated Latin run is
#: an analyte abbreviation far more often than a unit — 「P-LCR」,
#: 「RDW-SD」, 「CK-MB」 — and `_looks_like_analyte` refuses whatever this
#: class accepts.
_UNIT_CELL = re.compile(rf"^(?=.*[{_UNIT_CHARS}])[{_UNIT_CHARS}\d\.\*]{{1,14}}$")

#: THE COUNTERS A UNIT IS SPELLED WITH IN CHINESE. A urine sediment
#: count is printed 「个/uL」, 「个/HP」 or 「个/HPF」 and a repeat count is
#: printed 「个」, and `_UNIT_CELL` admits no CJK at all — so on the
#: cell-per-line layout that cell was not a unit to any reader, and
#: `_looks_like_analyte` then called it the NEXT ANALYTE and ended the
#: row on it: the count shipped with no unit, and the reference interval
#: printed to the right of the unit column was never reached either. A
#: closed list rather than 「any CJK」, because 「阴性」 and 「偏高」 are CJK
#: cells of the same table and neither is a unit.
#:
#: 「秒」 IS THE SAME FAILURE ONE PANEL OVER: it is what a 凝血 report
#: prints in the 单位 column of its prothrombin time, and being CJK it
#: ended that row exactly as 个/uL ended the sediment row. The shape,
#: not the instance.
_CJK_UNIT_COUNTERS = "个只条粒株次秒"
_CJK_UNIT_CELL = re.compile(
    rf"^[{_CJK_UNIT_COUNTERS}](?:\s*/\s*[{_UNIT_CHARS}\d\.\*]{{1,10}})?$"
    rf"|^/\s*[{_UNIT_CHARS}\d\.\*]{{1,10}}$"
)

#: SYMBOLS THAT SAY 「THIS CELL IS A UNIT」 BY THEMSELVES: a solidus, a
#: percent, a multiplication sign, a power, a superscript.
_UNIT_SHAPE_MARKERS = "/%×·^*⁰¹²³⁴⁵⁶⁷⁸⁹⁻"

#: AND THE UNITS THAT CARRY NO SYMBOL AT ALL, as a closed vocabulary.
#: This is the list that lets `_is_unit_cell` answer POSITIVELY; see it
#: for why a list is the right shape here and an exclusion is not.
_SIMPLE_UNIT_WORDS: frozenset = frozenset({
    "l", "ml", "dl", "cl", "ul", "μl", "µl", "nl", "pl", "fl",
    "g", "mg", "ug", "μg", "µg", "ng", "pg", "fg", "kg",
    "mol", "mmol", "umol", "μmol", "µmol", "nmol", "pmol", "fmol",
    "eq", "meq", "u", "iu", "miu", "uiu", "ku", "mu",
    # A TITRE IS PRINTED AS A WORD. 「ratio」 is the 单位 cell of an
    # 抗核抗体滴度 row and carries no symbol at all, which is what this
    # half of the list is for.
    "ratio", "titer", "titre", "index",
    "pa", "kpa", "mmhg", "cmh2o", "atm",
    # 「h」 IS THE HIGH FLAG BEFORE IT IS AN HOUR, and no panel this file
    # reads prints an hour. Every caller asks `_is_row_flag_cell` first,
    # and leaving it out is what keeps that ordering from being
    # load-bearing.
    "s", "sec", "ms", "min",
    "m", "cm", "mm", "um", "μm", "µm", "nm",
    "mv", "bpm", "hz", "kda", "kb",
    "osm", "mosm", "copies", "cells",
})


def _is_unit_cell(cell: str) -> bool:
    """`cell` IS this row's unit — asked positively, on purpose.

    THE EXCLUSION LIST WAS NEVER GOING TO BE FINISHED. `is_unit_only`
    and the two other unit readers asked 「is this Latin-shaped and not
    one of the four flag letters we know」, and a 提示 column prints far
    more than four: 「HI」, 「LO」, 「N」, 「A」, 「AB」, 「PANIC」, a
    laboratory's own house spelling. Every one of those is Latin,
    short and symbol-free, so every one of them was accepted AS THE
    ROW'S UNIT — and the damage is not the wrong unit, it is that the
    unit slot is then FULL: the real 单位 column, one cell further
    right, is never reached. Measured on a synthetic 生化全套 in the
    ordinary 项目 / 结果 / 提示 / 单位 order, an ALT of 88 shipped with
    `unit: 「A」` and the laboratory's 「U/L」 nowhere in the payload. That
    is the same failure `_LETTER_FLAG_CELLS` was written to stop, on the
    cells it does not list — and it will keep happening for as long as
    the question is 「what is this cell NOT」.

    A unit answers positively and a flag cannot: a printed unit either
    carries a solidus or a symbol, or it is a word from the closed
    vocabulary of unit names, or it is a Chinese counter. 「A」 is none
    of those, and neither is a spelling nobody has seen yet — which is
    the whole difference between this and one more entry on a list of
    refusals.

    THE LOOSE SHAPE TEST STAYS WHERE BEING WRONG IS SAFE.
    `_looks_like_analyte` still asks `_UNIT_CELL`, because there the
    question is 「could this cell be the unit column」 and answering yes
    only declines to call it an analyte — a 提示 cell that stopped being
    unit-shaped would END THE ROW, which costs the interval and the
    unit both. Publishing is the direction that needs certainty.
    """
    stripped = cell.strip()
    if not stripped:
        return False
    if _CJK_UNIT_CELL.match(stripped):
        return True
    if not _UNIT_CELL.match(stripped):
        return False
    if any(character in _UNIT_SHAPE_MARKERS for character in stripped):
        return True
    return stripped.lower() in _SIMPLE_UNIT_WORDS

#: A CELL THAT IS A NUMBER, AN INTERVAL OR A LIMIT — WITH OR WITHOUT ITS
#: UNIT GLUED ON.
#:
#: 「50-310 U/L」 is an ordinary way to print the reference column: one
#: cell, the interval and the unit together. It is not a value cell, not
#: a range cell and not a unit cell, so it fell through every class to
#: 「has Latin letters」 — and `_looks_like_analyte` therefore called it
#: the NEXT ANALYTE and ended the row on it. The reading shipped with no
#: unit and no interval, and with the interval gone the read-path
#: defence that checks a value against its own reference could not fire
#: on that row either.
#: WHAT CAN OPEN A UNIT THAT IS GLUED TO ITS NUMBER — and the character
#: that could not, on the unit this platform's commonest panel prints.
#:
#: 「6.69×10⁹/L」 is one cell: a reading with its unit attached, in the
#: spelling a haematology analyser prints. The unit half of the split
#: below had to START with a letter, a micro sign or a percent, and
#: 「×10⁹/L」 starts with none of them — so the cell did not split, and
#: `_unit_digit_spans` then classified the WHOLE cell as a unit that
#: spells itself with digits, which is what 「×10⁹/L」 alone would be.
#: The reading was reserved along with it. `extract_numeric_value`
#: skipped 6.69 as unreadable and took the next free number on the row,
#: which is whatever the reference column left exposed: measured on a
#: synthetic 血常规 printing 「白细胞计数(WBC) 6.69×10⁹/L
#: 3.5×10⁹/L-9.5×10⁹/L」 — the reference cell carrying the same unit, so
#: `_ROW_RANGE` cannot see an interval in it either — `wbc` published as
#: 3.5, THE BOTTOM OF THE NORMAL RANGE presented as this patient's white
#: cell count. With the reference bracketed instead, 「(3.5-9.5)×10⁹/L」,
#: the exposed number is the exponent's base and `wbc` published as 10.
#:
#: THE MULTIPLICATION SIGN OPENS A UNIT EXACTLY AS A LETTER DOES. The
#: ASCII spelling 「6.69x10^9/L」 was never affected, because its `x` is a
#: letter; the printed 「×」 is the spelling `_UNIT_CHARS` was widened for
#: and this class had not been told about.
#:
#: 「*」 IS NOT ADMITTED, AND THE REASON IS THE SAME ONE
#: `_EXPONENT_UNIT_TAIL` GIVES FOR 「E」. In 「10*9/L」 — the ASCII export
#: of the haematology unit — the star is the EXPONENT OPERATOR INSIDE
#: the unit, not a multiplication in front of one, so admitting it would
#: split that cell into a reading of 10 and a unit of 「*9/L」: exactly
#: the 「wbc: 10」 this whole class exists to refuse, on a spelling that
#: was already correct. 「×」 carries no such reading: no unit is spelled
#: 「10×9/L」.
_UNIT_OPENER = r"[A-Za-zμµ%×]"

_NUMERIC_DATA_CELL = re.compile(
    rf"^{_COMPARATOR}?\s*{_NUMBER_CELL_SOURCE}"
    rf"(?:\s*{_RANGE_SEPARATOR}\s*{_COMPARATOR}?\s*{_NUMBER_CELL_SOURCE})?"
    rf"\s*(?:{_UNIT_OPENER}[{_UNIT_CHARS}\d\.\*]{{0,13}})?$"
)

#: THE E EXPONENT IS PART OF THE UNIT, NOT THE START OF ONE.
#:
#: 「10E9/L」, 「10e9/L」 and 「10E12/L」 are how a Chinese LIS exports the
#: haematology unit when it cannot print a superscript — the same cell
#: as 「10^9/L」, 「10*9/L」 and 「×10⁹/L」, in the spelling those three
#: were fixed for and this one was not. The unit half only had to START
#: with a letter, and 「E9/L」 does, so the cell split into 「10」 and a
#: remainder: `_unit_digit_spans` then saw a cell that was NOT a whole
#: unit and reserved nothing, and on the 项目 / 单位 / 结果 order — the
#: 单位 column beside the analyte's name — the first number after the
#: name is that 10. Measured on a synthetic 血常规 in that order,
#: 「白细胞计数(WBC) 10E9/L 6.69 3.5-9.5」 published `wbc: 10` and
#: 「红细胞计数(RBC) 10E12/L 4.55」 published `rbc: 10`: a white cell
#: count of 10 is a leucocytosis a clinician acts on, a red cell count
#: of 10 is not a figure a living patient has, and neither 6.69 nor 4.55
#: was anywhere in the payload.
#:
#: An `E` followed by a DIGIT is an exponent; an `E` followed by
#: anything else still opens a unit, so 「5EU/L」 splits as it always did.
_EXPONENT_UNIT_TAIL = r"(?![Ee]\d)"

#: The same cell, split into the two columns it is really printing. The
#: unit half must START with `_UNIT_OPENER` — a letter, a percent sign
#: or a multiplication sign — which is what keeps 「10^9/L」 whole (that
#: is a unit, not a 10 with a unit of 「^9/L」) and must not start with an
#: exponent, which is what keeps 「10E9/L」 whole for the same reason.
_CELL_NUMBER_THEN_UNIT = re.compile(
    rf"^({_COMPARATOR}?\s*{_NUMBER_CELL_SOURCE}"
    rf"(?:\s*{_RANGE_SEPARATOR}\s*{_COMPARATOR}?\s*{_NUMBER_CELL_SOURCE})?)"
    rf"\s*{_EXPONENT_UNIT_TAIL}({_UNIT_OPENER}[{_UNIT_CHARS}\d\.\*]{{0,13}})$"
)


def _split_data_cell(cell: str) -> List[str]:
    """`cell`, as the columns it prints — 「50-310 U/L」 is two.

    `extract_lab_table_rows` classifies a row by asking which cell is
    the value, which is the interval and which is the unit, and a
    laboratory that prints the interval and its unit in one box answers
    none of the three. Splitting first is what lets the rest of that
    function stay column-order-independent.
    """
    match = _CELL_NUMBER_THEN_UNIT.match(cell.strip())
    if not match:
        return [cell]
    return [match.group(1).strip(), match.group(2).strip()]


#: Parentheticals that really are a unit rather than an abbreviation.
#: A unit spelled without a solidus and without a symbol is a short word
#: from a closed list; an abbreviation is not. See
#: `_names_its_own_abbreviation`.
_PARENTHETICAL_UNITS: frozenset = frozenset({
    "mm", "cm", "ml", "dl", "fl", "pg", "mg", "ug", "ng", "kg", "mmhg",
    "mmol", "umol", "nmol", "pmol", "mol", "kpa", "bpm", "iu", "min",
    "ms", "hz", "mv", "cmh2o", "sec", "kda", "kb", "bp",
})

#: The bracketed tail of a cell — 「白细胞计数(WBC)」, 「膈肌厚度(mm)」.
_CELL_PARENTHETICAL = re.compile(r"[(（]\s*([^)）]{1,10})\s*[)）]\s*$")


def _names_its_own_abbreviation(cell: str) -> bool:
    """`cell` is 「中文名(缩写)」 — an analyte, not a column heading.

    THE COMMONEST SHAPE ON A CHINESE LABORATORY REPORT WAS THE ONE THE
    GENERIC TABLE READER COULD NOT SEE. `_is_header_only` calls any
    「短词(拉丁内容)」 a label carrying a unit — written for 「膈肌厚度(mm)」
    and 「LVEF(%)」 — and `_looks_like_analyte` consulted it, so
    「白细胞计数(WBC)」, 「碱性磷酸酶(ALP)」, 「游离T3(FT3)」 were all
    refused as names. That reader exists precisely so that a report
    nobody anticipated still produces values, and it was blind to the
    dominant analyte form: a table of thirty rows printed that way
    yielded nothing at all.

    WHAT IS INSIDE THE BRACKETS IS THE WHOLE OF THE DIFFERENCE, and it
    is not 「Latin or Chinese」 — both of these are Latin. A unit either
    carries a solidus or a symbol, or it is one of a closed list of short
    words; an analyte abbreviation is a Latin token that is neither. A
    one-character parenthetical — 「(s)」, 「(U)」 — is read as a unit,
    because no laboratory abbreviates an analyte to one letter in its
    own name column.
    """
    stripped = cell.strip()
    if any(stripped.startswith(prefix) for prefix in _EXAM_METADATA_PREFIXES):
        return False
    match = _CELL_PARENTHETICAL.search(stripped)
    if not match:
        return False
    inside = match.group(1).strip()
    if len(inside) < 2 or not re.match(r"[A-Za-z]", inside):
        return False
    if "/" in inside:
        return False
    return inside.lower() not in _PARENTHETICAL_UNITS


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
    if cell in _TABLE_HEADER_CELLS or _is_header_row(cell):
        return False
    # A LABEL CARRYING ITS OWN ABBREVIATION IS AN ANALYTE. `_is_header_only`
    # cannot tell 「白细胞计数(WBC)」 from 「膈肌厚度(mm)」 and does not need
    # to for its own callers; here the difference is the whole reading.
    if _is_header_only(cell) and not _names_its_own_abbreviation(cell):
        return False
    # A NUMBER, AN INTERVAL OR A LIMIT — WITH OR WITHOUT ITS UNIT. The
    # three bare forms were listed and the unit-bearing ones were not,
    # so 「50-310 U/L」 ended the row it belongs to.
    if _NUMERIC_DATA_CELL.match(cell):
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
    #
    # THE LOOSE SHAPE TEST, DELIBERATELY. Here 「could be a unit」 is the
    # right question — being wrong only declines to call the cell an
    # analyte, and a 提示 cell that stopped being unit-shaped would END
    # THE ROW. `_is_unit_cell` is the strict half, asked where a cell is
    # PUBLISHED as a unit.
    if _UNIT_CELL.match(cell) and not re.search(r"[\u4e00-\u9fa5]", cell):
        return False
    # A UNIT SPELLED WITH A CHINESE COUNTER IS STILL A UNIT. 「个/uL」 is
    # the 单位 cell of every urine sediment row, and being CJK it fell
    # past the test above and was read as THE NEXT ANALYTE — so the row
    # ended on its own unit column, losing the unit and, where the
    # interval is printed to the right of it, the interval too.
    if _CJK_UNIT_CELL.match(cell.strip()):
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
            # 「50-310 U/L」 IS TWO COLUMNS IN ONE BOX. The classification
            # below asks which cell is the value, which the interval and
            # which the unit; a box holding two of them answers none.
            cells.extend(_split_data_cell(cell))
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
            at = cells.index(value)
            # A ONE-LETTER FLAG IS UNIT-SHAPED, and on 项目 / 结果 / 提示
            # / 单位 it is the cell immediately after the reading — so
            # 「H」 was published as the unit of every analyte this reader
            # exists to cover, and the laboratory's own unit, sitting one
            # cell further right, was never reached.
            #
            # AND THE 单位 COLUMN IS NOT ALWAYS TO THE RIGHT. On
            # 项目 / 单位 / 结果 it sits between the name and the reading,
            # so a right-only scan published every row of that table
            # without its unit. Searched after the right-hand cells and
            # nearest-first, which is the same order `_unit_from_row`
            # uses on the other reader of this layout.
            after = cells[at + 1 :]
            before = list(reversed(cells[:at]))
            unit = next(
                (
                    cell
                    for cell in after + before
                    if _is_unit_cell(cell) and not _is_row_flag_cell(cell)
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
                # ONE NUMBER, WITHOUT THE SEPARATORS THAT GROUP IT —
                # 「3,250」 is what the laboratory printed and 3250 is
                # what every consumer of this row parses. The printed
                # form stays on `source_text`. See `_canonical_number`.
                "value": _canonical_number(value) or value,
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

    for field_name in analytes:
        reading = _read_analyte_row(analytes, field_name, lines)
        if reading.value is None:
            continue
        numeric_value = _safe_float(reading.value)
        # BUILT FIRST, PANEL WRITTEN SECOND — see `_append_panel_number`.
        # A row refused for contradicting itself must be absent from
        # `normalized_summary` as well as from `structured_fields`.
        field = _build_field(
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
        )
        if field is None:
            continue
        panel[field_name] = numeric_value if numeric_value is not None else reading.value
        _append_field(fields, field)

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
    #: AND THE TWO SIDES OF THAT COMPARISON WERE SPELLED DIFFERENTLY.
    #: `row["value"]` leaves `extract_lab_table_rows` CANONICAL — the
    #: separators that group a printed number are folded away, which is
    #: the whole point of `_canonical_number` — while `source_text` is
    #: the row exactly as the laboratory printed it. So 「3250」 was
    #: looked for inside 「*14肌酸激酶(CK) 3,250 ↑ 50-310 U/L」 and never
    #: found, and the guard that exists to stop one creatine kinase
    #: being published twice let precisely the grouped readings through:
    #: `ck: 3250` and `table_肌酸激酶_ck: 3250`, both on `observations`,
    #: both in `latest_summary.by_analyte`, and the SAME analyte named
    #: twice in `abnormal_list` — on the readings large enough to need a
    #: thousands separator, which on this disease's panel are the muscle
    #: enzymes. The row snippets are folded the same way before the
    #: comparison so that both spellings of one number match.
    published_rows = [
        (raw, _strip_group_separators(raw))
        for raw in (
            str(field.get("source_text") or "")
            for field in fields
            if field.get("source_text")
        )
    ]
    existing_names = {str(f.get("field_name") or "").lower() for f in fields}

    def already_published(name: str, value: str) -> bool:
        return any(
            (name in raw or name in folded) and (value in raw or value in folded)
            for raw, folded in published_rows
        )

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

    #: The two sections of an 入院常规 printout, where the page prints
    #: both under their own headings. None on every ordinary
    #: single-panel report, which is what keeps this out of their way.
    sections = _split_blood_and_urine_sections(lines)
    if sections and report_type in {"blood_routine", "urinalysis"}:
        classification_reasons = list(classification_reasons) + [
            "sections:同页含血常规与尿常规两段，各段按本段判读"
        ]

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
            # BOTH PANELS, EACH BOUNDED TO ITS OWN SECTION, on a page
            # that carries both. See `_split_blood_and_urine_sections`
            # for what one label cost: the urinalysis rows were absent
            # and the blood rows were read out of the urine section.
            blood_lines, urine_lines = sections or (lines, lines)
            _extract_blood_routine(blood_lines, structured_fields, normalized_summary)
            if sections:
                _extract_urinalysis(urine_lines, structured_fields, normalized_summary)
        elif kind == "thyroid_function":
            _extract_thyroid_function(lines, structured_fields, normalized_summary)
        elif kind == "coagulation":
            _extract_coagulation(lines, structured_fields, normalized_summary)
        elif kind == "urinalysis":
            blood_lines, urine_lines = sections or (lines, lines)
            _extract_urinalysis(urine_lines, structured_fields, normalized_summary)
            if sections:
                _extract_blood_routine(blood_lines, structured_fields, normalized_summary)
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
