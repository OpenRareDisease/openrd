import { inferMriBodyMap, type BodyRegionMap } from './clinical-visuals';

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

export type ReportInsightMetric = {
  label: string;
  value: string;
  date?: string | null;
};

export type ReportInsightPanel = {
  key: 'diagnosis' | 'imaging' | 'blood' | 'respiratory' | 'cardiac';
  title: string;
  summary: string;
  latestDate: string;
  metrics: ReportInsightMetric[];
};

export type SystemInsightSection = {
  key: string;
  title: string;
  metrics: ReportInsightMetric[];
  priority: 'core' | 'secondary';
  groupKey?: 'fshd_related' | 'other';
  groupLabel?: string;
};

export type SystemInsightPanel = ReportInsightPanel & {
  key: 'blood' | 'respiratory' | 'cardiac';
  state: 'updated' | 'partial' | 'missing';
  stateLabel: string;
  coverage: string[];
  sourceCount: number;
  sections: SystemInsightSection[];
};

export type LatestMriVisualization = {
  regions: BodyRegionMap;
  findings: string[];
  latestDate: string;
  summary: string;
  hasFindings: boolean;
  sourceDocument: DocumentLike | null;
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

const maxDate = (values: Array<string | null | undefined>) => {
  const candidates = values
    .map((value) => formatDate(value ?? null))
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return candidates[0] ?? '—';
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

const filterDocsByTypes = (docs: DocumentLike[], docTypes: string[]) =>
  docs
    .filter((doc) => docTypes.includes(getDocumentType(doc)))
    .sort((a, b) => new Date(b.uploadedAt ?? 0).getTime() - new Date(a.uploadedAt ?? 0).getTime());

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

const filterDocsContainingText = (docs: DocumentLike[], patterns: string[]) =>
  docs
    .filter((doc) => {
      const fullText = `${JSON.stringify(doc.ocrPayload?.fields ?? {})} ${
        doc.ocrPayload?.extractedText ?? ''
      }`.toLowerCase();
      return patterns.some((pattern) => fullText.includes(pattern.toLowerCase()));
    })
    .sort((a, b) => new Date(b.uploadedAt ?? 0).getTime() - new Date(a.uploadedAt ?? 0).getTime());

const getDocumentType = (doc: DocumentLike) => {
  const fields = doc.ocrPayload?.fields;
  return (
    pickField(fields, ['classifiedType', 'classified_type', 'reportType', 'report_type']) ||
    doc.documentType ||
    'other'
  );
};

const REPORT_TYPE_LABELS: Record<string, string> = {
  pulmonary_function: '肺功能',
  diaphragm_ultrasound: '膈肌超声',
  ecg: '心电图',
  echocardiography: '心脏超声',
  muscle_enzyme: '肌酶',
  biochemistry: '生化',
  blood_routine: '血常规',
  thyroid_function: '甲功',
  coagulation: '凝血',
  urinalysis: '尿常规',
  infection_screening: '感染筛查',
  stool_test: '粪便/HP',
  abdominal_ultrasound: '腹部超声',
};

const getReportTypeLabel = (docType: string) => REPORT_TYPE_LABELS[docType] ?? docType;

const collectCoverage = (docs: DocumentLike[], docTypes: string[]) =>
  Array.from(
    new Set(
      filterDocsByTypes(docs, docTypes)
        .map((doc) => getDocumentType(doc))
        .filter((docType) => docTypes.includes(docType)),
    ),
  ).map((docType) => getReportTypeLabel(docType));

const SYSTEM_HERO_LABELS: Record<SystemInsightPanel['key'], string[]> = {
  blood: ['CK', 'Mb', 'LDH', 'CKMB'],
  respiratory: ['FVC %Pred', 'FEV1 %Pred', 'TLC %Pred', 'DLCO %Pred'],
  cardiac: ['心电结论', 'QTc', 'LVEF', '心率'],
};

export const getSystemPanelTabs = (panel: SystemInsightPanel) => {
  if (panel.key === 'blood') {
    const activeSections = panel.sections.filter((section) => section.metrics.length > 0);
    const hasFshdRelated = activeSections.some((section) => section.groupKey === 'fshd_related');
    const hasOther = activeSections.some((section) => section.groupKey === 'other');
    const groupCount = Number(hasFshdRelated) + Number(hasOther);
    const tabs: Array<{
      key: string;
      label: string;
      priority: 'all' | 'core' | 'secondary';
      scope: 'all' | 'group' | 'section';
    }> = [];

    if (groupCount > 1) {
      tabs.push({ key: 'all', label: '全部', priority: 'all', scope: 'all' });
    }
    if (hasFshdRelated) {
      tabs.push({
        key: 'group:fshd_related',
        label: 'FSHD相关',
        priority: 'core',
        scope: 'group',
      });
    }
    if (hasOther) {
      tabs.push({
        key: 'group:other',
        label: '其他',
        priority: 'secondary',
        scope: 'group',
      });
    }

    return tabs;
  }

  const tabs = panel.sections
    .filter((section) => section.metrics.length > 0)
    .map((section) => ({
      key: section.key,
      label: section.title,
      priority: section.priority,
      scope: 'section' as const,
    }));

  if (tabs.length <= 1) {
    return tabs;
  }

  return [{ key: 'all', label: '全部', priority: 'all' as const, scope: 'all' as const }, ...tabs];
};

export const getSystemPanelScopedSections = (
  panel: SystemInsightPanel,
  viewKey: string = 'all',
) => {
  if (viewKey === 'all') {
    return panel.sections.filter((section) => section.metrics.length > 0);
  }

  if (viewKey.startsWith('group:')) {
    return panel.sections.filter(
      (section) => section.groupKey === viewKey.replace('group:', '') && section.metrics.length > 0,
    );
  }

  return panel.sections.filter((section) => section.key === viewKey && section.metrics.length > 0);
};

export const getSystemPanelSectionTabs = (panel: SystemInsightPanel, viewKey: string = 'all') => {
  if (panel.key !== 'blood') {
    return [];
  }

  const scopedSections = getSystemPanelScopedSections(panel, viewKey);
  if (!scopedSections.length) {
    return [];
  }

  const sectionTabs = scopedSections.map((section) => ({
    key: section.key,
    label: section.title,
  }));

  if (scopedSections.length === 1) {
    return sectionTabs;
  }

  return [{ key: 'all', label: '全部' }, ...sectionTabs];
};

export const getSystemPanelHeroMetrics = (
  panel: SystemInsightPanel,
  viewKey: string = 'all',
  subViewKey: string = 'all',
) => {
  const sourceSections =
    subViewKey !== 'all'
      ? panel.sections.filter((section) => section.key === subViewKey && section.metrics.length > 0)
      : viewKey === 'all'
        ? panel.sections.filter(
            (section) => section.priority === 'core' && section.metrics.length > 0,
          )
        : getSystemPanelScopedSections(panel, viewKey);

  if (sourceSections.length === 0) {
    return [];
  }

  const sourceMetrics = sourceSections.flatMap((section) => section.metrics);

  const picked: ReportInsightMetric[] = [];
  const seen = new Set<string>();

  SYSTEM_HERO_LABELS[panel.key].forEach((label) => {
    const metric = sourceMetrics.find((item) => item.label === label);
    if (metric && !seen.has(metric.label)) {
      picked.push(metric);
      seen.add(metric.label);
    }
  });

  sourceMetrics.forEach((metric) => {
    if (picked.length >= 4 || seen.has(metric.label)) {
      return;
    }
    picked.push(metric);
    seen.add(metric.label);
  });

  return picked.slice(0, 4);
};

const latestDocForField = (docs: DocumentLike[], keys: string[], docTypes?: string[]) => {
  const candidates = docs
    .filter((doc) => {
      if (docTypes?.length && !docTypes.includes(getDocumentType(doc))) {
        return false;
      }
      return Boolean(pickField(doc.ocrPayload?.fields, keys));
    })
    .sort((a, b) => new Date(b.uploadedAt ?? 0).getTime() - new Date(a.uploadedAt ?? 0).getTime());

  return candidates[0];
};

const resolveMetric = (docs: DocumentLike[], keys: string[], docTypes?: string[]) => {
  const doc = latestDocForField(docs, keys, docTypes);
  const value = pickField(doc?.ocrPayload?.fields, keys);
  return {
    value,
    date: formatDate(pickFieldValue(doc, ['reportTime', 'report_time']) ?? doc?.uploadedAt ?? null),
  };
};

const buildMetric = (
  docs: DocumentLike[],
  label: string,
  keys: string[],
  docTypes?: string[],
): ReportInsightMetric | null => {
  const resolved = resolveMetric(docs, keys, docTypes);
  if (!resolved.value) {
    return null;
  }

  return {
    label,
    value: resolved.value,
    date: resolved.date,
  };
};

const buildMetricSection = (
  key: string,
  title: string,
  defs: Array<{ label: string; keys: string[]; docTypes?: string[] }>,
  docs: DocumentLike[],
  priority: 'core' | 'secondary' = 'secondary',
  groupKey?: 'fshd_related' | 'other',
  groupLabel?: string,
): SystemInsightSection | null => {
  const metrics = defs
    .map((def) => buildMetric(docs, def.label, def.keys, def.docTypes))
    .filter((item): item is ReportInsightMetric => Boolean(item));

  if (!metrics.length) {
    return null;
  }

  return { key, title, metrics, priority, groupKey, groupLabel };
};

const flattenSections = (sections: SystemInsightSection[]) =>
  sections.flatMap((section) => section.metrics);

const getPanelState = (
  sections: SystemInsightSection[],
): Pick<SystemInsightPanel, 'state' | 'stateLabel'> => {
  const metricCount = flattenSections(sections).length;
  if (metricCount === 0) {
    return { state: 'missing', stateLabel: '缺失' };
  }

  const coreSections = sections.filter((section) => section.priority === 'core');
  const coveredCoreSections = coreSections.filter((section) => section.metrics.length > 0);
  if (coreSections.length > 0 && coveredCoreSections.length === coreSections.length) {
    return { state: 'updated', stateLabel: '已覆盖' };
  }

  return { state: 'partial', stateLabel: '部分覆盖' };
};

const buildCoverageSummary = (
  coverage: string[],
  state: SystemInsightPanel['state'],
  missingText: string,
  completeText: string,
  partialText: string,
) => {
  if (state === 'missing') {
    return missingText;
  }

  const joined = coverage.join('、');
  if (state === 'updated') {
    return `已覆盖 ${joined}，${completeText}`;
  }

  return `当前已识别 ${joined}，${partialText}`;
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

const MRI_TEXT_PATTERNS = ['mri', '脂肪浸润', '前锯', 'hamstring', '臀肌', '胫前'];

const collectMriDocuments = (docs: DocumentLike[]) => {
  const byKey = new Map<string, DocumentLike>();
  [
    ...filterDocsByTypes(docs, ['muscle_mri', 'mri']),
    ...filterDocsContainingText(docs, MRI_TEXT_PATTERNS),
  ].forEach((doc, index) => {
    const mapKey =
      `${doc.uploadedAt ?? 'no-time'}::${getDocumentType(doc)}::${JSON.stringify(doc.ocrPayload?.fields ?? {})}` ||
      `fallback-${index}`;
    byKey.set(mapKey, doc);
  });

  return [...byKey.values()].sort(
    (a, b) => new Date(b.uploadedAt ?? 0).getTime() - new Date(a.uploadedAt ?? 0).getTime(),
  );
};

export const buildLatestMriVisualization = (docs: DocumentLike[]): LatestMriVisualization => {
  const sourceDocument = collectMriDocuments(docs)[0] ?? null;

  if (!sourceDocument) {
    return {
      regions: {},
      findings: [],
      latestDate: '—',
      summary: '等待 MRI 结构化结果',
      hasFindings: false,
      sourceDocument: null,
    };
  }

  const inferred = inferMriBodyMap(sourceDocument.ocrPayload ?? null);
  const impression = pickFieldValue(sourceDocument, [
    'reportImpression',
    'report_impression',
    'impressionText',
    'impression_text',
  ]);
  const finding = pickFieldValue(sourceDocument, ['findingText', 'finding_text']);
  const summary =
    inferred.findings.length > 0
      ? `影像提示：${inferred.findings.join('、')}`
      : compactText(
          impression ?? finding ?? sourceDocument.ocrPayload?.extractedText,
          '等待 MRI 结构化结果',
        );

  return {
    regions: inferred.regions,
    findings: inferred.findings,
    latestDate:
      formatDate(
        pickFieldValue(sourceDocument, ['reportTime', 'report_time']) ??
          sourceDocument.uploadedAt ??
          null,
      ) ?? '—',
    summary,
    hasFindings: inferred.hasFindings,
    sourceDocument,
  };
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
  const latestMri = collectMriDocuments(docs)[0];
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

  const mriDoc = latestMri;
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
  const myoglobin = pickField(bloodFields, ['myoglobin', 'MYO', 'Myo', 'MB', 'Mb', 'mb']);
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
      : compactText(respiratoryDoc?.ocrPayload?.extractedText, '暂无呼吸检查数据');

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
      : compactText(cardiacDoc?.ocrPayload?.extractedText, '暂无心脏检查数据');

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
  const mriHighlights = [mriImpression, mriFinding]
    .filter((value): value is string => Boolean(value))
    .map((value) => compactText(value, value));

  const diagnosisPanelMetrics: ReportInsightMetric[] = [
    {
      label: '分型',
      value: geneticType ?? '—',
      date: formatDate(latestGenetic?.uploadedAt ?? null),
    },
    {
      label: 'D4Z4',
      value: d4z4Repeats ?? '—',
      date: formatDate(latestGenetic?.uploadedAt ?? null),
    },
    {
      label: '单倍型',
      value: haplotype ?? '—',
      date: formatDate(latestGenetic?.uploadedAt ?? null),
    },
    {
      label: '甲基化',
      value: methylationValue ?? '—',
      date: formatDate(latestGenetic?.uploadedAt ?? null),
    },
  ].filter((item) => item.value && item.value !== '—');

  const respiratoryPattern = resolveMetric(
    docs,
    ['ventilatoryPattern', 'ventilatory_pattern'],
    ['pulmonary_function'],
  );
  const respiratoryFvc = resolveMetric(
    docs,
    ['fvcPredPct', 'fvc_pred_pct'],
    ['pulmonary_function'],
  );
  const respiratoryFev1 = resolveMetric(
    docs,
    ['fev1PredPct', 'fev1_pred_pct'],
    ['pulmonary_function'],
  );
  const respiratoryTlc = resolveMetric(
    docs,
    ['tlcPredPct', 'tlc_pred_pct'],
    ['pulmonary_function'],
  );
  const respiratoryDlco = resolveMetric(
    docs,
    ['dlcoPredPct', 'dlco_pred_pct'],
    ['pulmonary_function'],
  );
  const diaphragmSummaryMetric = resolveMetric(
    docs,
    ['diaphragmMotionSummary', 'diaphragm_motion_summary'],
    ['diaphragm_ultrasound'],
  );
  const diaphragmThickeningMetric = resolveMetric(
    docs,
    ['diaphragmThickeningSummary', 'diaphragm_thickening_summary'],
    ['diaphragm_ultrasound'],
  );

  const cardiacHr = resolveMetric(docs, ['heartRate', 'heart_rate'], ['ecg']);
  const cardiacQtc = resolveMetric(docs, ['qtcMs', 'qtc_ms', 'QTc', 'qtc'], ['ecg']);
  const cardiacLvef = resolveMetric(docs, ['LVEF', 'lvef'], ['echocardiography']);
  const cardiacRhythm = resolveMetric(docs, ['ecgRhythm', 'ecg_rhythm'], ['ecg']);
  const cardiacEcgSummary = resolveMetric(docs, ['ecgSummary', 'ecg_summary'], ['ecg']);
  const cardiacEchoSummary = resolveMetric(
    docs,
    ['echoSummary', 'echo_summary'],
    ['echocardiography'],
  );

  const labCk = resolveMetric(
    docs,
    ['creatineKinase', 'creatine_kinase', 'CK', 'ck'],
    ['muscle_enzyme', 'biochemistry'],
  );
  const labMb = resolveMetric(
    docs,
    ['myoglobin', 'MYO', 'Myo', 'MB', 'Mb', 'mb'],
    ['muscle_enzyme', 'biochemistry'],
  );
  const labLdh = resolveMetric(docs, ['LDH', 'ldh'], ['muscle_enzyme', 'biochemistry']);
  const labCkmb = resolveMetric(docs, ['CKMB', 'ckmb'], ['muscle_enzyme', 'biochemistry']);
  const labCreatinine = resolveMetric(docs, ['creatinine'], ['biochemistry']);
  const labUricAcid = resolveMetric(docs, ['uricAcid', 'uric_acid'], ['biochemistry']);
  const labWbc = resolveMetric(docs, ['wbc'], ['blood_routine']);
  const labHgb = resolveMetric(docs, ['hgb'], ['blood_routine']);
  const labPlt = resolveMetric(docs, ['plt'], ['blood_routine']);
  const labFt3 = resolveMetric(docs, ['ft3'], ['thyroid_function']);
  const labFt4 = resolveMetric(docs, ['ft4'], ['thyroid_function']);
  const labTsh = resolveMetric(docs, ['tsh'], ['thyroid_function']);
  const labPt = resolveMetric(docs, ['pt'], ['coagulation']);
  const labAptt = resolveMetric(docs, ['aptt'], ['coagulation']);
  const labFibrinogen = resolveMetric(docs, ['fibrinogen'], ['coagulation']);
  const labDdimer = resolveMetric(docs, ['dDimer', 'd_dimer'], ['coagulation']);

  const imagingPanelMetrics: ReportInsightMetric[] = [
    {
      label: '重点区域',
      value: mriHighlights.length > 0 ? mriHighlights.join('、') : '—',
      date: formatDate(mriReportTime ?? mriDoc?.uploadedAt ?? null),
    },
  ].filter((item) => item.value && item.value !== '—');

  const bloodSections = [
    buildMetricSection(
      'fshd_core',
      '肌损伤',
      [
        {
          label: 'CK',
          keys: ['creatineKinase', 'creatine_kinase', 'CK', 'ck'],
          docTypes: ['muscle_enzyme', 'biochemistry'],
        },
        {
          label: 'Mb',
          keys: ['myoglobin', 'MYO', 'Myo', 'MB', 'Mb', 'mb'],
          docTypes: ['muscle_enzyme', 'biochemistry'],
        },
        { label: 'LDH', keys: ['LDH', 'ldh'], docTypes: ['muscle_enzyme', 'biochemistry'] },
        { label: 'CKMB', keys: ['CKMB', 'ckmb'], docTypes: ['muscle_enzyme', 'biochemistry'] },
      ],
      docs,
      'core',
      'fshd_related',
      'FSHD相关',
    ),
    buildMetricSection(
      'metabolic',
      '代谢/肾功能',
      [
        { label: 'Cr', keys: ['creatinine'], docTypes: ['biochemistry'] },
        { label: 'UA', keys: ['uricAcid', 'uric_acid'], docTypes: ['biochemistry'] },
      ],
      docs,
      'secondary',
      'fshd_related',
      'FSHD相关',
    ),
    buildMetricSection(
      'blood_routine',
      '血常规',
      [
        { label: 'WBC', keys: ['wbc'], docTypes: ['blood_routine'] },
        { label: 'HGB', keys: ['hgb'], docTypes: ['blood_routine'] },
        { label: 'PLT', keys: ['plt'], docTypes: ['blood_routine'] },
      ],
      docs,
      'secondary',
      'other',
      '其他',
    ),
    buildMetricSection(
      'thyroid_function',
      '甲功',
      [
        { label: 'FT3', keys: ['ft3'], docTypes: ['thyroid_function'] },
        { label: 'FT4', keys: ['ft4'], docTypes: ['thyroid_function'] },
        { label: 'TSH', keys: ['tsh'], docTypes: ['thyroid_function'] },
      ],
      docs,
      'secondary',
      'other',
      '其他',
    ),
    buildMetricSection(
      'coagulation',
      '凝血',
      [
        { label: 'PT', keys: ['pt'], docTypes: ['coagulation'] },
        { label: 'APTT', keys: ['aptt'], docTypes: ['coagulation'] },
        { label: 'Fib', keys: ['fibrinogen'], docTypes: ['coagulation'] },
        { label: 'D-二聚体', keys: ['dDimer', 'd_dimer'], docTypes: ['coagulation'] },
      ],
      docs,
      'secondary',
      'other',
      '其他',
    ),
    buildMetricSection(
      'urinalysis',
      '尿常规',
      [
        { label: '尿蛋白', keys: ['urineProtein', 'urine_protein'], docTypes: ['urinalysis'] },
        {
          label: '尿潜血',
          keys: ['urineOccultBlood', 'urine_occult_blood'],
          docTypes: ['urinalysis'],
        },
        { label: '尿糖', keys: ['urineGlucose', 'urine_glucose'], docTypes: ['urinalysis'] },
        {
          label: '尿比重',
          keys: ['urineSpecificGravity', 'urine_specific_gravity'],
          docTypes: ['urinalysis'],
        },
        { label: '尿 pH', keys: ['urinePh', 'urine_ph'], docTypes: ['urinalysis'] },
      ],
      docs,
      'secondary',
      'other',
      '其他',
    ),
    buildMetricSection(
      'infection_screening',
      '感染筛查',
      [
        { label: 'HBsAg', keys: ['hbsag'], docTypes: ['infection_screening'] },
        { label: 'HIV', keys: ['hivAb', 'hiv_ab'], docTypes: ['infection_screening'] },
        { label: 'TPPA', keys: ['tppa'], docTypes: ['infection_screening'] },
        { label: 'TRUST', keys: ['trustAb', 'trust_ab'], docTypes: ['infection_screening'] },
      ],
      docs,
      'secondary',
      'other',
      '其他',
    ),
    buildMetricSection(
      'digestive_screening',
      '消化筛查',
      [
        {
          label: '粪便隐血',
          keys: ['stoolOccultBlood', 'stool_occult_blood'],
          docTypes: ['stool_test'],
        },
        { label: 'HP DOB', keys: ['hpDob', 'hp_dob'], docTypes: ['stool_test'] },
        { label: 'HP 结果', keys: ['hpResult', 'hp_result'], docTypes: ['stool_test'] },
      ],
      docs,
      'secondary',
      'other',
      '其他',
    ),
  ].filter((item): item is SystemInsightSection => Boolean(item));

  const respiratorySections = [
    buildMetricSection(
      'pulmonary_function',
      '肺功能',
      [
        {
          label: '通气模式',
          keys: ['ventilatoryPattern', 'ventilatory_pattern'],
          docTypes: ['pulmonary_function'],
        },
        {
          label: 'FVC %Pred',
          keys: ['fvcPredPct', 'fvc_pred_pct'],
          docTypes: ['pulmonary_function'],
        },
        {
          label: 'FEV1 %Pred',
          keys: ['fev1PredPct', 'fev1_pred_pct'],
          docTypes: ['pulmonary_function'],
        },
        {
          label: 'TLC %Pred',
          keys: ['tlcPredPct', 'tlc_pred_pct'],
          docTypes: ['pulmonary_function'],
        },
        {
          label: 'DLCO %Pred',
          keys: ['dlcoPredPct', 'dlco_pred_pct'],
          docTypes: ['pulmonary_function'],
        },
      ],
      docs,
      'core',
    ),
    buildMetricSection(
      'diaphragm_ultrasound',
      '膈肌超声',
      [
        {
          label: '膈肌运动',
          keys: ['diaphragmMotionSummary', 'diaphragm_motion_summary'],
          docTypes: ['diaphragm_ultrasound'],
        },
        {
          label: '膈肌增厚',
          keys: ['diaphragmThickeningSummary', 'diaphragm_thickening_summary'],
          docTypes: ['diaphragm_ultrasound'],
        },
      ],
      docs,
      'core',
    ),
  ].filter((item): item is SystemInsightSection => Boolean(item));

  const cardiacSections = [
    buildMetricSection(
      'ecg',
      '心电图',
      [
        { label: '心电结论', keys: ['ecgSummary', 'ecg_summary'], docTypes: ['ecg'] },
        { label: '心率', keys: ['heartRate', 'heart_rate'], docTypes: ['ecg'] },
        { label: 'QTc', keys: ['qtcMs', 'qtc_ms', 'QTc', 'qtc'], docTypes: ['ecg'] },
        { label: '心律', keys: ['ecgRhythm', 'ecg_rhythm'], docTypes: ['ecg'] },
      ],
      docs,
      'core',
    ),
    buildMetricSection(
      'echocardiography',
      '心脏超声',
      [
        { label: 'LVEF', keys: ['LVEF', 'lvef'], docTypes: ['echocardiography'] },
        {
          label: '心超结论',
          keys: ['echoSummary', 'echo_summary'],
          docTypes: ['echocardiography'],
        },
      ],
      docs,
      'core',
    ),
  ].filter((item): item is SystemInsightSection => Boolean(item));

  const bloodPanelMetrics = flattenSections(bloodSections);
  const respiratoryPanelMetrics = flattenSections(respiratorySections);
  const cardiacPanelMetrics = flattenSections(cardiacSections);

  const bloodCoverage = collectCoverage(docs, [
    'muscle_enzyme',
    'biochemistry',
    'blood_routine',
    'thyroid_function',
    'coagulation',
    'urinalysis',
    'infection_screening',
    'stool_test',
  ]);
  const respiratoryCoverage = collectCoverage(docs, ['pulmonary_function', 'diaphragm_ultrasound']);
  const cardiacCoverage = collectCoverage(docs, ['ecg', 'echocardiography']);

  const bloodState = getPanelState(bloodSections);
  const respiratoryState = getPanelState(respiratorySections);
  const cardiacState = getPanelState(cardiacSections);

  const diagnosisPanel: ReportInsightPanel = {
    key: 'diagnosis',
    title: '诊断与分型',
    summary: compactText(geneEvidence || geneticType, '暂无可直接展示的诊断证据'),
    latestDate: formatDate(latestGenetic?.uploadedAt ?? null) ?? '—',
    metrics: diagnosisPanelMetrics,
  };

  const imagingPanel: ReportInsightPanel = {
    key: 'imaging',
    title: '肌肉 MRI',
    summary: compactText(mriSummary, '暂无 MRI 分析数据'),
    latestDate: formatDate(mriReportTime ?? mriDoc?.uploadedAt ?? null) ?? '—',
    metrics: imagingPanelMetrics,
  };

  const respiratoryPanel: SystemInsightPanel = {
    key: 'respiratory',
    title: '呼吸检查',
    summary: buildCoverageSummary(
      respiratoryCoverage,
      respiratoryState.state,
      '暂无呼吸检查数据',
      '肺功能与膈肌状态都可直接查看。',
      '建议继续补齐肺功能或膈肌超声。',
    ),
    latestDate: maxDate([
      respiratoryReportTime,
      respiratoryPattern.date,
      respiratoryFvc.date,
      respiratoryFev1.date,
      respiratoryTlc.date,
      respiratoryDlco.date,
      diaphragmSummaryMetric.date,
      diaphragmThickeningMetric.date,
    ]),
    metrics: respiratoryPanelMetrics,
    state: respiratoryState.state,
    stateLabel: respiratoryState.stateLabel,
    coverage: respiratoryCoverage,
    sourceCount: respiratoryCoverage.length,
    sections: respiratorySections,
  };

  const cardiacPanel: SystemInsightPanel = {
    key: 'cardiac',
    title: '心脏检查',
    summary: buildCoverageSummary(
      cardiacCoverage,
      cardiacState.state,
      '暂无心脏检查数据',
      '心电和心超指标都已进入监测视图。',
      '建议继续补齐 ECG 或心脏超声。',
    ),
    latestDate: maxDate([
      cardiacReportTime,
      cardiacHr.date,
      cardiacQtc.date,
      cardiacLvef.date,
      cardiacEcgSummary.date,
      cardiacEchoSummary.date,
      cardiacRhythm.date,
    ]),
    metrics: cardiacPanelMetrics,
    state: cardiacState.state,
    stateLabel: cardiacState.stateLabel,
    coverage: cardiacCoverage,
    sourceCount: cardiacCoverage.length,
    sections: cardiacSections,
  };

  const bloodPanel: SystemInsightPanel = {
    key: 'blood',
    title: '实验室检查',
    summary: buildCoverageSummary(
      bloodCoverage,
      bloodState.state,
      '暂无实验室检查数据',
      'FSHD 相关实验室指标和分类结果都可直接查看。',
      '已按 FSHD 相关、甲功、血常规等分类整理。',
    ),
    latestDate: maxDate([
      bloodReportTime,
      labCk.date,
      labMb.date,
      labLdh.date,
      labCkmb.date,
      labCreatinine.date,
      labUricAcid.date,
      labWbc.date,
      labHgb.date,
      labPlt.date,
      labFt3.date,
      labFt4.date,
      labTsh.date,
      labPt.date,
      labAptt.date,
      labFibrinogen.date,
      labDdimer.date,
    ]),
    metrics: bloodPanelMetrics,
    state: bloodState.state,
    stateLabel: bloodState.stateLabel,
    coverage: bloodCoverage,
    sourceCount: bloodCoverage.length,
    sections: bloodSections,
  };

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
    diagnosisPanel,
    imagingPanel,
    systemPanels: [respiratoryPanel, cardiacPanel, bloodPanel],
  };
};
