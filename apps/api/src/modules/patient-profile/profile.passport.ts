import {
  DIAGNOSIS_LADDER_LABELS,
  DIAGNOSIS_LADDER_STATES,
  type DiagnosisLadderState,
} from './profile.schema.js';
import type {
  PatientActivityLogDTO,
  PatientDocumentDTO,
  PatientProfileDTO,
} from './profile.service.js';

/** Only what this file reads. `aiExtraction` / `ai_extraction` used to
 *  be declared here and referenced nowhere — and the profile query no
 *  longer loads them (see PROFILE_OCR_PAYLOAD_PROJECTION), so the shape
 *  now says what actually arrives. */
type OcrPayloadLike = {
  extractedText?: string;
  extracted_text?: string;
  fields?: Record<string, unknown>;
} | null;

type BodyRegionId =
  | 'face'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftUpperArmFront'
  | 'rightUpperArmFront'
  | 'leftUpperArmBack'
  | 'rightUpperArmBack'
  | 'leftTorso'
  | 'rightTorso'
  | 'leftGlute'
  | 'rightGlute'
  | 'leftThighFront'
  | 'rightThighFront'
  | 'leftThighBack'
  | 'rightThighBack'
  | 'leftShin'
  | 'rightShin'
  | 'leftCalf'
  | 'rightCalf';

export type PassportBodyRegionDatum = {
  intensity: number;
  label?: string;
};

export type PassportBodyRegionMap = Partial<Record<BodyRegionId, PassportBodyRegionDatum>>;

export interface PassportMetricDTO {
  label: string;
  value: string;
  hint: string;
}

export interface PassportFreshnessDTO {
  label: '最新' | '待更新' | '过期' | '缺失' | '未知';
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  date: string | null;
  daysSince: number | null;
}

export interface PassportSummaryCardDTO {
  key: 'diagnosis' | 'motor' | 'imaging' | 'monitoring';
  title: string;
  ready: boolean;
  summary: string;
  meta: string;
}

/**
 * How the diagnosis on this passport is backed.
 *
 * `genetic` — a D4Z4 repeat count, 4q haplotype or EcoRI fragment was
 *   extracted from a report the patient uploaded. This is evidence.
 * `self_reported` — the patient typed a diagnosis or a date into the
 *   baseline form. This is a claim, and it is the commonest state:
 *   the literature puts the FSHD diagnostic odyssey near a decade with
 *   a majority misdiagnosed along the way, so the realistic holder of
 *   an unconfirmed passport is someone carrying「可能是肌病」or an
 *   outright wrong label.
 * `none` — nothing yet.
 *
 * The distinction is the whole point. This document is designed to be
 * handed to a neurologist who may see three FSHD patients in a career,
 * and a confident, well-typeset page headed FSHD anchors them — which
 * is the mechanism that produces those ten-year odysseys in the first
 * place. A passport must never present a patient's own guess in the
 * same visual register as a genetic result.
 */
export type PassportDiagnosisConfirmation = 'genetic' | 'self_reported' | 'none';

export interface PassportDiagnosisDTO {
  ready: boolean;
  /** Carried all the way to the printed page — see
   *  PassportDiagnosisConfirmation. The export is the artefact that
   *  reaches a clinician, so it is the one place this state cannot be
   *  allowed to go missing. */
  confirmation: PassportDiagnosisConfirmation;
  /** Which rung of the five-state ladder the patient answered on the
   *  baseline form, or null for a profile written before the question
   *  existed. Distinct from `confirmation`, which is derived from
   *  uploaded reports only — the two answer different questions
   *  (「what did you tell us」 vs 「what does the evidence show」) and
   *  the passport shows both rather than reconciling them. */
  ladder: DiagnosisLadderState | null;
  ladderLabel: string | null;
  latestSourceDate: string | null;
  latestDocumentId: string | null;
  freshness: PassportFreshnessDTO;
  geneticType: string;
  d4z4Repeats: string;
  methylationValue: string;
  diagnosisDate: string;
  geneEvidence: string;
  /** The graded read of the genetic evidence, plus the 《检查申请说明》
   *  a patient can hand to a clinic. Always present — 未检测 and 未知
   *  are answers, not absences. */
  geneticEvidence: PassportGeneticEvidenceDTO;
}

export interface PassportMotorDTO {
  ready: boolean;
  average: string;
  latestMeasurementAt: string | null;
  latestActivityAt: string | null;
  summary: string;
  highlights: string[];
  bodyRegions: PassportBodyRegionMap;
  activitySummary: string;
}

export interface PassportImagingDTO {
  ready: boolean;
  latestMriDate: string | null;
  latestDocumentId: string | null;
  freshness: PassportFreshnessDTO;
  summary: string;
  highlights: string[];
  bodyRegions: PassportBodyRegionMap;
}

export interface PassportMonitoringItemDTO {
  key: 'blood' | 'respiratory' | 'cardiac';
  title: string;
  available: boolean;
  summary: string;
  latestDate: string | null;
  latestDocumentId: string | null;
  freshness: PassportFreshnessDTO;
  /**
   * Three states, because `available: false` collapsed two facts that
   * are not the same fact:
   *
   *   `present`    — structured values were read and are in `summary`.
   *   `unreadable` — a report of this class IS on file, but nothing
   *                  structured came out of it (bad scan, unknown
   *                  layout, OCR miss).
   *   `absent`     — nothing of this class has been uploaded.
   *
   * The distinction is load-bearing exactly once, and it is the highest
   * stakes surface in the product: the anesthesia card. Collapsing
   * `unreadable` into `absent` makes that card tell an anesthetist the
   * patient never had a pulmonary function test, about a patient who
   * uploaded one — and the pre-op PFT line is the only thing on that
   * card standing between an unassessed patient and general anesthesia.
   */
  state: 'present' | 'unreadable' | 'absent';
  /**
   * When a guideline says something about *whether* this test is
   * indicated, it goes here. The panel previously implied all three
   * slots were equally expected of everyone, which is how it ended up
   * asking asymptomatic patients for echocardiograms.
   */
  note?: string;
}

export interface PassportMonitoringDTO {
  ready: boolean;
  items: PassportMonitoringItemDTO[];
}

export interface PassportNextStepDTO {
  title: string;
  description: string;
  /**
   * `record` — something to upload or type in. Completes the passport.
   * `clinical` — something to raise with a doctor. Does not.
   *
   * These were one undifferentiated list rendered under 「如果想让临床
   * 护照更完整，可以优先补这些记录」, each with a warning triangle and a
   * 「去数据录入补齐」 button at the bottom. Adding a guideline
   * recommendation to that list turns 「问一次眼底检查」 into a
   * data-entry chore pointing at an upload form — the recommendation
   * survives the trip and its meaning does not.
   */
  kind: 'record' | 'clinical';
}

export interface PassportTimelineItemDTO {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  tag: '报告' | '肌力' | '活动';
  documentId?: string | null;
}

export interface ClinicalPassportSummaryDTO {
  generatedAt: string;
  passportId: string;
  patientName: string;
  hasRecordedData: boolean;
  latestUpdatedAt: string | null;
  completion: {
    completed: number;
    total: number;
  };
  metrics: PassportMetricDTO[];
  summaryCards: PassportSummaryCardDTO[];
  diagnosis: PassportDiagnosisDTO;
  motor: PassportMotorDTO;
  imaging: PassportImagingDTO;
  monitoring: PassportMonitoringDTO;
  nextSteps: PassportNextStepDTO[];
  timeline: PassportTimelineItemDTO[];
}

export interface ClinicalPassportExportDTO {
  generatedAt: string;
  documentTitle: string;
  fileName: string;
  contentType: 'text/markdown';
  markdown: string;
}

type ReportInsights = {
  /** The typed read of the latest genetic report. The four string
   *  fields below are the same values with 「—」 placeholders applied,
   *  kept because the passport and its markdown export render them
   *  directly. */
  geneticRecord: PassportGeneticRecordDTO;
  geneticType: string;
  haplotype: string;
  ecoRIFragment: string;
  d4z4Repeats: string;
  methylationValue: string;
  diagnosisDate: string;
  geneEvidence: string;
  latestGeneticDate: string | null;
  latestGeneticDocumentId: string | null;
  latestMriDate: string | null;
  latestMriDocumentId: string | null;
  mriSummary: string;
  latestBloodDate: string | null;
  latestBloodDocumentId: string | null;
  bloodSummary: string;
  latestRespiratoryDate: string | null;
  latestRespiratoryDocumentId: string | null;
  respiratorySummary: string;
  latestCardiacDate: string | null;
  latestCardiacDocumentId: string | null;
  cardiacSummary: string;
  strengthAverage: string;
  strengthSummary: string;
};

const BODY_REGION_LABELS: Record<BodyRegionId, string> = {
  face: '面肌',
  leftShoulder: '左肩带',
  rightShoulder: '右肩带',
  leftUpperArmFront: '左上臂前群',
  rightUpperArmFront: '右上臂前群',
  leftUpperArmBack: '左上臂后群',
  rightUpperArmBack: '右上臂后群',
  leftTorso: '左躯干侧',
  rightTorso: '右躯干侧',
  leftGlute: '左臀肌',
  rightGlute: '右臀肌',
  leftThighFront: '左大腿前群',
  rightThighFront: '右大腿前群',
  leftThighBack: '左大腿后群',
  rightThighBack: '右大腿后群',
  leftShin: '左小腿前群',
  rightShin: '右小腿前群',
  leftCalf: '左小腿后群',
  rightCalf: '右小腿后群',
};

