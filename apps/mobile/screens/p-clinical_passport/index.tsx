import { COLOR, INTERACTION } from '../../lib/design';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Button from '../common/Button';
import SegmentedControl from '../common/SegmentedControl';
import AnswerText from '../common/AnswerText';
import Icon from '../common/Icon';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import styles from './styles';
import HumanBodyFigure from '../common/HumanBodyFigure';
import ScreenHeader from '../common/ScreenHeader';
import { useAppDialog } from '../common/feedback/AppDialog';
import SystemMonitoringPanels from '../common/SystemMonitoringPanels';
import TimelineSectionCard from '../common/TimelineSectionCard';
import {
  ApiError,
  getClinicalPassportSummary,
  getMyPatientProfile,
  isConsentRequiredError,
  type ClinicalPassportSummary,
  type PatientProfile,
  type StreamAiQuestionHandle,
} from '../../lib/api';
import { streamAiQuestion } from '../../lib/ai-streaming';
import { VISIT_PREP_NOTE_KEY } from '../../lib/draft-keys';
import { getSessionValue, setSessionValue } from '../../lib/session-storage';
import type { BodyRegionMap } from '../../lib/clinical-visuals';
import { buildClinicalPassportPdfHtml } from '../../lib/clinical-passport-pdf';
import { buildAnesthesiaCard } from '../../lib/anesthesia-card';
import { renderAnesthesiaCardPng, type RenderedCard } from '../../lib/anesthesia-card-image';
import { buildLatestMriVisualization, buildReportInsights } from '../../lib/report-insights';
import { formatDateLabel } from '../../lib/clinical-visuals';

const getFreshnessColors = (tone: ClinicalPassportSummary['diagnosis']['freshness']['tone']) => {
  switch (tone) {
    case 'success':
      return {
        backgroundColor: COLOR.goodWash,
        color: COLOR.good,
      };
    case 'warning':
      return {
        backgroundColor: COLOR.warnWash,
        color: COLOR.warn,
      };
    case 'danger':
      return {
        backgroundColor: COLOR.alertWash,
        color: COLOR.alert,
      };
    default:
      return {
        backgroundColor: COLOR.well,
        color: COLOR.inkMuted,
      };
  }
};

const createProgressId = () =>
  `passport_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const VISIT_PREP_QUESTION =
  '我下次要去看门诊。请根据我最近的记录和检查报告，整理三部分内容：' +
  '一、这段时间发生了什么变化；二、建议向医生确认的问题（最多三个）；' +
  '三、需要带去的报告。用简短的条目，不要给治疗建议。';

/** Full date, not the MM-DD `formatDateLabel` used elsewhere on this
 *  screen: a prep note the patient is reading in a waiting room is
 *  worth acting on only if they can tell it was drafted this week
 *  rather than before the last appointment. */
const formatVisitPrepTimestamp = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day} ${hour}:${minute}`;
};

