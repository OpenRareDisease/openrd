import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
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
  type PatientProfile,
  type ProgressionSummary,
} from '../../lib/api';
import {
  buildBodyMapFromMeasurements,
  CLINICAL_COLORS,
  CLINICAL_GRADIENTS,
  CLINICAL_TINTS,
  formatDateLabel,
  summarizeBodyRegions,
  type BodyView,
} from '../../lib/clinical-visuals';
import {
  buildDiseaseBackgroundFacts,
  buildDomainTrendCards,
  buildProgressionTimeline,
} from '../../lib/followup-analytics';
import { buildReportInsights } from '../../lib/report-insights';
import HumanBodyFigure from '../common/HumanBodyFigure';
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

const chartConfig = {
  backgroundColor: CLINICAL_COLORS.panel,
  backgroundGradientFrom: CLINICAL_COLORS.panel,
  backgroundGradientTo: CLINICAL_COLORS.panel,
  decimalPlaces: 1,
  color: (opacity = 1) => `rgba(63, 122, 112, ${opacity})`,
  labelColor: () => CLINICAL_COLORS.textMuted,
  propsForDots: {
    r: '3',
    strokeWidth: '2',
    stroke: CLINICAL_COLORS.accentStrong,
  },
};

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

export default function ArchiveScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [summary, setSummary] = useState<ProgressionSummary | null>(null);
  const [bodyView, setBodyView] = useState<BodyView>('front');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const chartWidth = Math.max(260, Dimensions.get('window').width - 112);

  const loadData = async (refresh = false) => {
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      setErrorMessage(null);
      const [profileData, summaryData] = await Promise.all([
        getMyPatientProfile(),
        getProgressionSummary(),
      ]);
      setProfile(profileData);
      setSummary(summaryData);
    } catch (error) {
      setProfile(null);
      setSummary(null);
      setErrorMessage(error instanceof ApiError ? error.message : '暂时无法加载完整病程档案。');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData().catch(() => undefined);
  }, []);

  const reportInsights = useMemo(
    () => buildReportInsights(profile?.documents ?? [], profile),
    [profile],
  );
  const backgroundFacts = useMemo(() => buildDiseaseBackgroundFacts(profile), [profile]);
  const bodyRegions = useMemo(
    () => buildBodyMapFromMeasurements(profile?.measurements ?? []),
    [profile],
  );
  const focusAreas = useMemo(() => summarizeBodyRegions(bodyRegions, 6), [bodyRegions]);
  const domainTrendCards = useMemo(() => buildDomainTrendCards(profile), [profile]);
  const timelineItems = useMemo(
    () => buildProgressionTimeline(profile, summary, 16),
    [profile, summary],
  );

  const lateralityOverview = [
    ...(summary?.lateralOverview.leftDominant ?? []).map((item) => `左侧更重 · ${item}`),
    ...(summary?.lateralOverview.rightDominant ?? []).map((item) => `右侧更重 · ${item}`),
    ...(summary?.lateralOverview.bilateral ?? []).map((item) => `双侧受累 · ${item}`),
  ];

  const displayName =
    profile?.preferredName?.trim() || profile?.fullName?.trim() || 'FSHD 病程档案';
  const passportId = profile?.id
    ? `FSHD-${profile.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`
    : 'FSHD-UNASSIGNED';

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
              <View>
                <Text style={styles.eyebrow}>FULL CASEBOOK</Text>
                <Text style={styles.pageTitle}>完整病程总册</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.outlineButton}
                activeOpacity={0.88}
                onPress={() => router.push('/p-manage')}
              >
                <FontAwesome6 name="wave-square" size={13} color={CLINICAL_COLORS.accentStrong} />
                <Text style={styles.outlineButtonText}>病程管理</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryButton}
                activeOpacity={0.88}
                onPress={() => router.push('/p-data_entry')}
              >
                <FontAwesome6 name="plus" size={12} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>新增记录</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.section}>
            <LinearGradient colors={CLINICAL_GRADIENTS.surface} style={styles.heroCard}>
              <Text style={styles.heroEyebrow}>病例身份与长期随访</Text>
              <Text style={styles.heroTitle}>{displayName}</Text>
              <Text style={styles.heroMeta}>
                {passportId}
                {summary?.currentStatus.lastFollowupAt
                  ? ` · 最近随访 ${formatDateLabel(summary.currentStatus.lastFollowupAt)}`
                  : ' · 还没有完成随访'}
              </Text>
              <Text style={styles.heroSummary}>
                {summary?.currentStatus.detail ??
                  '这里会把疾病背景、左右差异、趋势和病程事件整合成一份患者自己也能读懂的总册。'}
              </Text>
            </LinearGradient>
          </View>

          {errorMessage ? (
            <View style={styles.section}>
              <View style={styles.stateWrap}>
                <Text style={styles.stateText}>{errorMessage}</Text>
                <TouchableOpacity
                  style={styles.primaryButton}
                  activeOpacity={0.88}
                  onPress={() => loadData().catch(() => undefined)}
                >
                  <Text style={styles.primaryButtonText}>重新加载</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>疾病背景</Text>
            <View style={styles.backgroundGrid}>
              {backgroundFacts.map((item) => (
                <View key={item.label} style={styles.backgroundCard}>
                  <Text style={styles.backgroundLabel}>{item.label}</Text>
                  <Text style={styles.backgroundValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>长期变化摘要</Text>
            {summary?.changeCards?.length ? (
              <View style={styles.summaryGrid}>
                {summary.changeCards.map((item) => {
                  const meta = trendMeta[item.trend];
                  return (
                    <View key={item.id} style={styles.summaryCard}>
                      <View style={styles.summaryTopRow}>
                        <Text style={styles.summaryTitle}>{item.title}</Text>
                        <View
                          style={[styles.summaryBadge, { backgroundColor: meta.backgroundColor }]}
                        >
                          <Text style={[styles.summaryBadgeText, { color: meta.color }]}>
                            {meta.label}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.summaryDate}>
                        {item.evidenceAt
                          ? `记录于 ${formatDateLabel(item.evidenceAt)}`
                          : '等待更多记录'}
                      </Text>
                      <Text style={styles.summaryText}>{item.detail}</Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.stateWrap}>
                <Text style={styles.stateText}>
                  还没有足够的随访记录，先补一次快速随访后这里会自动总结变化。
                </Text>
              </View>
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>左右体图</Text>
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

            <View style={styles.card}>
              <HumanBodyFigure
                view={bodyView}
                regions={bodyRegions}
                title="根据左右分开的功能/肌力记录生成"
                subtitle="没有数据的区域不会自动填色。后续可继续补录左右侧差异。"
              />
              <View style={styles.focusWrap}>
                {lateralityOverview.length ? (
                  lateralityOverview.map((item) => (
                    <View key={item} style={styles.focusTag}>
                      <Text style={styles.focusTagText}>{item}</Text>
                    </View>
                  ))
                ) : focusAreas.length ? (
                  focusAreas.map((item) => (
                    <View key={item} style={styles.focusTag}>
                      <Text style={styles.focusTagText}>{item}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyText}>暂无体图数据，补录后自动生成。</Text>
                )}
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>多域趋势</Text>
            <View style={styles.trendGrid}>
              {domainTrendCards.map((item) => {
                const chartData = renderChartPoints(item.points);
                const meta = trendMeta[item.trend];
                return (
                  <View key={item.key} style={styles.trendCard}>
                    <View style={styles.summaryTopRow}>
                      <Text style={styles.trendCardTitle}>{item.label}</Text>
                      <View
                        style={[styles.summaryBadge, { backgroundColor: meta.backgroundColor }]}
                      >
                        <Text style={[styles.summaryBadgeText, { color: meta.color }]}>
                          {meta.label}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.trendValue}>
                      {item.currentValue === null ? '未记录' : `${item.currentValue.toFixed(1)}/10`}
                    </Text>
                    <Text style={styles.trendSummary}>{item.summary}</Text>
                    {chartData ? (
                      <LineChart
                        data={chartData}
                        width={chartWidth}
                        height={170}
                        chartConfig={chartConfig}
                        withInnerLines={false}
                        withOuterLines={false}
                        withVerticalLines={false}
                        fromZero
                        yAxisInterval={2}
                        style={styles.chart}
                        bezier
                      />
                    ) : (
                      <View style={styles.chartEmpty}>
                        <Text style={styles.emptyText}>还没有足够数据绘制趋势。</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>病程事件时间线</Text>
            {timelineItems.length ? (
              <View style={styles.timelineWrap}>
                {timelineItems.map((item, index) => (
                  <View key={`${item.id}-${item.timestamp}`} style={styles.timelineItem}>
                    <View style={styles.timelineRail}>
                      <View style={styles.timelineDot} />
                      {index !== timelineItems.length - 1 ? (
                        <View style={styles.timelineLine} />
                      ) : null}
                    </View>
                    <View style={styles.timelineContent}>
                      <View style={styles.timelineHeaderRow}>
                        <View style={styles.timelineTag}>
                          <Text style={styles.timelineTagText}>{item.tag}</Text>
                        </View>
                        <Text style={styles.timelineTime}>{formatDateLabel(item.timestamp)}</Text>
                      </View>
                      <Text style={styles.timelineTitle}>{item.title}</Text>
                      <Text style={styles.timelineText}>{item.description}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.stateWrap}>
                <Text style={styles.stateText}>还没有病程事件或报告记录。</Text>
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>历史报告与患者版摘要</Text>
            <View style={styles.reportGrid}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>基因摘要</Text>
                <Text style={styles.summaryDate}>{reportInsights.diagnosisDate}</Text>
                <Text style={styles.summaryText}>
                  {reportInsights.geneEvidence || '暂无基因摘要'}
                </Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>MRI 摘要</Text>
                <Text style={styles.summaryDate}>{reportInsights.latestMriDate}</Text>
                <Text style={styles.summaryText}>{reportInsights.mriSummary}</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>监测摘要</Text>
                <Text style={styles.summaryDate}>
                  {reportInsights.latestRespiratoryDate || reportInsights.latestBloodDate}
                </Text>
                <Text style={styles.summaryText}>
                  {reportInsights.respiratorySummary !== '暂无呼吸监测数据'
                    ? reportInsights.respiratorySummary
                    : reportInsights.bloodSummary}
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>

        {isLoading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={CLINICAL_COLORS.accentStrong} />
            <Text style={styles.loadingText}>正在生成完整病程总册...</Text>
          </View>
        ) : null}
      </LinearGradient>
    </SafeAreaView>
  );
}