const documentLabels: Record<string, string> = {
  mri: 'MRI 报告',
  muscle_mri: 'MRI 报告',
  genetic_report: '基因报告',
  medical_summary: '病历摘要',
  physical_exam: '肌力/体格检查',
  pulmonary_function: '肺功能报告',
  diaphragm_ultrasound: '膈肌超声',
  ecg: '心电图',
  echocardiography: '心脏超声',
  biochemistry: '生化报告',
  muscle_enzyme: '肌酶报告',
  blood_routine: '血常规',
  thyroid_function: '甲功报告',
  coagulation: '凝血报告',
  urinalysis: '尿常规',
  infection_screening: '感染筛查',
  stool_test: '粪便/幽门检测',
  abdominal_ultrasound: '腹部超声',
  blood_panel: '血检报告',
  other: '医学报告',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getTimestamp = (value?: string | null) => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const formatDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const trimmed = value.trim();
    return trimmed || null;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDateLabel = (value?: string | null) => {
  const formatted = formatDate(value);
  if (!formatted) return '—';
  const date = new Date(formatted);
  if (Number.isNaN(date.getTime())) return formatted;
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const compactText = (value?: string | null, fallback = '暂无摘要', limit = 88) => {
  const text = value?.trim();
  if (!text) return fallback;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

const hasMeaningfulValue = (value?: string | null) => {
  const text = value?.trim();
  if (!text || text === '—') return false;
  if (text.startsWith('暂无')) return false;
  return true;
};

const toPayload = (value: unknown): OcrPayloadLike => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as OcrPayloadLike;
};

const getPayloadText = (payload: OcrPayloadLike) => {
  if (!payload) return '';
  return `${JSON.stringify(payload.fields ?? {})} ${
    typeof payload.extractedText === 'string'
      ? payload.extractedText
      : typeof payload.extracted_text === 'string'
        ? payload.extracted_text
        : ''
  }`.toLowerCase();
};

const pickField = (fields: Record<string, unknown> | undefined, keys: string[]) => {
  if (!fields) return undefined;
  for (const key of keys) {
    const value = fields[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
};

const latestDoc = (
  documents: PatientDocumentDTO[],
  predicate: (document: PatientDocumentDTO) => boolean,
) => {
  const matches = documents.filter(predicate);
  if (matches.length === 0) return null;
  return matches.sort((a, b) => getTimestamp(b.uploadedAt) - getTimestamp(a.uploadedAt))[0] ?? null;
};

const getDocumentType = (document: PatientDocumentDTO) => {
  const payload = toPayload(document.ocrPayload);
  return (
    pickField(payload?.fields, [
      'classifiedType',
      'classified_type',
      'reportType',
      'report_type',
    ]) || document.documentType
  );
};

const getDocumentDisplayTitle = (document: PatientDocumentDTO) => {
  const payload = toPayload(document.ocrPayload);
  const reportTypeLabel = pickField(payload?.fields, ['reportTypeLabel', 'report_type_label']);
  if (reportTypeLabel) {
    return reportTypeLabel;
  }

  const classifiedType = getDocumentType(document);
  if (documentLabels[classifiedType]) {
    return documentLabels[classifiedType];
  }

  const manualTitle = document.title?.trim();
  if (manualTitle) {
    return manualTitle;
  }

  return documentLabels[document.documentType] ?? '临床报告';
};

const latestDocByType = (documents: PatientDocumentDTO[], type: string) =>
  latestDoc(documents, (document) => getDocumentType(document) === type);

const filterDocsByTypes = (documents: PatientDocumentDTO[], types: string[]) =>
  documents
    .filter((document) => types.includes(getDocumentType(document)))
    .sort((a, b) => getTimestamp(b.uploadedAt) - getTimestamp(a.uploadedAt));

const latestDocByTypes = (documents: PatientDocumentDTO[], types: string[]) =>
  latestDoc(documents, (document) => types.includes(getDocumentType(document)));

const filterDocsContainingText = (documents: PatientDocumentDTO[], patterns: string[]) =>
  documents
    .filter((document) => {
      const text = getPayloadText(toPayload(document.ocrPayload));
      return patterns.some((pattern) => text.includes(pattern.toLowerCase()));
    })
    .sort((a, b) => getTimestamp(b.uploadedAt) - getTimestamp(a.uploadedAt));

const latestDocContainingText = (documents: PatientDocumentDTO[], patterns: string[]) =>
  latestDoc(documents, (document) => {
    const text = getPayloadText(toPayload(document.ocrPayload));
    return patterns.some((pattern) => text.includes(pattern.toLowerCase()));
  });

const latestDocWithFields = (documents: PatientDocumentDTO[], keys: string[]) =>
  latestDoc(documents, (document) => {
    const payload = toPayload(document.ocrPayload);
    return Boolean(pickField(payload?.fields, keys));
  });

const parseScore = (value: string) => {
  const match = value.match(/(\d+(?:\.\d+)?)(\+|-)?/);
  if (!match) return null;
  const base = Number(match[1]);
  if (Number.isNaN(base)) return null;
  const modifier = match[2] === '+' ? 0.3 : match[2] === '-' ? -0.3 : 0;
  return clamp(base + modifier, 0, 5);
};

const buildStrengthSummary = (fields?: Record<string, unknown>) => {
  const entries = [
    { label: '三角肌', key: 'deltoidStrength', alt: 'deltoid_strength' },
    { label: '肱二头肌', key: 'bicepsStrength', alt: 'biceps_strength' },
    { label: '肱三头肌', key: 'tricepsStrength', alt: 'triceps_strength' },
    { label: '股四头肌', key: 'quadricepsStrength', alt: 'quadriceps_strength' },
    { label: '胫前肌', key: 'tibialisStrength', alt: 'tibialis_strength' },
  ];

  const parts: string[] = [];
  const scores: number[] = [];

  entries.forEach((entry) => {
    const value = pickField(fields, [entry.key, entry.alt]);
    if (!value) return;
    parts.push(`${entry.label}${value}`);
    const score = parseScore(value);
    if (score !== null) {
      scores.push(score);
    }
  });

  const average =
    scores.length > 0
      ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1))
      : null;

  return {
    summary: parts.join('，') || null,
    average,
  };
};

/**
 * What a monitoring slot says when OCR produced no structured field.
 *
 * These three slots used to fall back to `compactText(extractedText)` —
 * the first 88 characters of whatever OCR read off the page. On a failed
 * parse that is the hospital letterhead, and it does not stay inert:
 * `hasMeaningfulValue` sees a non-empty string, `buildMonitoringItem`
 * marks the slot `available`, and 「最近肺功能」 on the anesthesia card
 * handed to an anesthetist reads 「××市第一人民医院 检验科 报告单 …」.
 * That line is the only thing on that card standing between an
 * unassessed patient and general anesthesia, and letterhead in it is
 * indistinguishable from a result at a glance.
 *
 * Every string here starts with 暂无 on purpose: `hasMeaningfulValue`
 * treats that prefix as「nothing here」, which is what holds the slot at
 * `available: false` and the anesthesia card at 未做过或未上传. Changing
 * the prefix silently re-opens the hole — see the tests in
 * profile.passport.monitoring.test.ts.
 *
 * The wording says 「无法自动读取」 rather than 「没做过」 because the
 * document may well exist; what is missing is a machine-readable value.
 */
const NO_STRUCTURED_RESULT = {
  blood: '暂无可自动读取的血检结果',
  respiratory: '暂无可自动读取的肺功能结果',
  cardiac: '暂无可自动读取的心脏检查结果',
} as const;

const MRI_TEXT_PATTERNS = ['mri', '脂肪浸润', '前锯', 'hamstring', '臀肌', '胫前'];

const collectMriDocuments = (documents: PatientDocumentDTO[]) => {
  const byId = new Map<string, PatientDocumentDTO>();
  [
    ...filterDocsByTypes(documents, ['muscle_mri', 'mri']),
    ...filterDocsContainingText(documents, MRI_TEXT_PATTERNS),
  ].forEach((document) => {
    byId.set(document.id, document);
  });

  return [...byId.values()].sort((a, b) => getTimestamp(b.uploadedAt) - getTimestamp(a.uploadedAt));
};

const buildReportInsights = (profile: PatientProfileDTO): ReportInsights => {
  const documents = profile.documents;
  const latestGenetic = latestDocByType(documents, 'genetic_report');
  const latestMri = collectMriDocuments(documents)[0] ?? null;
  const latestBlood = latestDocByTypes(documents, [
    'blood_panel',
    'biochemistry',
    'muscle_enzyme',
    'blood_routine',
    'thyroid_function',
    'coagulation',
    'urinalysis',
    'infection_screening',
    'stool_test',
    'abdominal_ultrasound',
  ]);
  const latestPhysicalExam = latestDocByType(documents, 'physical_exam');

  const fallbackGenetic = latestDocWithFields(documents, GENETIC_EVIDENCE_KEYS);

  const geneticDoc = latestGenetic ?? fallbackGenetic;
  const geneticPayload = toPayload(geneticDoc?.ocrPayload);
  const geneticFields = geneticPayload?.fields;
  // One reader for the whole genetic block. The four values below used
  // to be plucked by four inline key lists that had drifted apart from
  // each other and from the writers; they now all come off the same
  // typed record, so「the passport says X」and「the grader says X」cannot
  // disagree. `geneticRecord` keeps `null` where the report is silent;
  // the placeholders are re-applied here because the string fields are
  // rendered directly and have always shown 「—」.
  const geneticRecord = buildGeneticRecord(geneticFields, geneticDoc?.id ?? null);
  const geneticType = geneticRecord.geneticType || profile.geneticMutation || '—';
  const haplotype = geneticRecord.haplotype || '—';
  const ecoRIFragment = geneticRecord.ecoRIFragment || '—';
  const d4z4Repeats = geneticRecord.d4z4?.raw || '—';
  const methylationValue = geneticRecord.methylationValue || '—';
  const diagnosisDate =
    formatDate(profile.diagnosisDate) ||
    formatDate(pickField(geneticFields, ['diagnosisDate', 'diagnosis_date'])) ||
    '—';

  const mriDoc = latestMri;
  const mriPayload = toPayload(mriDoc?.ocrPayload);
  const mriFields = mriPayload?.fields;
  const mriGrade = pickField(mriFields, ['serratusFatigueGrade', 'serratus_fatigue_grade']);
  const mriImpression = pickField(mriFields, [
    'reportImpression',
    'report_impression',
    'impressionText',
    'impression_text',
  ]);
  const mriFinding = pickField(mriFields, ['findingText', 'finding_text']);
  const mriReportTime = pickField(mriFields, ['reportTime', 'report_time']);
  const mriSummary = mriGrade
    ? `前锯肌脂肪化等级 ${mriGrade}`
    : compactText(
        mriImpression ??
          mriFinding ??
          (typeof mriPayload?.extractedText === 'string'
            ? mriPayload.extractedText
            : typeof mriPayload?.extracted_text === 'string'
              ? mriPayload.extracted_text
              : ''),
        '暂无 MRI 分析数据',
      );

  const bloodDoc =
    latestBlood || latestDocContainingText(documents, ['ck', '肌酸激酶', 'ldh', 'mb', 'ckmb']);
  const bloodPayload = toPayload(bloodDoc?.ocrPayload);
  const bloodFields = bloodPayload?.fields;
  const bloodReportTime = pickField(bloodFields, ['reportTime', 'report_time']);
  const creatineKinase = pickField(bloodFields, ['creatineKinase', 'creatine_kinase', 'CK', 'ck']);
  const myoglobin = pickField(bloodFields, ['myoglobin', 'Mb', 'mb']);
  const ldh = pickField(bloodFields, ['LDH', 'ldh']);
  const ckmb = pickField(bloodFields, ['CKMB', 'ckmb']);
  const creatinine = pickField(bloodFields, ['creatinine']);
  const uricAcid = pickField(bloodFields, ['uricAcid', 'uric_acid']);
  const bloodParts: string[] = [];
  if (creatineKinase) bloodParts.push(`CK ${creatineKinase}`);
  if (myoglobin) bloodParts.push(`Mb ${myoglobin}`);
  if (ldh) bloodParts.push(`LDH ${ldh}`);
  if (ckmb) bloodParts.push(`CKMB ${ckmb}`);
  if (creatinine) bloodParts.push(`Cr ${creatinine}`);
  if (uricAcid) bloodParts.push(`UA ${uricAcid}`);
  const bloodSummary = bloodParts.join('，') || NO_STRUCTURED_RESULT.blood;

  const respiratoryDoc =
    latestDocByTypes(documents, ['pulmonary_function', 'diaphragm_ultrasound']) ||
    latestDocContainingText(documents, ['fvc', 'fev1', 'tlc', 'dlco', '肺功能', '膈肌']);
  const respiratoryPayload = toPayload(respiratoryDoc?.ocrPayload);
  const respiratoryFields = respiratoryPayload?.fields;
  const respiratoryReportTime = pickField(respiratoryFields, ['reportTime', 'report_time']);
  const respiratoryMetrics = [
    pickField(respiratoryFields, ['ventilatoryPattern', 'ventilatory_pattern']),
    pickField(respiratoryFields, ['fvcPredPct', 'fvc_pred_pct']),
    pickField(respiratoryFields, ['tlcPredPct', 'tlc_pred_pct']),
    pickField(respiratoryFields, ['dlcoPredPct', 'dlco_pred_pct']),
    pickField(respiratoryFields, ['diaphragmMotionSummary', 'diaphragm_motion_summary']),
  ].filter(Boolean) as string[];
  const respiratorySummary =
    respiratoryMetrics.length > 0
      ? respiratoryMetrics.join(' / ')
      : NO_STRUCTURED_RESULT.respiratory;

  const cardiacDoc =
    latestDocByTypes(documents, ['ecg', 'echocardiography']) ||
    latestDocContainingText(documents, ['ecg', 'echo', 'lvef', 'qtc', 'qrs', '心电', '超声心动']);
  const cardiacPayload = toPayload(cardiacDoc?.ocrPayload);
  const cardiacFields = cardiacPayload?.fields;
  const cardiacReportTime = pickField(cardiacFields, ['reportTime', 'report_time']);
  const cardiacMetrics = [
    pickField(cardiacFields, ['ecgSummary', 'ecg_summary']),
    pickField(cardiacFields, ['echoSummary', 'echo_summary']),
    pickField(cardiacFields, ['LVEF', 'lvef']),
    pickField(cardiacFields, ['QTc', 'qtc', 'qtcMs', 'qtc_ms']),
  ].filter(Boolean) as string[];
  const cardiacSummary =
    cardiacMetrics.length > 0 ? cardiacMetrics.join(' / ') : NO_STRUCTURED_RESULT.cardiac;

  const strengthDoc =
    latestPhysicalExam ||
    latestDocWithFields(documents, [
      'deltoidStrength',
      'bicepsStrength',
      'tricepsStrength',
      'quadricepsStrength',
      'tibialisStrength',
      'deltoid_strength',
      'biceps_strength',
      'triceps_strength',
      'quadriceps_strength',
      'tibialis_strength',
    ]);
  const strengthPayload = toPayload(strengthDoc?.ocrPayload);
  const strengthSummary = buildStrengthSummary(strengthPayload?.fields);

  const geneEvidence = [geneticType, haplotype, ecoRIFragment, d4z4Repeats]
    .filter((value) => value && value !== '—')
    .join(' · ');

  return {
    geneticRecord,
    geneticType,
    haplotype,
    ecoRIFragment,
    d4z4Repeats,
    methylationValue,
    diagnosisDate,
    geneEvidence: geneEvidence || '暂无可直接展示的基因证据',
    latestGeneticDate: formatDate(geneticDoc?.uploadedAt ?? null),
    latestGeneticDocumentId: geneticDoc?.id ?? null,
    latestMriDate: formatDate(mriReportTime ?? mriDoc?.uploadedAt ?? null),
    latestMriDocumentId: mriDoc?.id ?? null,
    mriSummary,
    latestBloodDate: formatDate(bloodReportTime ?? bloodDoc?.uploadedAt ?? null),
    latestBloodDocumentId: bloodDoc?.id ?? null,
    bloodSummary,
    latestRespiratoryDate: formatDate(respiratoryReportTime ?? respiratoryDoc?.uploadedAt ?? null),
    latestRespiratoryDocumentId: respiratoryDoc?.id ?? null,
    respiratorySummary,
    latestCardiacDate: formatDate(cardiacReportTime ?? cardiacDoc?.uploadedAt ?? null),
    latestCardiacDocumentId: cardiacDoc?.id ?? null,
    cardiacSummary,
    strengthAverage: strengthSummary.average !== null ? strengthSummary.average.toFixed(1) : '—',
    strengthSummary: strengthSummary.summary ?? '暂无可用的肌力评估摘要',
  };
};

const scoreToWeaknessIntensity = (score: number | null) => {
  if (score === null) return 0;
  if (score >= 4.8) return 0;
  if (score >= 4) return 1;
  if (score >= 3) return 2;
  if (score >= 2) return 3;
  return 4;
};

const pushRegion = (
  regions: PassportBodyRegionMap,
  regionId: BodyRegionId,
  intensity: number,
  label?: string,
) => {
  const next = clamp(Math.round(intensity), 0, 4);
  if (next <= 0) return;
  const existing = regions[regionId];
  if (!existing || next > existing.intensity) {
    regions[regionId] = {
      intensity: next,
      label: label ?? BODY_REGION_LABELS[regionId],
    };
  }
};

const applyStrengthGroup = (
  regions: PassportBodyRegionMap,
  muscleGroup: string,
  intensity: number,
) => {
  if (intensity <= 0) return;
  switch (muscleGroup) {
    case 'deltoid':
      pushRegion(regions, 'leftShoulder', intensity, '肩带');
      pushRegion(regions, 'rightShoulder', intensity, '肩带');
      break;
    case 'biceps':
      pushRegion(regions, 'leftUpperArmFront', intensity, '上臂前群');
      pushRegion(regions, 'rightUpperArmFront', intensity, '上臂前群');
      break;
    case 'triceps':
      pushRegion(regions, 'leftUpperArmBack', intensity, '上臂后群');
      pushRegion(regions, 'rightUpperArmBack', intensity, '上臂后群');
      break;
    case 'quadriceps':
      pushRegion(regions, 'leftThighFront', intensity, '大腿前群');
      pushRegion(regions, 'rightThighFront', intensity, '大腿前群');
      break;
    case 'hamstrings':
      pushRegion(regions, 'leftThighBack', intensity, '大腿后群');
      pushRegion(regions, 'rightThighBack', intensity, '大腿后群');
      break;
    case 'gluteus':
      pushRegion(regions, 'leftGlute', intensity, '臀肌');
      pushRegion(regions, 'rightGlute', intensity, '臀肌');
      break;
    case 'tibialis':
      pushRegion(regions, 'leftShin', intensity, '小腿前群');
      pushRegion(regions, 'rightShin', intensity, '小腿前群');
      break;
    default:
      break;
  }
};

const pickLatestMeasurementsByGroup = (measurements: PatientProfileDTO['measurements']) => {
  const latest: Record<string, PatientProfileDTO['measurements'][number]> = {};
  measurements.forEach((measurement) => {
    const previous = latest[measurement.muscleGroup];
    if (!previous || getTimestamp(measurement.recordedAt) >= getTimestamp(previous.recordedAt)) {
      latest[measurement.muscleGroup] = measurement;
    }
  });
  return latest;
};

const buildBodyMapFromMeasurements = (measurements: PatientProfileDTO['measurements']) => {
  const latest = pickLatestMeasurementsByGroup(measurements);
  const regions: PassportBodyRegionMap = {};

  Object.entries(latest).forEach(([group, item]) => {
    const score = parseScore(String(item.strengthScore));
    applyStrengthGroup(regions, group, scoreToWeaknessIntensity(score));
  });

  return regions;
};

const textContains = (text: string, patterns: string[]) =>
  patterns.some((pattern) => text.includes(pattern));

const inferLateralityIntensity = (
  text: string,
  leftPatterns: string[],
  rightPatterns: string[],
) => {
  const hasLeft = textContains(text, leftPatterns);
  const hasRight = textContains(text, rightPatterns);
  if (hasLeft && hasRight) return { left: 3, right: 3 };
  if (hasLeft) return { left: 4, right: 2 };
  if (hasRight) return { left: 2, right: 4 };
  return { left: 3, right: 3 };
};

const inferMriBodyMap = (payload: OcrPayloadLike) => {
  const text = getPayloadText(payload);
  const regions: PassportBodyRegionMap = {};
  const findings: string[] = [];

  if (textContains(text, ['前锯', 'serratus'])) {
    pushRegion(regions, 'leftShoulder', 3, '肩带');
    pushRegion(regions, 'rightShoulder', 3, '肩带');
    findings.push('肩带/前锯肌受累');
  }

  if (textContains(text, ['臀', 'glute'])) {
    const laterality = inferLateralityIntensity(
      text,
      ['左臀', 'left glute', 'left buttock'],
      ['右臀', 'right glute', 'right buttock'],
    );
    pushRegion(regions, 'leftGlute', laterality.left, '臀肌');
    pushRegion(regions, 'rightGlute', laterality.right, '臀肌');
    findings.push('臀肌受累');
  }

  if (textContains(text, ['大腿后', '腘绳', 'hamstring'])) {
    const laterality = inferLateralityIntensity(
      text,
      ['左大腿后', '左腘绳', 'left hamstring'],
      ['右大腿后', '右腘绳', 'right hamstring'],
    );
    pushRegion(regions, 'leftThighBack', laterality.left, '大腿后群');
    pushRegion(regions, 'rightThighBack', laterality.right, '大腿后群');
    findings.push('大腿后群受累');
  }

  if (textContains(text, ['股四头', '大腿前', 'quadriceps'])) {
    pushRegion(regions, 'leftThighFront', 3, '大腿前群');
    pushRegion(regions, 'rightThighFront', 3, '大腿前群');
    findings.push('大腿前群受累');
  }

  if (textContains(text, ['胫前', 'tibialis', '趾长伸', 'extensor'])) {
    const laterality = inferLateralityIntensity(
      text,
      ['左胫前', 'left tibialis', '左小腿前'],
      ['右胫前', 'right tibialis', '右小腿前'],
    );
    pushRegion(regions, 'leftShin', laterality.left, '小腿前群');
    pushRegion(regions, 'rightShin', laterality.right, '小腿前群');
    findings.push('小腿前群受累');
  }

  if (textContains(text, ['腓肠', '比目鱼', 'gastrocnemius', 'soleus', '小腿后'])) {
    const laterality = inferLateralityIntensity(
      text,
      ['左腓肠', 'left gastrocnemius', '左小腿后'],
      ['右腓肠', 'right gastrocnemius', '右小腿后'],
    );
    pushRegion(regions, 'leftCalf', laterality.left, '小腿后群');
    pushRegion(regions, 'rightCalf', laterality.right, '小腿后群');
    findings.push('小腿后群受累');
  }

  if (textContains(text, ['面肌', '口轮匝肌', 'facial'])) {
    pushRegion(regions, 'face', 2, '面肌');
    findings.push('面肌受累');
  }

  return {
    regions,
    findings,
    hasFindings: Object.keys(regions).length > 0,
  };
};

const mergeBodyRegionMaps = (
  base: PassportBodyRegionMap,
  incoming: PassportBodyRegionMap,
): PassportBodyRegionMap => {
  const next = { ...base };

  Object.entries(incoming).forEach(([regionId, datum]) => {
    if (!datum) {
      return;
    }

    const key = regionId as BodyRegionId;
    const existing = next[key];
    if (!existing || datum.intensity > existing.intensity) {
      next[key] = datum;
    }
  });

  return next;
};

const buildAggregateMriBodyMap = (documents: PatientDocumentDTO[]) => {
  let regions: PassportBodyRegionMap = {};
  const findings = new Set<string>();

  documents.forEach((document) => {
    const inferred = inferMriBodyMap(toPayload(document.ocrPayload));
    regions = mergeBodyRegionMaps(regions, inferred.regions);
    inferred.findings.forEach((item) => findings.add(item));
  });

  return {
    regions,
    findings: [...findings],
    hasFindings: Object.keys(regions).length > 0,
  };
};

const summarizeBodyRegions = (regions: PassportBodyRegionMap, limit = 4) =>
  Object.values(regions)
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, limit)
    .map((item) => item.label ?? '受累区域');

const getFreshness = (value?: string | null): PassportFreshnessDTO => {
  const date = formatDate(value);
  if (!date) {
    return { label: '缺失', tone: 'neutral', date: null, daysSince: null };
  }

  const timestamp = getTimestamp(date);
  if (!timestamp) {
    return { label: '未知', tone: 'neutral', date, daysSince: null };
  }

  const daysSince = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
  if (daysSince <= 90) {
    return { label: '最新', tone: 'success', date, daysSince };
  }
  if (daysSince <= 180) {
    return { label: '待更新', tone: 'warning', date, daysSince };
  }
  return { label: '过期', tone: 'danger', date, daysSince };
};

const buildMonitoringItem = (input: {
  key: 'blood' | 'respiratory' | 'cardiac';
  title: string;
  summary: string;
  latestDate: string | null;
  latestDocumentId: string | null;
  note?: string;
}): PassportMonitoringItemDTO => {
  const available = hasMeaningfulValue(input.summary);
  // A document id is set whenever a report of this class was found,
  // whether or not the parser got anything structured out of it — so
  //「有 id、没有值」 is precisely「上传了，读不出来」. Derived here rather
  // than left for each consumer to infer, because the one consumer that
  // gets it wrong prints the answer on a card handed to an anesthetist.
  const state: PassportMonitoringItemDTO['state'] = available
    ? 'present'
    : input.latestDocumentId
      ? 'unreadable'
      : 'absent';
  return {
    key: input.key,
    title: input.title,
    available,
    summary: input.summary,
    latestDate: input.latestDate,
    latestDocumentId: input.latestDocumentId,
    freshness: getFreshness(input.latestDate),
    state,
    ...(input.note ? { note: input.note } : {}),
  };
};

const buildTimeline = (
  profile: PatientProfileDTO,
  latestMeasurementsByGroup: Record<string, PatientProfileDTO['measurements'][number]>,
  strengthAverage: string,
) => {
  const items: Array<{ sortKey: number; value: PassportTimelineItemDTO }> = [];

  profile.documents.forEach((document) => {
    const payload = toPayload(document.ocrPayload);
    items.push({
      sortKey: getTimestamp(document.uploadedAt),
      value: {
        id: `doc-${document.id}`,
        title: getDocumentDisplayTitle(document),
        description: compactText(
          typeof payload?.extractedText === 'string'
            ? payload.extractedText
            : typeof payload?.extracted_text === 'string'
              ? payload.extracted_text
              : document.fileName,
          '已上传报告',
          96,
        ),
        timestamp: document.uploadedAt,
        tag: '报告',
        documentId: document.id,
      },
    });
  });

  const latestMeasurementAt = Object.values(latestMeasurementsByGroup).reduce(
    (max, item) => Math.max(max, getTimestamp(item.recordedAt)),
    0,
  );
  if (latestMeasurementAt > 0) {
    items.push({
      sortKey: latestMeasurementAt,
      value: {
        id: 'measurement-latest',
        title: '肌力更新',
        description: `共 ${Object.keys(latestMeasurementsByGroup).length} 组，平均 ${strengthAverage} 级`,
        timestamp: new Date(latestMeasurementAt).toISOString(),
        tag: '肌力',
      },
    });
  }

  const latestActivity = [...profile.activityLogs].sort(
    (a, b) => getTimestamp(b.logDate) - getTimestamp(a.logDate),
  )[0] as PatientActivityLogDTO | undefined;
  if (latestActivity) {
    items.push({
      sortKey: getTimestamp(latestActivity.logDate),
      value: {
        id: `activity-${latestActivity.id}`,
        title: '最近活动记录',
        description: compactText(latestActivity.content, '已记录活动日志', 96),
        timestamp: latestActivity.logDate,
        tag: '活动',
      },
    });
  }

  return items
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, 6)
    .map((item) => item.value);
};

