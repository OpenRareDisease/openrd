import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import Button from '../common/Button';
import SegmentedControl from '../common/SegmentedControl';
import { LineChart } from 'react-native-chart-kit';
import {
  addMedication,
  ApiError,
  getMuscleInsight,
  type MuscleInsight,
  getMyPatientProfile,
  getProgressionSummary,
  getRiskSummary,
  type AiAskContext,
  type AiAskMetricKey,
  type PatientProfile,
  type ProgressionSummary,
} from '../../lib/api';
import { formatDateLabel, getRiskMeta } from '../../lib/clinical-visuals';
import { COLOR, INTERACTION, MOTION } from '../../lib/design';
import {
  buildMedicationHighlights,
  buildPatientVisualizationCards,
  buildProgressionTimeline,
  type PatientVisualizationKey,
} from '../../lib/followup-analytics';
import { buildLatestMriVisualization, buildReportInsights } from '../../lib/report-insights';
import AskAboutDrawer from '../common/AskAboutDrawer';
import HumanBodyFigure from '../common/HumanBodyFigure';
import SystemMonitoringPanels from '../common/SystemMonitoringPanels';
import TimelineSectionCard from '../common/TimelineSectionCard';
import styles from './styles';

/** Outlined badges: the trend colour rides on the border and the word
 *  itself, so the word keeps full ink contrast. The old tinted-fill
 *  version washed out exactly the thing it was meant to emphasise. */
const trendMeta: Record<
  NonNullable<ProgressionSummary['changeCards']>[number]['trend'],
  { label: string; color: string }
> = {
  better: { label: '改善', color: COLOR.good },
  // inkSoft, not inkMuted: the badge lost its tinted fill in this
  // pass, so the word now sits directly on paper at 11pt.
  stable: { label: '平稳', color: COLOR.inkSoft },
  worse: { label: '加重', color: COLOR.alert },
  new: { label: '新增', color: COLOR.warn },
};

/** Every chart key is one the server accepts as an ask-context, so
 *  every chart gets the ask affordance. This annotation is the check:
 *  add a chart whose key the server doesn't allow and it stops
 *  compiling here, instead of shipping a button that 400s at runtime.
 *
 *  The runtime allowlist this replaces had drifted — it carried
 *  'muscle_strength', which no `PatientVisualizationCard` has ever
 *  used, so the "no ask button" branch was unreachable while a real
 *  gap would have been just as invisible. */
const asMetricKey = (key: PatientVisualizationKey): AiAskMetricKey => key;

/**
 * The tabs, grouped by the question a patient opens 病程 to ask —
 * not by which table the data came out of.
 *
 * The screen used to stack ten blocks in payload order (interventions,
 * meds, cohort, changes, evidence, charts, body map, timeline, system
 * panels), which meant "我这次检查结果怎么样" was four screenfuls of
 * scrolling past things the patient wasn't asking about. Regrouped,
 * the five real questions are:
 *
 *   近况      — 上次记录之后有什么变化，我在群体里的位置
 *   趋势      — 我是在变好还是变差（受累分布 + 曲线）
 *   用药与辅具 — 我现在在用什么，怎么补一条
 *   检查结果  — 我做过的检查说了什么（诊断/MRI/各系统）
 *   时间轴    — 这一路发生过什么
 *
 * 和病友群体相比 sits with 最近记录的变化 rather than with the charts
 * because both answer "现在怎么样", while the charts answer "在往哪走".
 * 受累可视化 moves in with the charts for the same reason: the body map
 * and the curves are one question asked two ways.
 *
 * The status hero and 记一笔 stay *above* the strip: they are the
 * answer to "我现在怎么样" and the app's primary verb, and neither
 * belongs to any single tab.
 */
