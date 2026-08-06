/**
 * The rules behind 在家计时测试.
 *
 * Four of these tests exist because of a specific way a home
 * measurement lies, and each one goes red if that protection is
 * removed:
 *
 *  - elapsed time reconstructed from stamps, not accumulated, so a
 *    WeChat webview that suspends the page does not shrink the number;
 *  - a countdown that expired while the page was hidden clamps to its
 *    exact duration rather than to「now」;
 *  - the quality grade decides trend eligibility, and legacy rows this
 *    file never wrote are never excluded by it;
 *  - a standing test is not offered to someone home alone.
 */

import {
  ANTI_GRAVITY_ITEMS,
  MAX_RUN_MS,
  QUALITY_GRADES,
  TIMED_TESTS,
  buildFunctionTestPayload,
  countdownRemainingMs,
  decodeProtocolField,
  encodeProtocolField,
  findTimedTest,
  formatClock,
  formatSeconds,
  gateFor,
  isCountdownDone,
  isImplausibleRun,
  previousReadingFor,
  recentFall,
  runElapsedMs,
  shouldExcludeFromTrend,
  startRun,
  type TimedTestProtocol,
} from '../../../lib/timed-test-protocols';

const T0 = Date.UTC(2026, 6, 1, 9, 0, 0);

describe('elapsed time survives a suspended webview', () => {
  it('is end minus start, whatever happened in between', () => {
    const run = startRun(T0);
    // No ticks fired at all — the page was in the background for the
    // whole test, which is the ordinary case: the instruction on every
    // card is「按开始，把手机放下」. An accumulating timer reports ~0
    // here; this one reports the truth.
    expect(runElapsedMs(run, T0 + 12_400)).toBe(12_400);
  });

  it('freezes once stopped, and ignores the clock afterwards', () => {
    const run = { startedAt: T0, stoppedAt: T0 + 9_100, interrupted: false };
    expect(runElapsedMs(run, T0 + 600_000)).toBe(9_100);
  });

  it('never reports a negative elapsed if the clock steps backwards', () => {
    // NTP correction mid-run. Rare, but the alternative is a negative
    // measurement reaching Zod as a valid number.
    expect(runElapsedMs(startRun(T0), T0 - 5_000)).toBe(0);
  });

  it('flags a run longer than any test here as a forgotten stop', () => {
    const run = startRun(T0);
    expect(isImplausibleRun(run, T0 + MAX_RUN_MS - 1)).toBe(false);
    expect(isImplausibleRun(run, T0 + MAX_RUN_MS + 1)).toBe(true);
  });
});

describe('countdown', () => {
  const thirtySeconds = 30_000;

  it('counts down from the duration and stops at zero', () => {
    const run = startRun(T0);
    expect(countdownRemainingMs(run, T0, thirtySeconds)).toBe(30_000);
    expect(countdownRemainingMs(run, T0 + 29_000, thirtySeconds)).toBe(1_000);
    expect(countdownRemainingMs(run, T0 + 45_000, thirtySeconds)).toBe(0);
  });

  it('reports done for a window that expired while the page was hidden', () => {
    // The screen locked at second 3 and the patient came back four
    // minutes later. `isCountdownDone` is what lets the form clamp the
    // stop stamp to startedAt + duration instead of recording 243 秒 as
    // a 30-second test.
    expect(isCountdownDone(startRun(T0), T0 + 243_000, thirtySeconds)).toBe(true);
  });
});

describe('formatting', () => {
  it('shows one decimal of seconds', () => {
    expect(formatSeconds(12_449)).toBe('12.4');
    expect(formatSeconds(-5)).toBe('0.0');
  });

  it('shows minutes on the running clock, for the 2- and 6-minute walks', () => {
    expect(formatClock(0)).toBe('0:00.0');
    expect(formatClock(9_500)).toBe('0:09.5');
    expect(formatClock(125_300)).toBe('2:05.3');
  });
});