/** The unit a report printed its D4Z4 measurement in. `null` means the
 *  report printed a bare number and said nothing — which is the common
 *  case, and is NOT the same as knowing it meant repeat units. */
export type D4Z4Unit = 'repeats' | 'kb';

/**
 * What a D4Z4 measurement OCR'd off a genetics report actually says.
 *
 * `value` is non-null only for a single unambiguous number. Everything
 * else a real report prints —「1-10」,「≤10」,「4~7」,「1 至 10」,「未检出」—
 * lands as `value: null`, with `isRange` recording *why* so a caller can
 * tell「the lab gave an interval」apart from「there was nothing to read」.
 * That distinction is the whole reason this returns a record rather than
 * a number: an interval is a real, reportable finding that happens not
 * to pin down a count, and collapsing it to null loses the fact that a
 * test was done at all.
 */
export interface D4Z4Reading {
  raw: string;
  value: number | null;
  isRange: boolean;
  unit: D4Z4Unit | null;
}

export const parseD4Z4Reading = (raw: string | null | undefined): D4Z4Reading => {
  const text = (raw ?? '').trim();
  if (!text || text === '—') {
    return { raw: text, value: null, isRange: false, unit: null };
  }

  // Stated unit only. A bare「3」stays `null` rather than being assumed
  // to mean repeats: the two units differ by a factor of ~3.3 and the
  // guideline gives its thresholds in both, so guessing here would put
  // a wrong number in front of a clinician.
  const unit: D4Z4Unit | null = /kb|千碱基|kilobase/i.test(text)
    ? 'kb'
    : /个|重复|单元|unit|repeat/i.test(text)
      ? 'repeats'
      : null;

  // A comparison operator or a dash/CJK range word means the lab gave a
  // bound, not a count. Two numbers in the string mean the same thing
  //（「1-10」uses a plain hyphen, which is not in the operator class）.
  const bounded = /[<>≤≥~]|--|–|—|~|至|到/.test(text);
  const numbers = text.match(/\d+(?:\.\d+)?/g);
  if (bounded || (numbers?.length ?? 0) > 1) {
    return { raw: text, value: null, isRange: true, unit };
  }
  if (!numbers || numbers.length !== 1) {
    return { raw: text, value: null, isRange: false, unit };
  }
  const value = Number(numbers[0]);
  return { raw: text, value: Number.isFinite(value) ? value : null, isRange: false, unit };
};

