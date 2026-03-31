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
  type PatientProfile,
  type ProgressionSummary,
} from '../../lib/api';
import { CLINICAL_COLORS, CLINICAL_GRADIENTS, formatDateLabel } from '../../lib/clinical-visuals';
import styles from './styles';

const quickActions: Array<{
  title: string;
  description: string;
  order: string;
  icon: keyof typeof FontAwesome6.glyphMap;
  color: string;
  route:
    | '/p-archive'
    | '/p-data_entry'
    | '/p-clinical_passport'
    | '/p-manage'
    | '/p-report_management'
    | '/p-qna'
    | '/p-community';
  badge?: string;
}> = [
  {
    order: '01',
    title: '我的档案',
    description: '查看基本信息、FSHD 背景、受累可视化和患者端数据可视化。',
    icon: 'address-card',
    color: CLINICAL_COLORS.accentStrong,
    route: '/p-archive',
    badge: '主入口',
  },
  {
    order: '02',
    title: '患者自录与上传',
    description: '进入统一录入页，完成量化随访、事件记录或上传一份报告。',
    icon: 'file-circle-plus',
    color: CLINICAL_COLORS.warning,
    route: '/p-data_entry',
    badge: '录入',
  },
  {
    order: '03',
    title: '问答',
    description: '进入连续对话，围绕 FSHD 和当前资料继续追问。',
    icon: 'comments',
    color: '#2563EB',
    route: '/p-qna',
  },
  {
    order: '04',
    title: '临床护照',
    description: '查看门诊和住院可直接出示的结构化摘要。',
    icon: 'id-card',
    color: CLINICAL_COLORS.accent,
    route: '/p-clinical_passport',
  },
  {
    order: '05',
    title: '报告管理',
    description: '按分类和日期整理全部系统检测报告。',
    icon: 'folder-open',
    color: CLINICAL_COLORS.success,
    route: '/p-report_management',
  },
  {
    order: '06',
    title: '病程管理',
    description: '集中查看时间轴、患者端趋势和检查结果。',
    icon: 'wave-square',
    color: '#C98A33',
    route: '/p-manage',
  },
  {
    order: '07',
    title: '社区',
    description: '社区功能暂未开放，先保留入口。',
    icon: 'users',
    color: CLINICAL_COLORS.textMuted,
    route: '/p-community',
    badge: '未开放',
  },
];

const buildPassportId = (profile: PatientProfile | null) =>
  profile?.id
    ? `FSHD-${profile.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`
    : 'FSHD-UNASSIGNED';

const HomeScreen = () => {
  const router = useRouter();
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [summary, setSummary] = useState<ProgressionSummary | null>(null);
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
        error instanceof ApiError ? error.message : '暂时无法整理首页总览，请稍后重试。',
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
  const passportId = buildPassportId(profile);
  const reportCount = profile?.documents.length ?? 0;
  const latestReportDate = useMemo(() => {
    const latest = [...(profile?.documents ?? [])]
      .map(
        (item) =>
          item.ocrPayload?.fields?.reportTime ??
          item.ocrPayload?.fields?.report_time ??
          item.uploadedAt,
      )
      .filter(Boolean)
      .sort((a, b) => new Date(String(b)).getTime() - new Date(String(a)).getTime())[0];
    return latest ? formatDateLabel(String(latest)) : '—';
  }, [profile?.documents]);
  const reviewItems = summary?.recommendedReviewItems?.slice(0, 3) ?? [];

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
                <Text style={styles.eyebrow}>PATIENT HUB</Text>
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
                <Text style={styles.heroTagText}>病程总览</Text>
              </View>
            </View>

            <Text style={styles.heroTitle}>{passportId}</Text>
            <Text style={styles.heroDescription}>
              已建立患者档案、临床护照和系统检查入口。最近记录{' '}
              {summary?.currentStatus.lastFollowupAt
                ? formatDateLabel(summary.currentStatus.lastFollowupAt)
                : formatDateLabel(profile?.updatedAt)}
              ， 最近一份报告 {latestReportDate}。
            </Text>

            <View style={styles.heroMetrics}>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>
                  {summary?.currentStatus.lastFollowupAt
                    ? formatDateLabel(summary.currentStatus.lastFollowupAt)
                    : '—'}
                </Text>
                <Text style={styles.metricLabel}>最近记录</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{reportCount}</Text>
                <Text style={styles.metricLabel}>报告总数</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{profile?.baseline ? '已完成' : '待补充'}</Text>
                <Text style={styles.metricLabel}>基础档案</Text>
              </View>
            </View>
          </LinearGradient>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>快捷入口</Text>

            <View style={styles.quickActionMiniGrid}>
              {quickActions.map((item) => (
                <TouchableOpacity
                  key={item.title}
                  style={[
                    styles.quickActionMiniCard,
                    item.badge === '未开放' && styles.quickActionMiniCardMuted,
                  ]}
                  activeOpacity={0.88}
                  onPress={() => router.push(item.route)}
                >
                  <View style={styles.quickActionMiniTopRow}>
                    <View style={styles.quickActionOrderBadge}>
                      <Text style={styles.quickActionOrderText}>{item.order}</Text>
                    </View>
                    {item.badge ? (
                      <View style={styles.quickActionMiniBadge}>
                        <Text style={styles.quickActionMiniBadgeText}>{item.badge}</Text>
                      </View>
                    ) : null}
                  </View>
                  <View
                    style={[styles.quickActionMiniIconWrap, { backgroundColor: `${item.color}20` }]}
                  >
                    <FontAwesome6 name={item.icon} size={15} color={item.color} />
                  </View>
                  <Text style={styles.quickActionMiniTitle}>{item.title}</Text>
                  <Text style={styles.quickActionMiniText}>{item.description}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>下一步建议</Text>
            {reviewItems.length ? (
              reviewItems.map((item) => (
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
                <Text style={styles.reviewItemText}>
                  当前已建立基础档案与系统检查入口，可继续补充量化随访、事件记录或新报告。
                </Text>
              </View>
            )}
          </View>

          {errorMessage ? (
            <View style={styles.section}>
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>加载失败</Text>
                <Text style={styles.emptyText}>{errorMessage}</Text>
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
            <Text style={styles.loadingText}>正在整理首页总览...</Text>
          </View>
        ) : null}
      </LinearGradient>
    </SafeAreaView>
  );
};

export default HomeScreen;