describe('the protocol field carries identity and grade', () => {
  it('round-trips every test at every grade', () => {
    for (const test of TIMED_TESTS) {
      for (const option of QUALITY_GRADES) {
        const encoded = encodeProtocolField(test.id, option.key);
        expect(decodeProtocolField(encoded)).toEqual({ testId: test.id, grade: option.key });
      }
    }
  });

  it('never exceeds the column, which would 400 as「保存失败」', () => {
    for (const test of TIMED_TESTS) {
      for (const option of QUALITY_GRADES) {
        expect(encodeProtocolField(test.id, option.key).length).toBeLessThanOrEqual(120);
      }
    }
  });

  it('stays readable without the parser', () => {
    expect(encodeProtocolField('ten_meter_walk', 'per_protocol')).toContain('10 米步行·按方案完成');
  });

  it('rejects a row this file did not write', () => {
    // The daily-record form still posts this exact string.
    expect(decodeProtocolField('连续上 10 级台阶')).toBeNull();
    expect(decodeProtocolField(null)).toBeNull();
    expect(decodeProtocolField('tt1|not_a_test|per_protocol|x')).toBeNull();
    expect(decodeProtocolField('tt1|ten_meter_walk|excellent|x')).toBeNull();
  });
});

describe('only 按方案完成 belongs on a trend line', () => {
  it('excludes 条件不完整 and 自由记录', () => {
    expect(shouldExcludeFromTrend(encodeProtocolField('sit_to_stand_5x', 'partial'))).toBe(true);
    expect(shouldExcludeFromTrend(encodeProtocolField('sit_to_stand_5x', 'free'))).toBe(true);
  });

  it('keeps 按方案完成', () => {
    expect(shouldExcludeFromTrend(encodeProtocolField('sit_to_stand_5x', 'per_protocol'))).toBe(
      false,
    );
  });

  it('never excludes a record from before this feature existed', () => {
    // The whole point of phrasing the rule as an exclusion. A consumer
    // that plotted only `per_protocol` would erase every 连续上 10 级台阶
    // record in production, and nothing this round removes anything a
    // patient already had.
    expect(shouldExcludeFromTrend('连续上 10 级台阶')).toBe(false);
    expect(shouldExcludeFromTrend(null)).toBe(false);
  });
});

describe('safety gate', () => {
  const test = (id: string): TimedTestProtocol => findTimedTest(id)!;

  it('withholds every standing test while the patient is home alone', () => {
    const standing = TIMED_TESTS.filter((entry) => entry.requiresStanding);
    expect(standing.length).toBeGreaterThanOrEqual(8);
    for (const entry of standing) {
      const gate = gateFor(entry, { companion: 'alone', hasRecentFall: false });
      expect(gate.state).not.toBe('open');
    }
  });

  it('does the same before the question has been answered at all', () => {
    // 'unknown' is the mount state. A screen that offered 30 秒坐站
    // before anyone asked would be issuing the instruction on its own
    // authority.
    expect(
      gateFor(test('sit_to_stand_30s'), { companion: 'unknown', hasRecentFall: false }).state,
    ).toBe('needs_companion');
  });

  it('still offers 握力, which is done sitting down', () => {
    expect(gateFor(test('grip_strength'), { companion: 'alone', hasRecentFall: false }).state).toBe(
      'open',
    );
  });

  it('withholds the 6-minute walk outright after a recent fall', () => {
    const gate = gateFor(test('six_minute_walk'), { companion: 'present', hasRecentFall: true });
    expect(gate.state).toBe('withheld');
  });

  it('gives the withheld reason priority over the companion question', () => {
    // Otherwise a patient who taps「有人」 watches 6 分钟步行 appear and
    // never learns it had been withheld, or why.
    const gate = gateFor(test('six_minute_walk'), { companion: 'alone', hasRecentFall: true });
    expect(gate.state).toBe('withheld');
  });

  it('keeps the 2-minute walk available with a companion after a fall', () => {
    // Withdrawing every walking measure from the patients declining
    // fastest is how a record goes quiet exactly when it matters.
    expect(
      gateFor(test('two_minute_walk'), { companion: 'present', hasRecentFall: true }).state,
    ).toBe('open');
  });
});

