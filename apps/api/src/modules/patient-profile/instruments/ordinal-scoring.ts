import type {
  InstrumentItem,
  InstrumentItemResponse,
  InstrumentScoringOutcome,
} from './instrument.types.js';

/**
 * The scoring mechanism shared by every single-item ordinal scale.
 *
 * Brooke and Vignos each own a named, versioned scoring function
 * (`scoreBrookeV1`, `scoreVignosV1`) — that name is what gets written
 * into `instrument_administrations.scoring_method`, and it is what a
 * future re-scoring pass selects on. Those functions delegate here
 * rather than each carrying their own copy of the same forty lines,
 * because two copies of a validation rule drift and the drift is
 * invisible: it shows up as one scale quietly accepting a grade the
 * other rejects.
 *
 * Everything here is pure. No clock, no database, no logger. A scoring
 * function that can fail for an environmental reason cannot be
 * re-run over historical rows to reproduce a historical score, and
 * reproducing a historical score is the entire reason the method name
 * is stored.
 */
export const scoreSingleOrdinalItem = (
  item: InstrumentItem,
  responses: readonly InstrumentItemResponse[],
  scoringMethod: string,
): InstrumentScoringOutcome => {
  // Reject unknown item codes before looking for the one we want.
  // A body carrying an answer to an item this instrument does not
  // have is either a client bug or a caller aiming at a different
  // scale; silently ignoring it would score the administration from
  // whatever happened to match and report full completeness.
  const unknown = responses.find((response) => response.itemCode !== item.code);
  if (unknown) {
    return {
      ok: false,
      reasonCode: 'unknown_item',
      messageZh: '提交的答案里有本量表没有的题目，请刷新后重试',
    };
  }

  const matching = responses.filter((response) => response.itemCode === item.code);

  if (matching.length === 0) {
    return {
      ok: false,
      reasonCode: 'missing_item',
      messageZh: '请先选择一个等级再提交',
    };
  }

  // The DB has a UNIQUE (administration_id, item_code), so two answers
  // to one item would fail on write anyway — but as a 500 after the
  // insert, not as an answerable 400 before it.
  if (matching.length > 1) {
    return {
      ok: false,
      reasonCode: 'duplicate_item',
      messageZh: '同一道题目提交了多个答案，请刷新后重试',
    };
  }

  const response = matching[0];

  // A single-item scale has no partial answer. See the note on
  // InstrumentScoringOutcome: refusing is the honest outcome, because
  // any number we invented here would land on a trend line as though
  // the patient had said it.
  if (response.skipped || response.notApplicable || response.responseValue == null) {
    return {
      ok: false,
      reasonCode: 'unanswered_item',
      messageZh: '本量表只有一道题目，跳过就没有分数可记录了',
    };
  }

  const value = response.responseValue;
  const allowed = item.levels.some((level) => level.value === value);
  if (!allowed) {
    return {
      ok: false,
      reasonCode: 'value_out_of_range',
      messageZh: '选择的等级不在本量表的范围内',
    };
  }

  return {
    ok: true,
    score: {
      rawScore: value,
      // Equal for these scales, and separate columns on purpose — see
      // the raw_score / scored_value note in migration 022.
      scoredValue: value,
      completeness: 1,
      scoringMethod,
    },
  };
};
