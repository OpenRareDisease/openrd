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
  const candidates = docs.filter((doc) => doc.documentType === docType && doc.uploadedAt);
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

const parseScore = (value: string) => {
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (Number.isNaN(parsed)) return null;
  return parsed;
};

export const buildStrengthSummary = (fields?: Record<string, string | number>) => {
  const entries = [
    { label: '三角肌', key: 'deltoidStrength', alt: 'deltoid_strength' },
    { label: '肱二头肌', key: 'bicepsStrength', alt: 'biceps_strength' },
    { label: '肱三头肌', key: 'tricepsStrength', alt: 'triceps_strength' },
    { label: '股四头肌', key: 'quadricepsStrength', alt: 'quadriceps_strength' },
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
  const latestMri = latestDocByType(docs, 'mri');
  const latestBlood = latestDocByType(docs, 'blood_panel');

  const geneticFields = latestGenetic?.ocrPayload?.fields;
  const fallbackFieldsDoc = latestDocWithFields(docs, ['d4z4Repeats', 'd4z4_repeats']);
  const fallbackFields = fallbackFieldsDoc?.ocrPayload?.fields;

  const geneticType =
    pickField(geneticFields, ['geneticType', 'geneType', 'genetic_type']) ||
    (profile?.geneticMutation ?? undefined);

  const d4z4Repeats =
    pickField(geneticFields, ['d4z4Repeats', 'd4z4_repeats']) ||
    pickField(fallbackFields, ['d4z4Repeats', 'd4z4_repeats']);

  const methylationValue =
    pickField(geneticFields, ['methylationValue', 'methylation_value']) ||
    pickField(fallbackFields, ['methylationValue', 'methylation_value']);

  const diagnosisDate =
    formatDate(profile?.diagnosisDate ?? null) ||
    formatDate(pickField(geneticFields, ['diagnosisDate', 'diagnosis_date'])) ||
    null;

  const mriFields = latestMri?.ocrPayload?.fields;
  const mriGrade = pickField(mriFields, ['serratusFatigueGrade', 'serratus_fatigue_grade']);
  const mriImpression = pickFieldValue(latestMri, ['impressionText', 'impression_text']);
  const mriFinding = pickFieldValue(latestMri, ['findingText', 'finding_text']);
  const mriReportTime = pickFieldValue(latestMri, ['reportTime', 'report_time']);
  const mriSummary = mriGrade
    ? `前锯肌脂肪化等级 ${mriGrade}`
    : (mriImpression ?? mriFinding ?? latestMri?.ocrPayload?.extractedText ?? null);

  const bloodFields = latestBlood?.ocrPayload?.fields;
  const bloodReportTime = pickFieldValue(latestBlood, ['reportTime', 'report_time']);
  const bloodParts: string[] = [];
  const liverFunction = pickField(bloodFields, ['liverFunction', 'liver_function']);
  const creatineKinase = pickField(bloodFields, ['creatineKinase', 'creatine_kinase']);
  if (liverFunction) {
    bloodParts.push(`肝功能 ${liverFunction}`);
  }
  if (creatineKinase) {
    bloodParts.push(`肌酸激酶 ${creatineKinase}`);
  }
  const bloodSummary = bloodParts.join('，') || latestBlood?.ocrPayload?.extractedText || null;

  const strengthDoc = latestDocWithFields(docs, [
    'deltoidStrength',
    'bicepsStrength',
    'tricepsStrength',
    'quadricepsStrength',
    'deltoid_strength',
    'biceps_strength',
    'triceps_strength',
    'quadriceps_strength',
  ]);
  const strengthFields = strengthDoc?.ocrPayload?.fields;
  const strengthSummary = buildStrengthSummary(strengthFields);

  return {
    geneticType: geneticType ?? '—',
    d4z4Repeats: d4z4Repeats ?? '—',
    methylationValue: methylationValue ?? '—',
    diagnosisDate: diagnosisDate ?? '—',
    latestMriDate: formatDate(mriReportTime ?? latestMri?.uploadedAt ?? null) ?? '—',
    mriSummary: mriSummary ?? '暂无MRI分析数据',
    latestBloodDate: formatDate(bloodReportTime ?? latestBlood?.uploadedAt ?? null) ?? '—',
    bloodSummary: bloodSummary ?? '暂无血检摘要',
    strengthAverage: strengthSummary.average !== null ? strengthSummary.average.toFixed(1) : '—',
    strengthSummary: strengthSummary.summary ?? '暂无可用的肌力评估摘要',
  };
};