describe('recentFall', () => {
  const now = Date.UTC(2026, 6, 1, 12, 0, 0);

  it('finds a fall inside the window and returns the event so the date can be shown', () => {
    const found = recentFall(
      [
        { eventType: 'fall', occurredAt: '2026-05-20' },
        { eventType: 'fall', occurredAt: '2026-06-25' },
      ],
      now,
    );
    expect(found?.occurredAt).toBe('2026-06-25');
  });

  it('ignores falls older than the window', () => {
    expect(recentFall([{ eventType: 'fall', occurredAt: '2025-01-02' }], now)).toBeNull();
  });

  it('ignores events that are not falls', () => {
    expect(recentFall([{ eventType: 'started_afo', occurredAt: '2026-06-30' }], now)).toBeNull();
  });

  it('accepts a fall logged today despite the UTC-midnight date stamp', () => {
    // 'YYYY-MM-DD' parses as UTC midnight. In UTC+8 a fall logged this
    // morning is stamped in this device's future, and a strict guard
    // would silently drop the most alarming record on the screen.
    const beijingEarlyMorning = Date.UTC(2026, 6, 1, 0, 30, 0);
    expect(
      recentFall([{ eventType: 'fall', occurredAt: '2026-07-01' }], beijingEarlyMorning),
    ).not.toBeNull();
  });

  it('rejects a date far in the future rather than trusting it', () => {
    expect(recentFall([{ eventType: 'fall', occurredAt: '2027-01-01' }], now)).toBeNull();
  });
});

describe('every card states the conditions that make its number comparable', () => {
  it.each(TIMED_TESTS.map((test) => [test.nameZh, test] as const))('%s', (_name, test) => {
    const keys = test.sections.map((section) => section.key);
    // The five the brief requires of every card: the space and its
    // markings, the starting posture, the aid rule, the words to say,
    // and how many attempts count.
    for (const required of ['space', 'posture', 'aid', 'command', 'attempts'] as const) {
      expect(keys).toContain(required);
    }
  });

  it('gives every section a source, and never an empty one', () => {
    for (const test of TIMED_TESTS) {
      for (const section of test.sections) {
        expect(section.source.trim().length).toBeGreaterThan(0);
        expect(section.linesZh.length).toBeGreaterThan(0);
      }
    }
  });

  it('says out loud which cards are ours rather than a guideline', () => {
    // The four-step stair and the 2-minute walk are both home
    // adaptations of something the literature specifies differently
    // (14 steps; 6 minutes). If either ever stops saying so, this is
    // the assertion that catches it.
    const stair = findTimedTest('stair_four_step')!;
    expect(stair.sections.map((s) => s.linesZh.join('')).join('')).toContain('14');
    const twoMinute = findTimedTest('two_minute_walk')!;
    expect(twoMinute.sections.map((s) => s.linesZh.join('')).join('')).toContain('6 分钟步行');
  });

  it('gives a countdown test a duration and a label for what to enter', () => {
    for (const test of TIMED_TESTS) {
      if (test.measure !== 'countdown') continue;
      expect(test.countdownMs).toBeGreaterThan(0);
      expect(test.valueLabelZh).toBeTruthy();
    }
  });
});