const TABS = [
  {
    key: 'recent',
    label: '近况',
    caption: '最近一次记录之后发生了什么，以及你在病友群体里的位置。',
  },
  {
    key: 'trends',
    label: '趋势',
    caption: '受累分布和日常记录画出的曲线。任何一条看不懂都可以就地追问。',
  },
  { key: 'meds', label: '用药与辅具', caption: '当前在用的药物和辅具，也可以直接在这里补一条。' },
  {
    key: 'exams',
    label: '检查结果',
    caption: '诊断分型、MRI 以及实验室、呼吸、心脏检查里已识别出的关键结果。',
  },
  { key: 'timeline', label: '时间轴', caption: '病程变化、事件和报告按时间统一排列。' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const toRgba = (hex: string, opacity = 1) => {
  const normalized = hex.replace('#', '');
  const safeHex =
    normalized.length === 3
      ? normalized
          .split('')
          .map((part) => `${part}${part}`)
          .join('')
      : normalized;

  const red = Number.parseInt(safeHex.slice(0, 2), 16);
  const green = Number.parseInt(safeHex.slice(2, 4), 16);
  const blue = Number.parseInt(safeHex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
};

/** The chart now sits on the page rather than inside a tinted card, so
 *  its canvas is paper — a chart that carries its own background is a
 *  box, and this pass is removing boxes. */
const createChartConfig = (lineColor: string) => ({
  backgroundColor: COLOR.paper,
  backgroundGradientFrom: COLOR.paper,
  backgroundGradientTo: COLOR.paper,
  decimalPlaces: 1,
  color: (opacity = 1) => toRgba(lineColor, opacity),
  labelColor: () => COLOR.inkMuted,
  propsForDots: {
    r: '3',
    strokeWidth: '2',
    stroke: lineColor,
  },
});

const renderChartPoints = (points: Array<{ timestamp: string; value: number }>) => {
  if (!points.length) {
    return null;
  }

  if (points.length === 1) {
    return {
      labels: [formatDateLabel(points[0].timestamp), formatDateLabel(points[0].timestamp)],
      datasets: [{ data: [points[0].value, points[0].value] }],
    };
  }

  return {
    labels: points.map((item) => formatDateLabel(item.timestamp)),
    datasets: [{ data: points.map((item) => item.value) }],
  };
};

export default function ManageScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [summary, setSummary] = useState<ProgressionSummary | null>(null);
  const [riskSummary, setRiskSummary] = useState<{
    overallLevel?: string | null;
    notes?: string[];
  } | null>(null);
  const [bodyView, setBodyView] = useState<'front' | 'back'>('front');
  // Which question the patient is currently on. Pure render state —
  // every tab reads from the payload `loadData` already fetched, so
  // switching tabs never touches the network.
  const [activeTab, setActiveTab] = useState<TabKey>(TABS[0].key);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Inline medication add-form (PR-25): the med list finally becomes
  // maintainable where it's read.
  const [medFormVisible, setMedFormVisible] = useState(false);
  const [medDraft, setMedDraft] = useState({ name: '', dosage: '', frequency: '' });
  const [medBusy, setMedBusy] = useState(false);
  const [medError, setMedError] = useState<string | null>(null);
  // 就地追问: which object the drawer is currently pinned to. Undefined
  // context = an open question about the page as a whole.
  const [ask, setAsk] = useState<{ context?: AiAskContext; label?: string } | null>(null);
  // Cohort comparison (PR-27): per-muscle-group percentile
  // distribution vs the patient's own latest self-test score. Loaded
  // best-effort alongside the page; groups without data drop out.
  const [muscleInsights, setMuscleInsights] = useState<
    Array<{ label: string; insight: MuscleInsight }>
  >([]);

  const submitMedication = async () => {
    const name = medDraft.name.trim();
    if (!name) {
      setMedError('请填写药物名称。');
      return;
    }
    if (medBusy) return;
    setMedBusy(true);
    setMedError(null);
    try {
      await addMedication({
        medicationName: name,
        dosage: medDraft.dosage.trim() || null,
        frequency: medDraft.frequency.trim() || null,
        status: 'active',
      });
      setMedDraft({ name: '', dosage: '', frequency: '' });
      setMedFormVisible(false);
      await loadData(true);
    } catch (error) {
      setMedError(error instanceof Error ? error.message : '保存失败，请稍后重试。');
    } finally {
      setMedBusy(false);
    }
  };

  const loadData = async (refresh = false) => {
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      setErrorMessage(null);
      const [profileData, summaryData, riskData] = await Promise.all([
        getMyPatientProfile(),
        getProgressionSummary(),
        getRiskSummary(),
      ]);
      setProfile(profileData);
      setSummary(summaryData);
      setRiskSummary(riskData as { overallLevel?: string | null; notes?: string[] });

      // Best-effort, after the main payload: a failed insight fetch
      // (or an empty cohort) silently drops that row.
      const groups: Array<{ group: string; label: string }> = [
        { group: 'deltoid', label: '举手过头（肩带）' },
        { group: 'biceps', label: '屈肘（上臂）' },
        { group: 'quadriceps', label: '伸膝（大腿）' },
        { group: 'tibialis', label: '勾脚背（小腿）' },
      ];
      const settled = await Promise.allSettled(
        groups.map(async ({ group, label }) => ({
          label,
          insight: await getMuscleInsight(group),
        })),
      );
      setMuscleInsights(
        settled
          .filter(
            (result): result is PromiseFulfilledResult<{ label: string; insight: MuscleInsight }> =>
              result.status === 'fulfilled' &&
              result.value.insight.userLatestScore !== null &&
              result.value.insight.distribution !== null,
          )
          .map((result) => result.value),
      );
    } catch (error) {
      setProfile(null);
      setSummary(null);
      setRiskSummary(null);
      setErrorMessage(error instanceof ApiError ? error.message : '暂时无法加载病程管理页。');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData().catch(() => undefined);
  }, []);

  /** Reset to the first tab when the screen loses focus, so coming back
   *  always lands on 近况 rather than wherever the patient happened to
   *  stop last time —「我上次停在哪」is a question the app shouldn't
   *  make them answer. Reset on blur rather than on focus: on focus it
   *  would also fire on the very first mount and on every re-focus
   *  after the tab is already correct, and a patient who taps 病程 in
   *  the tab bar while already on it would see the panel flip out from
   *  under them mid-read. */
  useFocusEffect(useCallback(() => () => setActiveTab(TABS[0].key), []));

  const riskMeta = getRiskMeta(riskSummary?.overallLevel);
  const reportInsights = useMemo(
    () => buildReportInsights(profile?.documents ?? [], profile),
    [profile],
  );
  const patientVisualizationCards = useMemo(
    () => buildPatientVisualizationCards(profile),
    [profile],
  );
  const latestMriVisualization = useMemo(
    () => buildLatestMriVisualization(profile?.documents ?? []),
    [profile],
  );
  const timelineItems = useMemo(
    () => buildProgressionTimeline(profile, summary, 8),
    [profile, summary],
  );
  const medicationHighlights = useMemo(() => buildMedicationHighlights(profile), [profile]);
  const assistiveDevices =
    profile?.baseline?.currentStatus?.assistiveDevices?.filter(Boolean) ?? [];
  const evidencePanels = [reportInsights.diagnosisPanel, reportInsights.imagingPanel];
  const systemPanels = reportInsights.systemPanels;
  // The charts are no longer inset by a card's padding, so they get
  // back the ~36pt they were losing to it.
  const chartWidth = Math.max(220, windowWidth - 48);

  const changeCards = summary?.changeCards?.slice(0, 3) ?? [];
  // `find` can't be proven non-empty to the compiler, and a stale key
  // would otherwise blank the caption rather than fall back.
  const activeTabMeta = TABS.find((tab) => tab.key === activeTab) ?? TABS[0];

  /** One tab's content. Every branch reads state that is already in
   *  memory — no branch fetches, so switching tabs costs a render and
   *  nothing else. Every branch also carries its own empty state: an
   *  empty *section* used to read as "nothing here yet" because the
   *  sections above and below it proved the page had loaded, but an
   *  empty *tab* reads as a broken tab. */
  const renderPanel = () => {
    switch (activeTab) {
      case 'recent':
        return (
          <>
            <Text style={styles.blockHeading}>最近记录的变化</Text>
            {changeCards.length ? (
              changeCards.map((item) => {
                const meta = trendMeta[item.trend];
                return (
                  <View key={item.id} style={styles.changeRow}>
                    <View style={styles.changeCopy}>
                      <Text style={styles.changeTitle}>{item.title}</Text>
                      <Text style={styles.changeDetail}>{item.detail}</Text>
                    </View>
                    <View style={[styles.changeBadge, { borderColor: meta.color }]}>
                      <Text style={[styles.changeBadgeText, { color: meta.color }]}>
                        {meta.label}
                      </Text>
                    </View>
                  </View>
                );
              })
            ) : (
              <Text style={styles.emptyText}>
                再记一次日常数据，这里就会对比出和上次相比的变化。
              </Text>
            )}

            <View style={styles.rule} />
            <Text style={styles.blockHeading}>和病友群体相比</Text>
            {muscleInsights.length > 0 ? (
              muscleInsights.map(({ label, insight }) => (
                // The patient's own score is the value being compared,
                // so it gets the metric treatment and a right edge to
                // align on; the cohort context drops to a caption.
                <View key={insight.muscleGroup} style={styles.cohortRow}>
                  <View style={styles.cohortCopy}>
                    <Text style={styles.cohortLabel}>{label}</Text>
                    {/* The API withholds `distribution` until enough
                        distinct patients have contributed (see
                        COHORT_MIN_PATIENTS). Rendering the null case as
                        「群体中位 — 分 · 0 人」 still asserts a cohort,
                        and for a while it asserted a false one: the
                        query compared the patient against their own
                        rows and counted measurements as people, so the
                        first person to test both sides five times was
                        told 「10 人」. Say what is true instead. */}
                    <Text style={styles.cohortCaption}>
                      {insight.distribution
                        ? `群体中位 ${insight.distribution.medianScore} 分 · ${insight.distribution.sampleCount} 人`
                        : '病友数据还不够，暂不做对比'}
                    </Text>
                  </View>
                  {/* 「你」has to stay. Dropping it left the cohort
                      median as the only labelled number in the row,
                      so the patient's own score — the whole point of
                      the comparison — read as an unattributed figure,
                      and a screen reader announced 「群体中位 4 分 ·
                      120 人，5，分」with no way to tell them apart. */}
                  <View style={styles.cohortValueWrap}>
                    <Text style={styles.cohortOwner}>你</Text>
                    <Text style={styles.cohortValue}>{insight.userLatestScore}</Text>
                    <Text style={styles.cohortUnit}>分</Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyBlock}>
                <Text style={styles.emptyText}>
                  完成一次肌力自测后，这里会显示你和病友群体的对比。
                </Text>
                <Button
                  label="去做一次自测"
                  variant="tinted"
                  compact
                  onPress={() => router.push('/p-data_entry')}
                />
              </View>
            )}
          </>
        );

      case 'trends':
        return (
          <View style={styles.visualizationChartStack}>
            <View>
              <View style={styles.visualizationSectionHeader}>
                <Text style={styles.blockHeading}>受累可视化</Text>
                <SegmentedControl
                  segments={[
                    { key: 'front', label: '正面' },
                    { key: 'back', label: '背面' },
                  ]}
                  value={bodyView}
                  onChange={(key) => setBodyView(key as 'front' | 'back')}
                  accessibilityLabel="受累分布视角"
                />
              </View>

              <HumanBodyFigure
                view={bodyView}
                regions={latestMriVisualization.regions}
                mode="mri"
                title="MRI 受累分布"
                subtitle={latestMriVisualization.summary}
              />
            </View>

            {patientVisualizationCards.length ? (
              patientVisualizationCards.map((item) => {
                const meta = trendMeta[item.trend];
                const chartData = renderChartPoints(item.points);
                return (
                  <View key={item.key} style={styles.visualizationChartBlock}>
                    {/* Label first and small, value second and large:
                        the reading is what the patient is here for,
                        the metric name is just how to find it. */}
                    <View style={styles.visualizationChartHeader}>
                      <View style={styles.visualizationChartHeaderMain}>
                        <Text style={styles.visualizationChartTitle}>{item.label}</Text>
                        <Text style={styles.visualizationChartValue}>{item.latestDisplay}</Text>
                      </View>
                      <View style={[styles.changeBadge, { borderColor: meta.color }]}>
                        <Text style={[styles.changeBadgeText, { color: meta.color }]}>
                          {meta.label}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.visualizationChartSummary}>{item.summary}</Text>
                    <Text style={styles.visualizationChartHint}>{item.helperText}</Text>
                    {chartData ? (
                      <View style={styles.chartWrap}>
                        <LineChart
                          data={chartData}
                          width={chartWidth}
                          height={164}
                          chartConfig={createChartConfig(item.chartColor)}
                          withInnerLines={false}
                          withOuterLines={false}
                          withVerticalLines={false}
                          fromZero
                          yAxisInterval={2}
                          style={styles.chart}
                          bezier
                        />
                      </View>
                    ) : (
                      <View style={styles.chartEmpty}>
                        <Text style={styles.emptyText}>
                          完成 2 次以上日常记录后，这里会自动绘制趋势。
                        </Text>
                      </View>
                    )}

                    {/* 就地追问 — the curve is right there, so the
                        question doesn't need to describe it.

                        Tinted, not prominent: this renders once per
                        trend chart and the chart list is never empty,
                        so `prominent` here put three, four, five filled
                        accent buttons on the screen alongside the
                        header's 记一笔 — and a screen with five primary
                        actions has none. 记一笔 is what 病程 exists to
                        do; these are per-card affordances. */}
                    <Button
                      label="这什么意思"
                      icon="comment-dots"
                      variant="tinted"
                      compact
                      accessibilityLabel={`问 AI：${item.label}`}
                      onPress={() =>
                        setAsk({
                          context: { type: 'metric', key: asMetricKey(item.key) },
                          label: `${item.label} · ${item.latestDisplay}`,
                        })
                      }
                    />
                  </View>
                );
              })
            ) : (
              <View style={styles.emptyBlock}>
                <Text style={styles.emptyText}>还没有可画成曲线的日常记录。</Text>
                <Button
                  label="去记一笔"
                  icon="plus"
                  variant="tinted"
                  compact
                  onPress={() => router.push('/p-data_entry')}
                />
              </View>
            )}
          </View>
        );

      case 'meds':
        return (
          <>
            <View style={styles.medHeaderRow}>
              <Text style={styles.blockHeading}>药物和辅具</Text>
              <Button
                label={medFormVisible ? '收起' : '添加用药'}
                icon={medFormVisible ? 'minus' : 'plus'}
                variant="tinted"
                compact
                onPress={() => {
                  setMedError(null);
                  setMedFormVisible((prev) => !prev);
                }}
              />
            </View>
            {medFormVisible ? (
              <View style={styles.medForm}>
                <TextInput
                  style={styles.medInput}
                  placeholder="药物名称（必填）"
                  placeholderTextColor={COLOR.inkMuted}
                  value={medDraft.name}
                  onChangeText={(value) => setMedDraft((prev) => ({ ...prev, name: value }))}
                />
                <TextInput
                  style={styles.medInput}
                  placeholder="剂量，例如 5mg（可选）"
                  placeholderTextColor={COLOR.inkMuted}
                  value={medDraft.dosage}
                  onChangeText={(value) => setMedDraft((prev) => ({ ...prev, dosage: value }))}
                />
                <TextInput
                  style={styles.medInput}
                  placeholder="频次，例如 每日一次（可选）"
                  placeholderTextColor={COLOR.inkMuted}
                  value={medDraft.frequency}
                  onChangeText={(value) => setMedDraft((prev) => ({ ...prev, frequency: value }))}
                />
                {medError ? <Text style={styles.medErrorText}>{medError}</Text> : null}
                <TouchableOpacity
                  style={[styles.medSubmit, medBusy && styles.blockedOpacity]}
                  activeOpacity={INTERACTION.pressOpacity}
                  accessibilityRole="button"
                  disabled={medBusy}
                  onPress={() => void submitMedication()}
                >
                  <Text style={styles.medSubmitText}>{medBusy ? '保存中…' : '保存用药'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <View style={styles.pillWrap}>
              {medicationHighlights.length ? (
                medicationHighlights.map((item) => (
                  <View key={item.id} style={styles.pill}>
                    <Text style={styles.pillText}>{item.title}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText}>
                  暂无用药记录。可用上方「添加用药」补充，或在「记录数据 → 事件」里记录用药变化。
                </Text>
              )}
              {assistiveDevices.map((item) => (
                <View key={item} style={styles.pill}>
                  <Text style={styles.pillText}>{item}</Text>
                </View>
              ))}
            </View>
          </>
        );

      case 'exams':
        return (
          <>
            <Text style={styles.blockHeading}>FSHD 关键证据</Text>
            <View style={styles.insightGrid}>
              {evidencePanels.map((panel) => (
                <View key={panel.key} style={styles.insightBlock}>
                  <View style={styles.insightTopRow}>
                    <Text style={styles.insightTitle}>{panel.title}</Text>
                    <Text style={styles.insightDate}>{panel.latestDate}</Text>
                  </View>
                  <Text style={styles.insightSummary}>{panel.summary}</Text>
                  <View style={styles.metricWrap}>
                    {panel.metrics.length > 0 ? (
                      // Label above value, two to a row, so readings from
                      // the same report line up in a column instead of
                      // scattering as differently-sized capsules.
                      panel.metrics.map((metric) => (
                        <View key={`${panel.key}-${metric.label}`} style={styles.metricItem}>
                          <Text style={styles.metricItemLabel}>{metric.label}</Text>
                          <Text style={styles.metricItemValue}>{metric.value}</Text>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.emptyText}>报告识别出关键指标后，会在这里直接展示。</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.rule} />
            <Text style={styles.blockHeading}>实验室 / 呼吸 / 心脏</Text>
            <SystemMonitoringPanels
              panels={systemPanels}
              emptyText="检查报告识别出关键指标后，会自动归入这里。"
            />
          </>
        );

      case 'timeline':
      default:
        return (
          <TimelineSectionCard
            items={timelineItems}
            subtitle="点击卡片可进入详情；报告类记录可继续跳转到报告详情页。"
            emptyText="记录数据或上传报告后，时间轴会自动汇总到这里。"
          />
        );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Plain paper. The page gradient cost every value and hairline
          above it contrast, and bought nothing. */}
      <View style={styles.backgroundGradient}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[2]}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadData(true).catch(() => undefined)}
              tintColor={COLOR.accent}
            />
          }
        >
          {/* No back button: 病程 is a tab now, not a page you drilled
              into from 首页. The `PROGRESSION` eyebrow is gone too —
              it said nothing 病程 doesn't. */}
          <View style={styles.header}>
            <Text style={styles.pageTitle}>病程</Text>
            <Button
              label="记一笔"
              icon="plus"
              variant="prominent"
              compact
              accessibilityLabel="记一笔"
              onPress={() => router.push('/p-data_entry')}
            />
          </View>

          {/* The single filled block on this screen: current status.
              Everything below is set on the page. */}
          <View style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <View style={[styles.riskChip, { borderColor: riskMeta.color }]}>
                <View style={[styles.riskDot, { backgroundColor: riskMeta.color }]} />
                <Text style={[styles.riskText, { color: riskMeta.color }]}>{riskMeta.label}</Text>
              </View>
              {/* The two things a patient leaves this page *for*:
                  the doctor-facing summary, and the report archive.
                  Both keep their own screens — this is the entry
                  point they lost when 首页's directory went away. */}
              <View style={styles.heroActions}>
                <Button
                  label="临床护照"
                  variant="tinted"
                  compact
                  onPress={() => router.push('/p-clinical_passport')}
                />
                <Button
                  label="报告"
                  variant="tinted"
                  compact
                  onPress={() => router.push('/p-report_management')}
                />
              </View>
            </View>
            <Text style={styles.heroTitle}>
              {summary?.currentStatus.headline ?? '从一次日常记录开始管理病程'}
            </Text>
            <Text style={styles.heroText}>
              {riskSummary?.notes?.join('； ') ||
                summary?.currentStatus.detail ||
                '这里不展示原始数据堆叠，只告诉你接下来更该补什么、看什么。'}
            </Text>
            {/* Two columns, not three: the third used to repeat the
                risk level already shown as the chip above. */}
            <View style={styles.heroMetrics}>
              <View style={styles.metricCell}>
                <Text style={styles.metricValue}>
                  {summary?.currentStatus.lastFollowupAt
                    ? formatDateLabel(summary.currentStatus.lastFollowupAt)
                    : '—'}
                </Text>
                <Text style={styles.metricLabel}>最近记录</Text>
              </View>
              <View style={[styles.metricCell, styles.metricCellDivided]}>
                <Text style={styles.metricValue}>{summary?.changeCards?.length ?? 0}</Text>
                <Text style={styles.metricLabel}>变化摘要</Text>
              </View>
            </View>
            {/* Contextual AI entry: the trend question is what this
                page exists to answer, so it opens here instead of
                handing the patient off to 问答 with a prefilled
                sentence they then have to read and send. */}
            <Button
              label="问 AI 我的趋势"
              icon="comment-dots"
              variant="tinted"
              onPress={() => setAsk({})}
            />
          </View>

          {/* The tab strip. Horizontally scrollable because these are
              words rather than icons and five of them don't fit a
              narrow phone — the alternative, shrinking the targets to
              fit one row, is the exact thing lib/a11y.ts forbids.

              Sticky: index 2 of this ScrollView's four children
              (header, hero, strip, panel). No child here is ever
              conditionally null, which matters — RN counts sticky
              indices with React.Children.toArray (nulls dropped) and
              react-native-web with React.Children.map (nulls kept),
              so a conditional sibling above the strip would stick the
              wrong element on web. The page-level error therefore
              lives inside the panel, where it also reads better: it
              explains why the panel is empty. */}
          <View style={styles.tabStrip}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabStripContent}
              accessibilityRole="tablist"
            >
              {TABS.map((tab) => {
                const selected = tab.key === activeTab;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    style={[styles.tabItem, selected && styles.tabItemActive]}
                    activeOpacity={INTERACTION.pressOpacity}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    aria-selected={selected}
                    onPress={() => setActiveTab(tab.key)}
                  >
                    {/* Selection is carried three ways — underline,
                        weight and ink — because colour alone fails for
                        the colour-blind and washes out in sunlight. */}
                    <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.panel}>
            {errorMessage ? (
              <View style={styles.panelError}>
                <View style={styles.stateWrap}>
                  <Text style={styles.stateText}>{errorMessage}</Text>
                  <Button
                    label="重新加载"
                    icon="rotate-right"
                    variant="tinted"
                    onPress={() => loadData().catch(() => undefined)}
                  />
                </View>
              </View>
            ) : (
              <>
                {/* One line saying what this tab answers. The old
                    per-section titles are gone: the strip already names
                    the block, and repeating it as an 18pt heading
                    pushed the content the patient tapped for below the
                    fold. */}
                <Text style={styles.panelCaption}>{activeTabMeta.caption}</Text>
                {/* Rendered only when the load succeeded. The catch
                    nulls `profile`, so every panel's empty state fires
                    — and「加载失败」was stacked on top of「暂无用药记录」
                    and「还没有可画成曲线的日常记录」, which is the app
                    reporting the patient's records as absent rather
                    than as unread. */}
                {/* Keyed on the tab, so switching tabs re-mounts the
                    panel and the fade runs. Without the key React
                    reconciles the two panels into one tree and the
                    content swaps with no transition at all — the thing
                    that made tab switching feel like a page reload. */}
                <Animated.View key={activeTab} entering={FadeIn.duration(MOTION.enter)}>
                  {renderPanel()}
                </Animated.View>
              </>
            )}
          </View>
        </ScrollView>

        {isLoading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={COLOR.accent} />
            <Text style={styles.loadingText}>正在整理病程管理重点...</Text>
          </View>
        ) : null}

        <AskAboutDrawer
          visible={ask !== null}
          onClose={() => setAsk(null)}
          context={ask?.context}
          contextLabel={ask?.label}
          suggestions={
            ask?.context
              ? ['这什么意思', '这个变化要紧吗', '我该记录点什么']
              : ['我最近的趋势怎么样', '有什么需要注意的', '下次门诊我该问什么']
          }
        />
      </View>
    </SafeAreaView>
  );
}