/**
 * True only when the D4Z4 repeat count is unambiguously in the range the
 * AAN/AANEM guideline calls a large deletion.
 *
 * The guideline supplies both the size and its repeat equivalent in one
 * sentence — 「contracted D4Z4 allele of 10–20 kb or 1–4 repeats」 — so
 * the threshold here is quoted, not converted by us.
 *
 * The input is OCR'd off a genetics report, so it arrives as free text:
 *「3」,「3个」,「1-10」,「≤10」. A range or a comparison operator means we
 * do not know the number, and this gates a recommendation to go see an
 * ophthalmologist — so anything short of a single plain integer is
 * treated as unknown rather than guessed at.
 *
 * NOTE ON `unit`: this deliberately ignores it, so that the behaviour is
 * bit-for-bit what it was before `parseD4Z4Reading` existed. There is a
 * hand-kept copy of this function in the mobile bundle
 * (apps/mobile/lib/surveillance-schedule.ts) that cannot import from the
 * API package and is checked against the same table of cases; nothing in
 * the build links the two, so a semantic change here silently makes the
 * app and the passport disagree about whether to send someone to an
 * ophthalmologist. Requiring `unit !== 'kb'` would be defensible — 1–4
 * kb is not a viable EcoRI fragment — but it belongs in one change that
 * touches both copies, not this one.
 */
export const isLargeD4Z4Deletion = (raw: string): boolean => {
  const { value } = parseD4Z4Reading(raw);
  // 0 repeats is not a viable FSHD1 allele; reading one means the
  // extraction is wrong, not that the deletion is enormous.
  return value !== null && Number.isInteger(value) && value >= 1 && value <= 4;
};

/**
 * The 8–10 unit gray zone.
 *
 * Giardina et al. 2024 names this range and says what to do with it:
 * 8–10 U 4qA arrays are carried by roughly 1%–2% of the European
 * control population with no signs and no family history, so「a 4qA
 * repeat array of 8 U should be reported as likely pathogenic」rather
 * than pathogenic. A patient whose number lands here has a result that
 * carries its own uncertainty, and the product's job is to say so
 * instead of letting them read it as a verdict.
 *
 * Gated on `unit !== 'kb'` because the range is stated in repeat units.
 * An 8–10 kb EcoRI fragment is a different measurement entirely (a
 * severe contraction, not a borderline one) and must not be flagged as
 * borderline.
 */
export const isD4Z4GreyZone = (reading: D4Z4Reading | null): boolean =>
  reading !== null &&
  reading.value !== null &&
  Number.isInteger(reading.value) &&
  reading.unit !== 'kb' &&
  reading.value >= 8 &&
  reading.value <= 10;

/* ------------------------------------------------------------------- *
 * The structured genetic record, and the grade that comes out of it.
 * ------------------------------------------------------------------- */

/**
 * Every OCR key any writer in this pipeline has ever produced for a
 * genetic value, in the order they are preferred, with the writer named.
 *
 * These lists used to sit inline in `buildReportInsights` as four
 * anonymous string arrays, and the file had no record of where any of
 * the keys came from — so nobody could add one, drop one, or say which
 * of them a given report would actually carry. Collected here because
 * the answer differs per key and is knowable:
 *
 *   `d4z4Repeats`, `haplotype`, `methylationValue`, `diagnosisType`
 *     — written by apps/api/src/services/ocr/embedded-report-ocr.ts from
 *       `normalized_summary.genetic_summary`, AND the four keys a patient
 *       may hand-correct (EDITABLE_OCR_FIELDS in profile.schema.ts).
 *       Hand-correction is why these come FIRST: a patient who fixed a
 *       misread digit must see their own number, not the OCR's.
 *   `d4z4RepeatPathogenic` / `d4z4_repeat_pathogenic`,
 *   `ecoriFragmentKb` / `ecori_fragment_kb`, `methylation_value`
 *     — the same bridge copies every Python `structured_fields` entry in
 *       under both its snake_case name and its camelCase form.
 *   `ecoRIFragment`
 *     — bridge-only alias, built as `${kb}kb` from the summary.
 *   `haplotype4q`, `haplotype_4q`, `EcoRI_kb`, `EcoRIFragment`,
 *   `ecoriFragment`, `d4z4_repeats`, `geneticType`, `geneType`,
 *   `genetic_type`
 *     — LEGACY. No writer in the current pipeline emits these; they are
 *       kept because payloads written by earlier extraction paths are
 *       still on disk and dropping a key silently blanks a real
 *       patient's evidence. Do not add to this group.
 */
