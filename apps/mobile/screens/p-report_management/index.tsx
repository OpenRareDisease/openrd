import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  deletePatientDocument,
  getMyPatientProfile,
  type PatientDocument,
  type PatientProfile,
} from '../../lib/api';
import { CLINICAL_COLORS, CLINICAL_GRADIENTS, CLINICAL_TINTS } from '../../lib/clinical-visuals';
import ScreenBackButton from '../common/ScreenBackButton';
import styles from '../p-archive/styles';

type ReportCategory = '诊断' | '影像' | '呼吸' | '心脏' | '实验室' | '其他';

interface ReportCardMeta {
  id: string;
  title: string;
  summary: string;
  label: string;
  category: ReportCategory;
  reportDate: string | null;
  uploadedDate: string;
  fileName: string;
  statusLabel: string;
  icon: ComponentProps<typeof FontAwesome6>['name'];
  iconColor: string;
  iconBackground: string;
}

const reportTypeCatalog: Record<
  string,
  {
    label: string;
    category: ReportCategory;
    icon: ComponentProps<typeof FontAwesome6>['name'];
    iconColor: string;
    iconBackground: string;
  }
> = {
  genetic_report: {
    label: '基因报告',
    category: '诊断',
    icon: 'dna',
    iconColor: '#8B5CF6',
    iconBackground: 'rgba(139, 92, 246, 0.12)',
  },
  mri: {
    label: 'MRI 报告',
    category: '影像',
    icon: 'magnet',
    iconColor: '#3B82F6',
    iconBackground: 'rgba(59, 130, 246, 0.12)',
  },
  muscle_mri: {
    label: '肌肉 MRI',
    category: '影像',
    icon: 'magnet',
    iconColor: '#3B82F6',
    iconBackground: 'rgba(59, 130, 246, 0.12)',
  },
  abdominal_ultrasound: {
    label: '腹部超声',
    category: '影像',
    icon: 'wave-square',
    iconColor: '#0F766E',
    iconBackground: 'rgba(15, 118, 110, 0.12)',
  },
  diaphragm_ultrasound: {
    label: '膈肌超声',
    category: '呼吸',
    icon: 'lungs',
    iconColor: '#0EA5A4',
    iconBackground: 'rgba(14, 165, 164, 0.12)',
  },
  pulmonary_function: {
    label: '肺功能报告',
    category: '呼吸',
    icon: 'lungs',
    iconColor: '#0EA5A4',
    iconBackground: 'rgba(14, 165, 164, 0.12)',
  },
  ecg: {
    label: '心电图',
    category: '心脏',
    icon: 'heart-pulse',
    iconColor: '#DC2626',
    iconBackground: 'rgba(220, 38, 38, 0.12)',
  },
  echocardiography: {
    label: '心脏超声',
    category: '心脏',
    icon: 'heart',
    iconColor: '#DC2626',
    iconBackground: 'rgba(220, 38, 38, 0.12)',
  },
  biochemistry: {
    label: '生化报告',
    category: '实验室',
    icon: 'flask',
    iconColor: '#C2410C',
    iconBackground: 'rgba(194, 65, 12, 0.12)',
  },
  muscle_enzyme: {
    label: '肌酶报告',
    category: '实验室',
    icon: 'flask',
    iconColor: '#C2410C',
    iconBackground: 'rgba(194, 65, 12, 0.12)',
  },
  blood_routine: {
    label: '血常规',
    category: '实验室',
    icon: 'droplet',
    iconColor: '#B91C1C',
    iconBackground: 'rgba(185, 28, 28, 0.12)',
  },
  thyroid_function: {
    label: '甲功报告',
    category: '实验室',
    icon: 'vial',
    iconColor: '#C2410C',
    iconBackground: 'rgba(194, 65, 12, 0.12)',
  },
  coagulation: {
    label: '凝血报告',
    category: '实验室',
    icon: 'shield-halved',
    iconColor: '#C2410C',
    iconBackground: 'rgba(194, 65, 12, 0.12)',
  },
  urinalysis: {
    label: '尿常规',
    category: '实验室',
    icon: 'vial',
    iconColor: '#C2410C',
    iconBackground: 'rgba(194, 65, 12, 0.12)',
  },
  infection_screening: {
    label: '感染筛查',
    category: '实验室',
    icon: 'shield-halved',
    iconColor: '#C2410C',
    iconBackground: 'rgba(194, 65, 12, 0.12)',
  },
  stool_test: {
    label: '粪便/幽门检测',
    category: '实验室',
    icon: 'microscope',
    iconColor: '#C2410C',
    iconBackground: 'rgba(194, 65, 12, 0.12)',
  },
  other: {
    label: '医学报告',
    category: '其他',
    icon: 'file-medical',
    iconColor: CLINICAL_COLORS.accentStrong,
    iconBackground: CLINICAL_TINTS.accentSoft,
  },
};

