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
  latestSourceDate: string | null;
  latestDocumentId: string | null;
  freshness: PassportFreshnessDTO;
  geneticType: string;
  d4z4Repeats: string;
  methylationValue: string;
  diagnosisDate: string;
  geneEvidence: string;
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

  const fallbackGenetic = latestDocWithFields(documents, [
    'diagnosisType',
    'diagnosis_type',
    'd4z4Repeats',
    'd4z4RepeatPathogenic',
    'd4z4_repeat_pathogenic',
    'd4z4_repeats',
    'ecoRIFragment',
    'ecoriFragmentKb',
    'ecori_fragment_kb',
    'EcoRI_kb',
    'haplotype',
    'haplotype4q',
  ]);

  const geneticPayload = toPayload((latestGenetic ?? fallbackGenetic)?.ocrPayload);
  const geneticFields = geneticPayload?.fields;
  const geneticType =
    pickField(geneticFields, [
      'diagnosisType',
      'geneticType',
      'geneType',
      'diagnosis_type',
      'genetic_type',
    ]) ||
    profile.geneticMutation ||
    '—';
  const haplotype = pickField(geneticFields, ['haplotype', 'haplotype4q', 'haplotype_4q']) || '—';
  const ecoRIFragment =
    pickField(geneticFields, [
      'ecoRIFragment',
      'ecoriFragment',
      'ecoriFragmentKb',
      'ecori_fragment_kb',
      'EcoRI_kb',
      'EcoRIFragment',
    ]) || '—';
  const d4z4Repeats =
    pickField(geneticFields, [
      'd4z4Repeats',
      'd4z4RepeatPathogenic',
      'd4z4_repeat_pathogenic',
      'd4z4_repeats',
    ]) || '—';
  const methylationValue =
    pickField(geneticFields, ['methylationValue', 'methylation_value']) || '—';
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
  const bloodSummary =
    bloodParts.join('，') ||
    compactText(
      typeof bloodPayload?.extractedText === 'string'
        ? bloodPayload.extractedText
        : typeof bloodPayload?.extracted_text === 'string'
          ? bloodPayload.extracted_text
          : '',
      '暂无血检摘要',
    );

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
      : compactText(
          typeof respiratoryPayload?.extractedText === 'string'
            ? respiratoryPayload.extractedText
            : typeof respiratoryPayload?.extracted_text === 'string'
              ? respiratoryPayload.extracted_text
              : '',
          '暂无肺功能数据',
        );

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
    cardiacMetrics.length > 0
      ? cardiacMetrics.join(' / ')
      : compactText(
          typeof cardiacPayload?.extractedText === 'string'
            ? cardiacPayload.extractedText
            : typeof cardiacPayload?.extracted_text === 'string'
              ? cardiacPayload.extracted_text
              : '',
          '暂无心脏检查数据',
        );

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
    geneticType,
    haplotype,
    ecoRIFragment,
    d4z4Repeats,
    methylationValue,
    diagnosisDate,
    geneEvidence: geneEvidence || '暂无可直接展示的基因证据',
    latestGeneticDate: formatDate(latestGenetic?.uploadedAt ?? fallbackGenetic?.uploadedAt ?? null),
    latestGeneticDocumentId: latestGenetic?.id ?? fallbackGenetic?.id ?? null,
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
}): PassportMonitoringItemDTO => ({
  key: input.key,
  title: input.title,
  available: hasMeaningfulValue(input.summary),
  summary: input.summary,
  latestDate: input.latestDate,
  latestDocumentId: input.latestDocumentId,
  freshness: getFreshness(input.latestDate),
  ...(input.note ? { note: input.note } : {}),
});

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
 */
export const isLargeD4Z4Deletion = (raw: string): boolean => {
  const text = (raw ?? '').trim();
  if (!text || text === '—') return false;
  if (/[<>≤≥~]|--|–|—|~|至|到/.test(text)) return false;
  const numbers = text.match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length !== 1) return false;
  const repeats = Number(numbers[0]);
  // 0 repeats is not a viable FSHD1 allele; reading one means the
  // extraction is wrong, not that the deletion is enormous.
  return Number.isInteger(repeats) && repeats >= 1 && repeats <= 4;
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
      note: '没有症状的 FSHD 患者不需要常规做心电图或心脏超声 —— 这一点和 DMD 等其他肌营养不良不同。但如果出现胸痛、心悸或不寻常的气短，应该去做心脏评估。',
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
  if (!geneticallyConfirmed) {
    nextSteps.push({
      title: diagnosisClaimed ? '补充基因检测报告' : '补充基因或诊断依据',
      kind: 'record',
      description: diagnosisClaimed
        ? '目前的诊断信息由本人填写，尚无基因报告佐证。上传基因检测报告后，护照才能显示 D4Z4 重复数等可供医生直接引用的证据。'
        : '上传基因检测报告，护照才能展示 D4Z4 重复数、4q 单倍型等可引用的诊断证据。',
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
    '',
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
