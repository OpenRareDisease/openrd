import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { LineChart } from 'react-native-chart-kit';
import {
  ApiError,
  getMyPatientProfile,
  getProgressionSummary,
  getRiskSummary,
  type PatientProfile,
  type ProgressionSummary,
} from '../../lib/api';
import {
  CLINICAL_COLORS,
  CLINICAL_GRADIENTS,
  CLINICAL_TINTS,
  formatDateLabel,
  getRiskMeta,
} from '../../lib/clinical-visuals';
import {
  buildMedicationHighlights,
  buildPatientVisualizationCards,
  buildProgressionTimeline,
} from '../../lib/followup-analytics';
import { buildLatestMriVisualization, buildReportInsights } from '../../lib/report-insights';
import HumanBodyFigure from '../common/HumanBodyFigure';
import ScreenBackButton from '../common/ScreenBackButton';
import SystemMonitoringPanels from '../common/SystemMonitoringPanels';
import TimelineSectionCard from '../common/TimelineSectionCard';
import styles from './styles';

const trendMeta: Record<
  NonNullable<ProgressionSummary['changeCards']>[number]['trend'],
  { label: string; color: string; backgroundColor: string }
> = {
  better: {
    label: '改善',
    color: CLINICAL_COLORS.success,
    backgroundColor: CLINICAL_TINTS.successSoft,
  },
  stable: {
    label: '平稳',
    color: CLINICAL_COLORS.textSoft,
    backgroundColor: CLINICAL_TINTS.neutralSoft,
  },
  worse: {
    label: '加重',
    color: CLINICAL_COLORS.danger,
    backgroundColor: CLINICAL_TINTS.dangerSoft,
  },
  new: {
    label: '新增',
    color: CLINICAL_COLORS.warning,
    backgroundColor: CLINICAL_TINTS.warningSoft,
  },
};

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

