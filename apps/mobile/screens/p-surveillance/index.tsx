import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import ScreenHeader from '../common/ScreenHeader';
import Button from '../common/Button';
import styles from './styles';
import {
  ApiError,
  getClinicalPassportSummary,
  getMyPatientProfile,
  type ClinicalPassportSummary,
  type PatientProfile,
} from '../../lib/api';
import {
  SURVEILLANCE_COVERAGE_NOTE,
  SURVEILLANCE_DISCLAIMER,
  SURVEILLANCE_INTRO,
  SURVEILLANCE_LEVEL_LEGEND,
  buildSurveillanceSchedule,
  type SurveillanceRow,
} from '../../lib/surveillance-schedule';

/**
 * 我的随访计划.
 *
 * A reading page in the same family as 遗传与生育: text, sources, no
 * actions the app performs on the patient's behalf. What makes it
 * different is that it is *keyed to their record* — the wheelchair
 * event they logged, the D4Z4 count off their genetics report, their
 * date of birth — so the guideline's conditional recommendations stop
 * being conditions the reader has to evaluate about themselves.
 *
 * Three things this screen must never do, in order of how badly they
 * would fail the person reading:
 *
 *  1. Read as a prescription. Every row ends at a sentence to say to a
 *     doctor. There is no 「安排检查」 button and no checkbox, because
 *     ticking a row would make the page a plan the app owns.
 *  2. Present a row we could not evaluate as a row that does not
 *     apply. `unknown` and `not_matched` are separate states with
 *     separate copy — the platform never asked about scoliosis or
 *     daytime somnolence, and a grey 「不适用」 over those would be the
 *     app telling a patient something about their body that it has no
 *     way of knowing.
 *  3. Show a reassuring empty state when the fetch failed. A page that
 *     silently rendered the six universal rows without the patient's
 *     data would look complete and be wrong exactly on the rows that
 *     depend on the record.
 *
 * The content and every branch live in lib/surveillance-schedule.ts so
 * the clinical claims are testable without a renderer.
 */

const APPLICABILITY_CHIP: Record<
  SurveillanceRow['applicability'],
  { label: string; tone: 'matched' | 'neutral' } | null
> = {
  // Nothing to say: the row applies to every FSHD patient and a chip
  // reading「所有人」on six rows is noise.
  everyone: null,
  matched: { label: '和你的记录对得上', tone: 'matched' },
  not_matched: { label: '按你的记录不适用', tone: 'neutral' },
  unknown: { label: '这里判断不了', tone: 'neutral' },
};

