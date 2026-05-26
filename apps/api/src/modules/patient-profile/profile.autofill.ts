type OcrPayloadLike = {
  fields?: Record<string, unknown>;
} | null;

export interface AutofillDocumentLike {
  documentType: string | null;
  uploadedAt: string | null;
  ocrPayload: OcrPayloadLike | unknown;
}

export interface AutofillProfileLike {
  diagnosisDate: string | null;
  geneticMutation: string | null;
  baseline: Record<string, unknown> | null;
}

interface GeneticReportAutofill {
  diagnosisType: string | null;
  d4z4: string | null;
  haplotype: string | null;
  methylation: string | null;
  diagnosisDate: string | null;
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
};

const pickTextField = (record: Record<string, unknown> | null, keys: string[]) => {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
};

const hasMeaningfulValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return true;
};

const normalizeDate = (value: string | null) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  const yearFirst = value.match(/((?:19|20)\d{2})[./-年](\d{1,2})[./-月](\d{1,2})/);
  if (yearFirst) {
    const [, year, month, day] = yearFirst;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return null;
};

const extractYear = (value: string | null) => {
  if (!value) {
    return null;
  }

  const normalized = normalizeDate(value);
  if (normalized) {
    return Number(normalized.slice(0, 4));
  }

  const yearMatch = value.match(/(?:19|20)\d{2}/);
  return yearMatch ? Number(yearMatch[0]) : null;
};

const getTimestamp = (value: string | null) => {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const getDocumentType = (document: AutofillDocumentLike) => {
  const payload = asRecord(document.ocrPayload);
  const fields = asRecord(payload?.fields);
  return (
    pickTextField(fields, ['classifiedType', 'classified_type', 'reportType', 'report_type']) ||
    document.documentType ||
    'other'
  );
};

const latestDocument = (
  documents: AutofillDocumentLike[],
  predicate: (document: AutofillDocumentLike) => boolean,
) => {
  const matches = documents.filter(predicate);
  if (matches.length === 0) {
    return null;
  }

  return matches.reduce((latest, current) =>
    getTimestamp(current.uploadedAt) > getTimestamp(latest.uploadedAt) ? current : latest,
  );
};

const deriveGeneticReportAutofill = (
  documents: AutofillDocumentLike[],
): GeneticReportAutofill | null => {
  const latestGenetic = latestDocument(
    documents,
    (document) => getDocumentType(document) === 'genetic_report',
  );
  const fallbackGenetic = latestDocument(documents, (document) => {
    const payload = asRecord(document.ocrPayload);
    const fields = asRecord(payload?.fields);
    return Boolean(
      pickTextField(fields, [
        'diagnosisType',
        'diagnosis_type',
        'geneticType',
        'd4z4Repeats',
        'd4z4RepeatPathogenic',
        'd4z4_repeat_pathogenic',
        'haplotype',
        'haplotype4q',
        'methylationValue',
        'methylation_value',
      ]),
    );
  });

  const source = latestGenetic ?? fallbackGenetic;
  if (!source) {
    return null;
  }

  const payload = asRecord(source.ocrPayload);
  const fields = asRecord(payload?.fields);
  if (!fields) {
    return null;
  }

  const diagnosisType = pickTextField(fields, [
    'diagnosisType',
    'geneticType',
    'geneType',
    'diagnosis_type',
    'genetic_type',
  ]);
  const d4z4 = pickTextField(fields, [
    'd4z4Repeats',
    'd4z4RepeatPathogenic',
    'd4z4_repeat_pathogenic',
    'd4z4_repeats',
  ]);
  const haplotype = pickTextField(fields, ['haplotype', 'haplotype4q', 'haplotype_4q']);
  const methylation = pickTextField(fields, ['methylationValue', 'methylation_value']);
  const diagnosisDate = normalizeDate(pickTextField(fields, ['diagnosisDate', 'diagnosis_date']));

  if (!diagnosisType && !d4z4 && !haplotype && !methylation && !diagnosisDate) {
    return null;
  }

  return {
    diagnosisType,
    d4z4,
    haplotype,
    methylation,
    diagnosisDate,
  };
};

const assignMissingValue = (target: Record<string, unknown>, key: string, value: unknown) => {
  if (!hasMeaningfulValue(value) || hasMeaningfulValue(target[key])) {
    return false;
  }

  target[key] = value;
  return true;
};

export const applyGeneticReportAutofill = (
  profile: AutofillProfileLike,
  documents: AutofillDocumentLike[],
): AutofillProfileLike => {
  const derived = deriveGeneticReportAutofill(documents);
  if (!derived) {
    return profile;
  }

  const baseline = asRecord(profile.baseline) ?? {};
  const foundation = asRecord(baseline.foundation) ?? {};
  const diseaseBackground = asRecord(baseline.diseaseBackground) ?? {};

  const nextFoundation = { ...foundation };
  const nextDiseaseBackground = { ...diseaseBackground };

  let baselineChanged = false;
  baselineChanged =
    assignMissingValue(nextDiseaseBackground, 'diagnosisType', derived.diagnosisType) ||
    baselineChanged;
  baselineChanged =
    assignMissingValue(nextDiseaseBackground, 'd4z4', derived.d4z4) || baselineChanged;
  baselineChanged =
    assignMissingValue(nextDiseaseBackground, 'haplotype', derived.haplotype) || baselineChanged;
  baselineChanged =
    assignMissingValue(nextDiseaseBackground, 'methylation', derived.methylation) ||
    baselineChanged;

  if (
    !hasMeaningfulValue(nextDiseaseBackground.diagnosedFshd) &&
    (derived.diagnosisType || derived.d4z4 || derived.haplotype || derived.methylation)
  ) {
    nextDiseaseBackground.diagnosedFshd = true;
    baselineChanged = true;
  }

  const nextDiagnosisDate = normalizeDate(profile.diagnosisDate) ?? derived.diagnosisDate;
  const nextGeneticMutation = hasMeaningfulValue(profile.geneticMutation)
    ? profile.geneticMutation
    : derived.diagnosisType;
  const diagnosisYear = extractYear(nextDiagnosisDate);
  if (!hasMeaningfulValue(nextFoundation.diagnosisYear) && diagnosisYear) {
    nextFoundation.diagnosisYear = diagnosisYear;
    baselineChanged = true;
  }

  return {
    diagnosisDate: nextDiagnosisDate,
    geneticMutation: nextGeneticMutation,
    baseline: baselineChanged
      ? {
          ...baseline,
          foundation: nextFoundation,
          diseaseBackground: nextDiseaseBackground,
        }
      : profile.baseline,
  };
};