const createChartConfig = (lineColor: string) => ({
  backgroundColor: CLINICAL_COLORS.panel,
  backgroundGradientFrom: CLINICAL_COLORS.panel,
  backgroundGradientTo: CLINICAL_COLORS.panel,
  decimalPlaces: 1,
  color: (opacity = 1) => toRgba(lineColor, opacity),
  labelColor: () => CLINICAL_COLORS.textMuted,
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
  const [visualizationExpanded, setVisualizationExpanded] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
  const chartWidth = Math.max(220, windowWidth - 92);

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={CLINICAL_GRADIENTS.page}
        style={styles.backgroundGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadData(true).catch(() => undefined)}
              tintColor={CLINICAL_COLORS.accentStrong}
            />
          }
        >
          <View style={styles.header}>
            <View style={styles.headerLead}>
              <ScreenBackButton fallbackHref="/p-home" />
              <View>
                <Text style={styles.eyebrow}>PROGRESSION MANAGEMENT</Text>
                <Text style={styles.pageTitle}>病程管理</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.addButton}
              activeOpacity={0.88}
              onPress={() => router.push('/p-data_entry')}
            >
              <FontAwesome6 name="plus" size={14} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <LinearGradient colors={CLINICAL_GRADIENTS.surface} style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <View style={styles.riskChip}>
                  <View style={[styles.riskDot, { backgroundColor: riskMeta.color }]} />
                  <Text style={[styles.riskText, { color: riskMeta.color }]}>{riskMeta.label}</Text>
                </View>
                <TouchableOpacity
                  style={styles.secondaryAction}
                  activeOpacity={0.88}
                  onPress={() => router.push('/p-report_management')}
                >
                  <Text style={styles.secondaryActionText}>报告管理</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.heroTitle}>
                {summary?.currentStatus.headline ?? '从一次快速随访开始管理病程'}
              </Text>
              <Text style={styles.heroText}>
                {riskSummary?.notes?.join('； ') ||
                  summary?.currentStatus.detail ||
                  '这里不展示原始数据堆叠，只告诉你接下来更该补什么、看什么。'}
              </Text>
              <View style={styles.heroMetrics}>
                <View style={styles.metricCard}>
                  <Text style={styles.metricValue}>
                    {summary?.currentStatus.lastFollowupAt
                      ? formatDateLabel(summary.currentStatus.lastFollowupAt)
                      : '—'}
                  </Text>
                  <Text style={styles.metricLabel}>最近随访</Text>
                </View>
                <View style={styles.metricCard}>
                  <Text style={[styles.metricValue, { color: riskMeta.color }]}>
                    {riskMeta.label}
                  </Text>
                  <Text style={styles.metricLabel}>风险提示</Text>
                </View>
                <View style={styles.metricCard}>
                  <Text style={styles.metricValue}>{summary?.changeCards?.length ?? 0}</Text>
                  <Text style={styles.metricLabel}>变化摘要</Text>
                </View>
              </View>
            </LinearGradient>
          </View>

          {errorMessage ? (
            <View style={styles.section}>
              <View style={styles.stateWrap}>
                <Text style={styles.stateText}>{errorMessage}</Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  activeOpacity={0.88}
                  onPress={() => loadData().catch(() => undefined)}
                >
                  <Text style={styles.retryText}>重新加载</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>当前干预与工具</Text>
                <Text style={styles.sectionSubtitle}>
                  集中查看当前用药、辅具和最近一次记录到的功能变化。
                </Text>
              </View>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardHeading}>药物和辅具</Text>
              <View style={styles.pillWrap}>
                {medicationHighlights.length ? (
                  medicationHighlights.map((item) => (
                    <View key={item.id} style={styles.pill}>
                      <Text style={styles.pillText}>{item.title}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyText}>暂无用药记录。</Text>
                )}
                {assistiveDevices.map((item) => (
                  <View key={item} style={styles.pill}>
                    <Text style={styles.pillText}>{item}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.monitorDivider} />
              <Text style={styles.cardHeading}>最近记录的变化</Text>
              {(summary?.changeCards?.slice(0, 3) ?? []).map((item) => {
                const meta = trendMeta[item.trend];
                return (
                  <View key={item.id} style={styles.changeRow}>
                    <View style={styles.changeCopy}>
                      <Text style={styles.changeTitle}>{item.title}</Text>
                      <Text style={styles.changeDetail}>{item.detail}</Text>
                    </View>
                    <View style={[styles.changeBadge, { backgroundColor: meta.backgroundColor }]}>
                      <Text style={[styles.changeBadgeText, { color: meta.color }]}>
                        {meta.label}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>FSHD 关键证据</Text>
                <Text style={styles.sectionSubtitle}>
                  汇总诊断分型和 MRI 相关结构化证据，方便快速回顾。
                </Text>
              </View>
            </View>
            <View style={styles.insightGrid}>
              {evidencePanels.map((panel) => (
                <View key={panel.key} style={styles.insightCard}>
                  <View style={styles.insightTopRow}>
                    <Text style={styles.insightTitle}>{panel.title}</Text>
                    <Text style={styles.insightDate}>{panel.latestDate}</Text>
                  </View>
                  <Text style={styles.insightSummary}>{panel.summary}</Text>
                  <View style={styles.metricWrap}>
                    {panel.metrics.length > 0 ? (
                      panel.metrics.map((metric) => (
                        <View key={`${panel.key}-${metric.label}`} style={styles.metricPill}>
                          <Text style={styles.metricPillLabel}>{metric.label}</Text>
                          <Text style={styles.metricPillValue}>{metric.value}</Text>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.emptyText}>当前还没有可直接展示的结构化指标。</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>患者端数据可视化</Text>
                <Text style={styles.sectionSubtitle}>
                  优先显示 MRI 受累图，并继续合并患者端随访趋势。
                </Text>
              </View>
              <TouchableOpacity
                style={styles.inlineAction}
                activeOpacity={0.88}
                onPress={() => setVisualizationExpanded((prev) => !prev)}
              >
                <FontAwesome6
                  name={visualizationExpanded ? 'chevron-up' : 'chevron-down'}
                  size={12}
                  color={CLINICAL_COLORS.accentStrong}
                />
                <Text style={styles.inlineActionText}>
                  {visualizationExpanded ? '收起' : '展开'}
                </Text>
              </TouchableOpacity>
            </View>
            {visualizationExpanded ? (
              <View style={styles.visualizationChartStack}>
                <View style={styles.card}>
                  <View style={styles.visualizationSectionHeader}>
                    <Text style={styles.cardHeading}>受累可视化</Text>
                    <View style={styles.toggleRow}>
                      <TouchableOpacity
                        style={[styles.toggleChip, bodyView === 'front' && styles.toggleChipActive]}
                        activeOpacity={0.88}
                        onPress={() => setBodyView('front')}
                      >
                        <Text
                          style={[
                            styles.toggleChipText,
                            bodyView === 'front' && styles.toggleChipTextActive,
                          ]}
                        >
                          正面
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.toggleChip, bodyView === 'back' && styles.toggleChipActive]}
                        activeOpacity={0.88}
                        onPress={() => setBodyView('back')}
                      >
                        <Text
                          style={[
                            styles.toggleChipText,
                            bodyView === 'back' && styles.toggleChipTextActive,
                          ]}
                        >
                          背面
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <HumanBodyFigure
                    view={bodyView}
                    regions={latestMriVisualization.regions}
                    mode="mri"
                    title="MRI 受累分布"
                    subtitle={latestMriVisualization.summary}
                  />
                </View>

                {patientVisualizationCards.map((item) => {
                  const meta = trendMeta[item.trend];
                  const chartData = renderChartPoints(item.points);
                  return (
                    <View key={item.key} style={styles.visualizationChartCard}>
                      <View style={styles.visualizationChartHeader}>
                        <View style={styles.visualizationChartHeaderMain}>
                          <Text style={styles.visualizationChartTitle}>{item.label}</Text>
                          <Text style={styles.visualizationChartValue}>{item.latestDisplay}</Text>
                        </View>
                        <View
                          style={[styles.changeBadge, { backgroundColor: meta.backgroundColor }]}
                        >
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
                          <Text style={styles.emptyText}>还没有足够数据绘制趋势。</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>病程时间轴</Text>
                <Text style={styles.sectionSubtitle}>病程变化、事件和报告统一整理在这里。</Text>
              </View>
            </View>
            <View style={styles.timelineSectionCard}>
              <TimelineSectionCard
                items={timelineItems}
                subtitle="点击卡片可进入详情；报告类记录可继续跳转到报告详情页。"
                emptyText="还没有病程事件或报告更新。"
              />
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>检查结果</Text>
                <Text style={styles.sectionSubtitle}>
                  按实验室、呼吸和心脏三个系统查看当前已识别的检查结果。
                </Text>
              </View>
            </View>
            <SystemMonitoringPanels
              panels={systemPanels}
              emptyText="当前还没有可归入检查结果的结构化数据。"
            />
          </View>
        </ScrollView>

        {isLoading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={CLINICAL_COLORS.accentStrong} />
            <Text style={styles.loadingText}>正在整理病程管理重点...</Text>
          </View>
        ) : null}
      </LinearGradient>
    </SafeAreaView>
  );
}
