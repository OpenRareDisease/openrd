import { useEffect, useState } from 'react';
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
  type PatientProfile,
  type ProgressionSummary,
} from '../../lib/api';
import {
  buildBodyMapFromMeasurements,
  CLINICAL_COLORS,
  CLINICAL_GRADIENTS,
  CLINICAL_TINTS,
  formatDateLabel,
  type BodyView,
} from '../../lib/clinical-visuals';
import HumanBodyFigure from '../common/HumanBodyFigure';
import styles from './styles';

const trendMeta: Record<
  ProgressionSummary['changeCards'][number]['trend'],
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

const domainLabels: Record<ProgressionSummary['changeCards'][number]['domain'], string> = {
  upper_limb: '上肢',
  lower_limb: '下肢/步态',
  face: '面部',
  breathing: '呼吸',
  symptoms: '症状',
  events: '事件',
  reports: '报告',
};

const HomeScreen = () => {
  const router = useRouter();
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [summary, setSummary] = useState<ProgressionSummary | null>(null);
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
      const [profileData, summaryData] = await Promise.all([
        getMyPatientProfile(),
        getProgressionSummary(),
      ]);
      setProfile(profileData);
      setSummary(summaryData);
    } catch (error) {
      setProfile(null);
      setSummary(null);
      setErrorMessage(
        error instanceof ApiError ? error.message : '暂时无法整理你的病程摘要，请稍后重试。',
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData().catch(() => undefined);
  }, []);

  const displayName = profile?.preferredName?.trim() || profile?.fullName?.trim() || 'FSHD 患者';
  const bodyRegions = buildBodyMapFromMeasurements(profile?.measurements ?? []);
  const baselineReady = summary?.currentStatus.baselineReady ?? Boolean(profile?.baseline);
  const changeStatusText =
    summary?.currentStatus.hasNewChanges === true
      ? '有变化'
      : summary?.currentStatus.hasNewChanges === false
        ? '变化不大'
        : '待补记录';
  const lateralityGroups = [
    ...(summary?.lateralOverview.leftDominant ?? []).map((item) => `左侧更重 · ${item}`),
    ...(summary?.lateralOverview.rightDominant ?? []).map((item) => `右侧更重 · ${item}`),
    ...(summary?.lateralOverview.bilateral ?? []).map((item) => `双侧受累 · ${item}`),
  ].slice(0, 6);

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
            <View style={styles.headerLeft}>
              <View>
                <Text style={styles.eyebrow}>PROGRESSION SUMMARY</Text>
                <Text style={styles.pageTitle}>{displayName}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.settingsButton}
              activeOpacity={0.88}
              onPress={() => router.push('/p-settings')}
            >
              <FontAwesome6 name="gear" size={15} color={CLINICAL_COLORS.textSoft} />
            </TouchableOpacity>
          </View>

          <LinearGradient colors={CLINICAL_GRADIENTS.surface} style={styles.heroCard}>
            <View style={styles.heroHeader}>
              <View style={styles.heroTag}>
                <Text style={styles.heroTagText}>患者病程摘要</Text>
              </View>
              <TouchableOpacity
                style={styles.heroAction}
                activeOpacity={0.88}
                onPress={() => router.push('/p-data_entry')}
              >
                <Text style={styles.heroActionText}>去记录</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.heroTitle}>
              {summary?.currentStatus.headline ?? '先完成一次基线或随访记录'}
            </Text>
            <Text style={styles.heroDescription}>
              {summary?.currentStatus.detail ??
                '系统会把“和上次相比有没有变化”整理成患者能读懂的摘要。'}
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
                <Text style={styles.metricValue}>{changeStatusText}</Text>
                <Text style={styles.metricLabel}>和上次比</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{baselineReady ? '已完成' : '待完成'}</Text>
                <Text style={styles.metricLabel}>基线建档</Text>
              </View>
            </View>
          </LinearGradient>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>变化摘要</Text>
              <TouchableOpacity activeOpacity={0.8} onPress={() => router.push('/p-archive')}>
                <Text style={styles.sectionLink}>查看完整档案</Text>
              </TouchableOpacity>
            </View>

            {summary?.changeCards?.length ? (
              summary.changeCards.map((item) => {
                const meta = trendMeta[item.trend];
                return (
                  <View key={item.id} style={styles.changeCard}>
                    <View style={styles.changeTopRow}>
                      <View>
                        <Text style={styles.changeDomain}>{domainLabels[item.domain]}</Text>
                        <Text style={styles.changeTitle}>{item.title}</Text>
                      </View>
                      <View style={[styles.changeBadge, { backgroundColor: meta.backgroundColor }]}>
                        <Text style={[styles.changeBadgeText, { color: meta.color }]}>
                          {meta.label}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.changeDetail}>{item.detail}</Text>
                    <Text style={styles.changeMeta}>
                      {item.evidenceAt
                        ? `记录时间 ${formatDateLabel(item.evidenceAt)}`
                        : '等待更多证据'}
                    </Text>
                  </View>
                );
              })
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>还没有可比较的变化</Text>
                <Text style={styles.emptyText}>
                  先完成一次快速随访，系统会从这里开始总结上肢、下肢、面部和呼吸的变化。
                </Text>
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>快捷入口</Text>
            <View style={styles.quickActionGrid}>
              <TouchableOpacity
                style={styles.quickActionCard}
                activeOpacity={0.88}
                onPress={() => router.push('/p-data_entry')}
              >
                <FontAwesome6 name="bolt" size={16} color={CLINICAL_COLORS.accentStrong} />
                <Text style={styles.quickActionTitle}>快速随访</Text>
                <Text style={styles.quickActionText}>2 到 5 分钟记录最近变化</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickActionCard}
                activeOpacity={0.88}
                onPress={() => router.push('/p-data_entry')}
              >
                <FontAwesome6 name="flag" size={16} color={CLINICAL_COLORS.warning} />
                <Text style={styles.quickActionTitle}>事件记录</Text>
                <Text style={styles.quickActionText}>跌倒、足下垂、辅具变化单独登记</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickActionCard}
                activeOpacity={0.88}
                onPress={() => router.push('/p-data_entry')}
              >
                <FontAwesome6 name="file-arrow-up" size={16} color={CLINICAL_COLORS.success} />
                <Text style={styles.quickActionTitle}>上传报告</Text>
                <Text style={styles.quickActionText}>先给一句患者版摘要，再看专业细节</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickActionCard}
                activeOpacity={0.88}
                onPress={() => router.push('/p-clinical_passport')}
              >
                <FontAwesome6 name="id-card" size={16} color={CLINICAL_COLORS.accent} />
                <Text style={styles.quickActionTitle}>临床护照</Text>
                <Text style={styles.quickActionText}>查看结构化病程摘要和报告时间轴</Text>
              </TouchableOpacity>
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

            <View style={styles.bodyCard}>
              <HumanBodyFigure
                view={bodyView}
                regions={bodyRegions}
                title="当前录入生成的左右体图"
                subtitle="颜色表示目前记录到的受累程度；如果某侧没有数据，就不会自动填色。"
              />

              <View style={styles.lateralityWrap}>
                {lateralityGroups.length ? (
                  lateralityGroups.map((item) => (
                    <View key={item} style={styles.lateralityTag}>
                      <Text style={styles.lateralityTagText}>{item}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyText}>
                    还没有足够的左右侧记录，补录左右分开的功能或肌力后会更清楚。
                  </Text>
                )}
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>最近事件</Text>
            {summary?.recentEvents?.length ? (
              summary.recentEvents.map((item) => (
                <View key={item.id} style={styles.timelineCard}>
                  <View style={styles.timelineHeader}>
                    <View style={styles.timelineTag}>
                      <Text style={styles.timelineTagText}>{item.tag}</Text>
                    </View>
                    <Text style={styles.timelineTime}>{formatDateLabel(item.timestamp)}</Text>
                  </View>
                  <Text style={styles.timelineTitle}>{item.title}</Text>
                  <Text style={styles.timelineText}>{item.description}</Text>
                </View>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>还没有病程事件</Text>
                <Text style={styles.emptyText}>
                  如果最近出现跌倒、抬手更困难、呼吸不适或开始用辅具，可以随时补一条事件记录。
                </Text>
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>最近报告摘要</Text>
            {summary?.recentReports?.length ? (
              summary.recentReports.map((item) => (
                <View key={item.id} style={styles.reportCard}>
                  <View style={styles.reportHeader}>
                    <Text style={styles.reportTitle}>{item.title}</Text>
                    <Text style={styles.reportTime}>{formatDateLabel(item.uploadedAt)}</Text>
                  </View>
                  <Text style={styles.reportText}>{item.summary}</Text>
                </View>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>还没有上传报告</Text>
                <Text style={styles.emptyText}>
                  报告不是主录入方式，但上传后能帮助系统生成更完整的病程解释。
                </Text>
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>建议回顾项</Text>
            {(summary?.recommendedReviewItems?.length ?? 0) > 0 ? (
              summary?.recommendedReviewItems.map((item) => (
                <View key={item} style={styles.reviewItem}>
                  <FontAwesome6
                    name="circle-check"
                    size={12}
                    color={CLINICAL_COLORS.accentStrong}
                  />
                  <Text style={styles.reviewItemText}>{item}</Text>
                </View>
              ))
            ) : (
              <View style={styles.reviewItem}>
                <FontAwesome6 name="circle-check" size={12} color={CLINICAL_COLORS.accentStrong} />
                <Text style={styles.reviewItemText}>当前记录已经覆盖主要随访信息。</Text>
              </View>
            )}
          </View>

          {errorMessage ? (
            <View style={styles.section}>
              <View style={styles.errorCard}>
                <Text style={styles.errorTitle}>加载失败</Text>
                <Text style={styles.errorText}>{errorMessage}</Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  activeOpacity={0.88}
                  onPress={() => loadData().catch(() => undefined)}
                >
                  <Text style={styles.retryButtonText}>重新加载</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </ScrollView>

        {isLoading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={CLINICAL_COLORS.accentStrong} />
            <Text style={styles.loadingText}>正在整理病程摘要...</Text>
          </View>
        ) : null}
      </LinearGradient>
    </SafeAreaView>
  );
};

export default HomeScreen;
