/**
 * The shape of a measurement instrument, and of one scoring pass over
 * it.
 *
 * WHY A REGISTRY AT ALL, INSTEAD OF TWO ENDPOINTS
 *
 * The app's previous idea of a score was five self-rated movements
 * averaged into one number. That number is private to this app: it
 * cannot be handed to a neurologist, matched against natural-history
 * data, or used to answer 「我还符合那个临床试验的入组条件吗」. The
 * fix is not a better private number, it is published instruments —
 * and published instruments arrive with baggage that a hard-coded
 * pair of endpoints has nowhere to put: a licence, a citation, a
 * recall period, a direction (these two count UPWARD as function is
 * lost), a version, and a scoring rule that must stay pinned to the
 * wording it was written against.
 *
 * So every instrument is a value of `InstrumentDefinition`, its
 * scoring is a pure function that takes item responses and returns a
 * score or a refusal, and both are versioned. `scoringMethod` is
 * written into every stored row so that a scoring rule found to be
 * wrong next year can be re-run over exactly the administrations it
 * produced, rather than over a guess.
 */

export type InstrumentLicenceStatus =
  | 'public_domain'
  | 'free_with_attribution'
  | 'permission_required'
  | 'unknown';

/** One behavioural anchor: a level of one item. */
export interface InstrumentLevel {
  /** The ordinal value stored in `instrument_item_responses.response_value`. */
  value: number;
  /** What the patient reads. Chinese, behavioural, no jargon. */
  labelZh: string;
  /**
   * The published English wording this anchor is a translation of,
   * verbatim. Kept in the code, not in a doc: a translation whose
   * source is not next to it is a translation nobody can check, and
   * this is the text that decides which grade a patient's life gets
   * filed under.
   */
  sourceEn: string;
}

export interface InstrumentItem {
  /** Stable code stored in `instrument_item_responses.item_code`. */
  code: string;
  /** Versioned independently of the instrument — see migration 022. */
  version: string;
  /** The question, in Chinese. */
  promptZh: string;
  levels: readonly InstrumentLevel[];
}

/** One patient answer, as it arrives from the API. */
export interface InstrumentItemResponse {
  itemCode: string;
  responseValue: number | null;
  skipped: boolean;
  notApplicable: boolean;
}

export interface InstrumentScore {
  rawScore: number;
  scoredValue: number;
  /** Fraction of scorable items answered, 0..1. */
  completeness: number;
  scoringMethod: string;
}

/**
 * A scoring pass either produces a score or refuses, with a reason the
 * patient can read.
 *
 * It returns a refusal rather than throwing, and rather than returning
 * a partial score, because a scale with one item has no meaningful
 * partial answer: half of one item is not a low score, it is no score.
 * Storing a placeholder would put a number on a trend line that no
 * patient ever gave.
 */
export type InstrumentScoringOutcome =
  | { ok: true; score: InstrumentScore }
  | { ok: false; reasonCode: InstrumentScoringRefusal; messageZh: string };

export type InstrumentScoringRefusal =
  | 'missing_item'
  | 'unanswered_item'
  | 'unknown_item'
  | 'duplicate_item'
  | 'value_out_of_range';

export interface InstrumentDefinition {
  key: string;
  version: string;
  nameZh: string;
  licenceStatus: InstrumentLicenceStatus;
  /** Primary source + wording source + self-report evidence, in one string. */
  sourceCitation: string;
  scoreMin: number;
  scoreMax: number;
  /** TRUE for both instruments here: a higher grade means less function. */
  higherIsWorse: boolean;
  recallPeriod: string;
  adminMinutes: number;
  /** One or two sentences the patient sees before starting. */
  descriptionZh: string;
  /**
   * What this instrument is known to get WRONG for FSHD, in the
   * patient's language, sourced.
   *
   * Not optional and not a footnote. Both scales were designed for
   * Duchenne and both have documented floor effects in slowly
   * progressive dystrophies — a patient can sit at the best grade for
   * years while their life changes underneath them, and if the app
   * presents that flat line as "stable" it has told them something
   * untrue. The catalogue endpoint ships this alongside the anchors so
   * the screen has no way to render the scale without it.
   */
  limitationsZh: readonly string[];
  /** The self-report reliability evidence, in the patient's language. */
  selfReportEvidenceZh: string;
  items: readonly InstrumentItem[];
  scoringMethod: string;
  score: (responses: readonly InstrumentItemResponse[]) => InstrumentScoringOutcome;
}
