export type OcrPayload = {
  extractedText?: string;
  fields?: Record<string, string | number>;
} | null;

export type DocumentLike = {
  documentType?: string | null;
  uploadedAt?: string | null;
  ocrPayload?: OcrPayload;
};

export type ProfileLike = {
  diagnosisDate?: string | null;
  geneticMutation?: string | null;
};

const pickField = (fields: Record<string, string | number> | undefined, keys: string[]) => {
  if (!fields) return undefined;
  for (const key of keys) {
    const value = fields[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
};

const pickFieldValue = (doc: DocumentLike | undefined, keys: string[]) => {
  const fields = doc?.ocrPayload?.fields;
  if (!fields) return undefined;
  for (const key of keys) {
    const value = fields[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
};

const formatDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const latestDocByType = (docs: DocumentLike[], docType: string) => {
  const candidates = docs.filter((doc) => getDocumentType(doc) === docType && doc.uploadedAt);
  if (candidates.length === 0) return undefined;
  return candidates.reduce((latest, current) => {
    const latestTime = new Date(latest.uploadedAt as string).getTime();
    const currentTime = new Date(current.uploadedAt as string).getTime();
    return currentTime > latestTime ? current : latest;
  });
};

const latestDocByTypes = (docs: DocumentLike[], docTypes: string[]) => {
  const candidates = docs.filter(
    (doc) => doc.uploadedAt && docTypes.includes(getDocumentType(doc)),
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((latest, current) => {
    const latestTime = new Date(latest.uploadedAt as string).getTime();
    const currentTime = new Date(current.uploadedAt as string).getTime();
    return currentTime > latestTime ? current : latest;
  });
};

const latestDocWithFields = (docs: DocumentLike[], keys: string[]) => {
  const candidates = docs.filter((doc) => {
    const fields = doc.ocrPayload?.fields;
    return Boolean(pickField(fields, keys));
  });
  if (candidates.length === 0) return undefined;
  return candidates.reduce((latest, current) => {
    const latestTime = new Date(latest.uploadedAt ?? 0).getTime();
    const currentTime = new Date(current.uploadedAt ?? 0).getTime();
    return currentTime > latestTime ? current : latest;
  });
};

const latestDocContainingText = (docs: DocumentLike[], patterns: string[]) => {
  const candidates = docs.filter((doc) => {
    const fullText = `${JSON.stringify(doc.ocrPayload?.fields ?? {})} ${
      doc.ocrPayload?.extractedText ?? ''
    }`.toLowerCase();
    return patterns.some((pattern) => fullText.includes(pattern.toLowerCase()));
  });
  if (candidates.length === 0) return undefined;
  return candidates.reduce((latest, current) => {
    const latestTime = new Date(latest.uploadedAt ?? 0).getTime();
    const currentTime = new Date(current.uploadedAt ?? 0).getTime();
    return currentTime > latestTime ? current : latest;
  });
};

const getDocumentType = (doc: DocumentLike) => {
  const fields = doc.ocrPayload?.fields;
  return (
    pickField(fields, ['classifiedType', 'classified_type', 'reportType', 'report_type']) ||
    doc.documentType ||
    'other'
  );
};

const parseScore = (value: string) => {
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (Number.isNaN(parsed)) return null;
  return parsed;
};

const compactText = (value?: string | null, fallback = '暂无数据') => {
  const text = value?.trim();
  if (!text) return fallback;
  return text.length > 88 ? `${text.slice(0, 88)}...` : text;
};

export const buildStrengthSummary = (fields?: Record<string, string | number>) => {
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
      ? Number((scores.reduce((sum, v) => sum + v, 0) / scores.length).toFixed(1))
      : null;

  return {
    summary: parts.join('，') || null,
    average,
  };
};

export const buildReportInsights = (docs: DocumentLike[], profile?: ProfileLike | null) => {
  const latestGenetic = latestDocByType(docs, 'genetic_report');
  const latestMri = latestDocByTypes(docs, ['muscle_mri', 'mri']);
  const latestBlood = latestDocByTypes(docs, [
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
  const latestPhysicalExam = latestDocByType(docs, 'physical_exam');

  const fallbackGeneticDoc = latestDocWithFields(docs, [
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

  const geneticFields = latestGenetic?.ocrPayload?.fields ?? fallbackGeneticDoc?.ocrPayload?.fields;
  const geneticType =
    pickField(geneticFields, [
      'diagnosisType',
      'geneticType',
      'geneType',
      'diagnosis_type',
      'genetic_type',
    ]) ||
    (profile?.geneticMutation ?? undefined);
  const haplotype = pickField(geneticFields, ['haplotype', 'haplotype4q', 'haplotype_4q']);
  const ecoRIFragment = pickField(geneticFields, [
    'ecoRIFragment',
    'ecoriFragment',
    'ecoriFragmentKb',
    'ecori_fragment_kb',
    'EcoRI_kb',
    'EcoRIFragment',
  ]);
  const d4z4Repeats = pickField(geneticFields, [
    'd4z4Repeats',
    'd4z4RepeatPathogenic',
    'd4z4_repeat_pathogenic',
    'd4z4_repeats',
  ]);
  const methylationValue = pickField(geneticFields, ['methylationValue', 'methylation_value']);

  const diagnosisDate =
    formatDate(profile?.diagnosisDate ?? null) ||
    formatDate(pickField(geneticFields, ['diagnosisDate', 'diagnosis_date'])) ||
    null;

  const mriDoc =
    latestMri ||
    latestDocContainingText(docs, ['mri', '脂肪浸润', '前锯', 'hamstring', '臀肌', '胫前']);
  const mriFields = mriDoc?.ocrPayload?.fields;
  const mriGrade = pickField(mriFields, ['serratusFatigueGrade', 'serratus_fatigue_grade']);
  const mriImpression = pickFieldValue(mriDoc, [
    'reportImpression',
    'report_impression',
    'impressionText',
    'impression_text',
  ]);
  const mriFinding = pickFieldValue(mriDoc, ['findingText', 'finding_text']);
  const mriReportTime = pickFieldValue(mriDoc, ['reportTime', 'report_time']);
  const mriSummary = mriGrade
    ? `前锯肌脂肪化等级 ${mriGrade}`
    : compactText(
        mriImpression ?? mriFinding ?? mriDoc?.ocrPayload?.extractedText,
        '暂无MRI分析数据',
      );

  const bloodDoc =
    latestBlood || latestDocContainingText(docs, ['ck', '肌酸激酶', 'ldh', 'mb', 'ckmb']);
  const bloodFields = bloodDoc?.ocrPayload?.fields;
  const bloodReportTime = pickFieldValue(bloodDoc, ['reportTime', 'report_time']);
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
    bloodParts.join('，') || compactText(bloodDoc?.ocrPayload?.extractedText, '暂无血检摘要');

  const respiratoryDoc =
    latestDocByTypes(docs, ['pulmonary_function', 'diaphragm_ultrasound']) ||
    latestDocContainingText(docs, ['fvc', 'fev1', 'tlc', 'dlco', '肺功能', '膈肌']);
  const respiratoryFields = respiratoryDoc?.ocrPayload?.fields;
  const respiratoryReportTime = pickFieldValue(respiratoryDoc, ['reportTime', 'report_time']);
  const respiratoryMetrics = [
    pickField(respiratoryFields, ['ventilatoryPattern', 'ventilatory_pattern']),
    pickField(respiratoryFields, ['fvcPredPct', 'fvc_pred_pct']),
    pickField(respiratoryFields, ['tlcPredPct', 'tlc_pred_pct']),
    pickField(respiratoryFields, ['dlcoPredPct', 'dlco_pred_pct']),
    pickField(respiratoryFields, ['diaphragmMotionSummary', 'diaphragm_motion_summary']),
  ].filter(Boolean);
  const respiratorySummary =
    respiratoryMetrics.length > 0
      ? respiratoryMetrics.join(' / ')
      : compactText(respiratoryDoc?.ocrPayload?.extractedText, '暂无呼吸监测数据');

  const cardiacDoc =
    latestDocByTypes(docs, ['ecg', 'echocardiography']) ||
    latestDocContainingText(docs, ['ecg', 'echo', 'lvef', 'qtc', 'qrs', '心电', '超声心动']);
  const cardiacFields = cardiacDoc?.ocrPayload?.fields;
  const cardiacReportTime = pickFieldValue(cardiacDoc, ['reportTime', 'report_time']);
  const cardiacMetrics = [
    pickField(cardiacFields, ['ecgSummary', 'ecg_summary']),
    pickField(cardiacFields, ['echoSummary', 'echo_summary']),
    pickField(cardiacFields, ['LVEF', 'lvef']),
    pickField(cardiacFields, ['QTc', 'qtc', 'qtcMs', 'qtc_ms']),
  ].filter(Boolean);
  const cardiacSummary =
    cardiacMetrics.length > 0
      ? cardiacMetrics.join(' / ')
      : compactText(cardiacDoc?.ocrPayload?.extractedText, '暂无心脏监测数据');

  const strengthDoc =
    latestPhysicalExam ||
    latestDocWithFields(docs, [
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
  const strengthFields = strengthDoc?.ocrPayload?.fields;
  const strengthSummary = buildStrengthSummary(strengthFields);

  const geneEvidence = [geneticType, haplotype, ecoRIFragment, d4z4Repeats]
    .filter(Boolean)
    .join(' · ');

  return {
    geneticType: geneticType ?? '—',
    haplotype: haplotype ?? '—',
    ecoRIFragment: ecoRIFragment ?? '—',
    d4z4Repeats: d4z4Repeats ?? '—',
    methylationValue: methylationValue ?? '—',
    diagnosisDate: diagnosisDate ?? '—',
    geneEvidence: geneEvidence || '暂无可直接展示的基因证据',
    latestMriDate: formatDate(mriReportTime ?? mriDoc?.uploadedAt ?? null) ?? '—',
    mriSummary,
    latestBloodDate: formatDate(bloodReportTime ?? bloodDoc?.uploadedAt ?? null) ?? '—',
    bloodSummary,
    latestRespiratoryDate:
      formatDate(respiratoryReportTime ?? respiratoryDoc?.uploadedAt ?? null) ?? '—',
    respiratorySummary,
    latestCardiacDate: formatDate(cardiacReportTime ?? cardiacDoc?.uploadedAt ?? null) ?? '—',
    cardiacSummary,
    strengthAverage: strengthSummary.average !== null ? strengthSummary.average.toFixed(1) : '—',
    strengthSummary: strengthSummary.summary ?? '暂无可用的肌力评估摘要',
  };
};
