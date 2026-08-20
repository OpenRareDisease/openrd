import { describe, expect, it } from 'vitest';

import { CTGOV_STATUS_ZH, translateCtgovStatus } from './status-map.js';

describe('the ctgov status map', () => {
  it('says exactly the six words the contract fixed', () => {
    expect([...CTGOV_STATUS_ZH.entries()]).toEqual([
      ['RECRUITING', '招募中'],
      ['ACTIVE_NOT_RECRUITING', '进行中·不再招募'],
      ['COMPLETED', '已完成'],
      ['TERMINATED', '已终止'],
      ['WITHDRAWN', '已撤回'],
      ['NOT_YET_RECRUITING', '尚未开始招募'],
    ]);
  });

  it('leaves a word it does not know in English rather than guessing', () => {
    // Both of these are live values — 7 and 3 of the 92 studies in the
    // 2026-08-13 capture. `ENROLLING_BY_INVITATION` is the one where a
    // careless 「招募中」 would send a patient to ask about a trial that
    // is not taking enquiries.
    expect(translateCtgovStatus('UNKNOWN')).toBeNull();
    expect(translateCtgovStatus('ENROLLING_BY_INVITATION')).toBeNull();
    expect(translateCtgovStatus('SUSPENDED')).toBeNull();
    expect(translateCtgovStatus('')).toBeNull();
  });

  it('does not answer for a prototype key', () => {
    // The reason this is a Map: `({} as Record<string, string>).constructor`
    // is truthy, and this value goes into a column a patient reads.
    expect(translateCtgovStatus('constructor')).toBeNull();
    expect(translateCtgovStatus('__proto__')).toBeNull();
    expect(translateCtgovStatus('toString')).toBeNull();
  });

  it('translates the words it does know', () => {
    expect(translateCtgovStatus('RECRUITING')).toBe('招募中');
    // The old corpus snapshot rendered this one 「招聘」 — a job
    // opening. That is what this map exists to make impossible.
    expect(translateCtgovStatus('RECRUITING')).not.toBe('招聘');
    expect(translateCtgovStatus('COMPLETED')).toBe('已完成');
  });
});
