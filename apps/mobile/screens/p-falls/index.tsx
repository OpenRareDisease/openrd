import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../common/ScreenHeader';
import Button from '../common/Button';
import { useAppDialog } from '../common/feedback/AppDialog';
import SensitiveDataConsentGate, {
  useSensitiveDataConsentGate,
} from '../p-privacy_settings/components/SensitiveDataConsentGate';
import styles from './styles';
import { ApiError } from '../../lib/api';
import { COLOR } from '../../lib/design';
import { deleteFall, listFalls, recordFall } from '../../lib/falls-api';
import {
  FALLS_WINDOW_DAYS,
  FALL_ACTIVITIES,
  FALL_ACTIVITY_LABELS_ZH,
  FALL_ACTIVITY_QUESTION_ZH,
  FALL_DATE_QUICK_PICKS,
  FALL_LOCATIONS,
  FALL_LOCATION_LABELS_ZH,
  createFallDraft,
  describeFallDay,
  describeFallDetails,
  describeSaveOutcome,
  describeUnlistedFalls,
  isoDateDaysAgo,
  summarizeFallsForCourse,
  validateFallDate,
  type FallDraft,
  type FallRecord,
  type FallsListResult,
} from '../../lib/falls';

/**
 * 跌倒记录 — the diary.
 *
 * WHO IS FILLING THIS IN. Someone who fell an hour ago, is sore, and
 * has one usable hand. FSHD takes reaching, arm elevation and sustained
 * grip first; ~65% of patients fall at least once a year. So the shape
 * of this screen is decided before any of the content:
 *
 *   - ONLY THE DATE IS REQUIRED, and it is pre-filled with 今天. Open
 *     the screen, press 保存, done. Every other question is behind a
 *     disclosure and every one of them can stay blank.
 *   - THE SAVE BUTTON IS ABOVE THE DETAILS. If the details came first
 *     the one-tap path would be a scroll, which is exactly the cost
 *     this feature cannot afford.
 *   - EVERY OPTION IS A 48pt TARGET AND THEY WRAP. Nine activity
 *     options do not fit one row and lib/a11y.ts forbids shrinking
 *     them to make them.
 *   - THE DETAIL OPTIONS ARE TRI-STATE. Tapping a chosen option again
 *     clears it, because a mis-tap that cannot be undone turns a blank
 *     ——「没填」—— into a wrong answer, and the API stores 「没填」 and
 *     「否」 as different things for a reason (see lib/falls.ts).
 *
 * AND WHAT IT MUST NOT BE. A fall diary that greets someone with a
 * running total and a trend line is a progression alert. The count sits
 * BELOW the form, at caption size, with the sentence that says what it
 * does and does not mean. There is no chart on this page and no
 * quarter-to-quarter comparison; the API can compose one and it exists
 * for the assistant to reason over when asked, not for the screen a
 * patient opens the day they fell.
 *
 * Everything that decides what a number or a blank is allowed to say
 * lives in lib/falls.ts, where it is asserted without a renderer.
 */

/** One tri-state answer: a row of wrapped options, and tapping the
 *  selected one clears it back to 「没填」. */
