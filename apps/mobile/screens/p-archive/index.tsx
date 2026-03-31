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
  getClinicalPassportSummary,
  getMyPatientProfile,
  type ClinicalPassportSummary,
  type PatientProfile,
} from '../../lib/api';
import {
  CLINICAL_COLORS,
  CLINICAL_GRADIENTS,
  CLINICAL_TINTS,
  formatDateLabel,
  type BodyRegionMap,
  type BodyView,
} from '../../lib/clinical-visuals';
import { buildPatientVisualizationCards } from '../../lib/followup-analytics';
import { buildLatestMriVisualization } from '../../lib/report-insights';
import HumanBodyFigure from '../common/HumanBodyFigure';
import styles from './styles';

const trendMeta = {
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
} as const;

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

const formatGenderLabel = (value?: string | null) => {
  if (!value) return '未填写';
  if (value === 'male' || value === '男') return '男';
  if (value === 'female' || value === '女') return '女';
  return value;
};

const formatAgeLabel = (profile: PatientProfile | null) => {
  if (!profile) return '未填写';
  const birthYear = profile.baseline?.foundation?.birthYear;
  if (typeof birthYear === 'number' && birthYear > 1900) {
    return `${new Date().getFullYear() - birthYear} 岁左右`;
  }
  if (profile.dateOfBirth) {
    const birthDate = new Date(profile.dateOfBirth);
    if (!Number.isNaN(birthDate.getTime())) {
      const now = new Date();
      let age = now.getFullYear() - birthDate.getFullYear();
      const monthDiff = now.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
        age -= 1;
      }
      return `${age} 岁`;
    }
  }
  return '未填写';
};

const formatRegionLabel = (profile: PatientProfile | null) => {
  if (!profile) return '未填写';
  const regionLabel = profile.baseline?.foundation?.regionLabel;
  if (regionLabel) return regionLabel;
  return (
    [profile.regionProvince, profile.regionCity, profile.regionDistrict]
      .filter(Boolean)
      .join(' ') || '未填写'
  );
};

const formatAmbulationLabel = (profile: PatientProfile | null) => {
  const independentlyAmbulatory = profile?.baseline?.currentStatus?.independentlyAmbulatory;
  if (independentlyAmbulatory === true) return '可独立行走';
  if (independentlyAmbulatory === false) return '需要辅助';
  return '未填写';
};

const formatAssistiveDevicesLabel = (profile: PatientProfile | null) => {
  const devices = profile?.baseline?.currentStatus?.assistiveDevices?.filter(Boolean) ?? [];
  return devices.length ? devices.join('、') : '未记录';
};

const buildPassportId = (
  profile: PatientProfile | null,
  passport?: ClinicalPassportSummary | null,
) =>
  passport?.passportId ||
  (profile?.id
    ? `FSHD-${profile.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`
    : 'FSHD-UNASSIGNED');

