import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import styles from './styles';
import HumanBodyFigure from '../common/HumanBodyFigure';
import ScreenBackButton from '../common/ScreenBackButton';
import SystemMonitoringPanels from '../common/SystemMonitoringPanels';
import TimelineSectionCard from '../common/TimelineSectionCard';
import {
  ApiError,
  getClinicalPassportSummary,
  getMyPatientProfile,
  type ClinicalPassportSummary,
  type PatientProfile,
} from '../../lib/api';
import type { BodyRegionMap } from '../../lib/clinical-visuals';
import { buildClinicalPassportPdfHtml } from '../../lib/clinical-passport-pdf';
import { buildLatestMriVisualization, buildReportInsights } from '../../lib/report-insights';
import {
  CLINICAL_COLORS,
  CLINICAL_GRADIENTS,
  CLINICAL_TINTS,
  formatDateLabel,
} from '../../lib/clinical-visuals';

const getFreshnessColors = (tone: ClinicalPassportSummary['diagnosis']['freshness']['tone']) => {
  switch (tone) {
    case 'success':
      return {
        backgroundColor: CLINICAL_TINTS.successSoft,
        color: CLINICAL_COLORS.success,
      };
    case 'warning':
      return {
        backgroundColor: CLINICAL_TINTS.warningSoft,
        color: CLINICAL_COLORS.warning,
      };
    case 'danger':
      return {
        backgroundColor: CLINICAL_TINTS.dangerSoft,
        color: CLINICAL_COLORS.danger,
      };
    default:
      return {
        backgroundColor: CLINICAL_TINTS.neutralSoft,
        color: CLINICAL_COLORS.textMuted,
      };
  }
};