describe('payloads', () => {
  const walk = findTimedTest('ten_meter_walk')!;

  it('sends the grade in `protocol` and the aids in `deviceUsed`', () => {
    const payload = buildFunctionTestPayload({
      test: walk,
      grade: 'per_protocol',
      measuredValue: 11.2,
      notApplicable: false,
      aidKeys: ['cane', 'afo'],
      venueNote: '家里客厅东西向',
      submissionId: 'sub-1',
    });

    expect(payload.testType).toBe('ten_meter_walk');
    expect(payload.unit).toBe('sec');
    expect(payload.measuredValue).toBe(11.2);
    expect(payload.protocol).toBe(encodeProtocolField('ten_meter_walk', 'per_protocol'));
    expect(payload.deviceUsed).toBe('AFO 踝足矫形器、手杖');
    // Aids are not a person helping.
    expect(payload.assistanceRequired).toBe(false);
    expect(payload.notes).toContain('测量地点：家里客厅东西向');
    // The grade lives in one place only. Duplicating a typed field into
    // free text is how「今天做不了」 once ended up in `notes`, where the
    // one consumer that needed it could not read it.
    expect(payload.notes).not.toContain('按方案完成');
  });

  it('marks a human steadying the patient as assistance', () => {
    const payload = buildFunctionTestPayload({
      test: walk,
      grade: 'partial',
      measuredValue: 18,
      notApplicable: false,
      aidKeys: ['person'],
      venueNote: '',
      submissionId: 'sub-1',
    });
    expect(payload.assistanceRequired).toBe(true);
  });

  it('sends 今天做不了 as a row with no value and no unit', () => {
    const payload = buildFunctionTestPayload({
      test: walk,
      grade: 'partial',
      measuredValue: 12,
      notApplicable: true,
      aidKeys: [],
      venueNote: '',
      submissionId: 'sub-1',
    });
    // The server refuses a body carrying both, and the refine message
    // names both fields. Sending a stale typed value alongside the flag
    // would turn a legitimate record into a 400.
    expect(payload.measuredValue).toBeNull();
    expect(payload.unit).toBeNull();
    expect(payload.notApplicable).toBe(true);
  });

  it('names the anti-gravity item, because four of them share one testType', () => {
    const antiGravity = findTimedTest('anti_gravity_four')!;
    const payload = buildFunctionTestPayload({
      test: antiGravity,
      grade: 'per_protocol',
      measuredValue: 1,
      notApplicable: false,
      aidKeys: [],
      venueNote: '',
      submissionId: 'sub-1',
      antiGravityItemKey: 'step_down',
    });
    expect(payload.notes).toContain('下一级');
    expect(payload.notes).toContain('step-down');
    // The anchor travels with the number, never a bare 1.
    expect(payload.notes).toContain('要用手撑腿');
  });

  it('covers all four items', () => {
    expect(ANTI_GRAVITY_ITEMS.map((item) => item.key)).toEqual([
      'sit_to_stand',
      'stand_to_sit',
      'step_up',
      'step_down',
    ]);
  });
});

describe('previousReadingFor', () => {
  it('picks the latest record of that test and reads its venue back out', () => {
    const previous = previousReadingFor('ten_meter_walk', [
      {
        testType: 'ten_meter_walk',
        measuredValue: 14.2,
        protocol: encodeProtocolField('ten_meter_walk', 'per_protocol'),
        deviceUsed: '手杖',
        notes: '测量地点：家里客厅东西向',
        performedAt: '2026-05-01T02:00:00.000Z',
      },
      {
        testType: 'ten_meter_walk',
        measuredValue: 15.8,
        protocol: encodeProtocolField('ten_meter_walk', 'partial'),
        deviceUsed: '无',
        notes: '测量地点：小区连廊',
        performedAt: '2026-06-01T02:00:00.000Z',
      },
    ]);

    expect(previous?.value).toBe(15.8);
    expect(previous?.grade).toBe('partial');
    expect(previous?.venueNote).toBe('小区连廊');
  });

  it('does not confuse two tests that share a testType', () => {
    // 30 秒坐站 and 5 次起坐 are both `sit_to_stand` on the API. Without
    // the protocol field they would overwrite each other's 上次 line —
    // and one is counted in reps while the other is timed in seconds.
    const previous = previousReadingFor('sit_to_stand_5x', [
      {
        testType: 'sit_to_stand',
        measuredValue: 9,
        protocol: encodeProtocolField('sit_to_stand_30s', 'per_protocol'),
        performedAt: '2026-06-01T02:00:00.000Z',
      },
    ]);
    expect(previous).toBeNull();
  });

  it('ignores rows this file never wrote', () => {
    expect(
      previousReadingFor('stair_four_step', [
        {
          testType: 'stair_climb',
          measuredValue: 18.5,
          protocol: '连续上 10 级台阶',
          performedAt: '2026-06-01T02:00:00.000Z',
        },
      ]),
    ).toBeNull();
  });
});
