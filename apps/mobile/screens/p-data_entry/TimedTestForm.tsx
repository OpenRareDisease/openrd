import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import Button from '../common/Button';
import InlineNotice from '../common/feedback/InlineNotice';
import { COMFORTABLE_TOUCH_TARGET, MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, RADIUS } from '../../lib/design';
import PressableScale from '../../lib/press-scale';
import { addFunctionTest, createSubmission, type PatientProfile } from '../../lib/api';
import {
  AID_OPTIONS,
  ANTI_GRAVITY_ITEMS,
  ANTI_GRAVITY_STATES,
  QUALITY_GRADES,
  SOURCE_HORLINGS,
  TEN_METER_MEASURE_CARD,
  TIMED_TESTS,
  type CompanionAnswer,
  type QualityGrade,
  type TimedTestId,
  type TimedTestProtocol,
  type TimerRun,
  aidChangeNoticeZh,
  buildFunctionTestPayload,
  countdownRemainingMs,
  formatClock,
  formatSeconds,
  gateFor,
  isCountdownDone,
  isImplausibleRun,
  previousReadingFor,
  recentFall,
  recentFallNoticeZh,
  runElapsedMs,
  startRun,
} from '../../lib/timed-test-protocols';

/**
 * 在家计时测试 — the six protocol cards, a timer, and a grade.
 *
 * The three things this screen is shaped by, none of which are about
 * timers:
 *
 *  1. **The patient cannot watch the screen while performing.** Every
 *     test on the card involves standing up and moving away from the
 *     phone. So the stop control is a single full-width block roughly
 *     three times the platform minimum, reachable without aiming, and
 *     the app says 开始/结束 out loud where the browser lets it. There
 *     is no second small button next to it to hit by mistake.
 *
 *  2. **The webview suspends timers.** See TimerRun in
 *     lib/timed-test-protocols.ts. Everything displayed is recomputed
 *     from `Date.now()` against the start stamp; the interval below
 *     exists only to force a re-render and contributes nothing to the
 *     value. A countdown that was resolved while the page was hidden is
 *     clamped to its exact duration on return and refused the
 *     按方案完成 grade, because a patient who could not hear the end
 *     did not stop at the end.
 *
 *  3. **A standing test is a fall risk.** The companion question is
 *     asked before anything is offered, every time the screen is
 *     opened, and it is not remembered — yesterday's answer is not
 *     today's household.
 */

interface TimedTestFormProps {
  profile: PatientProfile | null;
  /** The screen's PIPL gate — same contract as InstrumentForm. */
  ensureConsent?: () => Promise<boolean>;
  /** Ask the parent to re-read the profile after a save, so 上次 lines
   *  come from the server rather than from what this component thinks
   *  it just wrote. */
  onSaved?: () => void;
}

type AntiGravityAnswers = Record<string, number | undefined>;

const TICK_MS = 100;

/* ------------------------------------------------------------------ */
/* Screen wake + voice, both best-effort                               */
/* ------------------------------------------------------------------ */

/**
 * Keep the screen on while a test runs.
 *
 * Web-only and feature-detected: expo-keep-awake is not a dependency of
 * this app and adding one is out of scope for this change. The Screen
 * Wake Lock API is a browser built-in — nothing is fetched — but it is
 * NOT available everywhere this ships (older Android WebView, some
 * WeChat X5 builds, iOS before 16.4). The UI never promises the screen
 * will stay on; it says 「屏幕可能会自己熄灭」 and relies on the
 * timestamp arithmetic to be correct either way. That is the honest
 * split: the guarantee is in the arithmetic, not in the wake lock.
 */
const useScreenWakeLock = (active: boolean) => {
  const sentinelRef = useRef<{ release?: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !active) return undefined;

    let cancelled = false;
    const nav = (
      globalThis as { navigator?: { wakeLock?: { request?: (type: string) => Promise<unknown> } } }
    ).navigator;
    const request = nav?.wakeLock?.request;
    if (typeof request !== 'function') return undefined;

    const acquire = () => {
      Promise.resolve(request.call(nav!.wakeLock, 'screen'))
        .then((sentinel) => {
          if (cancelled) {
            void (sentinel as { release?: () => Promise<void> })?.release?.();
            return;
          }
          sentinelRef.current = sentinel as { release?: () => Promise<void> };
        })
        .catch(() => {
          // Denied, unsupported, or the document was not visible. Not
          // worth telling the patient about: the measurement is safe
          // regardless, and a warning here would read as「测试坏了」.
        });
    };

    acquire();
    // The browser drops the lock whenever the page is hidden, so coming
    // back to the tab has to re-take it or the second half of a
    // 6-minute walk runs with the screen free to sleep again.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') acquire();
    });

    return () => {
      cancelled = true;
      subscription.remove();
      void sentinelRef.current?.release?.();
      sentinelRef.current = null;
    };
  }, [active]);
};

/** True when this browser exposes speech synthesis at all. Support is
 *  not the same as audible — WeChat's webview may still stay silent —
 *  so the copy beside it is phrased as「可能会」. */
