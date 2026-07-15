/**
 * Instant feedback for a saved followup — the "data is working"
 * moment. Instead of a flat「已保存」, the dialog compares the values
 * just submitted against the previous record so every entry
 * immediately shows the patient something about themselves.
 *
 * Pure function so the comparison phrasing is unit-tested: this copy
 * makes implicit medical-adjacent statements (faster/slower), so it
 * must never mislabel the direction of change.
 */
export interface FollowupFeedbackInput {
  /** Seconds just submitted for the 10-step stair climb. */
  stairClimbSeconds: number;
  /** Previous stair-climb seconds, if any record exists. */
  previousStairClimbSeconds: number | null;
  /** 0-10 sleep score just submitted. */
  sleepScore: number;
  /** Previous sleep score, if any. */
  previousSleepScore: number | null;
  /** Total followup-shaped records AFTER this save (>= 1). */
  totalRecords: number;
}

/** Differences smaller than this are reported as「持平」— a 0.1s
 *  stopwatch delta is noise, not progress. */
const STAIR_EPSILON_SECONDS = 0.05;

const formatSeconds = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

export const buildFollowupFeedback = (input: FollowupFeedbackInput): string => {
  const lines: string[] = [];

  if (input.previousStairClimbSeconds === null) {
    lines.push('第一条上楼记录已保存，下次记录就能看到变化。');
  } else {
    // Lower is better for a timed climb.
    const delta = input.previousStairClimbSeconds - input.stairClimbSeconds;
    if (delta > STAIR_EPSILON_SECONDS) {
      lines.push(`上楼比上次快了 ${formatSeconds(delta)} 秒 👍`);
    } else if (delta < -STAIR_EPSILON_SECONDS) {
      lines.push(`上楼比上次慢了 ${formatSeconds(-delta)} 秒，注意休息，不必焦虑。`);
    } else {
      lines.push('上楼用时与上次基本持平。');
    }
  }

  if (input.previousSleepScore !== null) {
    const delta = input.sleepScore - input.previousSleepScore;
    if (delta > 0) {
      lines.push(`睡眠评分比上次高 ${delta} 分。`);
    } else if (delta < 0) {
      lines.push(`睡眠评分比上次低 ${-delta} 分。`);
    } else {
      lines.push('睡眠评分与上次持平。');
    }
  }

  lines.push(`已累计 ${Math.max(1, input.totalRecords)} 次随访记录，坚持记录能让趋势更可信。`);

  return lines.join('\n');
};
