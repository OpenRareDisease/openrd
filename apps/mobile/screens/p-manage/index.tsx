import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import {
  ApiError,
  getMyPatientProfile,
  getProgressionSummary,
  getRiskSummary,
  type PatientProfile,
  type ProgressionSummary,
} from '../../lib/api';
import {
  buildBodyMapFromMeasurements,
  CLINICAL_COLORS,
  CLINICAL_GRADIENTS,
  CLINICAL_TINTS,
  formatDateLabel,
  getRiskMeta,
  summarizeBodyRegions,
  type BodyView,
} from '../../lib/clinical-visuals';
import {
  buildDomainTrendCards,
  buildMedicationHighlights,
  buildProgressionTimeline,
} from '../../lib/followup-analytics';
import { buildReportInsights } from '../../lib/report-insights';
import HumanBodyFigure from '../common/HumanBodyFigure';
import ScreenBackButton from '../common/ScreenBackButton';
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

export default function ManageScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [summary, setSummary] = useState<ProgressionSummary | null>(null);
  const [riskSummary, setRiskSummary] = useState<{
    overallLevel?: string | null;
    notes?: string[];
  } | null>(null);
  const [bodyView, setBodyView] = useState<BodyView>('front');
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
  const trendCards = useMemo(() => buildDomainTrendCards(profile), [profile]);
  const timelineItems = useMemo(
    () => buildProgressionTimeline(profile, summary, 8),
    [profile, summary],
  );
  const bodyRegions = useMemo(
    () => buildBodyMapFromMeasurements(profile?.measurements ?? []),
    [profile],
  );
  const focusAreas = useMemo(() => summarizeBodyRegions(bodyRegions, 4), [bodyRegions]);
  const medicationHighlights = useMemo(() => buildMedicationHighlights(profile), [profile]);
  const assistiveDevices =
    profile?.baseline?.currentStatus?.assistiveDevices?.filter(Boolean) ?? [];
  const monitoringCards = [
    {
      key: 'resp',
      icon: 'lungs',
      title: '呼吸监测',
      date: reportInsights.latestRespiratoryDate,
      summary: reportInsights.respiratorySummary,
    },
    {
      key: 'cardiac',
      icon: 'heart-pulse',
      title: '心脏监测',
      date: reportInsights.latestCardiacDate,
      summary: reportInsights.cardiacSummary,
    },
    {
      key: 'lab',
      icon: 'flask',
      title: '实验室监测',
      date: reportInsights.latestBloodDate,
      summary: reportInsights.bloodSummary,
    },
  ];

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
                  onPress={() => router.push('/p-archive')}
                >
                  <Text style={styles.secondaryActionText}>完整档案</Text>
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
                  <Text style={styles.metricValue}>
                    {summary?.currentStatus.hasNewChanges === true
                      ? '有变化'
                      : summary?.currentStatus.hasNewChanges === false
                        ? '平稳'
                        : '待补'}
                  </Text>
                  <Text style={styles.metricLabel}>变化状态</Text>
                </View>
                <View style={styles.metricCard}>
                  <Text style={styles.metricValue}>
                    {summary?.recommendedReviewItems?.length ?? 0}
                  </Text>
                  <Text style={styles.metricLabel}>待回顾项</Text>
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
            <Text style={styles.sectionTitle}>这次优先回顾</Text>
            {(summary?.recommendedReviewItems?.length ?? 0) > 0 ? (
              summary?.recommendedReviewItems.map((item) => (
                <View key={item} style={styles.reviewItem}>
                  <FontAwesome6
                    name="circle-check"
                    size={12}
                    color={CLINICAL_COLORS.accentStrong}
                  />
                  <Text style={styles.reviewText}>{item}</Text>
                </View>
              ))
            ) : (
              <View style={styles.reviewItem}>
                <FontAwesome6 name="circle-check" size={12} color={CLINICAL_COLORS.accentStrong} />
                <Text style={styles.reviewText}>当前主要随访信息已经覆盖。</Text>
              </View>
            )}

            <View style={styles.quickActionRow}>
              <TouchableOpacity
                style={styles.quickActionCard}
                activeOpacity={0.88}
                onPress={() => router.push('/p-data_entry')}
              >
                <FontAwesome6 name="bolt" size={16} color={CLINICAL_COLORS.accentStrong} />
                <Text style={styles.quickActionTitle}>快速随访</Text>
                <Text style={styles.quickActionText}>补录和上次相比的变化</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickActionCard}
                activeOpacity={0.88}
                onPress={() => router.push('/p-data_entry')}
              >
                <FontAwesome6 name="flag" size={16} color={CLINICAL_COLORS.warning} />
                <Text style={styles.quickActionTitle}>事件记录</Text>
                <Text style={styles.quickActionText}>跌倒、足下垂、辅具变化</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.quickActionCard, styles.quickActionStandalone]}
              activeOpacity={0.88}
              onPress={() => router.push('/p-clinical_passport')}
            >
              <FontAwesome6 name="id-card" size={16} color={CLINICAL_COLORS.accent} />
              <Text style={styles.quickActionTitle}>临床护照</Text>
              <Text style={styles.quickActionText}>汇总查看基因、影像、监测与最近报告时间轴</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>当前干预与工具</Text>
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
              <Text style={styles.sectionTitle}>左右受累概况</Text>
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
                title="当前管理重点对应的体图"
                subtitle="优先告诉你现在哪些区域最需要继续观察。"
              />
              <View style={styles.focusWrap}>
                {focusAreas.length ? (
                  focusAreas.map((item) => (
                    <View key={item} style={styles.focusTag}>
                      <Text style={styles.focusTagText}>{item}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyText}>暂无体图重点区域。</Text>
                )}
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>多域观察</Text>
            <View style={styles.trendGrid}>
              {trendCards.map((item) => {
                const meta = trendMeta[item.trend];
                return (
                  <View key={item.key} style={styles.trendCard}>
                    <View style={styles.summaryRow}>
                      <Text style={styles.trendTitle}>{item.label}</Text>
                      <View style={[styles.changeBadge, { backgroundColor: meta.backgroundColor }]}>
                        <Text style={[styles.changeBadgeText, { color: meta.color }]}>
                          {meta.label}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.trendValue}>
                      {item.currentValue === null ? '未记录' : `${item.currentValue.toFixed(1)}/10`}
                    </Text>
                    <Text style={styles.trendText}>{item.summary}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>病程时间线</Text>
            <View style={styles.card}>
              {timelineItems.length ? (
                timelineItems.map((item, index) => (
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
                ))
              ) : (
                <Text style={styles.emptyText}>还没有病程事件或报告更新。</Text>
              )}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>监测提醒</Text>
            <View style={styles.monitorGrid}>
              {monitoringCards.map((item) => (
                <View key={item.key} style={styles.monitorCard}>
                  <View style={styles.monitorIconWrap}>
                    <FontAwesome6 name={item.icon} size={14} color={CLINICAL_COLORS.accentStrong} />
                  </View>
                  <View style={styles.monitorCopy}>
                    <Text style={styles.monitorTitle}>{item.title}</Text>
                    <Text style={styles.monitorDate}>{item.date || '暂无记录'}</Text>
                    <Text style={styles.monitorText}>{item.summary}</Text>
                  </View>
                </View>
              ))}
            </View>
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