const speechAvailable = (): boolean => {
  if (Platform.OS !== 'web') return false;
  const scope = globalThis as {
    speechSynthesis?: { speak: (utterance: unknown) => void; cancel: () => void };
    SpeechSynthesisUtterance?: new (text: string) => unknown;
  };
  return Boolean(scope.speechSynthesis && typeof scope.SpeechSynthesisUtterance === 'function');
};

const speak = (text: string) => {
  if (!speechAvailable()) return;
  const scope = globalThis as {
    speechSynthesis?: { speak: (utterance: unknown) => void; cancel: () => void };
    SpeechSynthesisUtterance?: new (text: string) => { lang: string; rate: number };
  };
  try {
    const utterance = new scope.SpeechSynthesisUtterance!(text);
    utterance.lang = 'zh-CN';
    // Slower than default. The listener is across the room and mid-task.
    utterance.rate = 0.9;
    scope.speechSynthesis!.cancel();
    scope.speechSynthesis!.speak(utterance);
  } catch {
    // Never let an announcement break a measurement.
  }
};

/* ------------------------------------------------------------------ */

const sanitizeDecimal = (value: string) => {
  const normalized = value.replace(/[^\d.]/g, '');
  const parts = normalized.split('.');
  if (parts.length <= 1) return normalized.slice(0, 5);
  return `${parts[0].slice(0, 4)}.${parts.slice(1).join('').slice(0, 1)}`;
};

