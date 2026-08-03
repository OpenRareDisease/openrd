import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { plainAnswerText } from '../common/answer-format';
import Button from '../common/Button';
import SegmentedControl from '../common/SegmentedControl';
import Icon from '../common/Icon';
import {
  ApiError,
  deletePatientDocument,
  getMyPatientProfile,
  type PatientDocument,
  type PatientProfile,
} from '../../lib/api';
import { COLOR } from '../../lib/design';
import InlineNotice from '../common/feedback/InlineNotice';
import ScreenHeader from '../common/ScreenHeader';
import { useAppDialog } from '../common/feedback/AppDialog';
import styles from '../p-archive/styles';

/**
 * 报告管理 — a list of records, set as a record.
 *
 * The previous version opened with two stacked filled blocks (a hero
 * whose body was copied verbatim from the section subtitle below it,
 * then a stat panel), sat on a page gradient, and rendered each report
 * as a 26pt-radius shadowed card containing three more boxes: a tinted
 * icon square, three pill badges, and two filled date tiles. The one
 * thing a patient comes here for — which report, from when — was the
 * smallest type on screen.
 *
 * Now: one filled block (the counts), hairline-separated report rows,
 * dates set as values rather than tiles, and a single pill left on the
 * row — the OCR status, which is the only badge that reports a state
 * rather than restating the title.
 */

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
  /** Semantic colour for the status pill — 识别失败 and 已识别 used to
   *  render in the same teal, which made a failed parse invisible. */
  statusTone: string;
  icon: string;
}

/**
 * Per-type icons are kept (they make a long list scannable) but the
 * per-type colour and tint were dropped: a rainbow of purple/blue/red
 * chips in tinted rounded squares was the loudest decoration on the
 * screen, and the category is already written out next to it.
 */
const reportTypeCatalog: Record<
  string,
  {
    label: string;
    category: ReportCategory;
    icon: string;
  }