export default function ArchiveScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [passport, setPassport] = useState<ClinicalPassportSummary | null>(null);
  const [bodyView, setBodyView] = useState<BodyView>('front');
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
      const [profileData, passportData] = await Promise.all([
        getMyPatientProfile(),
        getClinicalPassportSummary(),
      ]);
      setProfile(profileData);
      setPassport(passportData);
    } catch (error) {
      setProfile(null);
      setPassport(null);
      setErrorMessage(error instanceof ApiError ? error.message : '暂时无法加载我的档案。');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData().catch(() => undefined);
  }, []);

  const visualizationCards = useMemo(() => buildPatientVisualizationCards(profile), [profile]);
  const latestMriVisualization = useMemo(
    () => buildLatestMriVisualization(profile?.documents ?? []),
    [profile],
  );
  const displayName =
    profile?.preferredName?.trim() ||
    profile?.fullName?.trim() ||
    passport?.patientName ||
    '我的档案';
  const passportId = buildPassportId(profile, passport);
  const reportCount = profile?.documents.length ?? 0;
  const recognizedReportCount =
    profile?.documents.filter((item) => ['processed', 'completed'].includes(item.status)).length ??
    0;

  const consoleSections = useMemo(
    () => [
      {
        key: 'personal',
        title: '个人基本信息',
        items: [
          { label: '姓名', value: displayName },
          { label: '性别', value: formatGenderLabel(profile?.gender) },
          { label: '年龄', value: formatAgeLabel(profile) },
          { label: '所在地区', value: formatRegionLabel(profile) },
        ],
      },
      {
        key: 'fshd',
        title: 'FSHD 相关信息',
        items: [
          { label: '临床护照 ID', value: passportId, accent: true },
          {
            label: '确诊时间',
            value:
              profile?.baseline?.foundation?.diagnosisYear !== undefined &&
              profile?.baseline?.foundation?.diagnosisYear !== null
                ? `${profile.baseline.foundation.diagnosisYear}`
                : profile?.diagnosisDate?.slice(0, 10) || '未填写',
          },
          {
            label: '分型/诊断方式',
            value: profile?.baseline?.diseaseBackground?.diagnosisType || '等待报告识别',
          },
          {
            label: '遗传信息',
            value:
              [
                profile?.geneticMutation,
                profile?.baseline?.diseaseBackground?.d4z4
                  ? `D4Z4 ${profile.baseline.diseaseBackground.d4z4}`
                  : null,
                profile?.baseline?.diseaseBackground?.haplotype
                  ? `单倍型 ${profile.baseline.diseaseBackground.haplotype}`
                  : null,
                profile?.baseline?.diseaseBackground?.methylation
                  ? `甲基化 ${profile.baseline.diseaseBackground.methylation}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ') || '等待相关报告识别',
            wide: true,
          },
        ],
      },
      {
        key: 'background',
        title: '疾病背景',
        items: [
          {
            label: '首发部位',
            value: profile?.baseline?.diseaseBackground?.onsetRegion || '未填写',
          },
          {
            label: '家族史',
            value: profile?.baseline?.diseaseBackground?.familyHistory || '未填写',
          },
          { label: '当前行走', value: formatAmbulationLabel(profile) },
          { label: '辅具', value: formatAssistiveDevicesLabel(profile) },
        ],
      },
    ],
    [displayName, passportId, profile],
  );
  const archiveMriRegions =
    Object.keys(passport?.imaging.bodyRegions ?? {}).length > 0
      ? ((passport?.imaging.bodyRegions ?? {}) as BodyRegionMap)
      : latestMriVisualization.regions;
  const archiveMriHighlights =
    passport?.imaging.highlights && passport.imaging.highlights.length > 0
      ? passport.imaging.highlights
      : latestMriVisualization.findings;
  const archiveMriSubtitle = archiveMriHighlights.length
    ? `影像提示：${archiveMriHighlights.join('、')}`
    : passport?.imaging.summary || latestMriVisualization.summary;
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
            <View style={styles.headerTopRow}>
              <View style={styles.headerLead}>
                <View>
                  <Text style={styles.eyebrow}>MY ARCHIVE</Text>
                  <Text style={styles.pageTitle}>我的档案</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.primaryButton}
                activeOpacity={0.88}
                onPress={() => router.push('/p-data_entry')}
              >
                <FontAwesome6 name="plus" size={12} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>患者自录与上传</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.headerActionRail}>
              <TouchableOpacity
                style={styles.outlineButton}
                activeOpacity={0.88}
                onPress={() => router.push('/p-report_management')}
              >
                <FontAwesome6 name="file-medical" size={13} color={CLINICAL_COLORS.accentStrong} />
                <Text style={styles.outlineButtonText}>报告管理</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.outlineButton}
                activeOpacity={0.88}
                onPress={() => router.push('/p-clinical_passport')}
              >
                <FontAwesome6 name="id-card" size={13} color={CLINICAL_COLORS.accentStrong} />
                <Text style={styles.outlineButtonText}>临床护照</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.outlineButton}
                activeOpacity={0.88}
                onPress={() => router.push('/p-manage')}
              >
                <FontAwesome6 name="wave-square" size={13} color={CLINICAL_COLORS.accentStrong} />
                <Text style={styles.outlineButtonText}>病程管理</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.section}>
            <LinearGradient colors={CLINICAL_GRADIENTS.surface} style={styles.heroCard}>
              <Text style={styles.heroEyebrow}>PATIENT ARCHIVE</Text>
              <Text style={styles.heroTitle}>{displayName}</Text>
              <Text style={styles.heroMeta}>{passportId}</Text>
              <Text style={styles.heroSummary}>
                已建立患者档案、临床护照与系统检查入口。这里集中查看个人信息、FSHD
                相关信息和患者端可视化。
              </Text>
              <View style={styles.reportStatGrid}>
                <View style={styles.reportStatCard}>
                  <Text style={styles.reportStatValue}>{reportCount}</Text>
                  <Text style={styles.reportStatLabel}>报告总数</Text>
                </View>
                <View style={styles.reportStatCard}>
                  <Text style={styles.reportStatValue}>{recognizedReportCount}</Text>
                  <Text style={styles.reportStatLabel}>已识别</Text>
                </View>
                <View style={styles.reportStatCard}>
                  <Text style={styles.reportStatValue}>
                    {formatDateLabel(passport?.latestUpdatedAt ?? profile?.updatedAt)}
                  </Text>
                  <Text style={styles.reportStatLabel}>最近更新</Text>
                </View>
              </View>
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
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>档案控制台</Text>
                <Text style={styles.sectionSubtitle}>集中查看个人基本信息和 FSHD 关键背景。</Text>
              </View>
            </View>

            <View style={styles.consoleStack}>
              {consoleSections.map((section) => (
                <View key={section.key} style={styles.consoleCard}>
                  <Text style={styles.consoleTitle}>{section.title}</Text>
                  <View style={styles.consoleItemGrid}>
                    {section.items.map((item) => (
                      <View
                        key={`${section.key}-${item.label}`}
                        style={[styles.consoleItemCard, item.wide && styles.consoleItemCardWide]}
                      >
                        <Text style={styles.consoleItemLabel}>{item.label}</Text>
                        <Text
                          style={[
                            styles.consoleItemValue,
                            item.accent && styles.consoleItemValueAccent,
                          ]}
                        >
                          {item.value}
                        </Text>
                      </View>
                    ))}
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
                  <View style={styles.sectionHeader}>
                    <Text style={styles.consoleTitle}>受累可视化</Text>
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
                    regions={archiveMriRegions}
                    mode="mri"
                    title="MRI 受累分布"
                    subtitle={archiveMriSubtitle}
                  />
                </View>

                {visualizationCards.map((item) => {
                  const chartData = renderChartPoints(item.points);
                  const meta = trendMeta[item.trend];
                  return (
                    <View key={item.key} style={styles.visualizationChartCard}>
                      <View style={styles.visualizationChartHeader}>
                        <View style={styles.visualizationChartHeaderMain}>
                          <Text style={styles.visualizationChartTitle}>{item.label}</Text>
                          <Text style={styles.visualizationChartValue}>{item.latestDisplay}</Text>
                        </View>
                        <View
                          style={[styles.summaryBadge, { backgroundColor: meta.backgroundColor }]}
                        >
                          <Text style={[styles.summaryBadgeText, { color: meta.color }]}>
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
                <Text style={styles.sectionTitle}>随访摘要</Text>
                <Text style={styles.sectionSubtitle}>整合最近一次患者端记录。</Text>
              </View>
            </View>

            <View style={styles.visualizationDigestCard}>
              <View style={styles.visualizationDigestList}>
                {visualizationCards.map((item) => {
                  const meta = trendMeta[item.trend];
                  return (
                    <View key={`${item.key}-digest`} style={styles.visualizationDigestItem}>
                      <View style={styles.visualizationDigestTopRow}>
                        <Text style={styles.visualizationDigestTitle}>{item.label}</Text>
                        <View
                          style={[styles.summaryBadge, { backgroundColor: meta.backgroundColor }]}
                        >
                          <Text style={[styles.summaryBadgeText, { color: meta.color }]}>
                            {meta.label}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.visualizationDigestValue}>{item.latestDisplay}</Text>
                      <Text style={styles.visualizationDigestText}>{item.summary}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        </ScrollView>

        {isLoading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={CLINICAL_COLORS.accentStrong} />
            <Text style={styles.loadingText}>正在整理我的档案...</Text>
          </View>
        ) : null}
      </LinearGradient>
    </SafeAreaView>
  );
}