const GENETIC_FIELD_KEYS = {
  geneticType: ['diagnosisType', 'geneticType', 'geneType', 'diagnosis_type', 'genetic_type'],
  haplotype: ['haplotype', 'haplotype4q', 'haplotype_4q'],
  ecoRIFragment: [
    'ecoRIFragment',
    'ecoriFragment',
    'ecoriFragmentKb',
    'ecori_fragment_kb',
    'EcoRI_kb',
    'EcoRIFragment',
  ],
  d4z4Repeats: ['d4z4Repeats', 'd4z4RepeatPathogenic', 'd4z4_repeat_pathogenic', 'd4z4_repeats'],
  methylationValue: ['methylationValue', 'methylation_value'],
  testMethod: ['geneticTestMethod', 'genetic_test_method'],
} as const;

/** Union of every genetic key, used to decide whether a document with no
 *  `classifiedType: genetic_report` still carries genetic evidence. */
const GENETIC_EVIDENCE_KEYS: string[] = [
  ...GENETIC_FIELD_KEYS.geneticType,
  ...GENETIC_FIELD_KEYS.haplotype,
  ...GENETIC_FIELD_KEYS.ecoRIFragment,
  ...GENETIC_FIELD_KEYS.d4z4Repeats,
];

/**
 * How the D4Z4 array was measured.
 *
 * Written by the report parser (`genetic_test_method` in
 * apps/report-manager/app/services/fshd_report_service.py), never
 * inferred here. The parser matches explicit method names in the body of
 * the report with its boilerplate tail already cut off, and emits
 * `ambiguous` when more than one family of markers hits — which lands in
 * `unknown` below, along with every value this file does not recognise
 * and every report parsed before the field existed.
 *
 * There is no text-scanning fallback in this file ON PURPOSE. A WES
 * report's limitations section routinely says the D4Z4 array needs
 * Southern blot, and a Southern blot report routinely names sequencing
 * as an alternative, so a keyword search over the whole payload
 * mislabels both — and the direction that matters is exactly the one it
 * would get wrong. 未知 is the honest answer for an unparsed report.
 */
export type GeneticTestMethod =
  | 'southern_blot'
  | 'optical_genome_mapping'
  | 'molecular_combing'
  | 'short_read_sequencing'
  | 'unknown';

const KNOWN_GENETIC_TEST_METHODS: ReadonlySet<string> = new Set([
  'southern_blot',
  'optical_genome_mapping',
  'molecular_combing',
  'short_read_sequencing',
]);

/** Methods that can size the repeat array at all. Giardina 2024 §6:
 *  「Analysis of long fragments can be by SB-PFGE …, OGM or MC.」 */
const SIZING_METHODS: ReadonlySet<GeneticTestMethod> = new Set<GeneticTestMethod>([
  'southern_blot',
  'optical_genome_mapping',
  'molecular_combing',
]);

export interface PassportGeneticRecordDTO {
  /** FSHD1 / FSHD2 as printed, or null. */
  geneticType: string | null;
  haplotype: string | null;
  /** True only for an unambiguous 4qA, false only for an unambiguous
   *  4qB, null when the field is missing OR names both — a report that
   *  lists「4qA/4qB」is naming its probes, not stating a result. */
  permissiveHaplotype: boolean | null;
  ecoRIFragment: string | null;
  d4z4: D4Z4Reading | null;
  /** See isD4Z4GreyZone. Derived here rather than stored by the parser
   *  so it cannot drift from the number on screen: `d4z4Repeats` is one
   *  of the fields a patient may hand-correct after OCR, and a flag
   *  frozen at parse time would then contradict the corrected value. */
  greyZone: boolean;
  methylationValue: string | null;
  method: GeneticTestMethod;
  documentId: string | null;
}

export type GeneticEvidenceGrade =
  | 'not_tested'
  | 'method_not_applicable'
  | 'method_right_incomplete'
  | 'trial_ready'
  | 'unknown';

export interface GeneticTestRequestSectionDTO {
  heading: string;
  body: string[];
  source: string;
}

/** 《检查申请说明》 — the page a patient hands across a clinic desk. */
export interface GeneticTestRequestDTO {
  title: string;
  intro: string;
  sections: GeneticTestRequestSectionDTO[];
  /** The same content flattened, for print / copy-to-clipboard. */
  printable: string;
}

export interface PassportGeneticEvidenceDTO {
  grade: GeneticEvidenceGrade;
  gradeLabel: string;
  headline: string;
  reason: string;
  action: string;
  record: PassportGeneticRecordDTO;
  /** Non-null only when the repeat count is in the 8–10 unit gray zone. */
  greyZoneNote: string | null;
  /** Null once the report already carries size AND haplotype — at that
   *  point there is nothing left to ask a clinic for. */
  testRequest: GeneticTestRequestDTO | null;
  sources: string[];
}

const SOURCE_GIARDINA_2024 =
  'Giardina E 等《面肩肱型肌营养不良基因诊断最佳实践指南：2012 版更新》，Clinical Genetics 2024;106(1):13-26，doi:10.1111/cge.14533';
const SOURCE_ZHANG_2019 =
  '张成、李欢《面-肩-肱型肌营养不良症研究进展史》，中国现代神经疾病杂志 2019 年 5 月第 19 卷第 5 期';
const SOURCE_XIA_2024 =
  'Xia X 等（复旦大学附属华山医院）摘要 642P，Neuromuscular Disorders 2024;43:104441';

/** 4qA / 4qB, read strictly. See `permissiveHaplotype`. */
const parsePermissiveHaplotype = (raw: string | null): boolean | null => {
  if (!raw) return null;
  const hasA = /4\s*q\s*a/i.test(raw);
  const hasB = /4\s*q\s*b/i.test(raw);
  if (hasA && !hasB) return true;
  if (hasB && !hasA) return false;
  return null;
};

const buildGeneticRecord = (
  fields: Record<string, unknown> | undefined,
  documentId: string | null,
): PassportGeneticRecordDTO => {
  const d4z4Raw = pickField(fields, [...GENETIC_FIELD_KEYS.d4z4Repeats]) ?? null;
  const d4z4 = d4z4Raw ? parseD4Z4Reading(d4z4Raw) : null;
  const haplotype = pickField(fields, [...GENETIC_FIELD_KEYS.haplotype]) ?? null;
  const methodRaw = pickField(fields, [...GENETIC_FIELD_KEYS.testMethod]) ?? null;

  return {
    geneticType: pickField(fields, [...GENETIC_FIELD_KEYS.geneticType]) ?? null,
    haplotype,
    permissiveHaplotype: parsePermissiveHaplotype(haplotype),
    ecoRIFragment: pickField(fields, [...GENETIC_FIELD_KEYS.ecoRIFragment]) ?? null,
    d4z4,
    greyZone: isD4Z4GreyZone(d4z4),
    methylationValue: pickField(fields, [...GENETIC_FIELD_KEYS.methylationValue]) ?? null,
    method:
      methodRaw && KNOWN_GENETIC_TEST_METHODS.has(methodRaw)
        ? (methodRaw as GeneticTestMethod)
        : 'unknown',
    documentId,
  };
};

/** A size the guideline would accept: a definite repeat count, or an
 *  EcoRI fragment length. A range is a real finding but not a size. */
const hasDeterminateSize = (record: PassportGeneticRecordDTO) =>
  (record.d4z4 !== null && record.d4z4.value !== null) || Boolean(record.ecoRIFragment);

const hasHaplotypeResult = (record: PassportGeneticRecordDTO) =>
  record.permissiveHaplotype !== null;

/**
 * The four-level grade, plus 未知.
 *
 * The rules only ever UPGRADE on something explicit, and the one
 * downgrade — 方法不适用 — needs the parser to have named a short-read
 * method AND the report to carry no D4Z4 result at all. A Chinese
 * genetics report arrives as a photo of a low-contrast thermal print;
 * telling somebody their test was the wrong test on the strength of a
 * fuzzy match would send them to pay for a second one they may not need.
 * Anything that does not match falls to 未知.
 *
 * Report evidence outranks the self-reported ladder deliberately: a
 * patient who ticked 「临床诊断，还没做过基因检测」 and then uploaded a
 * Southern blot is graded on the blot.
 */
const gradeGeneticEvidence = (
  record: PassportGeneticRecordDTO,
  ladder: DiagnosisLadderState | null,
): GeneticEvidenceGrade => {
  const size = hasDeterminateSize(record);
  const haplotype = hasHaplotypeResult(record);

  if (record.method === 'short_read_sequencing' && !size && !haplotype) {
    return 'method_not_applicable';
  }
  if (SIZING_METHODS.has(record.method) || size || haplotype || record.d4z4 !== null) {
    return size && haplotype ? 'trial_ready' : 'method_right_incomplete';
  }
  // Nothing readable on file. The patient's own answer is the only
  // evidence left, and only three of the five rungs assert that no
  // genetic test has been done.
  if (
    ladder === 'untested_wants_test' ||
    ladder === 'untested_no_plan' ||
    ladder === 'clinical_only'
  ) {
    return 'not_tested';
  }
  return 'unknown';
};

const GENETIC_GRADE_LABELS: Record<GeneticEvidenceGrade, string> = {
  not_tested: '未检测',
  method_not_applicable: '方法不适用',
  method_right_incomplete: '方法对，但结果不全',
  trial_ready: '可用于入组',
  unknown: '未知',
};

const WHY_SHORT_READ_CANNOT: GeneticTestRequestSectionDTO = {
  heading: '为什么全外显子 / 全基因组测序读不到 FSHD',
  body: [
    'FSHD1 的病因是 4 号染色体 4q35 上 D4Z4 串联重复序列的拷贝数缩短。单个 D4Z4 单元长 3.3 kb，整段重复序列可长达 150 个单元（约 500 kb）。',
    '指南原文写明：D4Z4 重复序列的长度和单倍型「cannot be determined by short read WES- or WGS-like technologies」——短读长的全外显子、全基因组以及 panel 测序无法测定这两项。',
    '因此一份写着「未见明确致病变异」的全外显子报告，不能作为排除 FSHD 的依据：它测的不是这个位点。再做一次同类测序也不会有不同结果。',
  ],
  source: SOURCE_GIARDINA_2024,
};

const WHICH_TEST_INSTEAD: GeneticTestRequestSectionDTO = {
  heading: '能测出 FSHD1 的方法',
  body: [
    'Southern blotting：EcoR I + Bln I 双酶切基因组 DNA，脉冲场凝胶电泳（PFGE）或琼脂糖凝胶电泳，联合 p13E-11 探针，再结合 4qA / 4qB 探针判断单倍型。',
    '指南列出的可用于长片段分析的方法有三种：SB-PFGE（脉冲场电泳后的 Southern blot）、光学基因组图谱（optical genome mapping, OGM）、分子梳（molecular combing, MC）。',
    '国内已有开展：复旦大学附属华山医院 2017 年 1 月至 2023 年 12 月对 247 例 FSHD 表型患者做 OGM 或分子梳的 4qA 等位基因分析，其中 219 例据此确诊 FSHD1（重复单元 2–9 个）。',
    '需要提前知道的一点：SB-PFGE 与分子梳需要琼脂糖包埋制备的高质量 DNA，对操作和设备要求高，不是每家实验室都能做——问清楚再抽血，可以少跑一趟。',
  ],
  source: `${SOURCE_ZHANG_2019}；${SOURCE_GIARDINA_2024}；${SOURCE_XIA_2024}`,
};