const OptionRow = <T extends string>({
  question,
  options,
  value,
  onChange,
}: {
  question: string;
  options: ReadonlyArray<{ key: T; label: string }>;
  value: T | null;
  onChange: (next: T | null) => void;
}) => (
  <View style={styles.questionBlock}>
    <Text style={styles.question}>{question}</Text>
    <View style={styles.optionWrap} accessibilityRole="radiogroup" aria-label={question}>
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            style={[styles.option, selected && styles.optionSelected]}
            // Tapping the selected option clears it. See the class
            // comment: an answer that cannot be taken back is how a
            // blank becomes a wrong answer.
            onPress={() => onChange(selected ? null : option.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            // react-native-web 0.20 drops accessibilityState, so the
            // web export — the only channel that ships — needs the ARIA
            // attribute spelled out or every option announces the same.
            aria-checked={selected}
            accessibilityHint={selected ? '已选，再点一下可以取消' : undefined}
          >
            <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  </View>
);

const ACTIVITY_OPTIONS = FALL_ACTIVITIES.map((key) => ({
  key,
  label: FALL_ACTIVITY_LABELS_ZH[key],
}));
const LOCATION_OPTIONS = FALL_LOCATIONS.map((key) => ({
  key,
  label: FALL_LOCATION_LABELS_ZH[key],
}));

/** The three booleans, each phrased so both options are things that
 *  happened. 「否」 as a label would blur into the blank state. */
const HANDS_FULL_OPTIONS = [
  { key: 'yes' as const, label: '拿着东西' },
  { key: 'no' as const, label: '双手是空的' },
];
const GOT_UP_OPTIONS = [
  { key: 'yes' as const, label: '自己起来的' },
  { key: 'no' as const, label: '需要人扶' },
];
const INJURED_OPTIONS = [
  { key: 'yes' as const, label: '受了伤' },
  { key: 'no' as const, label: '没受伤' },
];

type YesNo = 'yes' | 'no';
const toYesNo = (value: boolean | null): YesNo | null =>
  value === null ? null : value ? 'yes' : 'no';
const fromYesNo = (value: YesNo | null): boolean | null =>
  value === null ? null : value === 'yes';

const FallsScreen = () => {
  const { confirm } = useAppDialog();
  const { ensureSensitiveDataConsent, gateProps } = useSensitiveDataConsentGate();

  const [draft, setDraft] = useState<FallDraft>(() => createFallDraft());
  // Which date control the patient is using. 今天/昨天/前天 covers
  // nearly every entry; the text field exists for the rest and is not
  // on screen until it is asked for.
  const [customDate, setCustomDate] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const [result, setResult] = useState<FallsListResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      setResult(await listFalls(FALLS_WINDOW_DAYS));
    } catch (error) {
      // Cleared together with the error. A stale list beside 「读不到」
      // would leave the patient unable to tell which entries are
      // actually on the server.
      setResult(null);
      setLoadError(error instanceof Error ? error.message : '这会儿读不到已经记下的条目。');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (next: Partial<FallDraft>) => setDraft((previous) => ({ ...previous, ...next }));

  const submit = async () => {
    if (busy) return;
    const dateError = validateFallDate(draft.occurredOn);
    if (dateError) {
      setFormError(dateError);
      return;
    }
    setBusy(true);
    setFormError(null);
    setSavedNote(null);
    try {
      // PIPL Art. 29: a fall is health data, and the API refuses this
      // route without a consent ledger row (sensitiveDataConsent on
      // POST /me/falls). Asking here means a patient who declines sees
      // a question rather than a 403.
      const consented = await ensureSensitiveDataConsent();
      if (!consented) {
        setFormError('没有记录敏感个人信息处理同意，这一次没有保存。你随时可以再来。');
        return;
      }
      const saved = await recordFall({ ...draft, occurredOn: draft.occurredOn.trim() });
      setSavedNote(describeSaveOutcome(saved, result?.windowDays ?? FALLS_WINDOW_DAYS));
      setDraft(createFallDraft());
      setCustomDate(false);
      setDetailsOpen(false);
      await load();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (fall: FallRecord) => {
    const confirmed = await confirm({
      title: '删除这条跌倒记录？',
      message: `${fall.occurredOn} 这一条会从跌倒记录和病程时间线上一起撤下。`,
      confirmLabel: '删除',
      destructive: true,
    });
    if (!confirmed) return;
    setDeleteError(null);
    try {
      await deleteFall(fall.id);
      await load();
    } catch (error) {
      // Its OWN state, not `loadError`. The load error is rendered only
      // when there is no list to show, so putting a failed delete there
      // would leave the entry on screen looking retracted and say
      // nothing — the patient would believe it was gone.
      setDeleteError(error instanceof Error ? error.message : '删除没有成功，请稍后再试。');
    }
  };

  const summary = result?.summary ?? null;
  const windowDays = result?.windowDays ?? FALLS_WINDOW_DAYS;
  const courseNote = summary ? summarizeFallsForCourse(summary, windowDays) : null;
  const unlisted = result ? describeUnlistedFalls(result.summary, result.falls.length) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.safeArea}>
        <ScreenHeader title="跌倒记录" />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>
            摔了就记一条。只有日期是要填的，其余的想填再填，不填也存得上。
          </Text>

          <View style={styles.form}>
            <Text style={styles.question}>哪一天？</Text>
            <View style={styles.optionWrap} accessibilityRole="radiogroup" aria-label="跌倒的日期">
              {FALL_DATE_QUICK_PICKS.map((pick) => {
                const iso = isoDateDaysAgo(pick.daysAgo);
                const selected = !customDate && draft.occurredOn === iso;
                return (
                  <Pressable
                    key={pick.label}
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => {
                      setCustomDate(false);
                      patch({ occurredOn: iso });
                      setFormError(null);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, checked: selected }}
                    aria-checked={selected}
                  >
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                      {pick.label}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                style={[styles.option, customDate && styles.optionSelected]}
                onPress={() => {
                  setCustomDate(true);
                  setFormError(null);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: customDate, checked: customDate }}
                aria-checked={customDate}
              >
                <Text style={[styles.optionText, customDate && styles.optionTextSelected]}>
                  更早的一天
                </Text>
              </Pressable>
            </View>

            {customDate ? (
              <TextInput
                style={styles.dateInput}
                value={draft.occurredOn}
                onChangeText={(value) => {
                  patch({ occurredOn: value });
                  setFormError(null);
                }}
                placeholder="2026-08-06"
                placeholderTextColor={COLOR.inkMuted}
                keyboardType="numbers-and-punctuation"
                accessibilityLabel="跌倒的日期，格式为年-月-日"
              />
            ) : null}

            {/* Full-size, never `compact`: on the web export a compact
                button is a 34pt target (Button.tsx), and this is the
                control the whole screen exists for. */}
            <View style={styles.submit}>
              <Button
                label="保存这一次"
                variant="prominent"
                fullWidth
                busy={busy}
                onPress={() => void submit()}
                accessibilityHint="只用日期就能保存"
              />
            </View>

            {formError ? <Text style={styles.formError}>{formError}</Text> : null}

            <View style={styles.disclosure}>
              <Button
                label={detailsOpen ? '收起当时的情况' : '补充当时的情况（可以不填）'}
                variant="tinted"
                fullWidth
                icon={detailsOpen ? 'minus' : 'plus'}
                onPress={() => setDetailsOpen((previous) => !previous)}
              />
            </View>

            {detailsOpen ? (
              <>
                <OptionRow
                  question={FALL_ACTIVITY_QUESTION_ZH}
                  options={ACTIVITY_OPTIONS}
                  value={draft.activity}
                  onChange={(activity) => patch({ activity })}
                />
                <OptionRow
                  question="在哪里"
                  options={LOCATION_OPTIONS}
                  value={draft.location}
                  onChange={(location) => patch({ location })}
                />
                <OptionRow
                  question="当时双手"
                  options={HANDS_FULL_OPTIONS}
                  value={toYesNo(draft.handsFull)}
                  onChange={(next) => patch({ handsFull: fromYesNo(next) })}
                />
                <OptionRow
                  question="后来是怎么起来的"
                  options={GOT_UP_OPTIONS}
                  value={toYesNo(draft.gotUpUnaided)}
                  onChange={(next) => patch({ gotUpUnaided: fromYesNo(next) })}
                />
                <OptionRow
                  question="有没有受伤"
                  options={INJURED_OPTIONS}
                  value={toYesNo(draft.injured)}
                  onChange={(next) => patch({ injured: fromYesNo(next) })}
                />
                <Text style={styles.detailHint}>
                  没选的就是没填，不会被当成「没有」。选错了再点一下就能取消。
                </Text>
              </>
            ) : null}
          </View>

          {savedNote ? <Text style={styles.savedNote}>{savedNote}</Text> : null}

          {isLoading ? (
            <View style={styles.stateBlock}>
              <View style={styles.loadingRow}>
                <ActivityIndicator />
                <Text style={styles.stateText}>正在读已经记下的条目</Text>
              </View>
            </View>
          ) : null}

          {loadError && !result ? (
            <View style={styles.stateBlock}>
              <Text style={styles.stateText}>{loadError}</Text>
              {/* Deliberately no zeroed count beside this. 「0 次」 with
                  nothing behind it is the app telling someone they have
                  not fallen. */}
              <Text style={styles.stateText}>上面的表单不受影响，现在记的这一条照样存得上。</Text>
              <Button label="重新加载" variant="tinted" onPress={() => void load()} />
            </View>
          ) : null}

          {courseNote ? (
            <View style={styles.contextBlock}>
              <Text style={styles.contextLine}>{courseNote.headline}</Text>
              {courseNote.caveat ? (
                <Text style={styles.contextCaveat}>{courseNote.caveat}</Text>
              ) : null}
              {unlisted ? <Text style={styles.contextCaveat}>{unlisted}</Text> : null}
            </View>
          ) : null}

          {result && result.falls.length > 0 ? (
            <>
              <Text style={styles.listHeading} accessibilityRole="header">
                已经记下的
              </Text>
              {/* A failed retraction, said beside the entry that is
                  still there. Without it the row stays on screen with
                  no explanation and reads as「删了但没消失」. */}
              {deleteError ? <Text style={styles.formError}>{deleteError}</Text> : null}
              {result.falls.map((fall) => {
                const chips = describeFallDetails(fall);
                return (
                  <View key={fall.id} style={styles.entry}>
                    <View style={styles.entryTopRow}>
                      <View>
                        <Text style={styles.entryDay}>{describeFallDay(fall.occurredOn)}</Text>
                        <Text style={styles.entryDate}>{fall.occurredOn}</Text>
                      </View>
                      {/* `plain` is legal here: position inside a list
                          row already says it is interactive. Not
                          `compact` — see the submit button above. */}
                      <Button
                        label="删除"
                        variant="plain"
                        accessibilityLabel={`删除 ${fall.occurredOn} 的跌倒记录`}
                        onPress={() => void remove(fall)}
                      />
                    </View>
                    {chips.length > 0 ? (
                      <View style={styles.chipWrap}>
                        {chips.map((chip) => (
                          <View key={chip} style={styles.chip}>
                            <Text style={styles.chipText}>{chip}</Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      // About the row, not about the person. It exists
                      // so a date-only entry does not read as a fall
                      // that happened indoors, uninjured, unassisted.
                      <Text style={styles.dateOnlyText}>这一条只有日期。</Text>
                    )}
                  </View>
                );
              })}
            </>
          ) : null}
        </ScrollView>
      </View>

      <SensitiveDataConsentGate {...gateProps} />
    </SafeAreaView>
  );
};

export default FallsScreen;