const pickDocumentField = (document: PatientDocument, keys: string[]) => {
  const fields = document.ocrPayload?.fields;
  if (!fields) {
    return undefined;
  }

  for (const key of keys) {
    const raw = fields[key];
    if (raw === null || raw === undefined) {
      continue;
    }
    const value = String(raw).trim();
    if (value) {
      return value;
    }
  }

  return undefined;
};

const formatCalendarDate = (value?: string | null) => {
  if (!value) {
    return '—';
  }

  const directMatch = String(value).match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (directMatch) {
    return `${directMatch[1]}.${directMatch[2].padStart(2, '0')}.${directMatch[3].padStart(2, '0')}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
};

const getDocumentStatusLabel = (status?: string | null) => {
  switch (status) {
    case 'processed':
    case 'completed':
      return '已识别';
    case 'processing':
      return '识别中';
    case 'failed':
      return '识别失败';
    default:
      return '已上传';
  }
};

const buildReportCardMeta = (document: PatientDocument): ReportCardMeta => {
  const classifiedType =
    pickDocumentField(document, ['classifiedType', 'classified_type']) ||
    document.documentType ||
    'other';
  const catalogMeta = reportTypeCatalog[classifiedType] ?? reportTypeCatalog.other;
  const label =
    pickDocumentField(document, ['reportTypeLabel', 'report_type_label']) || catalogMeta.label;
  const title = document.title?.trim() || label;
  const summary =
    pickDocumentField(document, [
      'aiSummary',
      'ai_summary',
      'reportImpression',
      'report_impression',
      'ecgSummary',
      'ecg_summary',
      'echoSummary',
      'echo_summary',
      'ventilatoryPattern',
      'ventilatory_pattern',
    ]) || '已完成识别，可进入详情页查看结构化结果。';

  return {
    id: document.id,
    title,
    summary,
    label,
    category: catalogMeta.category,
    reportDate: pickDocumentField(document, ['reportTime', 'report_time']) ?? null,
    uploadedDate: document.uploadedAt,
    fileName: document.fileName?.trim() || '未命名文件',
    statusLabel: getDocumentStatusLabel(document.status),
    icon: catalogMeta.icon,
    iconColor: catalogMeta.iconColor,
    iconBackground: catalogMeta.iconBackground,
  };
};

export default function ReportManagementScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [activeReportCategory, setActiveReportCategory] = useState<'全部' | ReportCategory>('全部');
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
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
      const profileData = await getMyPatientProfile();
      setProfile(profileData);
    } catch (error) {
      setProfile(null);
      setErrorMessage(error instanceof ApiError ? error.message : '暂时无法加载报告管理页。');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData().catch(() => undefined);
  }, []);

  const displayName = profile?.preferredName?.trim() || profile?.fullName?.trim() || '系统检测报告';
  const reportCards = useMemo(
    () =>
      [...(profile?.documents ?? [])]
        .map((item) => buildReportCardMeta(item))
        .sort(
          (a, b) =>
            new Date(b.reportDate ?? b.uploadedDate).getTime() -
            new Date(a.reportDate ?? a.uploadedDate).getTime(),
        ),
    [profile],
  );
  const reportCategoryOptions = useMemo(() => {
    const counts = new Map<ReportCategory, number>();
    reportCards.forEach((item) => {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    });

    const orderedCategories: ReportCategory[] = ['诊断', '影像', '呼吸', '心脏', '实验室', '其他'];
    return [
      { label: '全部' as const, count: reportCards.length },
      ...orderedCategories
        .filter((category) => counts.has(category))
        .map((category) => ({ label: category, count: counts.get(category) ?? 0 })),
    ];
  }, [reportCards]);
  const visibleReportCards = useMemo(
    () =>
      activeReportCategory === '全部'
        ? reportCards
        : reportCards.filter((item) => item.category === activeReportCategory),
    [activeReportCategory, reportCards],
  );
  const latestReportDate = reportCards.length
    ? reportCards[0].reportDate || reportCards[0].uploadedDate
    : null;
  const recognizedReportCount = reportCards.filter((item) => item.statusLabel === '已识别').length;

  useEffect(() => {
    if (!reportCategoryOptions.some((item) => item.label === activeReportCategory)) {
      setActiveReportCategory('全部');
    }
  }, [activeReportCategory, reportCategoryOptions]);

  const openReportDetail = (documentId: string) => {
    router.push({
      pathname: '/p-report_detail',
      params: { documentId },
    });
  };

  const runDeleteReport = async (documentId: string) => {
    try {
      setDeletingReportId(documentId);
      await deletePatientDocument(documentId);
      await loadData(true);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '删除报告失败';
      Alert.alert('删除失败', message);
    } finally {
      setDeletingReportId(null);
    }
  };

  const confirmDeleteReport = (report: ReportCardMeta) => {
    Alert.alert('删除报告', `确认删除“${report.title}”吗？删除后会从时间轴和汇总视图中移除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: deletingReportId === report.id ? '删除中...' : '删除',
        style: 'destructive',
        onPress: () => {
          runDeleteReport(report.id).catch(() => undefined);
        },
      },
    ]);
  };

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
                <Text style={styles.eyebrow}>REPORT MANAGEMENT</Text>
                <Text style={styles.pageTitle}>报告管理</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.outlineButton}
                activeOpacity={0.88}
                onPress={() => router.push('/p-archive')}
              >
                <FontAwesome6 name="folder-open" size={13} color={CLINICAL_COLORS.accentStrong} />
                <Text style={styles.outlineButtonText}>我的档案</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryButton}
                activeOpacity={0.88}
                onPress={() => router.push('/p-data_entry')}
              >
                <FontAwesome6 name="plus" size={12} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>添加报告</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.section}>
            <LinearGradient colors={CLINICAL_GRADIENTS.surface} style={styles.heroCard}>
              <Text style={styles.heroEyebrow}>系统检测报告</Text>
              <Text style={styles.heroTitle}>{displayName}</Text>
              <Text style={styles.heroSummary}>
                按分类和日期整理全部系统检测报告，支持查看详情、继续新增和直接删除。
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
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>报告清单</Text>
                <Text style={styles.sectionSubtitle}>
                  按分类和日期整理，支持查看详情、继续新增和直接删除。
                </Text>
              </View>
            </View>

            <LinearGradient colors={CLINICAL_GRADIENTS.surface} style={styles.reportHeroCard}>
              <View style={styles.reportStatGrid}>
                <View style={styles.reportStatCard}>
                  <Text style={styles.reportStatValue}>{reportCards.length}</Text>
                  <Text style={styles.reportStatLabel}>报告总数</Text>
                </View>
                <View style={styles.reportStatCard}>
                  <Text style={styles.reportStatValue}>{reportCategoryOptions.length - 1}</Text>
                  <Text style={styles.reportStatLabel}>已覆盖分类</Text>
                </View>
                <View style={styles.reportStatCard}>
                  <Text style={styles.reportStatValue}>{recognizedReportCount}</Text>
                  <Text style={styles.reportStatLabel}>已识别</Text>
                </View>
              </View>
              <Text style={styles.reportHeroMeta}>
                {latestReportDate
                  ? `最近一份报告日期 ${formatCalendarDate(latestReportDate)}`
                  : '还没有上传系统检测报告'}
              </Text>
            </LinearGradient>

            <View style={styles.categoryFilterWrap}>
              {reportCategoryOptions.map((item) => {
                const active = activeReportCategory === item.label;
                return (
                  <TouchableOpacity
                    key={item.label}
                    style={[styles.categoryChip, active && styles.categoryChipActive]}
                    activeOpacity={0.88}
                    onPress={() => setActiveReportCategory(item.label)}
                  >
                    <Text
                      style={[styles.categoryChipText, active && styles.categoryChipTextActive]}
                    >
                      {item.label}
                    </Text>
                    <View
                      style={[styles.categoryChipCount, active && styles.categoryChipCountActive]}
                    >
                      <Text
                        style={[
                          styles.categoryChipCountText,
                          active && styles.categoryChipCountTextActive,
                        ]}
                      >
                        {item.count}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {visibleReportCards.length ? (
              <View style={styles.reportManagerList}>
                {visibleReportCards.map((item) => (
                  <View key={item.id} style={styles.reportManagerCard}>
                    <View style={styles.reportManagerHeader}>
                      <View
                        style={[styles.reportIconWrap, { backgroundColor: item.iconBackground }]}
                      >
                        <FontAwesome6 name={item.icon} size={16} color={item.iconColor} />
                      </View>

                      <View style={styles.reportManagerHeaderMain}>
                        <View style={styles.reportBadgeRow}>
                          <View style={styles.reportCategoryBadge}>
                            <Text style={styles.reportCategoryBadgeText}>{item.category}</Text>
                          </View>
                          <View style={styles.reportTypeBadge}>
                            <Text style={styles.reportTypeBadgeText}>{item.label}</Text>
                          </View>
                          <View style={styles.reportStatusBadge}>
                            <Text style={styles.reportStatusBadgeText}>{item.statusLabel}</Text>
                          </View>
                        </View>
                        <Text style={styles.reportManagerTitle}>{item.title}</Text>
                      </View>
                    </View>

                    <View style={styles.reportDateRow}>
                      <View style={styles.reportDateCard}>
                        <Text style={styles.reportDateLabel}>报告日期</Text>
                        <Text style={styles.reportDateValue}>
                          {formatCalendarDate(item.reportDate)}
                        </Text>
                      </View>
                      <View style={styles.reportDateCard}>
                        <Text style={styles.reportDateLabel}>上传日期</Text>
                        <Text style={styles.reportDateValue}>
                          {formatCalendarDate(item.uploadedDate)}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.reportManagerSummary}>{item.summary}</Text>
                    <Text style={styles.reportFileText}>{item.fileName}</Text>

                    <View style={styles.reportActionRow}>
                      <TouchableOpacity
                        style={styles.reportPrimaryAction}
                        activeOpacity={0.88}
                        onPress={() => openReportDetail(item.id)}
                      >
                        <FontAwesome6 name="arrow-up-right-from-square" size={12} color="#FFFFFF" />
                        <Text style={styles.reportPrimaryActionText}>查看详情</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.reportGhostAction}
                        activeOpacity={0.88}
                        disabled={deletingReportId === item.id}
                        onPress={() => confirmDeleteReport(item)}
                      >
                        <FontAwesome6 name="trash-can" size={12} color={CLINICAL_COLORS.danger} />
                        <Text style={styles.reportGhostActionText}>
                          {deletingReportId === item.id ? '删除中...' : '删除'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.stateWrap}>
                <Text style={styles.stateText}>
                  {activeReportCategory === '全部'
                    ? '还没有上传报告，进入患者自录与上传页添加后，这里会自动按分类和时间整理。'
                    : `当前没有“${activeReportCategory}”分类的报告。`}
                </Text>
                <TouchableOpacity
                  style={styles.primaryButton}
                  activeOpacity={0.88}
                  onPress={() => router.push('/p-data_entry')}
                >
                  <Text style={styles.primaryButtonText}>去添加报告</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>

        {isLoading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={CLINICAL_COLORS.accentStrong} />
            <Text style={styles.loadingText}>正在整理报告管理视图...</Text>
          </View>
        ) : null}
      </LinearGradient>
    </SafeAreaView>
  );
}