const ClinicalPassportScreen = () => {
  const router = useRouter();
  const [passport, setPassport] = useState<ClinicalPassportSummary | null>(null);
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [bodyView, setBodyView] = useState<'front' | 'back'>('front');

  const loadPassport = async () => {
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
      const message = error instanceof ApiError ? error.message : '无法获取临床护照数据';
      setErrorMessage(message);
      setPassport(null);
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPassport();
  }, []);

  const handleExport = async () => {
    if (!passport?.hasRecordedData) {
      Alert.alert('无法导出', '当前没有足够的护照数据可供导出。');
      return;
    }

    try {
      setIsExporting(true);
      const html = buildClinicalPassportPdfHtml(passport);

      if (Platform.OS === 'web') {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          throw new Error('浏览器拦截了 PDF 预览窗口，请允许弹出新窗口后重试。');
        }

        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        printWindow.onload = () => {
          printWindow.print();
        };
        return;
      }

      const exported = await Print.printToFileAsync({
        html,
        base64: false,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(exported.uri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: `${passport.patientName} 临床护照`,
        });
        return;
      }

      await Print.printAsync({ html });
    } catch (error) {
      const message = error instanceof Error ? error.message : '临床护照 PDF 导出失败';
      Alert.alert('操作失败', message);
    } finally {
      setIsExporting(false);
    }
  };

  const diagnosisFreshnessStyle = useMemo(
    () => getFreshnessColors(passport?.diagnosis.freshness.tone ?? 'neutral'),
    [passport?.diagnosis.freshness.tone],
  );

  const heroMetrics = useMemo(() => {
    if (!passport) return [];
    const metrics = passport.metrics.filter((item) => item.label !== '肌力组数');
    metrics.splice(2, 0, {
      label: '最近随访',
      value: formatDateLabel(passport.motor.latestActivityAt ?? passport.motor.latestMeasurementAt),
      hint: passport.motor.activitySummary || '暂无随访变化摘要',
    });
    return metrics;
  }, [passport]);
  const reportInsights = useMemo(
    () => buildReportInsights(profile?.documents ?? [], profile),
    [profile],
  );
  const latestMriVisualization = useMemo(
    () => buildLatestMriVisualization(profile?.documents ?? []),
    [profile],
  );
  const passportMriRegions =
    Object.keys(passport?.imaging.bodyRegions ?? {}).length > 0
      ? ((passport?.imaging.bodyRegions ?? {}) as BodyRegionMap)
      : latestMriVisualization.regions;
  const passportMriHighlights =
    passport?.imaging.highlights && passport.imaging.highlights.length > 0
      ? passport.imaging.highlights
      : latestMriVisualization.findings;
  const passportMriSubtitle = passportMriHighlights.length
    ? `影像提示：${passportMriHighlights.join('、')}`
    : passport?.imaging.summary || latestMriVisualization.summary;

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={CLINICAL_GRADIENTS.page}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.backgroundGradient}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <ScreenBackButton />
            <Text style={styles.headerTitle}>FSHD 临床护照</Text>
            <TouchableOpacity
              style={styles.headerAction}
              activeOpacity={0.75}
              onPress={handleExport}
              disabled={isExporting || !passport?.hasRecordedData}
            >
              {isExporting ? (
                <ActivityIndicator size="small" color={CLINICAL_COLORS.accentStrong} />
              ) : (
                <FontAwesome6
                  name="file-pdf"
                  size={14}
                  color={
                    passport?.hasRecordedData
                      ? CLINICAL_COLORS.accentStrong
                      : CLINICAL_COLORS.textMuted
                  }
                />
              )}
            </TouchableOpacity>
          </View>

          {errorMessage && !passport ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>护照数据暂时不可用</Text>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <LinearGradient
            colors={CLINICAL_GRADIENTS.surface}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            <View style={styles.heroTopRow}>
              <View style={styles.heroCopyBlock}>
                <Text style={styles.heroEyebrow}>CLINICAL PASSPORT</Text>
                <Text style={styles.heroTitle}>{passport?.patientName ?? '未命名病例'}</Text>
                <Text style={styles.heroPassportId}>{passport?.passportId ?? '待生成'}</Text>
                <Text style={styles.heroSubtitle}>
                  汇总诊断、影像、检查结果和时间轴，方便门诊、住院或研究登记时快速出示。
                </Text>
              </View>
              <View style={styles.heroStatusPill}>
                <Text style={styles.heroStatusText}>
                  {passport
                    ? `${passport.completion.completed}/${passport.completion.total} 已完成`
                    : '整理中'}
                </Text>
              </View>
            </View>

            <View style={styles.heroMetaRow}>
              <View style={styles.heroMetaChip}>
                <FontAwesome6 name="clock" size={12} color={CLINICAL_COLORS.accentStrong} />
                <Text style={styles.heroMetaText}>
                  最近更新 {formatDateLabel(passport?.latestUpdatedAt)}
                </Text>
              </View>
              <View style={styles.heroMetaChip}>
                <FontAwesome6 name="file-lines" size={12} color={CLINICAL_COLORS.accentStrong} />
                <Text style={styles.heroMetaText}>
                  {passport?.metrics.find((item) => item.label === '报告数')?.value ?? '0'}{' '}
                  份来源报告
                </Text>
              </View>
            </View>

            <View style={styles.metricGrid}>
              {heroMetrics.map((metric) => (
                <View key={metric.label} style={styles.metricCard}>
                  <Text style={styles.metricValue}>{metric.value}</Text>
                  <Text style={styles.metricLabel}>{metric.label}</Text>
                  <Text style={styles.metricHint}>{metric.hint}</Text>
                </View>
              ))}
            </View>

            <View style={styles.heroActionRow}>
              <TouchableOpacity
                style={styles.heroActionButton}
                activeOpacity={0.82}
                onPress={() => router.push('/p-data_entry')}
              >
                <Text style={styles.heroActionButtonText}>去补录数据</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.heroActionButton, styles.heroActionButtonGhost]}
                activeOpacity={0.82}
                onPress={handleExport}
                disabled={isExporting || !passport?.hasRecordedData}
              >
                <Text
                  style={[
                    styles.heroActionButtonText,
                    styles.heroActionButtonTextGhost,
                    !passport?.hasRecordedData && styles.heroActionButtonTextDisabled,
                  ]}
                >
                  {isExporting ? '生成中...' : '导出 PDF'}
                </Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>

          {isLoading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={CLINICAL_COLORS.accentStrong} />
              <Text style={styles.loadingText}>正在整理临床护照摘要...</Text>
            </View>
          ) : null}

          {passport ? (
            <>
              <View style={styles.sectionShell}>
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionBadge}>
                    <Text style={styles.sectionBadgeText}>01</Text>
                  </View>
                  <View style={styles.sectionHeadingGroup}>
                    <Text style={styles.sectionHeading}>诊断与身份</Text>
                    <Text style={styles.sectionDescription}>
                      用一张卡片看清临床护照 ID、诊断证据和当前信息新鲜度。
                    </Text>
                  </View>
                </View>

                <View style={styles.diagnosisCard}>
                  <View style={styles.cardHeadingRow}>
                    <View>
                      <Text style={styles.cardTitle}>诊断证据与身份信息</Text>
                      <Text style={styles.cardSubtitle}>
                        集中查看临床护照 ID、基因结果、诊断日期和证据摘要。
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.freshnessPill,
                        { backgroundColor: diagnosisFreshnessStyle.backgroundColor },
                      ]}
                    >
                      <Text
                        style={[styles.freshnessText, { color: diagnosisFreshnessStyle.color }]}
                      >
                        {passport.diagnosis.freshness.label}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.infoGrid}>
                    <View style={styles.infoCell}>
                      <Text style={styles.infoLabel}>临床护照 ID</Text>
                      <Text style={styles.infoValue}>{passport.passportId}</Text>
                    </View>
                    <View style={styles.infoCell}>
                      <Text style={styles.infoLabel}>基因类型</Text>
                      <Text style={styles.infoValue}>{passport.diagnosis.geneticType}</Text>
                    </View>
                    <View style={styles.infoCell}>
                      <Text style={styles.infoLabel}>D4Z4 重复数</Text>
                      <Text style={styles.infoValue}>{passport.diagnosis.d4z4Repeats}</Text>
                    </View>
                    <View style={styles.infoCell}>
                      <Text style={styles.infoLabel}>甲基化值</Text>
                      <Text style={styles.infoValue}>{passport.diagnosis.methylationValue}</Text>
                    </View>
                    <View style={styles.infoCell}>
                      <Text style={styles.infoLabel}>诊断日期</Text>
                      <Text style={styles.infoValue}>{passport.diagnosis.diagnosisDate}</Text>
                    </View>
                  </View>

                  <View style={styles.noteCard}>
                    <Text style={styles.noteTitle}>证据摘要</Text>
                    <Text style={styles.noteText}>{passport.diagnosis.geneEvidence}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.sectionShell}>
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionBadge}>
                    <Text style={styles.sectionBadgeText}>02</Text>
                  </View>
                  <View style={styles.sectionHeadingGroup}>
                    <Text style={styles.sectionHeading}>影像受累与功能变化</Text>
                    <Text style={styles.sectionDescription}>
                      主要基于 MRI 报告和最近随访变化，不再展示主观肌力体图。
                    </Text>
                  </View>
                </View>

                <View style={styles.segmentRow}>
                  <TouchableOpacity
                    style={[
                      styles.segmentButton,
                      bodyView === 'front' && styles.segmentButtonActive,
                    ]}
                    activeOpacity={0.82}
                    onPress={() => setBodyView('front')}
                  >
                    <Text
                      style={[
                        styles.segmentButtonText,
                        bodyView === 'front' && styles.segmentButtonTextActive,
                      ]}
                    >
                      正面
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.segmentButton,
                      bodyView === 'back' && styles.segmentButtonActive,
                    ]}
                    activeOpacity={0.82}
                    onPress={() => setBodyView('back')}
                  >
                    <Text
                      style={[
                        styles.segmentButtonText,
                        bodyView === 'back' && styles.segmentButtonTextActive,
                      ]}
                    >
                      背面
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.figureStack}>
                  <View style={styles.figureShell}>
                    <View style={styles.noteCard}>
                      <Text style={styles.noteTitle}>最近功能变化</Text>
                      <Text style={styles.noteText}>
                        {passport.motor.activitySummary || '暂无活动或随访变化摘要。'}
                      </Text>
                    </View>
                    <View style={styles.infoGrid}>
                      <View style={styles.infoCell}>
                        <Text style={styles.infoLabel}>最近随访</Text>
                        <Text style={styles.infoValue}>
                          {formatDateLabel(
                            passport.motor.latestActivityAt ?? passport.motor.latestMeasurementAt,
                          )}
                        </Text>
                      </View>
                      <View style={styles.infoCell}>
                        <Text style={styles.infoLabel}>影像重点</Text>
                        <Text style={styles.infoValue}>
                          {passportMriHighlights.length > 0
                            ? passportMriHighlights.join('、')
                            : '等待 MRI 结构化结果'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.figureShell}>
                    <HumanBodyFigure
                      view={bodyView}
                      regions={passportMriRegions}
                      mode="mri"
                      title="MRI 受累分布"
                      subtitle={passportMriSubtitle}
                    />
                  </View>
                </View>
              </View>

              <View style={styles.sectionShell}>
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionBadge}>
                    <Text style={styles.sectionBadgeText}>03</Text>
                  </View>
                  <View style={styles.sectionHeadingGroup}>
                    <Text style={styles.sectionHeading}>检查结果</Text>
                    <Text style={styles.sectionDescription}>
                      按系统分类查看实验室、呼吸和心脏相关结果，实验室支持两级分类切换。
                    </Text>
                  </View>
                </View>

                <View style={styles.sectionContentBlock}>
                  <SystemMonitoringPanels
                    panels={reportInsights.systemPanels}
                    emptyText="当前还没有可归入检查结果的结构化数据。"
                  />
                </View>
              </View>

              <View style={styles.sectionShell}>
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionBadge}>
                    <Text style={styles.sectionBadgeText}>04</Text>
                  </View>
                  <View style={styles.sectionHeadingGroup}>
                    <Text style={styles.sectionHeading}>时间轴</Text>
                    <Text style={styles.sectionDescription}>
                      最近随访、事件和报告会统一整理在这里，展开后可点击卡片查看详情。
                    </Text>
                  </View>
                </View>

                <View style={styles.sectionContentBlock}>
                  <TimelineSectionCard
                    items={passport.timeline}
                    subtitle="点击卡片可进入详情；报告类记录可继续跳转到报告详情页。"
                    emptyText="暂无时间轴内容，录入或上传后会自动汇总到这里。"
                  />
                </View>
              </View>

              <View style={styles.supportCard}>
                <View style={styles.cardHeadingRow}>
                  <View>
                    <Text style={styles.cardTitle}>待补项</Text>
                    <Text style={styles.cardSubtitle}>
                      如果想让临床护照更完整，可以优先补这些记录。
                    </Text>
                  </View>
                </View>

                <View style={styles.gapList}>
                  {passport.nextSteps.length === 0 ? (
                    <View style={styles.gapCard}>
                      <Text style={styles.gapTitle}>当前没有明显缺口</Text>
                      <Text style={styles.gapDescription}>
                        诊断、功能、影像和检查结果四个维度都已形成基础摘要。
                      </Text>
                    </View>
                  ) : (
                    passport.nextSteps.map((step) => (
                      <View key={step.title} style={styles.gapCard}>
                        <View style={styles.gapTopRow}>
                          <FontAwesome6
                            name="triangle-exclamation"
                            size={13}
                            color={CLINICAL_COLORS.warning}
                          />
                          <Text style={styles.gapTitle}>{step.title}</Text>
                        </View>
                        <Text style={styles.gapDescription}>{step.description}</Text>
                      </View>
                    ))
                  )}
                </View>

                <TouchableOpacity
                  style={styles.inlineActionButton}
                  activeOpacity={0.84}
                  onPress={() => router.push('/p-data_entry')}
                >
                  <Text style={styles.inlineActionText}>去数据录入补齐</Text>
                  <FontAwesome6 name="arrow-right" size={12} color={CLINICAL_COLORS.accentStrong} />
                </TouchableOpacity>
              </View>

              <View style={styles.exportCard}>
                <View style={styles.cardHeadingRow}>
                  <View>
                    <Text style={styles.cardTitle}>导出临床护照</Text>
                    <Text style={styles.cardSubtitle}>生成 PDF，便于保存、打印或发送给医生。</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.exportButton}
                  onPress={handleExport}
                  disabled={isExporting || !passport.hasRecordedData}
                  activeOpacity={0.84}
                >
                  <LinearGradient
                    colors={[CLINICAL_COLORS.accent, CLINICAL_COLORS.accentStrong]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.exportButtonGradient}
                  >
                    {isExporting ? (
                      <ActivityIndicator color={CLINICAL_COLORS.background} />
                    ) : (
                      <>
                        <FontAwesome6
                          name="file-pdf"
                          size={14}
                          color={CLINICAL_COLORS.background}
                        />
                        <Text style={styles.exportButtonText}>生成 PDF</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </>
          ) : null}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
};

export default ClinicalPassportScreen;