> = {
  genetic_report: { label: '基因报告', category: '诊断', icon: 'dna' },
  mri: { label: 'MRI 报告', category: '影像', icon: 'magnet' },
  muscle_mri: { label: '肌肉 MRI', category: '影像', icon: 'magnet' },
  abdominal_ultrasound: { label: '腹部超声', category: '影像', icon: 'wave-square' },
  diaphragm_ultrasound: { label: '膈肌超声', category: '呼吸', icon: 'lungs' },
  pulmonary_function: { label: '肺功能报告', category: '呼吸', icon: 'lungs' },
  ecg: { label: '心电图', category: '心脏', icon: 'heart-pulse' },
  echocardiography: { label: '心脏超声', category: '心脏', icon: 'heart' },
  biochemistry: { label: '生化报告', category: '实验室', icon: 'flask' },
  muscle_enzyme: { label: '肌酶报告', category: '实验室', icon: 'flask' },
  blood_routine: { label: '血常规', category: '实验室', icon: 'droplet' },
  thyroid_function: { label: '甲功报告', category: '实验室', icon: 'vial' },
  coagulation: { label: '凝血报告', category: '实验室', icon: 'shield-halved' },
  urinalysis: { label: '尿常规', category: '实验室', icon: 'vial' },
  infection_screening: { label: '感染筛查', category: '实验室', icon: 'shield-halved' },
  stool_test: { label: '粪便/幽门检测', category: '实验室', icon: 'microscope' },
  other: { label: '医学报告', category: '其他', icon: 'file-medical' },
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

const getDocumentStatus = (status?: string | null): { label: string; tone: string } => {
  switch (status) {
    // 'parsed' / 'needs_review' / 'parse_failed' are the async
    // pipeline's vocabulary (migration 011); the older values stay
    // for rows written before it landed.
    case 'processed':
    case 'completed':
    case 'parsed':
      return { label: '已识别', tone: COLOR.good };
    case 'needs_review':
      return { label: '待复核', tone: COLOR.warn };
    case 'processing':
      return { label: '识别中', tone: COLOR.inkMuted };
    case 'failed':
    case 'parse_failed':
      return { label: '识别失败', tone: COLOR.alert };
    default:
      return { label: '已上传', tone: COLOR.inkMuted };
  }
};

/** What a card says when the pipeline produced no summary line for it
 *  yet. Mirrors `getDocumentStatus`'s vocabulary — the two must not
 *  drift, which is the whole reason this is a function of the same
 *  input rather than a constant. */
const fallbackSummaryForStatus = (status?: string | null): string => {
  switch (status) {
    case 'processed':
    case 'completed':
    case 'parsed':
      return '已完成识别，可进入详情页查看识别出的关键指标。';
    case 'needs_review':
      return '识别完成，但有指标需要你核对一下。';
    case 'processing':
      return '正在识别，通常需要 1-2 分钟，完成后这里会自动更新。';
    case 'failed':
    case 'parse_failed':
      return '这份没能识别出来，可以在详情页重新识别或换一张更清晰的图。';
    default:
      return '已上传，等待识别。';
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
  const status = getDocumentStatus(document.status);
  const extracted = pickDocumentField(document, [
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
  ]);
  // The fallback has to answer to the status beside it.
  //
  // It used to be one unconditional sentence —「已完成识别，可进入详情
  // 页查看识别出的关键指标。」— chosen for the case where a report
  // parsed but produced no impression worth quoting. Every other case
  // got it too, so a card whose chip read 识别中 sat directly above a
  // line telling the patient recognition had finished, and a card that
  // had failed said the same thing. Two states, one sentence, and the
  // sentence was right for neither.
  // Flattened, not block-rendered: this card clamps to three lines and
  // `numberOfLines` does not cross the <View> stack AnswerText builds,
  // so dropping AnswerText in here would silently remove the clamp and
  // let one card push the next off screen. The syntax goes instead.
  const summary = extracted
    ? plainAnswerText(extracted)
    : fallbackSummaryForStatus(document.status);

  return {
    id: document.id,
    title,
    summary,
    label,
    category: catalogMeta.category,
    reportDate: pickDocumentField(document, ['reportTime', 'report_time']) ?? null,
    uploadedDate: document.uploadedAt,
    fileName: document.fileName?.trim() || '未命名文件',
    statusLabel: status.label,
    statusTone: status.tone,
    icon: catalogMeta.icon,
  };
};

export default function ReportManagementScreen() {
  const router = useRouter();
  const { confirm } = useAppDialog();
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [activeReportCategory, setActiveReportCategory] = useState<'全部' | ReportCategory>('全部');
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  // Recoverable failures (e.g. delete) render inline instead of a
  // blocking Alert — three-way feedback split, see InlineNotice.
  const [listNotice, setListNotice] = useState<string | null>(null);
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
      // Fresh data on screen — a stale delete-failure banner above a
      // healthy list would just confuse.
      setListNotice(null);
    } catch (error) {
      setProfile(null);
      setErrorMessage(error instanceof ApiError ? error.message : '暂时无法加载报告管理页。');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // Async OCR: a report uploaded moments ago is still 'processing'.
  // Refetch whenever this screen gains focus — expo-router fires this
  // on the initial mount too (so no separate mount effect: keeping
  // one caused a double concurrent fetch on every entry), and again
  // on every return from the detail screen / tab switch, so「识别中」
  // badges resolve without pull-to-refresh. refresh mode keeps
  // later focus gains to the small spinner; the first render's
  // full-screen loading comes from isLoading's initial `true`.
  useFocusEffect(
    // loadData is recreated per render; an empty dep list runs the
    // refetch exactly once per focus gain, which is the semantic we
    // want (this config has no react-hooks lint plugin to appease).
    useCallback(() => {
      loadData(true).catch(() => undefined);
    }, []),
  );

  // Whose record this is. Falls back to nothing rather than to a
  // stand-in string: the old '系统检测报告' placeholder sat under a
  // page title that already said the same thing.
  const patientName = profile?.preferredName?.trim() || profile?.fullName?.trim() || null;
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
      setListNotice(null);
      await deletePatientDocument(documentId);
      await loadData(true);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '删除报告失败';
      setListNotice(`删除失败：${message}`);
    } finally {
      setDeletingReportId(null);
    }
  };

  /** Deleting a report is irreversible and, on web, used to be
   *  unconfirmed: `Alert.alert` is an empty function there, so the row
   *  simply vanished on the first press. The in-flight label stays on
   *  the row button — the dialog is built fresh each time it opens and
   *  the only way in is a button that's disabled mid-delete. */
  const confirmDeleteReport = async (report: ReportCardMeta) => {
    if (deletingReportId) return;
    const confirmed = await confirm({
      title: '删除报告',
      message: `确认删除“${report.title}”吗？删除后会从时间轴和汇总视图中移除。`,
      confirmLabel: '删除',
      destructive: true,
    });
    if (!confirmed) return;
    await runDeleteReport(report.id);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Plain paper. The page gradient was decorative and cost every
          surface above it contrast. */}
      <View style={styles.backgroundGradient}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadData(true).catch(() => undefined)}
              tintColor={COLOR.accent}
            />
          }
        >
          {/* The REPORT MANAGEMENT eyebrow is gone: it translated the
              title sitting directly beneath it. Title + back + home now
              come from ScreenHeader so every stack screen exits the
              same way; 添加报告 and the patient name keep the row
              below, which is still one row rather than the two the
              original layout spent. */}
          <View style={styles.header}>
            <ScreenHeader title="报告管理" fallbackHref="/p-home" style={styles.screenHeaderRow} />
            <View style={styles.headerTopRow}>
              <View style={styles.headerLead}>
                {patientName ? <Text style={styles.pageSubtitle}>{patientName}</Text> : null}
              </View>
              <Button
                label="添加报告"
                icon="plus"
                variant="prominent"
                compact
                onPress={() => router.push('/p-data_entry')}
              />
            </View>
            {listNotice ? <InlineNotice message={listNotice} /> : null}
          </View>

          {/* The one filled block on this screen. 已覆盖分类 was dropped:
              it counted the filter chips rendered immediately below it.

              Suppressed on a failed load, matching the empty-list
              branch further down that already had this guard: the
              catch nulls the profile, so a failed refresh rendered
              「0 报告总数 / 0 已识别 / 还没有上传系统检测报告」 directly
              above the 加载失败 notice — the page contradicting itself,
              in the direction that says the patient's uploads are
              gone. */}
          {errorMessage ? null : (
            <View style={styles.section}>
              <View style={styles.reportHeroCard}>
                <View style={styles.reportStatGrid}>
                  <View style={styles.reportStatCard}>
                    <Text style={styles.reportStatValue}>{reportCards.length}</Text>
                    <Text style={styles.reportStatLabel}>报告总数</Text>
                  </View>
                  <View style={styles.reportStatCard}>
                    <Text style={styles.reportStatValue}>{recognizedReportCount}</Text>
                    <Text style={styles.reportStatLabel}>已识别</Text>
                  </View>
                </View>
                <Text style={styles.reportHeroMeta}>
                  {latestReportDate
                    ? `最近一份报告 ${formatCalendarDate(latestReportDate)}`
                    : '还没有上传系统检测报告'}
                </Text>
              </View>
            </View>
          )}

          {errorMessage ? (
            <View style={styles.section}>
              <View style={styles.stateWrap}>
                <Text style={styles.stateText}>{errorMessage}</Text>
                <Button
                  label="重新加载"
                  icon="rotate-right"
                  onPress={() => loadData().catch(() => undefined)}
                />
              </View>
            </View>
          ) : null}

          {/* 报告清单 heading dropped along with its subtitle: the page
              title names the list, and the subtitle was the same
              sentence as the hero body it sat under. */}
          <View style={styles.section}>
            {/* One exclusive choice, so one track — see
                SegmentedControl. The per-category count rides in the
                label rather than as a second line of type: a count is
                what makes「其他 0」worth not tapping, and it was the
                reason this row had to be a pill in the first place. */}
            <SegmentedControl
              segments={reportCategoryOptions.map((item) => ({
                key: item.label,
                label: `${item.label} ${item.count}`,
              }))}
              value={activeReportCategory}
              onChange={(key) => setActiveReportCategory(key as typeof activeReportCategory)}
              accessibilityLabel="报告分类"
              style={styles.categoryControl}
            />

            {visibleReportCards.length ? (
              <View style={styles.reportManagerList}>
                {visibleReportCards.map((item) => (
                  <View key={item.id} style={styles.reportManagerCard}>
                    <View style={styles.reportManagerHeader}>
                      {/* Bare icon — it used to sit in a tinted rounded
                          square in one of nine different hues. */}
                      <Icon name={item.icon} size={14} color={COLOR.inkMuted} />
                      <Text style={styles.reportManagerTitle}>{item.title}</Text>
                      <View style={[styles.reportStatusBadge, { borderColor: item.statusTone }]}>
                        <Text style={[styles.reportStatusBadgeText, { color: item.statusTone }]}>
                          {item.statusLabel}
                        </Text>
                      </View>
                    </View>

                    {/* Category and type were two separate pills that
                        only ever restated the catalog entry; one muted
                        line carries both. */}
                    <Text style={styles.reportManagerMeta}>
                      {item.category} · {item.label}
                    </Text>

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

                    <Text style={styles.reportManagerSummary} numberOfLines={3}>
                      {item.summary}
                    </Text>
                    <Text style={styles.reportFileText} numberOfLines={1}>
                      {item.fileName}
                    </Text>

                    <View style={styles.reportActionRow}>
                      <Button
                        label="查看详情"
                        variant="tinted"
                        compact
                        onPress={() => openReportDetail(item.id)}
                      />

                      {/* Its neighbour moved to Button and this one
                          didn't — the same row, two different kinds of
                          control, and the destructive one was the
                          hand-rolled half with no accessibilityRole. */}
                      <Button
                        label="删除"
                        icon="trash-can"
                        variant="destructive"
                        compact
                        busy={deletingReportId === item.id}
                        accessibilityLabel={`删除${item.title}`}
                        onPress={() => {
                          void confirmDeleteReport(item);
                        }}
                      />
                    </View>
                  </View>
                ))}
              </View>
            ) : errorMessage ? null : (
              // Suppressed while `errorMessage` is set: the catch in
              // loadData nulls the profile, so a failed request and an
              // empty account produce the identical empty list — and
              // the page was stacking「加载失败」on top of「还没有上传
              // 报告」, which is the app telling the patient their
              // uploads are gone.
              <View style={styles.stateWrap}>
                <Text style={styles.stateText}>
                  {activeReportCategory === '全部'
                    ? '还没有上传报告，进入「记录数据」页添加后，这里会自动按分类和时间整理。'
                    : `当前没有“${activeReportCategory}”分类的报告。`}
                </Text>
                {/* Tinted: the header's 添加报告 is already on screen,
                    filled, going to the same place. Two filled accent
                    buttons with one destination was every new user's
                    first view of this screen. The header's is the
                    standing primary across all filter states; this one
                    sits under a sentence that explains it and doesn't
                    need fill to be found. */}
                <Button
                  label="去添加报告"
                  icon="plus"
                  variant="tinted"
                  onPress={() => router.push('/p-data_entry')}
                />
              </View>
            )}
          </View>
        </ScrollView>

        {isLoading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={COLOR.accent} />
            <Text style={styles.loadingText}>正在整理报告管理视图...</Text>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