const WHAT_THE_REPORT_MUST_SAY: GeneticTestRequestSectionDTO = {
  heading: '报告上需要写明的内容',
  body: [
    '一、4 号染色体 D4Z4 重复单元数（U），以及所用的检测方法；',
    '二、该等位基因的 4qA / 4qB 单倍型——只有 4qA 是允许型，缺了这一项，重复单元数本身不足以下结论；',
    '三、若重复单元数大于 10 而临床仍高度怀疑，需加做 D4Z4 甲基化分析与 SMCHD1 测序，以评估 FSHD2。',
    '指南写明：FSHD 的基因分析建立在确定 4 号与 10 号染色体 D4Z4 重复序列的「长度和单倍型」这两项之上；而临床试验的入组无一例外要求已确认的分子遗传学诊断。',
  ],
  source: SOURCE_GIARDINA_2024,
};

const buildGreyZoneSection = (repeats: number): GeneticTestRequestSectionDTO => ({
  heading: `关于 ${repeats} 个重复单元（8–10 灰区）`,
  body: [
    `你的报告是 ${repeats} 个重复单元，落在指南所说的「灰区」（gray zone）。`,
    '在欧洲对照人群中，约 1%–2% 的人携带 8–10 个单元的 4qA 等位基因，且没有任何症状和家族史；因此在没有家族史的情况下，这一区间通常并不致病。',
    '指南给出的报告口径是：8 个单元的 4qA 等位基因应报告为「likely pathogenic（可能致病）」，而不是「pathogenic（致病）」。',
    '指南同时举例指出，同样是 8 个单元，在欧洲患者中报告为可能致病，而在日本患者中致病性「less certain（不那么确定）」。指南没有给出中国人群的对应数据。',
    '这不是说你的诊断被推翻，而是说这一项结果本身带着不确定性，需要结合临床表现、家族史和甲基化结果一起看——如果医生没有主动提，可以问一句。',
  ],
  source: SOURCE_GIARDINA_2024,
});

const buildTestRequest = (
  record: PassportGeneticRecordDTO,
  grade: GeneticEvidenceGrade,
): GeneticTestRequestDTO | null => {
  if (grade === 'trial_ready') return null;

  const sections: GeneticTestRequestSectionDTO[] = [];
  // Only worth printing when the report was not already done by a
  // sizing method — telling somebody who had a Southern blot why WES
  // does not work wastes the page they are handing over.
  if (!SIZING_METHODS.has(record.method)) {
    sections.push(WHY_SHORT_READ_CANNOT);
  }
  if (!hasDeterminateSize(record)) {
    sections.push(WHICH_TEST_INSTEAD);
  }
  sections.push(WHAT_THE_REPORT_MUST_SAY);
  if (record.greyZone && record.d4z4?.value !== null && record.d4z4 !== null) {
    sections.push(buildGreyZoneSection(record.d4z4.value as number));
  }

  const title = 'FSHD（面肩肱型肌营养不良）基因检查申请说明';
  const intro =
    '这份说明由患者本人带来，内容摘自国际 FSHD 基因诊断最佳实践指南与国内综述，供接诊医生参考。患者无法判断该开哪张单子，只是希望在开单之前，这几条与常规基因检测不同的地方能被看到。';

  const printable = [
    `【${title}】`,
    '',
    intro,
    '',
    ...sections.flatMap((section) => [
      `■ ${section.heading}`,
      ...section.body.map((line) => `  ${line}`),
      `  出处：${section.source}`,
      '',
    ]),
  ].join('\n');

  return { title, intro, sections, printable };
};

const buildGeneticEvidence = (
  record: PassportGeneticRecordDTO,
  ladder: DiagnosisLadderState | null,
): PassportGeneticEvidenceDTO => {
  const grade = gradeGeneticEvidence(record, ladder);
  // BOTH facts, not just size. This function rendered the patient-facing
  // copy while holding only one of the two things that copy talks about,
  // which is how it came to print 「已有单倍型（null）」.
  const size = hasDeterminateSize(record);
  const haplotype = hasHaplotypeResult(record);

  let headline: string;
  let reason: string;
  let action: string;
  const sources: string[] = [SOURCE_GIARDINA_2024];

  switch (grade) {
    case 'not_tested':
      headline = '还没有做过能测出 FSHD 的基因检测';
      reason = `这一条来自你自己填的诊断进度：${
        ladder ? DIAGNOSIS_LADDER_LABELS[ladder] : '未填写'
      }。`;
      action =
        '下面这份《检查申请说明》可以直接给医生看——它写清了 FSHD 该做哪一项检查，以及为什么常规的全外显子测序测不到这个位点。';
      break;
    case 'method_not_applicable':
      headline = '你上传的这份报告，用的方法测不到 FSHD 的位点';
      reason =
        '报告里明确写着做的是全外显子 / 全基因组 / panel 这类短读长测序。指南原文：D4Z4 重复序列的长度和单倍型无法由短读长的 WES 或 WGS 类技术测定。';
      action =
        '所以这份报告即使结论是阴性，也不能用来排除 FSHD——它没有测这个位点。不需要再花一次钱做同类测序；下面这份说明写清了该换成哪一项。';
      break;
    case 'method_right_incomplete': {
      // Both facts are read independently, because this branch is
      // reached whenever ANY of {sizing method named, size present,
      // haplotype present, a D4Z4 reading of any kind} holds — so
      // 「not size」 does NOT imply 「haplotype」. Deriving both from the
      // single `size` boolean printed 「已有单倍型（null）」 for a report
      // whose only genetic content was a range like 「1-10」, and
      // 「已有单倍型（4qA/4qB）」 for a report naming its probes rather
      // than stating a result — which `parsePermissiveHaplotype`
      // deliberately reads as no result at all.
      //
      // That string is `reason`, and buildClinicalPassportExport prints
      // it as 「- 依据：…」 into the markdown a patient hands across a
      // desk. A neurologist who reads 「已有单倍型」 does not re-order the
      // haplotype assay — the exact half a molecular diagnosis needs.
      const missingParts: string[] = [];
      if (!size) missingParts.push('D4Z4 重复单元数');
      if (!haplotype) missingParts.push('4qA / 4qB 单倍型');
      const missing = missingParts.join('和');

      const presentParts: string[] = [];
      if (size) presentParts.push(`D4Z4 长度（${record.d4z4?.raw || record.ecoRIFragment}）`);
      if (haplotype) presentParts.push(`单倍型（${record.haplotype}）`);

      headline =
        presentParts.length > 0
          ? `方法是对的，只差「${missing}」`
          : '方法是对的，但这两项结果都还没读到';
      reason =
        presentParts.length > 0
          ? `指南把 FSHD 的基因分析定义为两项：D4Z4 重复序列的长度，和它的 4qA / 4qB 单倍型。你的报告已有${presentParts.join('、')}，还没有看到${missing}。`
          : `指南把 FSHD 的基因分析定义为两项：D4Z4 重复序列的长度，和它的 4qA / 4qB 单倍型。报告用的是能测长度的方法，但这两项都还没读到——可能是报告本身没写，也可能是我们没能从图片里读出来。`;
      action =
        presentParts.length > 0
          ? '这一步很常见，大多数报告都停在这里。缺的这项通常不需要重新采血——原实验室多半可以在既有样本上补出结果、补发报告。下面的说明列出了需要补写的内容。'
          : '可以先对着报告原件核对一下这两项有没有写。如果确实没有，通常不需要重新采血——原实验室多半可以在既有样本上补出结果、补发报告。下面的说明列出了需要补写的内容。';
      sources.push(SOURCE_ZHANG_2019);
      break;
    }
    case 'trial_ready':
      headline = '这份报告已经包含临床试验入组通常要求的两项内容';
      reason = `D4Z4 长度 ${record.d4z4?.raw || record.ecoRIFragment}，单倍型 ${
        record.haplotype
      }。指南写明 FSHD 的基因分析基于确定重复序列的长度和单倍型两项，而临床试验入组要求已确认的分子遗传学诊断。`;
      action =
        '把它和临床护照一起带去就诊或报名筛选即可。具体是否符合某一项试验的入组标准，仍由该试验的研究者判断——这里只说明材料是齐的。';
      break;
    default:
      headline = '暂时判断不出你做的是哪一种基因检测';
      reason =
        '还没有上传过基因报告，或者报告里没有能明确认出检测方法的字样。这里不做猜测：猜错方向会让人白花一次检测的钱。';
      action =
        '如果你手上的报告写的是「全外显子测序」「全基因组测序」或某个基因 panel，那它测不到 FSHD 的位点，下面这份说明写清了该做哪一项；如果不确定，把报告拍照上传，或者带着这份说明去问接诊医生。';
      break;
  }

  return {
    grade,
    gradeLabel: GENETIC_GRADE_LABELS[grade],
    headline,
    reason,
    action,
    record,
    greyZoneNote: record.greyZone
      ? `你的 D4Z4 重复单元数是 ${record.d4z4?.value}，落在指南所说的 8–10 单元灰区。指南对这一区间给出的报告口径是「可能致病」而不是「致病」：8–10 个单元的 4qA 等位基因在欧洲对照人群中约有 1%–2% 的人携带且无症状。这不推翻你的诊断，只是说这一项结果本身带着不确定性，值得和医生确认一次。`
      : null,
    testRequest: buildTestRequest(record, grade),
    sources,
  };
};

/** The diagnosis ladder the patient answered on the baseline form, or
 *  null. Validated against the enum rather than cast: `baseline` is an
 *  untyped JSONB column, and rows predating migration-free rollout of
 *  the ladder simply do not have the key. */
const readDiagnosisLadder = (profile: PatientProfileDTO): DiagnosisLadderState | null => {
  const baseline = profile.baseline;
  if (!baseline || typeof baseline !== 'object') return null;
  const diseaseBackground = (baseline as Record<string, unknown>).diseaseBackground;
  if (!diseaseBackground || typeof diseaseBackground !== 'object') return null;
  const raw = (diseaseBackground as Record<string, unknown>).diagnosisLadder;
  return typeof raw === 'string' && (DIAGNOSIS_LADDER_STATES as readonly string[]).includes(raw)
    ? (raw as DiagnosisLadderState)
    : null;
};

/** Whole years old on the server clock, or null when no birth date is on file. */
const ageInYears = (dateOfBirth: string | null): number | null => {
  if (!dateOfBirth) return null;
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - born.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
};

