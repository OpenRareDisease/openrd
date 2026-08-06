import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import ScreenHeader from '../common/ScreenHeader';
import Button from '../common/Button';
import SegmentedControl from '../common/SegmentedControl';
import ToggleSwitch from '../common/ToggleSwitch';
import styles from './styles';
import { COLOR } from '../../lib/design';
import {
  ANESTHESIA_CARD_HREF,
  GENETICS_HREF,
  PREGNANCY_CONSENT_BODY,
  PREGNANCY_CONSENT_CHECKBOX_LABEL,
  PREGNANCY_CONSENT_TITLE,
  PREGNANCY_DISCLAIMER,
  PREGNANCY_INTRO,
  PREGNANCY_STAGES,
  PREGNANCY_TRACKER_CLEARED_NOTICE,
  PREGNANCY_TRACKER_CLEAR_LABEL,
  PREGNANCY_TRACKER_EXPLAINER,
  PREGNANCY_TRACKER_TITLE,
  SURVEILLANCE_HREF,
  describeGestation,
  formatGestation,
  getStage,
  stageForGestationalWeek,
  type PregnancyStageKey,
} from '../../lib/pregnancy-timeline-content';
import { clearDueDate, readDueDate, saveDueDate } from './pregnancy-tracker';

/**
 * 孕期时间线.
 *
 * A reading page in the same family as 遗传与生育 and 我的随访计划:
 * text, sources on every block, nothing the app does on the patient's
 * behalf. What is different — and what needed the care — is that this
 * one has a place to put a due date, and a due date is a statement
 * that someone is pregnant.
 *
 * The four rules this screen exists to hold
 * -----------------------------------------
 *  1. **The page is complete without the date.** Every stage is
 *     readable, in full, before anything is entered and after it is
 *     deleted. The date buys one thing: which tab opens first. If it
 *     ever buys more than that, the feature has started charging
 *     sensitive personal information for content.
 *  2. **The off switch outranks the content.** When a date is stored,
 *     the tracker block — whose FIRST control is 关闭并删除预产期 —
 *     renders above the intro, so the tap that stops all date-keyed
 *     text is the first thing on the page rather than something to be
 *     found. One press: no dialog, no 「确定吗」, no reason field. The
 *     screen stops rendering the week immediately, before the storage
 *     write is even awaited, because a person who pressed it has
 *     stopped consenting whether or not the browser cooperated.
 *  3. **Nothing is inferred.** Opening this screen writes nothing.
 *     The one write is behind an Art. 29 单独同意 switch that starts
 *     off and is not remembered between visits.
 *  4. **No countdown, no congratulation.** The readout says 「孕 22 周
 *     +3 天」 and stops. 「还有 118 天」 is a promise about an outcome,
 *     and this app is not in a position to make one.
 *
 * After a clear, the setup form does not come back in the same
 * session. See PREGNANCY_TRACKER_CLEARED_NOTICE for why: the likeliest
 * presser of that button has just had a pregnancy end, and re-offering
 * the field underneath 产后抑郁筛查 is the app asking them to confirm
 * it. A quiet 「重新填写」 stays available for the person who simply
 * mistyped, one press away and clearly separated.
 */

const STAGE_SEGMENTS = PREGNANCY_STAGES.map((stage) => ({
  key: stage.key,
  label: stage.shortTitle,
}));

interface CrossLink {
  label: string;
  href: string;
  hint: string;
}

const CROSS_LINKS: CrossLink[] = [
  {
    label: '打开「遗传与生育」',
    href: GENETICS_HREF,
    hint: '50% 的遗传概率、PGT 的 5% 误判风险、产前诊断怎么选 —— 都在那一页，本页不重复，两边不会说成两个版本。',
  },
  {
    label: '打开「麻醉注意事项卡」',
    href: ANESTHESIA_CARD_HREF,
    hint: '在临床护照里生成，是给麻醉医师看的那一张。孕晚期见麻醉科时带上它。',
  },
  {
    label: '打开「我的随访计划」',
    href: SURVEILLANCE_HREF,
    hint: '肺功能、心脏、疼痛这几条在孕期之外一样适用，那一页会对照你自己的记录。',
  },
];