const SurveillanceRowCard = ({ row }: { row: SurveillanceRow }) => {
  const router = useRouter();
  const applicabilityChip = APPLICABILITY_CHIP[row.applicability];
  const isMatched = row.applicability === 'matched';
  const { link } = row;

  return (
    <View style={[styles.row, isMatched && styles.rowMatched]}>
      <View style={styles.chipRow}>
        <View style={[styles.chip, styles.chipLevel]}>
          <Text style={[styles.chipText, styles.chipLevelText]}>
            {row.level === 'B' ? 'Level B · 中等推荐' : 'Level C · 弱推荐'}
          </Text>
        </View>

        {row.polarity === 'do_not' ? (
          <View style={[styles.chip, styles.chipDoNot]}>
            <Text style={[styles.chipText, styles.chipDoNotText]}>指南不建议常规做</Text>
          </View>
        ) : null}

        {applicabilityChip ? (
          <View style={[styles.chip, applicabilityChip.tone === 'matched' && styles.chipMatched]}>
            <Text
              style={[
                styles.chipText,
                applicabilityChip.tone === 'matched' && styles.chipMatchedText,
              ]}
            >
              {applicabilityChip.label}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.rowTitle} accessibilityRole="header">
        {row.title}
      </Text>
      <Text style={styles.rowGuideline}>{row.guideline}</Text>

      <View style={styles.evidenceBlock}>
        <Text style={styles.evidenceLabel}>依据你的记录</Text>
        <Text style={styles.evidenceText}>{row.evidence}</Text>
      </View>

      {/* Selectable: on the web export this is the block a patient
          copies into WeChat to send ahead of an appointment, or reads
          off the screen in the room. */}
      <View style={styles.askBlock}>
        <Text style={styles.askLabel}>和医生确认</Text>
        <Text style={styles.askText} selectable>
          {row.ask}
        </Text>
      </View>

      {/* Full-size, not `compact`: on the web export — the only channel
          that ships — a compact button is a 34pt target (see
          Button.tsx's note on hitSlop under react-native-web), and this
          is the control that gets pressed by someone whose grip this
          disease has already taken something from. */}
      {link ? (
        <View style={styles.linkBlock}>
          <Button
            label={link.label}
            variant="tinted"
            trailingIcon="chevron-right"
            accessibilityHint={link.hint}
            onPress={() => router.push(link.href as Href)}
          />
          <Text style={styles.linkHint}>{link.hint}</Text>
        </View>
      ) : null}

      <Text style={styles.sourceText}>出处：{row.source}</Text>
    </View>
  );
};

const SurveillanceScreen = () => {
  const [passport, setPassport] = useState<ClinicalPassportSummary | null>(null);
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const [passportData, profileData] = await Promise.all([
        getClinicalPassportSummary(),
        getMyPatientProfile(),
      ]);
      setPassport(passportData);
      setProfile(profileData);
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError ? error.message : '读不到你的档案，这一页没法对照你的记录。',
      );
      // Both cleared together. A schedule built from a stale passport
      // and a fresh profile — or from half of a failed reload — would
      // print branch decisions ("你的 D4Z4 重复数是 3") sourced from
      // data this screen can no longer vouch for.
      setPassport(null);
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // `today` is captured per build rather than read inside the builder,
  // so every recency and age branch on one render agrees with itself.
  const schedule = useMemo(
    () => (passport ? buildSurveillanceSchedule(passport, profile, new Date()) : null),
    [passport, profile],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.safeArea}>
        <ScreenHeader title="我的随访计划" />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>{SURVEILLANCE_INTRO}</Text>

          {isLoading ? (
            <View style={styles.stateCard}>
              <View style={styles.loadingRow}>
                <ActivityIndicator />
                <Text style={styles.stateTitle}>正在对照你的记录</Text>
              </View>
              <Text style={styles.stateText}>
                指南的内容是固定的，需要读的是你的部分：基因报告、随访事件、检查结果。
              </Text>
            </View>
          ) : null}

          {errorMessage && !schedule ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>暂时对照不了你的记录</Text>
              <Text style={styles.stateText}>{errorMessage}</Text>
              {/* Deliberately no "just show the guideline anyway"
                  fallback. Half of these rows are conditional, and a
                  page that rendered them with no record behind them
                  would look like it had checked. */}
              <Text style={styles.stateText}>
                指南本身没有变，是你的档案这会儿读不到。稍后再打开一次。
              </Text>
              <Button label="重新加载" variant="tinted" onPress={() => void load()} />
            </View>
          ) : null}

          {schedule ? (
            <>
              {schedule.matchedCount > 0 ? (
                <Text style={styles.matchedLine}>
                  其中 {schedule.matchedCount} 条和你记录里的情况直接对得上。
                </Text>
              ) : null}

              <Text style={styles.coverageNote}>{SURVEILLANCE_COVERAGE_NOTE}</Text>

              {schedule.groups.map((group) => (
                <View key={group.key}>
                  <View style={styles.groupHeader}>
                    <Text style={styles.groupTitle} accessibilityRole="header">
                      {group.title}
                    </Text>
                    <Text style={styles.groupLede}>{group.lede}</Text>
                  </View>

                  {group.rows.map((row) => (
                    <SurveillanceRowCard key={row.id} row={row} />
                  ))}
                </View>
              ))}

              <View style={styles.legend}>
                <Text style={styles.legendTitle}>推荐强度是什么意思</Text>
                {SURVEILLANCE_LEVEL_LEGEND.map((entry) => (
                  <Text key={entry.level} style={styles.legendRow}>
                    {entry.label} —— {entry.gloss}
                  </Text>
                ))}
              </View>

              <Text style={styles.disclaimer}>{SURVEILLANCE_DISCLAIMER}</Text>
            </>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

export default SurveillanceScreen;