export const buildClinicalPassportSummary = (
  profile: PatientProfileDTO,
): ClinicalPassportSummaryDTO => {
  const reportInsights = buildReportInsights(profile);
  const mriDocuments = collectMriDocuments(profile.documents);
  const latestMeasurementsByGroup = pickLatestMeasurementsByGroup(profile.measurements);
  const measurementScores = Object.values(latestMeasurementsByGroup)
    .map((item) => parseScore(String(item.strengthScore)))
    .filter((value): value is number => value !== null);
  const strengthAverage =
    measurementScores.length > 0
      ? (
          measurementScores.reduce((sum, score) => sum + score, 0) / measurementScores.length
        ).toFixed(1)
      : reportInsights.strengthAverage;
  const strengthBodyRegions = buildBodyMapFromMeasurements(profile.measurements);
  const mriBodyMap = buildAggregateMriBodyMap(mriDocuments);

  const latestMeasurementAt = Object.values(latestMeasurementsByGroup).reduce<string | null>(
    (latest, item) =>
      getTimestamp(item.recordedAt) > getTimestamp(latest) ? item.recordedAt : latest,
    null,
  );

  const latestActivity = [...profile.activityLogs].sort(
    (a, b) =>
      Math.max(getTimestamp(b.logDate), getTimestamp(b.createdAt)) -
      Math.max(getTimestamp(a.logDate), getTimestamp(a.createdAt)),
  )[0];
  const latestActivityAt = latestActivity?.logDate ?? latestActivity?.createdAt ?? null;

  const latestDocumentAt = profile.documents.reduce<string | null>(
    (latest, document) =>
      getTimestamp(document.uploadedAt) > getTimestamp(latest) ? document.uploadedAt : latest,
    null,
  );

  const latestUpdatedAt = [
    profile.updatedAt,
    latestMeasurementAt,
    latestActivityAt,
    latestDocumentAt,
  ].reduce<string | null>(
    (latest, value) => (getTimestamp(value) > getTimestamp(latest) ? value : latest),
    null,
  );

  // Only fields OCR pulled off an uploaded report count as evidence.
  // `geneticType` deliberately does NOT: it falls back to
  // `profile.geneticMutation`, which is free text the patient types
  // into the baseline form, and `diagnosisDate` is typed too.
  const geneticallyConfirmed =
    hasMeaningfulValue(reportInsights.d4z4Repeats) ||
    hasMeaningfulValue(reportInsights.haplotype) ||
    hasMeaningfulValue(reportInsights.ecoRIFragment);
  const diagnosisClaimed =
    hasMeaningfulValue(reportInsights.geneticType) ||
    hasMeaningfulValue(reportInsights.diagnosisDate);
  const diagnosisConfirmation: PassportDiagnosisConfirmation = geneticallyConfirmed
    ? 'genetic'
    : diagnosisClaimed
      ? 'self_reported'
      : 'none';
  const diagnosisLadder = readDiagnosisLadder(profile);
  const geneticEvidence = buildGeneticEvidence(reportInsights.geneticRecord, diagnosisLadder);
  // Completion counts confirmed diagnoses only — a progress ring that
  // fills on a self-entered date teaches the patient the document is
  // finished when its most load-bearing field is unverified.
  const diagnosisReady = geneticallyConfirmed;
  const motorReady =
    measurementScores.length > 0 ||
    profile.activityLogs.length > 0 ||
    hasMeaningfulValue(reportInsights.strengthSummary);
  const imagingReady = mriBodyMap.hasFindings || hasMeaningfulValue(reportInsights.mriSummary);
  const monitoringItems = [
    buildMonitoringItem({
      key: 'blood',
      title: '血检指标',
      summary: reportInsights.bloodSummary,
      latestDate: reportInsights.latestBloodDate,
      latestDocumentId: reportInsights.latestBloodDocumentId,
      // No guideline in the corpus asks for serial CK in FSHD. It shows
      // what you uploaded; it is not a progression measure.
      note: 'CK 等指标常用于诊断阶段。目前没有指南建议靠定期抽血来追踪 FSHD 的进展 —— 这一栏展示的是你已上传的结果。',
    }),
    buildMonitoringItem({
      key: 'respiratory',
      title: '肺功能',
      summary: reportInsights.respiratorySummary,
      latestDate: reportInsights.latestRespiratoryDate,
      latestDocumentId: reportInsights.latestRespiratoryDocumentId,
      // The one slot here that every FSHD patient is meant to have.
      // Second sentence is the anesthesia case, which is the reason a
      // patient with no symptoms might still need this on file.
      note: '指南建议每位 FSHD 患者都做一次肺功能基线。另外，如果要做全身麻醉的手术，术前应先查一次 —— 呼吸肌受累可能没有任何症状。',
    }),
    buildMonitoringItem({
      key: 'cardiac',
      title: '心脏检查',
      summary: reportInsights.cardiacSummary,
      latestDate: reportInsights.latestCardiacDate,
      latestDocumentId: reportInsights.latestCardiacDocumentId,
      // AAN Level C, stated as a condition rather than a schedule.
      // A patient who does have palpitations needs to know to act; a
      // patient who doesn't needs to know they can stop worrying about
      // an annual echo. The old panel gave both of them the same nudge.
      //
      // The surgical clause is not a hedge. Routine surveillance and
      // preoperative evaluation are different questions with different
      // answers, and only the first one is 「not essential」: Mani et al.
      // (AANA J, Oct 2025) call ECG and echo essential components of
      // the preoperative workup in FSHD, on a background of incomplete
      // RBBB in ~30% and mitral valve prolapse in ~25%. Without this
      // sentence the note is something a patient could hand to a
      // pre-op clinic as grounds to skip the ECG.
      note: '没有症状的 FSHD 患者不需要常规做心电图或心脏超声 —— 这一点和 DMD 等其他肌营养不良不同。两种情况例外：出现胸痛、心悸或不寻常的气短时应该去做心脏评估；以及手术前 —— FSHD 的术前评估应当包括心电图和心脏超声。',
    }),
  ];
  const monitoringReady = monitoringItems.some((item) => item.available);
  const completionCount = [diagnosisReady, motorReady, imagingReady, monitoringReady].filter(
    Boolean,
  ).length;
  // Everything a patient can put into the system counts as recorded
  // data — including the three sources this check used to miss.
  //
  // The daily followup form writes a function test (stair climb), a
  // symptom score (sleep) and, on a fall, a followup event. None of
  // those were listed here, so somebody who had faithfully logged
  // twenty followups and a fall still read as having recorded
  // nothing: passport id stuck at 待生成, PDF export greyed out, and
  // (once the visit-prep note landed) no way to draft it — for
  // exactly the patient with the clearest trend to bring to a clinic.
  const hasRecordedData =
    profile.measurements.length > 0 ||
    profile.activityLogs.length > 0 ||
    profile.documents.length > 0 ||
    profile.medications.length > 0 ||
    profile.functionTests.length > 0 ||
    profile.symptomScores.length > 0 ||
    profile.followupEvents.length > 0;

  const patientName = profile.fullName?.trim() || profile.preferredName?.trim() || '未命名病例';
  const passportId = hasRecordedData
    ? `FSHD-${profile.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`
    : '待生成';

  const strengthHighlights = summarizeBodyRegions(strengthBodyRegions);
  const mriHighlights = summarizeBodyRegions(mriBodyMap.regions);

  const nextSteps: PassportNextStepDTO[] = [];
  if (geneticEvidence.grade === 'method_not_applicable') {
    // Deliberately NOT the 「补充基因检测报告」 record step below. This
    // patient already uploaded a genetics report and already paid for a
    // test; asking them to upload another one reads as「your report was
    // not good enough」and points at a file picker. What they need is a
    // sentence to take to a doctor, which is what `clinical` means here.
    nextSteps.push({
      title: '这份报告用的方法测不到 FSHD',
      kind: 'clinical',
      description: `${geneticEvidence.reason}${geneticEvidence.action}`,
    });
  } else if (!geneticallyConfirmed) {
    nextSteps.push({
      title: diagnosisClaimed ? '补充基因检测报告' : '补充基因或诊断依据',
      kind: 'record',
      description: diagnosisClaimed
        ? '目前的诊断信息由本人填写，尚无基因报告佐证。上传基因检测报告后，护照才能显示 D4Z4 重复数等可供医生直接引用的证据。'
        : '上传基因检测报告，护照才能展示 D4Z4 重复数、4q 单倍型等可引用的诊断证据。',
    });
  }
  if (geneticEvidence.grade === 'method_right_incomplete') {
    nextSteps.push({
      title: '问一下报告里缺的那一项',
      kind: 'clinical',
      description: `${geneticEvidence.headline}。${geneticEvidence.action}`,
    });
  }
  if (geneticEvidence.greyZoneNote) {
    nextSteps.push({
      title: '你的重复单元数在灰区，值得确认一次',
      kind: 'clinical',
      description: geneticEvidence.greyZoneNote,
    });
  }
  if (measurementScores.length === 0) {
    nextSteps.push({
      title: '补录结构化肌力',
      kind: 'record',
      description: '当前运动功能主要依赖 OCR 摘要，建议直接录入肌群评分。',
    });
  }
  if (!imagingReady) {
    nextSteps.push({
      title: '上传 MRI 报告',
      kind: 'record',
      description: '补齐 MRI 后，护照才能展示人体受累分布。',
    });
  }
  // What follows is keyed to the AAN/AANEM 2015 evidence-based guideline
  // (Evaluation, Diagnosis, and Management of FSHD) and cross-checked
  // against the Dutch FSHD guideline (Spierziekten Nederland, 2018).
  // Both are in the corpus under 02.临床管理与治疗. Changing any of these
  // means reading them again — not reasoning from other dystrophies,
  // where the answers are different.
  if (!hasMeaningfulValue(reportInsights.respiratorySummary)) {
    nextSteps.push({
      title: '补充肺功能基线',
      kind: 'clinical',
      // Level B: baseline PFT on ALL patients. Repeat testing is where
      // the condition lives — abnormal baseline, or severe proximal
      // weakness / kyphoscoliosis / wheelchair dependence / comorbid
      // lung or cardiac disease. The old copy promised「长期随访闭环」to
      // everyone, which is the follow-up schedule of the risk group.
      description:
        '指南建议所有 FSHD 患者做一次肺功能基线（FVC / FEV1）。是否需要定期复查，取决于基线是否异常，以及有没有明显的近端无力、脊柱侧弯、轮椅依赖或其他肺部疾病 —— 由医生判断，不是每个人都要长期反复做。',
    });
  }
  // Cardiac is deliberately NOT requested. AAN Level C: 「routine cardiac
  // screening is not essential in the absence of cardiac signs or
  // symptoms」, and its clinical context calls routine ECG/echo
  // 「unnecessary in patients with FSHD who are asymptomatic」. The 44-page
  // Dutch guideline does not contain the word cardiac at all.
  //
  // This block used to tell every patient 「补齐 ECG、LVEF、QTc，避免系统
  // 监测维度缺口」 and counted the absence as incomplete. These are
  // out-of-pocket tests here, and the passport was manufacturing the
  // gap it then asked them to close. FSHD is not DMD or myotonic
  // dystrophy; carrying their surveillance schedule over is the error.
  //
  // Removing the nudge is only half of it — a patient who does have
  // palpitations still has to be told to act. That version of the
  // recommendation lives on the cardiac monitoring item's `note`, as a
  // condition instead of a schedule.
  if (isLargeD4Z4Deletion(reportInsights.d4z4Repeats)) {
    nextSteps.push({
      title: '问一次眼底检查',
      kind: 'clinical',
      // Level B, and gated on exactly the group it applies to: large
      // deletions. Exudative retinopathy (Coats disease) is rare in FSHD
      // but concentrated in this group, and untreated it can cost
      // vision that early treatment would have kept.
      description: `你的 D4Z4 重复数为 ${reportInsights.d4z4Repeats}，属于指南所说的大片段缺失。这一组患者的视网膜血管病变风险高于其他患者，指南建议由有经验的眼科医生做一次散瞳间接检眼镜检查，之后的复查频率按第一次的结果定。这不是急事，但值得在下次就诊时主动提出来。`,
    });
  }
  const age = ageInYears(profile.dateOfBirth);
  if (age !== null && age <= 6) {
    nextSteps.push({
      title: '每年做一次听力筛查',
      kind: 'clinical',
      // Level B: screen all young children at diagnosis and yearly
      // until they start school. The reason it is age-gated rather than
      // universal: an adult notices their own hearing loss, an infant
      // cannot, and undetected loss at this age delays language.
      description:
        '指南建议儿童患者在确诊时以及之后每年做一次听力筛查，直到上学。年幼的孩子不会主动说自己听不清，而这个年龄段漏掉的听力损失会影响语言发育。',
    });
  }

  const summaryCards: PassportSummaryCardDTO[] = [
    {
      key: 'diagnosis',
      title: '诊断证据',
      ready: diagnosisReady,
      summary:
        diagnosisConfirmation === 'genetic'
          ? compactText(reportInsights.geneEvidence, reportInsights.geneticType, 86)
          : diagnosisConfirmation === 'self_reported'
            ? '未经基因确诊 —— 以下为本人填写，尚无基因报告佐证'
            : '缺少可直接展示的基因或诊断证据',
      meta: `诊断日期 ${reportInsights.diagnosisDate}`,
    },
    {
      key: 'motor',
      title: '运动功能',
      ready: motorReady,
      summary: motorReady
        ? `平均 ${strengthAverage} 级 · ${
            strengthHighlights.length > 0
              ? strengthHighlights.join('、')
              : reportInsights.strengthSummary
          }`
        : '缺少肌力或活动功能记录',
      meta: latestMeasurementAt
        ? `最近记录 ${formatDateLabel(latestMeasurementAt)}`
        : '尚无时间序列',
    },
    {
      key: 'imaging',
      title: 'MRI 受累',
      ready: imagingReady,
      summary: imagingReady
        ? mriHighlights.length > 0
          ? mriHighlights.join('、')
          : reportInsights.mriSummary
        : '缺少 MRI 报告或影像提取结果',
      meta:
        mriDocuments.length > 1
          ? `最近 MRI ${formatDateLabel(reportInsights.latestMriDate)} · 累计 ${mriDocuments.length} 份`
          : `最近 MRI ${formatDateLabel(reportInsights.latestMriDate)}`,
    },
    {
      key: 'monitoring',
      title: '系统监测',
      ready: monitoringReady,
      summary: monitoringReady
        ? monitoringItems
            .filter((item) => item.available)
            .map((item) => item.title)
            .join(' / ')
        : // Not「仍缺核心监测」. Of the three slots below, only the
          // pulmonary baseline is recommended for every FSHD patient;
          // cardiac testing is explicitly not, and no guideline in the
          // corpus asks for serial CK. An empty panel here means nothing
          // has been uploaded yet — it does not mean tests are overdue.
          '还没有上传过肺功能、心脏或血检报告',
      meta: `最近监测 ${formatDateLabel(
        [
          reportInsights.latestBloodDate,
          reportInsights.latestRespiratoryDate,
          reportInsights.latestCardiacDate,
        ].sort((a, b) => getTimestamp(b) - getTimestamp(a))[0] ?? null,
      )}`,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    passportId,
    patientName,
    hasRecordedData,
    latestUpdatedAt,
    completion: {
      completed: completionCount,
      total: 4,
    },
    metrics: [
      {
        label: '完整度',
        value: `${completionCount}/4`,
        hint: completionCount === 4 ? '已形成完整摘要' : '仍有模块待补齐',
      },
      {
        label: '报告数',
        value: String(profile.documents.length),
        hint: profile.documents.length > 0 ? '已纳入护照' : '尚无报告来源',
      },
      {
        label: '肌力组数',
        value: String(Object.keys(latestMeasurementsByGroup).length),
        hint: measurementScores.length > 0 ? `平均 ${strengthAverage} 级` : '尚无结构化肌力',
      },
      {
        label: '最近更新',
        value: formatDateLabel(latestUpdatedAt),
        hint: latestUpdatedAt ? '用于判断新鲜度' : '暂无时间戳',
      },
    ],
    summaryCards,
    diagnosis: {
      ready: diagnosisReady,
      latestSourceDate: reportInsights.latestGeneticDate,
      latestDocumentId: reportInsights.latestGeneticDocumentId,
      confirmation: diagnosisConfirmation,
      ladder: diagnosisLadder,
      ladderLabel: diagnosisLadder ? DIAGNOSIS_LADDER_LABELS[diagnosisLadder] : null,
      geneticEvidence,
      freshness: getFreshness(reportInsights.latestGeneticDate),
      geneticType: reportInsights.geneticType,
      d4z4Repeats: reportInsights.d4z4Repeats,
      methylationValue: reportInsights.methylationValue,
      diagnosisDate: reportInsights.diagnosisDate,
      geneEvidence: reportInsights.geneEvidence,
    },
    motor: {
      ready: motorReady,
      average: strengthAverage,
      latestMeasurementAt,
      latestActivityAt,
      summary: reportInsights.strengthSummary,
      highlights: strengthHighlights,
      bodyRegions: strengthBodyRegions,
      activitySummary: compactText(latestActivity?.content, '暂无活动摘要', 120),
    },
    imaging: {
      ready: imagingReady,
      latestMriDate: reportInsights.latestMriDate,
      latestDocumentId: reportInsights.latestMriDocumentId,
      freshness: getFreshness(reportInsights.latestMriDate),
      summary: reportInsights.mriSummary,
      highlights: mriHighlights,
      bodyRegions: mriBodyMap.regions,
    },
    monitoring: {
      ready: monitoringReady,
      items: monitoringItems,
    },
    nextSteps,
    timeline: buildTimeline(profile, latestMeasurementsByGroup, strengthAverage),
  };
};

const escapeMarkdown = (value: string) => value.replace(/\|/g, '\\|');

export const buildClinicalPassportExport = (
  summary: ClinicalPassportSummaryDTO,
): ClinicalPassportExportDTO => {
  const lines = [
    `# ${summary.patientName} 临床护照摘要`,
    '',
    `- 护照 ID：${summary.passportId}`,
    `- 生成时间：${summary.generatedAt}`,
    `- 最近更新：${summary.latestUpdatedAt ?? '—'}`,
    `- 完整度：${summary.completion.completed}/${summary.completion.total}`,
    '',
    '## 核心摘要',
    '',
    '| 模块 | 状态 | 摘要 |',
    '| --- | --- | --- |',
    ...summary.summaryCards.map(
      (card) =>
        `| ${escapeMarkdown(card.title)} | ${card.ready ? '已就绪' : '待补齐'} | ${escapeMarkdown(card.summary)} |`,
    ),
    '',
    '## 诊断证据',
    '',
    `- 基因类型：${summary.diagnosis.geneticType}`,
    `- D4Z4 重复数：${summary.diagnosis.d4z4Repeats}`,
    `- 甲基化值：${summary.diagnosis.methylationValue}`,
    `- 诊断日期：${summary.diagnosis.diagnosisDate}`,
    `- 证据摘要：${summary.diagnosis.geneEvidence}`,
    ...(summary.diagnosis.ladderLabel
      ? [`- 本人填写的诊断进度：${summary.diagnosis.ladderLabel}`]
      : []),
    '',
    // The grade and the request note are the reason this export exists.
    // A neurologist reading the page needs to know not just what the
    // report said but whether the method could have said it — a
    // negative short-read report presented alongside 「诊断证据」 with
    // no qualifier is exactly the anchor that produces second wasted
    // tests.
    '### 基因证据分级',
    '',
    `- 分级：${summary.diagnosis.geneticEvidence.gradeLabel}`,
    `- ${summary.diagnosis.geneticEvidence.headline}`,
    `- 依据：${summary.diagnosis.geneticEvidence.reason}`,
    `- 下一步：${summary.diagnosis.geneticEvidence.action}`,
    ...(summary.diagnosis.geneticEvidence.greyZoneNote
      ? [`- 灰区提示：${summary.diagnosis.geneticEvidence.greyZoneNote}`]
      : []),
    ...summary.diagnosis.geneticEvidence.sources.map((source) => `- 出处：${source}`),
    '',
    ...(summary.diagnosis.geneticEvidence.testRequest
      ? [
          `### ${summary.diagnosis.geneticEvidence.testRequest.title}`,
          '',
          summary.diagnosis.geneticEvidence.testRequest.intro,
          '',
          ...summary.diagnosis.geneticEvidence.testRequest.sections.flatMap((section) => [
            `**${section.heading}**`,
            '',
            ...section.body.map((line) => `- ${line}`),
            `- 出处：${section.source}`,
            '',
          ]),
        ]
      : []),
    '## 运动功能',
    '',
    `- 平均肌力：${summary.motor.average} 级`,
    `- 重点区域：${summary.motor.highlights.join('、') || '暂无结构化分布'}`,
    `- 活动摘要：${summary.motor.activitySummary}`,
    '',
    '## MRI 受累',
    '',
    `- 最近 MRI：${summary.imaging.latestMriDate ?? '—'}`,
    `- 影像摘要：${summary.imaging.summary}`,
    `- 重点区域：${summary.imaging.highlights.join('、') || '暂无可视化分布'}`,
    '',
    '## 系统监测',
    '',
    // The note carries whether the test is indicated at all. Dropping it
    // here would leave the markdown export saying「心脏检查：暂无数据，
    // 缺失」with nothing to distinguish 'not done' from 'not needed'.
    ...summary.monitoring.items.flatMap((item) => [
      `- ${item.title}：${item.summary}（${item.latestDate ?? '无日期'}，${item.freshness.label}）`,
      ...(item.note ? [`  - ${item.note}`] : []),
    ]),
    '',
    '## 待补项',
    '',
    ...(summary.nextSteps.length > 0
      ? summary.nextSteps.map((item) => `- ${item.title}：${item.description}`)
      : ['- 当前没有明显缺口']),
    '',
    '## 最近来源',
    '',
    ...summary.timeline.map(
      (item) => `- [${item.tag}] ${item.title}（${item.timestamp}）：${item.description}`,
    ),
    '',
  ];

  const safeName = summary.patientName.replace(/[^\p{L}\p{N}_-]+/gu, '_');

  return {
    generatedAt: new Date().toISOString(),
    documentTitle: `${summary.patientName} 临床护照摘要`,
    fileName: `${safeName || 'patient'}-clinical-passport.md`,
    contentType: 'text/markdown',
    markdown: lines.join('\n'),
  };
};
