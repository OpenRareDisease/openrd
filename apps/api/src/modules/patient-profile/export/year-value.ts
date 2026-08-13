/**
 * A year field with three answers, not two.
 *
 * THE FAILURE THIS PREVENTS
 *
 * The diagnostic odyssey in FSHD runs close to a decade, and by the
 * time someone is entering their history into an app, "which year did
 * you stop climbing stairs" is genuinely unanswerable for a large
 * share of this population. A form with only a number box has two
 * outcomes for that person: they leave it blank, or they guess.
 *
 * Blank and guessed are both wrong, and they are wrong in opposite
 * directions. A blank is read downstream as 「没问过」 — the registry
 * sees a gap and assumes the question was never put to the patient.
 * A guess is read as data and gets averaged into an age-at-onset
 * distribution. 「记不清了」 is neither: it is a real, informative
 * answer that says the question WAS asked and the patient does not
 * know. Collapsing it into either of the other two corrupts the field.
 *
 * So this module makes it a value:
 *
 *   { kind: 'year',      year: 2014 }   已知
 *   { kind: 'unknown' }                 记不清了 — asked, not remembered
 *   { kind: 'not_asked' }               never put to the patient
 *
 * WHAT ACTUALLY REACHES IT TODAY. `patient_profiles.baseline_payload`
 * is JSONB. The mobile baseline form writes years through
 * `baselineProfileSchema`, whose `z.coerce.number().int()` can only
 * produce a number or null — so the form CANNOT yet express
 * 「记不清了」, and today `decodeYear` returns `unknown` only for rows
 * written by a path that bypasses Zod (an import, a migration, a
 * support fix, all of which write this column directly). That is not
 * hypothetical enough to leave undecoded: the alternative on such a
 * row is `Number('记不清了') → NaN`, which is how a "don't remember"
 * becomes a blank. Teaching the mobile form to send it is a separate
 * lane; this module is what makes that a one-sided change.
 */

export type YearAnswer =
  | { readonly kind: 'year'; readonly year: number }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not_asked' };

/** The exact strings a non-Zod write path may have parked in the JSONB. */
const UNKNOWN_TOKENS = new Set(['记不清了', '记不清', '不记得', 'unknown', 'not_remembered']);

/** Outside this range a "year" is a typo or a unit mix-up, not a year. */
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

export const decodeYear = (raw: unknown): YearAnswer => {
  if (raw === null || raw === undefined) {
    return { kind: 'not_asked' };
  }

  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= MIN_YEAR && raw <= MAX_YEAR
      ? { kind: 'year', year: raw }
      : { kind: 'not_asked' };
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return { kind: 'not_asked' };
    if (UNKNOWN_TOKENS.has(trimmed)) return { kind: 'unknown' };
    // A bare 4-digit year, or the leading year of an ISO date — the
    // shape `diagnosis_date` arrives in when it is carried as text.
    const match = /^(\d{4})(?:[-/].*)?$/.exec(trimmed);
    if (match) {
      const year = Number(match[1]);
      if (year >= MIN_YEAR && year <= MAX_YEAR) return { kind: 'year', year };
    }
    // Anything else is free text we cannot honestly turn into a year.
    // NOT `unknown`: we do not know that the patient was ever asked.
    return { kind: 'not_asked' };
  }

  return { kind: 'not_asked' };
};

/**
 * `decodeYear` over several candidates, first real answer wins, and
 * 「记不清了」 beats a later blank. Order the candidates most-specific
 * first: an explicitly recorded diagnosis YEAR outranks the year
 * component of a diagnosis DATE, because the date may itself have
 * been reconstructed.
 */
export const decodeFirstYear = (...raws: readonly unknown[]): YearAnswer => {
  for (const raw of raws) {
    const decoded = decodeYear(raw);
    if (decoded.kind !== 'not_asked') return decoded;
  }
  return { kind: 'not_asked' };
};

export interface SerialisedYear {
  /** 「已知」/「记不清了」/「未采集」 — the answer, in the patient's language. */
  readonly answerZh: string;
  readonly answer: 'known' | 'not_remembered' | 'not_collected';
  /** Null for both non-year answers. Never a guessed year. */
  readonly year: number | null;
}

/**
 * The wire form. `year` and `answer` are BOTH emitted on purpose: a
 * consumer that reads only `year` sees null for「记不清了」and for
 * 「未采集」 alike and is no worse off than today, while a consumer
 * that reads `answer` can tell them apart. Emitting only `year` would
 * have thrown the distinction away at the last step.
 */
export const serialiseYear = (answer: YearAnswer): SerialisedYear => {
  switch (answer.kind) {
    case 'year':
      return { answer: 'known', answerZh: '已知', year: answer.year };
    case 'unknown':
      return { answer: 'not_remembered', answerZh: '记不清了', year: null };
    case 'not_asked':
      return { answer: 'not_collected', answerZh: '未采集', year: null };
  }
};