const PregnancyScreen = () => {
  const router = useRouter();

  /** null = no stored date (the default, and every failure's answer). */
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  /** Set only by an explicit tap on 关闭并删除预产期, and only for this
   *  session — nothing about the clearing is persisted (see
   *  pregnancy-tracker.ts, rule 3). */
  const [justCleared, setJustCleared] = useState(false);

  const [draft, setDraft] = useState('');
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** null = follow the date, if there is one. Set by tapping a tab. */
  const [chosenStage, setChosenStage] = useState<PregnancyStageKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    // `today` is read once per load and passed down, so the validity
    // check on read and the week printed from it agree with each other.
    void readDueDate(new Date())
      .then((stored) => {
        if (cancelled) return;
        setDueDate(stored);
        setHasLoaded(true);
      })
      // A read that blew up is 「no date」, not 「no page」. Without this
      // the block would stay unmounted forever on a storage failure and
      // the reader would lose the optional field with no explanation.
      .catch(() => {
        if (cancelled) return;
        setDueDate(null);
        setHasLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const gestation = useMemo(
    () => (dueDate ? describeGestation(dueDate, new Date()) : null),
    [dueDate],
  );

  const autoStage = gestation ? stageForGestationalWeek(gestation.weeks) : null;
  const activeStageKey: PregnancyStageKey = chosenStage ?? autoStage ?? 'preconception';
  const activeStage = getStage(activeStageKey) ?? PREGNANCY_STAGES[0];

  const handleSave = useCallback(() => {
    const value = draft.trim();
    const today = new Date();
    const refuse = () =>
      setError(
        '这个日期看起来不像预产期。请按 2026-03-15 的格式填写一个今天之后、40 周以内的日期。',
      );
    void saveDueDate(value, today)
      .then((ok) => {
        if (!ok) {
          refuse();
          return;
        }
        setError(null);
        setDueDate(value);
        setJustCleared(false);
        // The tab follows the new date on the next render unless the
        // reader has already picked one themselves.
        setChosenStage(null);
      })
      // A throw here must read as 「not saved」. Showing the week from a
      // value that never reached storage would be a page asserting a
      // pregnancy it did not record and cannot delete.
      .catch(refuse);
  }, [draft]);

  /**
   * The one tap.
   *
   * Local state is cleared FIRST and synchronously: the week readout
   * and every date-keyed line stop rendering on this frame, before the
   * storage removal is awaited and regardless of whether it succeeds.
   * Making the UI wait on the write would mean a failed or slow write
   * left the checklist on screen — which is the exact failure this
   * whole control exists to prevent.
   */
  const handleClear = useCallback(() => {
    setDueDate(null);
    setDraft('');
    setConsented(false);
    setError(null);
    setChosenStage(null);
    setJustCleared(true);
    // `.catch` and not bare `void`: clearDueDate swallows its own
    // storage errors today, but this call site must not be the reason
    // an unhandled rejection ever escapes from the one control on this
    // page that has to work. The UI has already cleared itself above;
    // there is nothing left to report and nothing the reader could do.
    void clearDueDate().catch(() => {});
  }, []);

  const trackerBlock = (() => {
    if (!hasLoaded) return null;

    if (dueDate && gestation) {
      return (
        <View style={styles.tracker}>
          {/* First control in the block, above the readout, on purpose.
              See rule 2 in the header comment. */}
          <Button
            label={PREGNANCY_TRACKER_CLEAR_LABEL}
            variant="tinted"
            fullWidth
            onPress={handleClear}
            accessibilityHint="立即删除这台设备上保存的预产期，并停止显示所有和日期有关的内容。不会再问一次。"
          />
          <Text style={[styles.gestation, { marginTop: 14 }]}>{formatGestation(gestation)}</Text>
          <Text style={styles.gestationHint}>
            按你填的预产期算的，只保存在这台设备上。下面默认打开的是这一周所在的阶段，你可以随时点别的阶段。
          </Text>
        </View>
      );
    }

    if (justCleared) {
      return (
        <View style={styles.tracker}>
          <Text style={styles.clearedNotice}>{PREGNANCY_TRACKER_CLEARED_NOTICE}</Text>
          {/* Quiet, separated, and phrased as a correction rather than
              an invitation — for the person who mistyped the year. */}
          <View style={styles.reopenBlock}>
            <Button label="重新填写" variant="plain" onPress={() => setJustCleared(false)} />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.tracker}>
        <Text style={styles.trackerTitle} accessibilityRole="header">
          {PREGNANCY_TRACKER_TITLE}
        </Text>
        <Text style={styles.trackerText}>{PREGNANCY_TRACKER_EXPLAINER}</Text>

        <View style={styles.consentBlock}>
          <Text style={styles.consentTitle}>{PREGNANCY_CONSENT_TITLE}</Text>
          <Text style={styles.consentBody}>{PREGNANCY_CONSENT_BODY}</Text>
          <View style={styles.consentRow}>
            <ToggleSwitch
              isEnabled={consented}
              onToggle={setConsented}
              accessibilityLabel={PREGNANCY_CONSENT_CHECKBOX_LABEL}
            />
            <Text style={styles.consentRowLabel}>{PREGNANCY_CONSENT_CHECKBOX_LABEL}</Text>
          </View>
        </View>

        <Text style={styles.fieldLabel}>预产期</Text>
        <TextInput
          style={[styles.input, error ? styles.inputError : null]}
          value={draft}
          onChangeText={(text) => {
            setDraft(text);
            if (error) setError(null);
          }}
          placeholder="2026-03-15"
          placeholderTextColor={COLOR.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          inputMode="numeric"
          accessibilityLabel="预产期，格式为年-月-日"
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Button
          label="保存到这台设备"
          variant="tinted"
          fullWidth
          // Gated on the Art. 29 switch, not merely accompanied by it.
          disabled={!consented || draft.trim().length === 0}
          onPress={handleSave}
          accessibilityHint={
            consented ? '保存后可以随时一键删除。' : '需要先打开上面的同意开关才能保存。'
          }
        />
      </View>
    );
  })();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.safeArea}>
        <ScreenHeader title="孕期时间线" fallbackHref={GENETICS_HREF as Href} />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Order is deliberate. With a date stored, the block whose
              first control deletes it comes before everything else;
              with no date stored, the page leads with the paragraph
              saying it does not push, and the optional field follows.
              A page that opened with 「填写预产期」 would be asking
              before it had said why it was not asking. */}
          {dueDate ? trackerBlock : null}

          <Text style={styles.intro}>{PREGNANCY_INTRO}</Text>

          {dueDate ? null : trackerBlock}

          <SegmentedControl
            segments={STAGE_SEGMENTS}
            value={activeStageKey}
            onChange={(key) => setChosenStage(key as PregnancyStageKey)}
            accessibilityLabel="孕期阶段"
            style={styles.segmented}
          />

          <View style={styles.stageHeader}>
            <View style={styles.stageTitleRow}>
              <Text style={styles.stageTitle} accessibilityRole="header">
                {activeStage.title}
              </Text>
              {activeStage.weeksLabel ? (
                <Text style={styles.stageWeeks}>{activeStage.weeksLabel}</Text>
              ) : null}
            </View>
            <Text style={styles.stageLede}>{activeStage.lede}</Text>
          </View>

          {activeStage.items.map((item) => (
            <View key={item.id} style={styles.item}>
              <Text style={styles.itemTitle} accessibilityRole="header">
                {item.title}
              </Text>
              {/* Selectable: on the web export this is what a patient
                  copies into WeChat to send to a partner, or reads off
                  the screen in an obstetrics clinic. */}
              <Text style={styles.itemDetail} selectable>
                {item.detail}
              </Text>
              <View style={styles.sourceRow}>
                <Text style={styles.sourceText}>出处：{item.source}</Text>
              </View>
            </View>
          ))}

          <View style={styles.links}>
            <Text style={styles.linksTitle}>相关的页面</Text>
            {CROSS_LINKS.map((link) => (
              <View key={link.href}>
                {/* Full-size, not compact: on the web export a compact
                    button is a 34pt target (see Button.tsx on hitSlop
                    under react-native-web). */}
                <Button
                  label={link.label}
                  variant="tinted"
                  trailingIcon="chevron-right"
                  accessibilityHint={link.hint}
                  onPress={() => router.push(link.href as Href)}
                />
                <Text style={styles.linkHint}>{link.hint}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.disclaimer}>{PREGNANCY_DISCLAIMER}</Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

export default PregnancyScreen;
