import { readGeneticEvidence, type GeneticEvidenceDocumentLike } from './genetic-evidence.js';
import { reportsAbsence } from './profile.passport.js';

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

/**
 * A CELL THAT STATES SOMETHING ABOUT THIS PATIENT.
 *
 * `hasMeaningfulValue` asks whether the cell has characters in it, and
 * 「未检出」 has characters in it. That is the whole of what asserted
 * 「是否确诊 FSHD」 below: a genetics report whose only genetic content
 * was a D4Z4 cell reading 未检出 wrote `diagnosedFshd: true` into the
 * baseline — and the baseline is the archive, so unlike a sentence on a
 * page it is still there after the report is re-read, and the portable
 * exports read it back.
 *
 * `reportsAbsence` and not a second predicate here: it is the passport's
 * own reader, applied to the same cells, and the two have to reach the
 * same answer about one report. The VALUES are still written as the
 * report printed them — an archive that silently dropped 未检出 would
 * lose what the laboratory said — so this gates the assertion only.
 */
const cellStatesResult = (value: string | null) =>
  hasMeaningfulValue(value) && !reportsAbsence(value);

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
    (cellStatesResult(derived.diagnosisType) ||
      cellStatesResult(derived.d4z4) ||
      cellStatesResult(derived.haplotype) ||
      cellStatesResult(derived.methylation))
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