const TimedTestForm = ({ profile, ensureConsent, onSaved }: TimedTestFormProps) => {
  const [companion, setCompanion] = useState<CompanionAnswer>('unknown');
  const [openId, setOpenId] = useState<TimedTestId | null>(null);
  const [run, setRun] = useState<TimerRun | null>(null);
  const [tick, setTick] = useState(0);
  const [valueText, setValueText] = useState('');
  const [grade, setGrade] = useState<QualityGrade | null>(null);
  const [aidKeys, setAidKeys] = useState<string[]>([]);
  const [venueNote, setVenueNote] = useState('');
  const [notApplicable, setNotApplicable] = useState(false);
  const [antiGravity, setAntiGravity] = useState<AntiGravityAnswers>({});
  const [side, setSide] = useState<'left' | 'right'>('right');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  // What a half-finished 四项抗重力 save left behind. `addFunctionTest`
  // is a bare INSERT with no unique constraint and no idempotency key, so
  // an item that reached the server is stored for good — pressing 保存
  // again must not send it a second time. The submission id is kept with
  // it so the retry's rows join the same visit rather than inventing a
  // second one minutes later.
  const [antiGravitySavedKeys, setAntiGravitySavedKeys] = useState<string[]>([]);
  const [pendingSubmissionId, setPendingSubmissionId] = useState<string | null>(null);

  const openTest = useMemo(() => TIMED_TESTS.find((test) => test.id === openId) ?? null, [openId]);
  const isRunning = run !== null && run.stoppedAt === null;

  useScreenWakeLock(isRunning);

  // Re-render only. `tick` is never read as a duration — see the file
  // header and TimerRun. If this interval is throttled to once a minute
  // by a backgrounded webview, the displayed number jumps but stays
  // correct, which is exactly the property an accumulating timer lacks.
  useEffect(() => {
    if (!isRunning) return undefined;
    const handle = setInterval(() => setTick((value) => value + 1), TICK_MS);
    return () => clearInterval(handle);
  }, [isRunning]);

  // Mark the run interrupted the moment the page goes away. Recorded on
  // the run rather than inferred later, because by the time the patient
  // comes back there is no evidence left that it happened.
  useEffect(() => {
    if (!isRunning) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setRun((current) =>
          current && current.stoppedAt === null ? { ...current, interrupted: true } : current,
        );
      } else {
        // Force one recomputation on return so a countdown that expired
        // while hidden resolves immediately instead of waiting a tick.
        setTick((value) => value + 1);
      }
    });
    return () => subscription.remove();
  }, [isRunning]);

  const countdownMs = openTest?.countdownMs ?? 0;

  // Auto-stop a countdown. Clamped to `startedAt + countdownMs`, never
  // to「now」: if the webview suspended us for four minutes, now is four
  // minutes past the end and recording that would be a lie about a
  // 30-second test.
  useEffect(() => {
    if (!openTest || openTest.measure !== 'countdown' || !run || run.stoppedAt !== null) return;
    if (!isCountdownDone(run, Date.now(), countdownMs)) return;
    setRun({ ...run, stoppedAt: run.startedAt + countdownMs });
    speak('结束');
  }, [openTest, run, tick, countdownMs]);

  const resetEntry = () => {
    setRun(null);
    setValueText('');
    setGrade(null);
    setAidKeys([]);
    setVenueNote('');
    setNotApplicable(false);
    setAntiGravity({});
    setSide('right');
    setError(null);
    setAntiGravitySavedKeys([]);
    setPendingSubmissionId(null);
  };

  const toggleOpen = (id: TimedTestId) => {
    setOpenId((current) => (current === id ? null : id));
    resetEntry();
    setSavedNotice(null);
  };

  /* -------------------------------------------------------------- */
  /* Safety context                                                  */
  /* -------------------------------------------------------------- */

  const fall = useMemo(
    () => recentFall(profile?.followupEvents, Date.now()),
    // Date.now() is read once per profile change on purpose: re-running
    // this every render would make the gate flicker at the 90-day
    // boundary. The window is measured in months; a stale minute is
    // irrelevant.
    [profile],
  );
  const gateContext = { companion, hasRecentFall: fall !== null };

  const previous = useMemo(
    () => (openTest ? previousReadingFor(openTest.id, profile?.functionTests) : null),
    [openTest, profile],
  );

  /* -------------------------------------------------------------- */
  /* Grade eligibility                                               */
  /* -------------------------------------------------------------- */

  /**
   * Why 按方案完成 may be unavailable.
   *
   * Both cases are things the app knows and the patient cannot: the
   * timer ran for longer than any test here lasts (a forgotten stop),
   * or the page was suspended during a countdown so nobody heard the
   * end. Offering 按方案完成 in either case would let a number the app
   * itself distrusts onto the trend line.
   */
  const perProtocolBlocked = useMemo(() => {
    if (!openTest || !run) return null;
    if (isImplausibleRun(run, run.stoppedAt ?? Date.now())) {
      return '这次计时超过 20 分钟，多半是忘了按停。这样的用时不能算按方案完成 —— 请重做一次，或者选「自由记录」。';
    }
    if (openTest.measure === 'countdown' && run.interrupted) {
      return '计时中途手机切走了或者锁屏了，你听不到结束的提示音，所以这次不能算按方案完成。用时已经按方案的时长截断，结果请按实际完成的量填。';
    }
    return null;
  }, [openTest, run]);

  useEffect(() => {
    if (perProtocolBlocked && grade === 'per_protocol') {
      setGrade('partial');
    }
  }, [perProtocolBlocked, grade]);

  /* -------------------------------------------------------------- */
  /* Timer controls                                                  */
  /* -------------------------------------------------------------- */

  const handleStart = () => {
    setError(null);
    setSavedNotice(null);
    speak('开始');
    setRun(startRun(Date.now()));
  };

  const handleStop = () => {
    setRun((current) => {
      if (!current || current.stoppedAt !== null) return current;
      const now = Date.now();
      // A countdown stopped early is stopped where the thumb landed;
      // the auto-stop above owns the on-time case.
      return { ...current, stoppedAt: now };
    });
    speak('结束');
  };

  const elapsedMs = run ? runElapsedMs(run, Date.now()) : 0;
  const remainingMs = run && countdownMs ? countdownRemainingMs(run, Date.now(), countdownMs) : 0;

  /* -------------------------------------------------------------- */
  /* Saving                                                          */
  /* -------------------------------------------------------------- */

  const measuredValue = (): number | null => {
    if (!openTest) return null;
    if (openTest.measure === 'stopwatch') {
      if (!run || run.stoppedAt === null) return null;
      return Number(formatSeconds(runElapsedMs(run, run.stoppedAt)));
    }
    const parsed = Number(valueText);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const validate = (): string | null => {
    if (!openTest) return '请先选一项测试。';
    if (!grade) return '请先选这次记录的质量：按方案完成 / 条件不完整 / 自由记录。';

    if (openTest.measure === 'three_state') {
      const answered = ANTI_GRAVITY_ITEMS.filter(
        (item) => typeof antiGravity[item.key] === 'number',
      );
      if (answered.length === 0) return '四项里至少选一项。';
      return null;
    }

    if (notApplicable) return null;

    if (openTest.measure === 'stopwatch') {
      if (!run || run.stoppedAt === null) return '还没计时。按下面的大按钮开始，做完再按停。';
      if (runElapsedMs(run, run.stoppedAt) < 1000) {
        return '这次只计了不到 1 秒，多半是误触。请重新计一次。';
      }
      return null;
    }

    const value = measuredValue();
    if (value === null || !(value > 0)) {
      return `请填写${openTest.valueLabelZh ?? '结果'}，或者标记「今天做不了」。`;
    }
    return null;
  };

  const handleSave = async () => {
    if (!openTest || isSaving) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      if (ensureConsent) {
        const consented = await ensureConsent();
        if (!consented) {
          setError('未记录敏感个人信息处理同意，这次没有保存。你可以稍后再来。');
          return;
        }
      }

      // A retry reuses the visit the first attempt already opened. Making
      // a second one would split one test session across two visits — and
      // for 四项抗重力, would hang the re-sent items off a different visit
      // from the ones that already landed.
      let submissionId = pendingSubmissionId;
      if (!submissionId) {
        const submission = await createSubmission({
          submissionKind: 'followup',
          summary: `在家计时测试：${openTest.nameZh}`,
          changedSinceLast: null,
        });
        // apiRequest's type parameter is an unchecked assertion, so the
        // id is verified rather than trusted. Posting a function test with
        // `submissionId: undefined` would silently orphan the row from the
        // visit it belongs to.
        if (!submission || typeof submission.id !== 'string' || submission.id.length === 0) {
          throw new Error('保存失败：服务器没有返回这次记录的编号，请稍后重试。');
        }
        submissionId = submission.id;
        setPendingSubmissionId(submissionId);
      }

      const base = {
        test: openTest,
        grade: grade as QualityGrade,
        aidKeys,
        venueNote,
        submissionId,
      };

      if (openTest.measure === 'three_state') {
        // One row per item. A single summed score would be a scale we
        // invented; four ordinal observations are what was actually
        // seen. See ANTI_GRAVITY_ITEMS.
        //
        // allSettled rather than all: Promise.all rejects on the first
        // failure while its siblings keep going and commit, so one dropped
        // request on a weak connection would report a total failure over
        // rows that are already stored — and the retry would store them
        // twice. Each item's outcome is tracked so a retry sends only what
        // did not land.
        const pending = ANTI_GRAVITY_ITEMS.filter(
          (item) =>
            typeof antiGravity[item.key] === 'number' && !antiGravitySavedKeys.includes(item.key),
        );
        const results = await Promise.allSettled(
          pending.map((item) =>
            addFunctionTest(
              buildFunctionTestPayload({
                ...base,
                measuredValue: antiGravity[item.key] ?? null,
                notApplicable: false,
                antiGravityItemKey: item.key,
              }),
            ),
          ),
        );

        const landed = pending.filter((_, index) => results[index].status === 'fulfilled');
        const failed = pending.filter((_, index) => results[index].status === 'rejected');

        if (failed.length > 0) {
          const storedCount = antiGravitySavedKeys.length + landed.length;
          setAntiGravitySavedKeys((current) => [...current, ...landed.map((item) => item.key)]);
          const firstRejection = results.find(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
          );
          const reason =
            firstRejection?.reason instanceof Error
              ? firstRejection.reason.message
              : '保存失败，请稍后重试。';
          const failedNames = failed.map((item) => item.nameZh).join('、');
          // Says which items are already in the record, because the
          // patient's next move is to press 保存 again and they deserve
          // to know that doing so is safe. The promise is only about the
          // items this app watched land — a request that failed after the
          // server committed is not something the client can see.
          setError(
            storedCount > 0
              ? `${reason}\n${failedNames} 没存上，其余 ${storedCount} 项已经存上了 —— 再按一次保存只会重发没存上的那几项。`
              : reason,
          );
          return;
        }
      } else {
        await addFunctionTest(
          buildFunctionTestPayload({
            ...base,
            measuredValue: notApplicable ? null : measuredValue(),
            notApplicable,
            side: openTest.id === 'grip_strength' ? side : undefined,
          }),
        );
      }

      setSavedNotice(
        notApplicable
          ? `已记下「今天做不了${openTest.nameZh}」。这是一条数据，不是空白。`
          : `已保存${openTest.nameZh}。这次记为「${
              QUALITY_GRADES.find((option) => option.key === grade)?.labelZh ?? ''
            }」。`,
      );
      resetEntry();
      setOpenId(null);
      onSaved?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败，请稍后重试。');
    } finally {
      setIsSaving(false);
    }
  };

  /* -------------------------------------------------------------- */
  /* Render helpers                                                  */
  /* -------------------------------------------------------------- */

  const renderCompanionGate = () => (
    <View style={styles.gateCard}>
      <Text style={styles.gateTitle}>今天旁边有人吗？</Text>
      <Text style={styles.gateBody}>
        下面除了握力，每一项都要站起来。FSHD 患者跌倒的概率是常人的六倍，65% 的人一年至少跌一次、30%
        的人一个月不止一次，而且多数是往前摔。所以先问这一句，每次都问。
      </Text>
      {/* The citation comes from the constant, not from a second copy
          typed here: a source that exists in two places is a source
          that will disagree with itself the first time either is
          edited. */}
      <Text style={styles.sourceLine}>跌倒数据：{SOURCE_HORLINGS}</Text>
      <View style={styles.gateRow}>
        {(
          [
            { key: 'present', label: '有人在旁边' },
            { key: 'alone', label: '只有我一个人' },
          ] as Array<{ key: CompanionAnswer; label: string }>
        ).map((option) => {
          const selected = companion === option.key;
          return (
            <PressableScale
              key={option.key}
              style={[styles.gateChoice, selected && styles.gateChoiceActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              aria-checked={selected}
              accessibilityLabel={option.label}
              onPress={() => setCompanion(option.key)}
            >
              <Text style={[styles.gateChoiceText, selected && styles.gateChoiceTextActive]}>
                {option.label}
              </Text>
            </PressableScale>
          );
        })}
      </View>
      {companion === 'alone' ? (
        <Text style={styles.gateAlone}>
          要站起来的项目先收起来了。今天可以做握力（坐着做），或者去「日常记录」记睡眠、疼痛和疲劳
          —— 那些一样是趋势里算数的数据。等有人在旁边，再回来做站着的项目。
        </Text>
      ) : null}
    </View>
  );

  const renderProtocolCard = (test: TimedTestProtocol) => (
    <View style={styles.protocolCard}>
      {test.sections.map((section) => (
        <View key={section.key} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.titleZh}</Text>
          {section.linesZh.map((line) => (
            <Text key={line} style={styles.sectionLine}>
              · {line}
            </Text>
          ))}
          <Text style={styles.sourceLine}>依据：{section.source}</Text>
        </View>
      ))}
    </View>
  );

  const renderMeasureCard = () => (
    <View style={styles.measureCard}>
      <Text style={styles.sectionTitle}>{TEN_METER_MEASURE_CARD.titleZh}</Text>
      <Text style={styles.sectionLine}>{TEN_METER_MEASURE_CARD.introZh}</Text>
      {TEN_METER_MEASURE_CARD.stepsZh.map((step, index) => (
        <Text key={step} style={styles.sectionLine}>
          {index + 1}. {step}
        </Text>
      ))}
      <Text style={styles.cautionLine}>{TEN_METER_MEASURE_CARD.cautionZh}</Text>
      <Text style={styles.sourceLine}>依据：{TEN_METER_MEASURE_CARD.source}</Text>
    </View>
  );

  /** The full-width block. Deliberately the only control in its row:
   *  a thumb aimed at 停 while out of breath must not be able to land on
   *  anything else. */
  const renderTimer = (test: TimedTestProtocol) => {
    const isCountdown = test.measure === 'countdown';
    const stopped = run !== null && run.stoppedAt !== null;

    return (
      <View style={styles.timerBlock}>
        <Text style={styles.timerReadout}>
          {isCountdown
            ? formatClock(run ? remainingMs : (test.countdownMs ?? 0))
            : formatClock(elapsedMs)}
        </Text>
        <Text style={styles.timerCaption}>
          {isCountdown
            ? stopped
              ? '计时结束'
              : isRunning
                ? '倒计时中 —— 手机可以放下'
                : `按下面开始，会倒数 ${Math.round((test.countdownMs ?? 0) / 1000)} 秒`
            : stopped
              ? `本次用时 ${formatSeconds(runElapsedMs(run!, run!.stoppedAt!))} 秒`
              : isRunning
                ? '计时中 —— 做完按下面那一大块'
                : '按下面开始'}
        </Text>

        {!isRunning && !stopped ? (
          <PressableScale
            style={styles.bigButton}
            accessibilityRole="button"
            accessibilityLabel={`开始${test.nameZh}计时`}
            onPress={handleStart}
          >
            <Text style={styles.bigButtonText}>开始</Text>
          </PressableScale>
        ) : null}

        {isRunning ? (
          <PressableScale
            style={[styles.bigButton, styles.bigButtonStop]}
            accessibilityRole="button"
            accessibilityLabel="停止计时"
            onPress={handleStop}
          >
            <Text style={styles.bigButtonText}>停</Text>
          </PressableScale>
        ) : null}

        {stopped ? (
          <PressableScale
            style={[styles.bigButton, styles.bigButtonRedo]}
            accessibilityRole="button"
            accessibilityLabel="重新计时"
            onPress={() => setRun(null)}
          >
            <Text style={styles.bigButtonRedoText}>重新计一次</Text>
          </PressableScale>
        ) : null}

        <Text style={styles.timerNote}>
          {speechAvailable()
            ? '开始和结束时手机可能会读一声，但有的手机和微信里没有声音 —— 别只靠它，让旁边的人喊。'
            : '这台手机不支持语音提示，请让旁边的人喊「开始」和「停」。'}
        </Text>
        <Text style={styles.timerNote}>
          计时用的是开始和结束两个时刻，中途锁屏、切到微信聊天都不会算少。屏幕可能会自己熄灭，那也不影响这个数。
        </Text>
      </View>
    );
  };

  const renderAidChips = () => (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>这次用了什么</Text>
      <Text style={styles.fieldHint}>
        用了不丢分，不记才丢分 —— 下次条件要和这次一样，两个数才能比。
      </Text>
      <View style={styles.chipWrap}>
        {AID_OPTIONS.map((option) => {
          const selected = aidKeys.includes(option.key);
          return (
            <PressableScale
              key={option.key}
              style={[styles.chip, selected && styles.chipActive]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              accessibilityLabel={option.labelZh}
              onPress={() =>
                setAidKeys((current) => {
                  if (option.key === 'none') return selected ? [] : ['none'];
                  const next = current.filter((key) => key !== 'none');
                  return selected
                    ? next.filter((key) => key !== option.key)
                    : [...next, option.key];
                })
              }
            >
              <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                {option.labelZh}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );

  const renderGradePicker = () => (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>刚才的条件，和上面卡片上写的一样吗</Text>
      {perProtocolBlocked ? <InlineNotice message={perProtocolBlocked} /> : null}
      {QUALITY_GRADES.map((option) => {
        const disabled = option.key === 'per_protocol' && perProtocolBlocked !== null;
        const selected = grade === option.key;
        return (
          <PressableScale
            key={option.key}
            style={[
              styles.gradeRow,
              selected && styles.gradeRowActive,
              disabled && styles.gradeRowDisabled,
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            aria-checked={selected}
            aria-disabled={disabled}
            // `disabled` as well as `aria-disabled`: react-native-web's
            // TouchableOpacity reads only `props.disabled`, so on the
            // platform this ships on (web export, WeChat X5) the aria
            // attribute alone still lets the row scale and brighten under
            // the thumb — feedback promising a press that the handler is
            // about to drop.
            disabled={disabled}
            accessibilityLabel={`${option.labelZh}：${option.meaningZh}`}
            onPress={() => {
              if (disabled) return;
              setGrade(option.key);
              setError(null);
            }}
          >
            <Text style={[styles.gradeLabel, selected && styles.gradeLabelActive]}>
              {option.labelZh}
            </Text>
            <Text style={[styles.gradeMeaning, selected && styles.gradeMeaningActive]}>
              {option.meaningZh}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );

  const renderAntiGravity = () => (
    <View style={styles.fieldBlock}>
      {ANTI_GRAVITY_ITEMS.map((item) => {
        // An item that reached the server during a half-finished save is
        // already a stored row. Leaving it editable would make the answer
        // on screen disagree with the answer in the record, since the
        // retry deliberately will not send it again.
        const stored = antiGravitySavedKeys.includes(item.key);
        return (
          <View key={item.key} style={styles.agItem}>
            <Text style={styles.fieldLabel}>{item.nameZh}</Text>
            <Text style={styles.fieldHint}>{item.howZh}</Text>
            {stored ? (
              <Text style={styles.agStoredLine}>这一项刚才已经存上了，再保存不会重复记一条。</Text>
            ) : null}
            {ANTI_GRAVITY_STATES.map((state) => {
              const selected = antiGravity[item.key] === state.value;
              return (
                <PressableScale
                  key={state.value}
                  style={[
                    styles.agChoice,
                    selected && styles.agChoiceActive,
                    stored && styles.agChoiceStored,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: stored }}
                  aria-checked={selected}
                  aria-disabled={stored}
                  disabled={stored}
                  accessibilityLabel={`${item.nameZh}：${state.labelZh}`}
                  onPress={() => {
                    if (stored) return;
                    setAntiGravity((current) => ({ ...current, [item.key]: state.value }));
                  }}
                >
                  <Text style={[styles.agChoiceText, selected && styles.agChoiceTextActive]}>
                    {state.labelZh}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        );
      })}
    </View>
  );

  const renderValueField = (test: TimedTestProtocol) => (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>
        {test.valueLabelZh ?? '结果'}（{test.valueUnitZh}）
      </Text>
      <TextInput
        value={valueText}
        onChangeText={(value) => {
          setValueText(sanitizeDecimal(value));
          setError(null);
        }}
        placeholder={test.unit === 'reps' ? '例如 8' : '例如 96'}
        placeholderTextColor={COLOR.inkFaint}
        keyboardType="decimal-pad"
        editable={!notApplicable}
        style={[styles.input, notApplicable && styles.inputDisabled]}
      />
    </View>
  );

  const renderSidePicker = () => (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>这次记的是哪只手</Text>
      <View style={styles.gateRow}>
        {(
          [
            { key: 'right', label: '右手' },
            { key: 'left', label: '左手' },
          ] as Array<{ key: 'left' | 'right'; label: string }>
        ).map((option) => {
          const selected = side === option.key;
          return (
            <PressableScale
              key={option.key}
              style={[styles.gateChoice, selected && styles.gateChoiceActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              aria-checked={selected}
              accessibilityLabel={option.label}
              onPress={() => setSide(option.key)}
            >
              <Text style={[styles.gateChoiceText, selected && styles.gateChoiceTextActive]}>
                {option.label}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );

  const renderOpenTest = (test: TimedTestProtocol) => {
    const aidNotice = aidChangeNoticeZh(previous, aidKeys);

    return (
      <View style={styles.openPanel}>
        {fall && test.longWalk ? (
          <Text style={styles.cautionLine}>{recentFallNoticeZh(fall.occurredAt)}</Text>
        ) : null}

        {renderProtocolCard(test)}
        {test.id === 'ten_meter_walk' ? renderMeasureCard() : null}

        {previous ? (
          <Text style={styles.previousLine}>
            上次（{previous.performedAt.slice(0, 10)}）：
            {previous.value !== null ? `${previous.value} ${test.valueUnitZh}` : '记为今天做不了'}
            {previous.deviceUsed ? ` · 用了${previous.deviceUsed}` : ''}
            {previous.venueNote ? ` · ${previous.venueNote}` : ''}
            {previous.grade === 'per_protocol'
              ? ''
              : ' · 上次是「条件不完整/自由记录」，不能直接和按方案的次数比'}
          </Text>
        ) : (
          <Text style={styles.previousLine}>这是第一次记这一项，今天的数字就是以后的起点。</Text>
        )}

        {test.measure === 'stopwatch' || test.measure === 'countdown' ? renderTimer(test) : null}

        {test.measure === 'three_state' ? renderAntiGravity() : null}
        {test.measure === 'countdown' || test.measure === 'manual' ? renderValueField(test) : null}
        {test.id === 'grip_strength' ? renderSidePicker() : null}

        {test.measure !== 'three_state' ? (
          <View style={styles.fieldBlock}>
            <PressableScale
              style={[styles.chip, notApplicable && styles.chipActive]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: notApplicable }}
              aria-checked={notApplicable}
              accessibilityLabel="今天做不了这一项"
              onPress={() => {
                setNotApplicable((current) => !current);
                setError(null);
              }}
            >
              <Text style={[styles.chipText, notApplicable && styles.chipTextActive]}>
                今天做不了这一项
              </Text>
            </PressableScale>
            <Text style={styles.fieldHint}>
              点了会存成一条「今天做不了」的记录，不是空白漏填 —— 趋势里看得到。
            </Text>
          </View>
        ) : null}

        {renderAidChips()}
        {aidNotice ? <InlineNotice message={aidNotice} /> : null}

        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>测量地点（只写你自己认得的）</Text>
          <Text style={styles.fieldHint}>
            比如「家里客厅东西向」「单元楼下最后四级」。下次它会显示出来，你照着找同一处。
          </Text>
          <TextInput
            value={venueNote}
            onChangeText={(value) => setVenueNote(value.slice(0, 60))}
            placeholder={previous?.venueNote ?? '例如：家里客厅东西向'}
            placeholderTextColor={COLOR.inkFaint}
            style={styles.input}
          />
        </View>

        {renderGradePicker()}

        {error ? <InlineNotice message={error} onRetry={() => void handleSave()} /> : null}

        <Button
          label="保存这一项"
          icon="check"
          variant="prominent"
          fullWidth
          busy={isSaving}
          accessibilityLabel={`保存${test.nameZh}`}
          onPress={() => void handleSave()}
        />
      </View>
    );
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>在家计时测试</Text>
      <Text style={styles.subtitle}>
        每一项都有一张卡片，写清楚场地、姿势、辅具、要说的话和做几次。照卡片做，这个数字以后才能和你自己比。做完选一档质量
        —— 只有「按方案完成」会画进护照的趋势线。
      </Text>

      {savedNotice ? <InlineNotice message={savedNotice} /> : null}

      {renderCompanionGate()}

      {TIMED_TESTS.map((test) => {
        const gate = gateFor(test, gateContext);
        const isOpen = openId === test.id;

        if (gate.state === 'withheld') {
          return (
            <View key={test.id} style={[styles.testCard, styles.testCardWithheld]}>
              <Text style={styles.testName}>{test.nameZh}</Text>
              <Text style={styles.testGateText}>{gate.reasonZh}</Text>
            </View>
          );
        }

        return (
          <View key={test.id} style={[styles.testCard, isOpen && styles.testCardOpen]}>
            <PressableScale
              style={styles.testSelect}
              accessibilityRole="button"
              accessibilityState={{
                expanded: isOpen,
                disabled: gate.state === 'needs_companion',
              }}
              aria-expanded={isOpen}
              aria-disabled={gate.state === 'needs_companion'}
              // Same reason as the grade rows: without `disabled`, the
              // gated header springs under the finger and then refuses to
              // open, which reads as a mis-tap rather than as a gate.
              disabled={gate.state === 'needs_companion'}
              accessibilityLabel={test.nameZh}
              onPress={() => {
                if (gate.state === 'needs_companion') return;
                toggleOpen(test.id);
              }}
            >
              <Text style={styles.testName}>{test.nameZh}</Text>
              <Text style={styles.testPurpose}>{test.purposeZh}</Text>
            </PressableScale>

            {gate.state === 'needs_companion' ? (
              <Text style={styles.testGateText}>{gate.reasonZh}</Text>
            ) : null}

            {isOpen && gate.state === 'open' ? renderOpenTest(test) : null}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.surface,
    backgroundColor: COLOR.surface,
    borderWidth: 1,
    borderColor: COLOR.line,
    padding: 16,
  },
  title: {
    color: COLOR.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 12,
    color: COLOR.inkMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  gateCard: {
    borderRadius: RADIUS.surface,
    borderWidth: 1,
    borderColor: COLOR.accentLine,
    backgroundColor: COLOR.accentWash,
    padding: 13,
    marginBottom: 12,
  },
  gateTitle: {
    color: COLOR.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  gateBody: {
    marginTop: 6,
    color: COLOR.inkSoft,
    fontSize: 12,
    lineHeight: 18,
  },
  gateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  gateChoice: {
    minHeight: MIN_TOUCH_TARGET,
    flexGrow: 1,
    flexBasis: 140,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderColor: COLOR.line,
    backgroundColor: COLOR.surface,
  },
  gateChoiceActive: {
    borderColor: COLOR.accent,
    backgroundColor: COLOR.accent,
  },
  gateChoiceText: {
    color: COLOR.inkSoft,
    fontSize: 14,
    fontWeight: '700',
  },
  gateChoiceTextActive: {
    color: COLOR.onAccent,
  },
  gateAlone: {
    marginTop: 10,
    color: COLOR.inkSoft,
    fontSize: 12,
    lineHeight: 18,
  },
  testCard: {
    borderRadius: RADIUS.surface,
    borderWidth: 1,
    borderColor: COLOR.line,
    backgroundColor: COLOR.well,
    padding: 13,
    marginBottom: 10,
  },
  testCardOpen: {
    borderColor: COLOR.accent,
    backgroundColor: COLOR.surface,
  },
  testCardWithheld: {
    borderColor: COLOR.warnWash,
    backgroundColor: COLOR.warnWash,
  },
  testSelect: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  testName: {
    color: COLOR.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  testPurpose: {
    marginTop: 4,
    color: COLOR.inkMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  testGateText: {
    marginTop: 8,
    color: COLOR.warn,
    fontSize: 12,
    lineHeight: 18,
  },
  openPanel: {
    marginTop: 12,
    gap: 12,
  },
  protocolCard: {
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderColor: COLOR.line,
    backgroundColor: COLOR.well,
    padding: 12,
    gap: 10,
  },
  measureCard: {
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderColor: COLOR.accentLine,
    backgroundColor: COLOR.accentWash,
    padding: 12,
  },
  section: {
    gap: 3,
  },
  sectionTitle: {
    color: COLOR.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  sectionLine: {
    color: COLOR.inkSoft,
    fontSize: 12,
    lineHeight: 19,
  },
  cautionLine: {
    marginTop: 6,
    color: COLOR.warn,
    fontSize: 12,
    lineHeight: 19,
  },
  sourceLine: {
    marginTop: 3,
    color: COLOR.inkFaint,
    fontSize: 11,
    lineHeight: 16,
  },
  previousLine: {
    color: COLOR.inkMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  timerBlock: {
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderColor: COLOR.line,
    backgroundColor: COLOR.surface,
    padding: 12,
    gap: 8,
  },
  timerReadout: {
    textAlign: 'center',
    color: COLOR.ink,
    fontSize: 46,
    lineHeight: 54,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  timerCaption: {
    textAlign: 'center',
    color: COLOR.inkMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  /** Roughly 3× MIN_TOUCH_TARGET and the full width of the card. The
   *  patient is out of breath, braced on furniture, and not looking. */
  bigButton: {
    minHeight: COMFORTABLE_TOUCH_TARGET * 2.5,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.control,
    backgroundColor: COLOR.accent,
  },
  bigButtonStop: {
    backgroundColor: COLOR.alert,
  },
  bigButtonRedo: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: COLOR.well,
    borderWidth: 1,
    borderColor: COLOR.line,
  },
  bigButtonText: {
    color: COLOR.onAccent,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 2,
  },
  bigButtonRedoText: {
    color: COLOR.inkSoft,
    fontSize: 14,
    fontWeight: '700',
  },
  timerNote: {
    color: COLOR.inkFaint,
    fontSize: 11,
    lineHeight: 17,
  },
  fieldBlock: {
    gap: 6,
  },
  fieldLabel: {
    color: COLOR.ink,
    fontSize: 13,
    fontWeight: '700',
  },
  fieldHint: {
    color: COLOR.inkMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderColor: COLOR.line,
    backgroundColor: COLOR.well,
    paddingHorizontal: 12,
    color: COLOR.ink,
    fontSize: 15,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderColor: COLOR.line,
    backgroundColor: COLOR.surface,
  },
  chipActive: {
    borderColor: COLOR.accent,
    backgroundColor: COLOR.accent,
  },
  chipText: {
    color: COLOR.inkSoft,
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: COLOR.onAccent,
  },
  gradeRow: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderColor: COLOR.line,
    backgroundColor: COLOR.surface,
  },
  gradeRowActive: {
    borderColor: COLOR.accent,
    backgroundColor: COLOR.accent,
  },
  gradeRowDisabled: {
    opacity: 0.45,
  },
  gradeLabel: {
    color: COLOR.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  gradeLabelActive: {
    color: COLOR.onAccent,
  },
  gradeMeaning: {
    marginTop: 3,
    color: COLOR.inkMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  gradeMeaningActive: {
    color: COLOR.onAccent,
  },
  agItem: {
    gap: 6,
    marginBottom: 10,
  },
  agChoice: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderColor: COLOR.line,
    backgroundColor: COLOR.surface,
  },
  agChoiceActive: {
    borderColor: COLOR.accent,
    backgroundColor: COLOR.accent,
  },
  agChoiceStored: {
    opacity: 0.45,
  },
  agStoredLine: {
    color: COLOR.inkMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  agChoiceText: {
    color: COLOR.inkSoft,
    fontSize: 13,
    lineHeight: 19,
  },
  agChoiceTextActive: {
    color: COLOR.onAccent,
  },
});

export default TimedTestForm;
