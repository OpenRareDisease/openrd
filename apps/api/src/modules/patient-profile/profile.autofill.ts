import { readGeneticEvidence, type GeneticEvidenceDocumentLike } from './genetic-evidence.js';

/**
 * WHICH REPORT THIS FILLS FROM IS NOT DECIDED HERE.
 *
 * It used to be: this module took the newest document typed
 * `genetic_report`, falling back to the newest document carrying any
 * genetic key. That rule disagreed with the one the passport uses, and
 * both answers reached a reader at once — the passport printing one
 * report's D4Z4 count, the registry export printing another's, neither
 * page saying the other existed. `pickGeneticEvidenceDocument` is the
 * single answer and `readGeneticEvidence` reads the values off it, so
 * what lands in the baseline is what the passport shows.
 */
export type AutofillDocumentLike = GeneticEvidenceDocumentLike;

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

const deriveGeneticReportAutofill = (
  documents: AutofillDocumentLike[],
): GeneticReportAutofill | null => {
  const reading = readGeneticEvidence(documents);
  const diagnosisDate = normalizeDate(reading.diagnosisDate);

  if (
    !reading.diagnosisType &&
    !reading.d4z4 &&
    !reading.haplotype &&
    !reading.methylation &&
    !diagnosisDate
  ) {
    return null;
  }

  return {
    diagnosisType: reading.diagnosisType,
    d4z4: reading.d4z4,
    haplotype: reading.haplotype,
    methylation: reading.methylation,
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

  // EVERY FIELD BELOW IS A VALUE THE REPORT PRINTED, COPIED AS PRINTED.
  //
  // That is the whole of what this function is allowed to do, and the
  // rule it is now written to. 分型, D4Z4 重复数, 单倍型 and 甲基化 are
  // the laboratory's statements about this patient, so a report is a
  // source for them; `foundation.diagnosisYear` below is the year part
  // of the 诊断日期 the report itself carries, which is the same kind of
  // copy in a different shape.
  //
  // 「是否确诊 FSHD」 IS NOT ONE OF THEM, AND IS NOT WRITTEN HERE ANY
  // MORE. That field is the patient's own answer to whether a doctor has
  // diagnosed them — it is answered by the patient and by nobody else,
  // and no report can supply it. This function used to assert it `true`
  // whenever any of the four cells above stated a result, which put an
  // answer this platform invented into the archive under the patient's
  // question. The archive is not a page: unlike a sentence on the
  // passport it survives a re-read of the report, and the portable
  // exports read it back.
  //
  // It is also not the same fact as 基因确诊. Molecular confirmation is
  // what the evidence gate decides off the report and is derived, never
  // stored (`geneticallyConfirmed` in profile.passport.ts); a patient
  // can carry a clinical diagnosis without it, and the two may disagree.
  // Both are kept, and neither is written from the other.
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