const ClinicalPassportScreen = () => {
  const router = useRouter();
  const { notify } = useAppDialog();
  const [passport, setPassport] = useState<ClinicalPassportSummary | null>(null);
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [bodyView, setBodyView] = useState<'front' | 'back'>('front');
  // 门诊准备: generated on demand, not on load. It costs an LLM round
  // trip and it's only wanted when a visit is actually coming up —
  // auto-generating on every open would spend tokens on the many
  // times this page gets opened just to show someone the diagnosis.
  const [visitPrep, setVisitPrep] = useState<string | null>(null);
  const [visitPrepGeneratedAt, setVisitPrepGeneratedAt] = useState<string | null>(null);
  const [visitPrepStream, setVisitPrepStream] = useState('');
  const [visitPrepBusy, setVisitPrepBusy] = useState(false);
  const [visitPrepError, setVisitPrepError] = useState<string | null>(null);
  const visitPrepHandleRef = useRef<StreamAiQuestionHandle | null>(null);
  // Deltas also land in a ref so `onComplete` can read the accumulated
  // text synchronously. Reading it out of a setState updater instead
  // would mean calling setState from inside another setState updater,
  // which React may replay.
  const visitPrepStreamRef = useRef('');

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
      // The card embeds the patient's latest FVC and diagnosis state.
      // Keeping a previously rendered one after a reload would hand an
      // anesthetist a stale reading with a current-looking date on it.
      setAnesthesiaCard(null);
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

  // Rehydrate the last prep note. The point of persisting it is the
  // trip itself: the note is drafted at home where there is signal and
  // read in the waiting room where there may not be. Before this it
  // lived in useState only, so walking to the hospital — or just
  // switching tabs — meant regenerating, which burns another LLM call
  // and comes back worded differently from the version the patient
  // already rehearsed.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let raw: string | null = null;
      try {
        raw = await getSessionValue(VISIT_PREP_NOTE_KEY);
      } catch {
        // SecureStore unavailable on this device. Nothing to restore;
        // the empty state below is a correct fallback, and surfacing a
        // storage error here would be noise on a screen the patient
        // opened to read their diagnosis.
        return;
      }
      if (cancelled || !raw) return;
      try {
        const parsed = JSON.parse(raw) as { text?: unknown; generatedAt?: unknown };
        if (typeof parsed.text !== 'string' || !parsed.text.trim()) return;
        setVisitPrep(parsed.text);
        setVisitPrepGeneratedAt(typeof parsed.generatedAt === 'string' ? parsed.generatedAt : null);
      } catch {
        // Corrupt payload (interrupted write, older shape). Drop it
        // rather than half-render it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // An in-flight stream outlives the screen otherwise, and the answer
  // nobody will read still costs tokens upstream.
  useEffect(
    () => () => {
      visitPrepHandleRef.current?.close();
      visitPrepHandleRef.current = null;
    },
    [],
  );

  const settleVisitPrep = (text: string) => {
    const generatedAt = new Date().toISOString();
    setVisitPrep(text);
    setVisitPrepGeneratedAt(generatedAt);
    // The write can genuinely fail — SecureStore rejects values over
    // ~2KB on Android, and a long three-part note gets close. Say so
    // rather than swallowing it: a patient who believes the note is
    // saved will close the app and walk to the hospital with nothing,
    // which is worse than being told now while there is still signal to
    // screenshot it.
    void setSessionValue(VISIT_PREP_NOTE_KEY, JSON.stringify({ text, generatedAt })).catch(() => {
      setVisitPrepError('这份没能存到本机，离开这个页面后要重新整理，建议先截图或导出 PDF。');
    });
  };

  /**
   * Draft the「下次门诊要说什么」note.
   *
   * Deliberately routed through the ordinary /ai/ask orchestrator
   * rather than a bespoke endpoint: this is exactly the question the
   * planner already has tools for (get_my_profile + get_my_reports),
   * and reusing it means the note inherits consent gating, PII
   * redaction and the prompt audit row for free. A second pipeline
   * would be a second place for those guarantees to drift.
   *
   * Streamed rather than awaited on the blocking /ai/ask. That endpoint
   * was the last non-streaming AI caller in the app and its client
   * deadline never matched the server: planner + tools + final answer
   * are 30s each and the OpenAI SDK retries twice, so a worst case runs
   * past 180s against a 60s client timeout. Every one of those runs
   * aborted a request the server was still paying for and told the
   * patient nothing had happened. Streaming replaces the guess with the
   * SSE keepalive watchdog, and — the part that matters at the point of
   * use — puts words on screen in the first second instead of a spinner
   * for a minute.
   */
  const handleGenerateVisitPrep = () => {
    if (visitPrepBusy) return;
    visitPrepHandleRef.current?.close();
    visitPrepStreamRef.current = '';
    setVisitPrepStream('');
    setVisitPrepError(null);
    setVisitPrepBusy(true);

    // A failed regenerate leaves the saved note untouched, and saying so
    // is the difference between「重试」and「我刚才的东西没了」. Only true
    // on a regenerate, so don't promise it on the first run.
    const keptNoteHint = visitPrep ? '已保存的那份还在。' : '';

    visitPrepHandleRef.current = streamAiQuestion(VISIT_PREP_QUESTION, createProgressId(), {
      onEvent: (event) => {
        if (event.type === 'answer_delta') {
          visitPrepStreamRef.current += event.text;
          setVisitPrepStream(visitPrepStreamRef.current);
        } else if (event.type === 'error') {
          setVisitPrepError(event.message);
        }
      },
      onComplete: (data) => {
        visitPrepHandleRef.current = null;
        setVisitPrepBusy(false);
        // The `done` frame carries the authoritative answer; deltas can
        // be dropped by a flaky connection, so only fall back to what
        // we accumulated when the payload has nothing.
        const settled = data?.answer?.trim() || visitPrepStreamRef.current.trim();
        visitPrepStreamRef.current = '';
        setVisitPrepStream('');
        if (settled) {
          settleVisitPrep(settled);
          return;
        }
        // A null payload means the stream ended without `done`. Don't
        // overwrite the note already on file — the previous draft is
        // still the best thing the patient can walk into the room with.
        setVisitPrepError(
          (prev) =>
            prev ??
            (data
              ? `这次没能整理出内容，再点一次就行。${keptNoteHint}`
              : `整理没做完就中断了，再点一次就行。${keptNoteHint}`),
        );
      },
      onError: (error) => {
        visitPrepHandleRef.current = null;
        visitPrepStreamRef.current = '';
        setVisitPrepStream('');
        setVisitPrepBusy(false);
        setVisitPrepError(
          isConsentRequiredError(error)
            ? '需要先在「我的 › 隐私设置」里同意 AI 使用你的数据。'
            : error instanceof ApiError && error.status
              ? error.message
              : // Transport failures used to surface as「请求超时，请检查
                // 网络后重试」. The slow half is the model, not the
                // patient's WiFi, and sending someone to go check their
                // router for a server-side stall is both wrong and the
                // kind of instruction this cohort can least afford to
                // act on.
                `整理服务这会儿没响应，稍后再点一次。${keptNoteHint}`,
        );
      },
    });
  };

  const handleCancelVisitPrep = () => {
    if (!visitPrepBusy) return;
    // `close()` suppresses the stream's own callbacks, so unwind here.
    // The partial text is discarded rather than kept: half a sentence
    // is not a prep note, and `visitPrep` still holds the last complete
    // one.
    visitPrepHandleRef.current?.close();
    visitPrepHandleRef.current = null;
    visitPrepStreamRef.current = '';
    setVisitPrepStream('');
    setVisitPrepBusy(false);
    setVisitPrepError(null);
  };

  const handleExport = async () => {
    if (!passport?.hasRecordedData) {
      notify({
        title: '无法导出',
        message: '当前没有足够的护照数据可供导出，先记录一次数据或上传一份报告。',
        tone: 'info',
      });
      return;
    }

    try {
      setIsExporting(true);
      // The prep note travels with the passport when it exists — a
      // printout handed across the desk should carry the same thing
      // the patient was reading on the way in.
      const html = buildClinicalPassportPdfHtml(passport, visitPrep);

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
      // The popup-blocker branch above throws its instructions through
      // here. On web that message was previously swallowed entirely,
      // so a blocked print window looked like a dead button.
      notify({ title: '导出失败', message, tone: 'error' });
    } finally {
      setIsExporting(false);
    }
  };

  // During a regenerate the previously saved note stays on screen until
  // the first delta arrives, so the card never blanks out on someone
  // who is standing in a corridor about to be called in.
  const visitPrepDisplayText = visitPrepBusy && visitPrepStream ? visitPrepStream : visitPrep;
  const visitPrepTimestamp = formatVisitPrepTimestamp(visitPrepGeneratedAt);

  const diagnosisFreshnessStyle = useMemo(
    () => getFreshnessColors(passport?.diagnosis.freshness.tone ?? 'neutral'),
    [passport?.diagnosis.freshness.tone],
  );

  const heroMetrics = useMemo(() => {
    if (!passport) return [];
    const metrics = passport.metrics.filter((item) => item.label !== '肌力组数');
    metrics.splice(2, 0, {
      label: '最近记录',
      value: formatDateLabel(passport.motor.latestActivityAt ?? passport.motor.latestMeasurementAt),
      hint: passport.motor.activitySummary || '暂无日常记录变化摘要',
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
  // Two lists, not one. 「补上传一份 MRI」 and 「问一次眼底检查」 are
  // different kinds of instruction and the second one stops meaning
  // what it says the moment it sits under a data-completeness heading.
  const recordSteps = useMemo(
    () => (passport?.nextSteps ?? []).filter((step) => step.kind === 'record'),
    [passport],
  );
  const [anesthesiaCard, setAnesthesiaCard] = useState<RenderedCard | null>(null);
  const [anesthesiaCardError, setAnesthesiaCardError] = useState<string | null>(null);

  const handleGenerateAnesthesiaCard = () => {
    if (!passport) return;
    setAnesthesiaCardError(null);
    // Canvas only exists on web, and this app reaches patients as a
    // web export. Say so plainly rather than leaving a button that
    // does nothing when it is opened in the native shell.
    const rendered = renderAnesthesiaCardPng(buildAnesthesiaCard(passport, new Date()));
    if (!rendered) {
      setAnesthesiaCardError('这台设备上暂时无法生成图片，请在浏览器里打开本页面后重试。');
      return;
    }
    setAnesthesiaCard(rendered);
  };

  const clinicalSteps = useMemo(
    () => (passport?.nextSteps ?? []).filter((step) => step.kind === 'clinical'),
    [passport],
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
      {/* Flat paper, not the sand gradient. CLINICAL_GRADIENTS.page is
          ['#F8F2EA', …], the palette lib/design.ts explicitly rejected
          — its own comment says #F8F2EA "pulled yellow enough to grey
          out the teal sitting on it" — so the last four screens using
          it were painting their page in the rejected colour underneath
          the accent it greys out. */}
      <View style={styles.backgroundGradient}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* The PDF action rides in ScreenHeader's `right` slot, so
              back / title / export / home all sit on one row and this
              screen picks up the home control the rest of the stack
              has. */}
          <ScreenHeader
            title="FSHD 临床护照"
            style={styles.header}
            right={
              <TouchableOpacity
                style={styles.headerAction}
                activeOpacity={INTERACTION.pressOpacity}
                accessibilityRole="button"
                accessibilityLabel="导出临床护照 PDF"
                onPress={handleExport}
                disabled={isExporting || !passport?.hasRecordedData}
              >
                {isExporting ? (
                  <ActivityIndicator size="small" color={COLOR.accent} />
                ) : (
                  <Icon
                    name="file-pdf"
                    size={14}
                    color={passport?.hasRecordedData ? COLOR.accent : COLOR.inkMuted}
                  />
                )}
              </TouchableOpacity>
            }
          />

          {errorMessage && !passport ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>护照数据暂时不可用</Text>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          {/* The hero fill was CLINICAL_GRADIENTS.surface, from the same
              rejected palette. styles.heroCard already carries
              SURFACE.cardAccent, which is what every other hero uses. */}
          <View style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <View style={styles.heroCopyBlock}>
                <Text style={styles.heroEyebrow}>CLINICAL PASSPORT</Text>
                {/* `?? '未命名病例'` / `?? '待生成'` are answers about
                    the record, and `passport` is also null while the
                    fetch is in flight and after it fails — so a patient
                    with a full passport saw 「未命名病例 · 待生成」 every
                    time this screen opened, and kept seeing it if the
                    request failed. The metric line below was fixed for
                    exactly this and the title was left behind. */}
                <Text style={styles.heroTitle}>
                  {passport?.patientName ?? (isLoading || errorMessage ? '—' : '未命名病例')}
                </Text>
                <Text style={styles.heroPassportId}>
                  {passport?.passportId ??
                    (isLoading ? '读取中' : errorMessage ? '暂时读不到' : '待生成')}
                </Text>
                <Text style={styles.heroSubtitle}>
                  汇总诊断、影像、检查结果和时间轴，方便门诊、住院或研究登记时快速出示。
                </Text>
              </View>
              <View style={styles.heroStatusPill}>
                <Text style={styles.heroStatusText}>
                  {passport
                    ? `${passport.completion.completed}/${passport.completion.total} 已完成`
                    : errorMessage
                      ? '读取失败'
                      : '整理中'}
                </Text>
              </View>
            </View>

            <View style={styles.heroMetaRow}>
              <View style={styles.heroMetaChip}>
                <Icon name="clock" size={12} color={COLOR.accent} />
                <Text style={styles.heroMetaText}>
                  最近更新 {formatDateLabel(passport?.latestUpdatedAt)}
                </Text>
              </View>
              <View style={styles.heroMetaChip}>
                <Icon name="file-lines" size={12} color={COLOR.accent} />
                {/* `?? '0'` answered "the passport hasn't loaded" with
                    the number zero — a factual claim about the
                    patient's account, made on the screen they export
                    for a clinician. An em dash says nothing instead. */}
                <Text style={styles.heroMetaText}>
                  {passport
                    ? `${passport.metrics.find((item) => item.label === '报告数')?.value ?? '0'} 份来源报告`
                    : '报告数 —'}
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

            {/* Both tinted, not prominent. These are shortcuts to
                things that have their own sections further down — the
                export card owns 生成 PDF, which is this screen's one
                prominent action. Before this they were hand-rolled
                Touchables with no accessibilityRole and no label at
                all: a screen reader reached two unnamed controls. */}
            <View style={styles.heroActionRow}>
              <Button
                label="去补录数据"
                variant="tinted"
                compact
                onPress={() => router.push('/p-data_entry')}
              />
              <Button
                label="导出 PDF"
                icon="file-pdf"
                variant="tinted"
                compact
                busy={isExporting}
                disabled={!passport?.hasRecordedData}
                accessibilityHint="生成临床护照 PDF，可保存、打印或发送给医生"
                onPress={handleExport}
              />
            </View>
          </View>

          {isLoading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={COLOR.accent} />
              <Text style={styles.loadingText}>正在整理临床护照摘要...</Text>
            </View>
          ) : null}

          {/* 门诊准备 — sits above the passport proper because it's the
              part with a deadline. Kept visually distinct (dashed
              border, explicit attribution) so nobody mistakes a drafted
              summary for recorded clinical data. */}
          {passport?.hasRecordedData ? (
            <View style={styles.visitPrepCard}>
              <View style={styles.visitPrepHeader}>
                <Icon name="clipboard-list" size={14} color={COLOR.accent} />
                <Text style={styles.visitPrepTitle}>门诊准备</Text>
              </View>

              {visitPrepDisplayText ? (
                <>
                  <AnswerText style={styles.visitPrepBody}>{visitPrepDisplayText}</AnswerText>
                  {/* While a regenerate streams, the timestamp still
                      describes the saved note, so hide it until the new
                      one settles rather than dating fresh text with an
                      old time. */}
                  {!visitPrepBusy && visitPrepTimestamp ? (
                    <Text style={styles.visitPrepMeta}>生成于 {visitPrepTimestamp}</Text>
                  ) : null}
                  <Text style={styles.visitPrepFootnote}>
                    由 AI 依据你的记录整理，供与医生沟通使用，不是诊断意见。导出 PDF 时会一并带上。
                  </Text>
                </>
              ) : (
                <Text style={styles.visitPrepHint}>
                  整理出「这段时间的变化 + 建议向医生确认的问题 + 需要带的报告」，
                  就诊前看一眼就知道要说什么。整理好的内容会留在本机，下次打开还在。
                </Text>
              )}

              {visitPrepBusy ? (
                <>
                  <View style={styles.visitPrepStatusRow}>
                    <ActivityIndicator size="small" color={COLOR.accent} />
                    <Text style={styles.visitPrepStatusText}>
                      {visitPrepStream ? '正在整理，内容会边写边出…' : '正在读你的记录和报告…'}
                    </Text>
                  </View>
                  <Button
                    label="中止"
                    icon="stop"
                    variant="destructive"
                    compact
                    accessibilityLabel="中止整理门诊准备"
                    onPress={handleCancelVisitPrep}
                  />
                </>
              ) : visitPrep ? (
                <Button
                  label="重新整理"
                  icon="rotate-right"
                  variant="tinted"
                  onPress={handleGenerateVisitPrep}
                />
              ) : (
                <Button
                  label="生成门诊准备"
                  icon="wand-magic-sparkles"
                  variant="tinted"
                  onPress={handleGenerateVisitPrep}
                />
              )}

              {visitPrepError ? <Text style={styles.visitPrepError}>{visitPrepError}</Text> : null}
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
                      主要基于 MRI 报告和最近日常记录变化，不再展示主观肌力体图。
                    </Text>
                  </View>
                </View>

                <SegmentedControl
                  segments={[
                    { key: 'front', label: '正面' },
                    { key: 'back', label: '背面' },
                  ]}
                  value={bodyView}
                  onChange={(key) => setBodyView(key as 'front' | 'back')}
                  accessibilityLabel="MRI 受累分布视角"
                  style={styles.segmentRow}
                />

                <View style={styles.figureStack}>
                  <View style={styles.figureShell}>
                    <View style={styles.noteCard}>
                      <Text style={styles.noteTitle}>最近功能变化</Text>
                      <Text style={styles.noteText}>
                        {passport.motor.activitySummary || '暂无活动或日常记录变化摘要。'}
                      </Text>
                    </View>
                    <View style={styles.infoGrid}>
                      <View style={styles.infoCell}>
                        <Text style={styles.infoLabel}>最近记录</Text>
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
                            : '等待 MRI 识别结果'}
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
                    emptyText="检查报告识别出关键指标后，会自动归入这里。"
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
                      最近记录、事件和报告会统一整理在这里，展开后可点击卡片查看详情。
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
                  {recordSteps.length === 0 ? (
                    <View style={styles.gapCard}>
                      <Text style={styles.gapTitle}>当前没有明显缺口</Text>
                      <Text style={styles.gapDescription}>
                        诊断、功能、影像和检查结果四个维度都已形成基础摘要。
                      </Text>
                    </View>
                  ) : (
                    recordSteps.map((step) => (
                      <View key={step.title} style={styles.gapCard}>
                        <View style={styles.gapTopRow}>
                          <Icon name="triangle-exclamation" size={13} color={COLOR.warn} />
                          <Text style={styles.gapTitle}>{step.title}</Text>
                        </View>
                        <Text style={styles.gapDescription}>{step.description}</Text>
                      </View>
                    ))
                  )}
                </View>

                {/* Skipped by the Button migration this file's own
                    header comment claims finished. */}
                <Button
                  label="去数据录入补齐"
                  trailingIcon="arrow-right"
                  variant="tinted"
                  compact
                  onPress={() => router.push('/p-data_entry')}
                />
              </View>

              {/* Guideline recommendations, kept out of the card above.
                  Nothing here is a hole in your records and none of it
                  is fixed by uploading a file, so it gets neither the
                  warning triangle nor the 「去数据录入补齐」 button —
                  both of which would send a patient to an upload form
                  to resolve 「问一次眼底检查」. */}
              {clinicalSteps.length > 0 ? (
                <View style={styles.supportCard}>
                  <View style={styles.cardHeadingRow}>
                    <View>
                      <Text style={styles.cardTitle}>值得和医生提一句</Text>
                      <Text style={styles.cardSubtitle}>
                        根据 FSHD 诊疗指南，结合你已录入的信息给出。不是急事，也不用现在做什么 ——
                        下次就诊时问一下就好。
                      </Text>
                    </View>
                  </View>

                  <View style={styles.gapList}>
                    {clinicalSteps.map((step) => (
                      <View key={step.title} style={styles.gapCard}>
                        <View style={styles.gapTopRow}>
                          <Icon name="user-doctor" size={13} color={COLOR.accent} />
                          <Text style={styles.gapTitle}>{step.title}</Text>
                        </View>
                        <Text style={styles.gapDescription}>{step.description}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={styles.exportCard}>
                <View style={styles.cardHeadingRow}>
                  <View>
                    <Text style={styles.cardTitle}>导出临床护照</Text>
                    <Text style={styles.cardSubtitle}>生成 PDF，便于保存、打印或发送给医生。</Text>
                  </View>
                </View>

                <Button
                  label="生成 PDF"
                  icon="file-pdf"
                  variant="prominent"
                  fullWidth
                  busy={isExporting}
                  disabled={!passport.hasRecordedData}
                  accessibilityHint="导出临床护照 PDF，可保存、打印或发送给医生"
                  onPress={handleExport}
                />
              </View>

              {/* A picture, not a PDF and not a print dialog. This gets
                  used by showing a phone to an anesthetist, or by
                  having it in the photo roll where no network is
                  needed. A lot of these patients open the site inside
                  WeChat's browser, which has no print dialog and turns
                  a PDF into a viewer they then have to escape. */}
              <View style={styles.exportCard}>
                <View style={styles.cardHeadingRow}>
                  <View>
                    <Text style={styles.cardTitle}>麻醉注意事项卡</Text>
                    <Text style={styles.cardSubtitle}>
                      要做手术或胃肠镜时给麻醉医师看。生成一张图片，长按可保存到相册。
                    </Text>
                  </View>
                </View>

                {anesthesiaCard ? (
                  <>
                    <Image
                      source={{ uri: anesthesiaCard.uri }}
                      // From the render, not a guess: the height falls
                      // out of how the clinical text wraps.
                      style={[
                        styles.anesthesiaCardImage,
                        { aspectRatio: anesthesiaCard.width / anesthesiaCard.height },
                      ]}
                      resizeMode="contain"
                      accessibilityLabel="FSHD 麻醉注意事项卡"
                    />
                    <Text style={styles.cardSubtitle}>长按图片即可保存到手机相册。</Text>
                  </>
                ) : (
                  <Button
                    label="生成麻醉卡"
                    icon="image"
                    variant="tinted"
                    fullWidth
                    accessibilityHint="生成一张可保存的图片，供手术前给麻醉医师查看"
                    onPress={handleGenerateAnesthesiaCard}
                  />
                )}
                {anesthesiaCardError ? (
                  <Text style={styles.cardSubtitle}>{anesthesiaCardError}</Text>
                ) : null}
              </View>
            </>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

export default ClinicalPassportScreen;
