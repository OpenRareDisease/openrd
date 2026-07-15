import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ApiError,
  deletePatientDocument,
  generatePatientDocumentSummary,
  getMyConsent,
  getPatientDocumentOcr,
  reparsePatientDocument,
  updateMyConsent,
  type PatientDocument,
} from '../../lib/api';
import { bumpConsentEpoch } from '../../lib/consent-epoch';
import {
  CLINICAL_COLORS,
  CLINICAL_GRADIENTS,
  inferMriBodyMap,
  inferReportKind,
  type BodyView,
} from '../../lib/clinical-visuals';
import { buildReportInsights, getSystemPanelHeroMetrics } from '../../lib/report-insights';
import styles from './styles';
import { shouldAutoSummarize } from './auto-summary';
import InlineNotice from '../common/feedback/InlineNotice';
import HumanBodyFigure from '../common/HumanBodyFigure';
import ScreenBackButton from '../common/ScreenBackButton';
import SystemMonitoringPanels from '../common/SystemMonitoringPanels';

type OcrPayload = NonNullable<PatientDocument['ocrPayload']>;
type DebugPayload = OcrPayload & {
  aiExtraction?: unknown;
  ai_extraction?: unknown;
  extracted_text?: string;
};

const getAnalysisStatus = (payload: OcrPayload | null) => {
  const status = payload?.fields?.analysisStatus ?? payload?.fields?.analysis_status;
  return typeof status === 'string' ? status : undefined;
};

const isProcessing = (payload: OcrPayload | null) => {
  const status = getAnalysisStatus(payload);
  return status === 'processing' || status === 'pending';
};

const pickField = (fields: Record<string, string> | undefined, keys: string[]) => {
  if (!fields) return undefined;
  for (const key of keys) {
    const raw = fields[key];
    if (raw === null || raw === undefined) continue;
    const text = String(raw).trim();
    if (text) return text;
  }
  return undefined;
};

const formatKindLabel = (kind: string) => {
  switch (kind) {
    case 'genetic':
      return '基因报告';
    case 'mri':
      return 'MRI / 影像';
    case 'lab':
      return '实验室';
    case 'monitoring':
      return '监测资料';
    case 'strength':
      return '肌力评估';
    default:
      return '综合报告';
  }
};

export default function ReportDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const documentId = useMemo(() => {
    const raw = params.documentId;
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params.documentId]);

  const poller = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [payload, setPayload] = useState<OcrPayload | null>(null);
  const [docStatus, setDocStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  // Recoverable failures render inline (three-way feedback split);
  // the summary one keeps a retry since regeneration is idempotent.
  const [summaryNotice, setSummaryNotice] = useState<string | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [summary, setSummary] = useState<string>('');
  const [bodyView, setBodyView] = useState<BodyView>('front');
  // The poll gave up (10 min) without the parse settling — the job is
  // almost certainly lost; offer「重新识别」instead of spinning forever.
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [isReparsing, setIsReparsing] = useState(false);
  const [reparseNotice, setReparseNotice] = useState<string | null>(null);
  // Bumping this restarts the load+poll effect (used after a reparse).
  const [pollNonce, setPollNonce] = useState(0);
  // AI consent drives interpretation automation: 'granted' →
  // summaries generate themselves once the parse settles; 'none' →
  // an unlock card explains what turning it on buys.
  const [aiConsent, setAiConsent] = useState<'unknown' | 'granted' | 'none'>('unknown');
  const [isGrantingConsent, setIsGrantingConsent] = useState(false);
  // One auto-trigger per screen visit: a failed generation degrades
  // to the manual button instead of retry-looping LLM calls.
  const autoSummaryTriggeredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getMyConsent()
      .then((consent) => {
        if (!cancelled) setAiConsent(consent.level === 'none' ? 'none' : 'granted');
      })
      .catch(() => {
        // 404 (no profile) or transient failure: treat as not granted
        // — the unlock card's grant call will surface a real error.
        if (!cancelled) setAiConsent('none');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = async (id: string) => {
    const res = await getPatientDocumentOcr(id);
    const next = res.ocrPayload ?? null;
    setPayload(next);
    setDocStatus(res.status ?? null);
    const maybeSummary = next?.fields?.aiSummary;
    setSummary(typeof maybeSummary === 'string' ? maybeSummary : '');
    return res;
  };

  // "Still parsing" = the document ROW says processing (async
  // pipeline keeps the payload null while the job runs). The old
  // payload-based analysisStatus check stays as a fallback for
  // pre-async rows whose payload carried the transient state.
  const isDocumentProcessing = (status: string | null | undefined, ocrPayload: OcrPayload | null) =>
    status === 'processing' || isProcessing(ocrPayload);

  useEffect(() => {
    if (!documentId) {
      setIsLoading(false);
      setErrorMessage('缺少 documentId');
      return;
    }

    let cancelled = false;

    const start = async () => {
      try {
        setIsLoading(true);
        setErrorMessage(null);
        setPollTimedOut(false);
        const first = await load(documentId);
        if (cancelled) return;

        const startedAt = Date.now();
        const tick = async () => {
          try {
            const refreshed = await load(documentId);
            if (!isDocumentProcessing(refreshed.status, refreshed.ocrPayload ?? null)) {
              poller.current = null;
              return;
            }
          } catch {
            // retry on next poll
          }

          if (Date.now() - startedAt > 10 * 60 * 1000) {
            poller.current = null;
            setPollTimedOut(true);
            return;
          }

          poller.current = setTimeout(tick, 2000);
        };

        if (isDocumentProcessing(first.status, first.ocrPayload ?? null)) {
          poller.current = setTimeout(tick, 1200);
        }
      } catch (error) {
        const message = error instanceof ApiError ? error.message : '无法获取报告详情';
        setErrorMessage(message);
        setPayload(null);
      } finally {
        setIsLoading(false);
      }
    };

    start();

    return () => {
      cancelled = true;
      if (poller.current) {
        clearTimeout(poller.current);
        poller.current = null;
      }
    };
  }, [documentId, pollNonce]);

  /** 重新识别: flip the row back to processing server-side, then
   *  restart the whole load+poll cycle via the nonce. */
  const handleReparse = async () => {
    if (!documentId || isReparsing) return;
    setIsReparsing(true);
    setReparseNotice(null);
    try {
      await reparsePatientDocument(documentId);
      setPayload(null);
      setDocStatus('processing');
      setPollTimedOut(false);
      setPollNonce((n) => n + 1);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '重新识别失败，请稍后重试';
      setReparseNotice(message);
    } finally {
      setIsReparsing(false);
    }
  };

  const fields = payload?.fields ?? undefined;
  // Prefer the document-row status: under the async pipeline the
  // payload (and its analysisStatus) is null for the entire parse,
  // which used to surface as a bare "unknown" in the hero chip.
  const status = docStatus ?? getAnalysisStatus(payload) ?? 'unknown';
  const reportKind = inferReportKind(payload);
  const mriInference = useMemo(() => inferMriBodyMap(payload), [payload]);
  const activeRegions = mriInference.regions;
  const activeSummary = mriInference.findings;
  const relevantSystemPanels = useMemo(() => {
    if (!payload) return [];
    const classifiedType = pickField(fields, [
      'classifiedType',
      'classified_type',
      'reportType',
      'report_type',
    ]);
    const reportTime = pickField(fields, ['reportTime', 'report_time']);
    const insights = buildReportInsights([
      {
        documentType: classifiedType ?? 'other',
        uploadedAt: reportTime ?? new Date().toISOString(),
        ocrPayload: payload,
      },
    ]);

    return insights.systemPanels.filter(
      (panel) => panel.metrics.length > 0 || panel.coverage.length > 0,
    );
  }, [fields, payload]);

  const structuredSections = useMemo(() => {
    if (!fields) return [];
    const reportItems: Array<{ label: string; value?: string }> = [
      { label: '解析状态', value: status },
      { label: '识别类型', value: pickField(fields, ['classifiedType', 'classified_type']) },
      {
        label: '识别置信度',
        value: pickField(fields, ['classifiedTypeConfidence', 'classified_type_confidence']),
      },
      { label: '报告时间', value: pickField(fields, ['reportTime', 'report_time']) },
      { label: '报告名称', value: pickField(fields, ['reportName', 'report_name']) },
      { label: '医院', value: pickField(fields, ['facility']) },
      { label: '科室', value: pickField(fields, ['department']) },
      { label: '标本', value: pickField(fields, ['specimen']) },
      { label: '送检医生', value: pickField(fields, ['orderingDoctor', 'ordering_doctor']) },
      { label: '患者姓名', value: pickField(fields, ['patientName']) },
      { label: '性别', value: pickField(fields, ['patientSex']) },
      { label: '年龄', value: pickField(fields, ['patientAge']) },
    ];

    const fshdItems: Array<{ label: string; value?: string }> = [
      {
        label: 'FSHD 分型',
        value: pickField(fields, [
          'diagnosisType',
          'geneType',
          'geneticType',
          'diagnosis_type',
          'genetic_type',
        ]),
      },
      { label: '单倍型', value: pickField(fields, ['haplotype', 'haplotype4q']) },
      {
        label: 'EcoRI',
        value: pickField(fields, [
          'ecoRIFragment',
          'ecoriFragmentKb',
          'ecori_fragment_kb',
          'EcoRI_kb',
          'ecoriFragment',
        ]),
      },
      {
        label: 'D4Z4 重复',
        value: pickField(fields, [
          'd4z4Repeats',
          'd4z4RepeatPathogenic',
          'd4z4_repeat_pathogenic',
          'd4z4_repeats',
        ]),
      },
      { label: '甲基化值', value: pickField(fields, ['methylationValue', 'methylation_value']) },
      { label: 'MRI 印象', value: pickField(fields, ['reportImpression', 'report_impression']) },
      {
        label: '腹部超声提示',
        value: pickField(fields, [
          'abdominalUltrasoundImpression',
          'abdominal_ultrasound_impression',
        ]),
      },
    ];

    return [
      { title: '报告信息', items: reportItems.filter((item) => item.value) },
      { title: 'FSHD 关键结果', items: fshdItems.filter((item) => item.value) },
    ].filter((section) => section.items.length > 0);
  }, [fields, status]);

  const highlightItems = useMemo(() => {
    const systemHighlights = relevantSystemPanels.flatMap((panel) =>
      getSystemPanelHeroMetrics(panel),
    );
    if (systemHighlights.length > 0) {
      return systemHighlights.slice(0, 4);
    }
    return structuredSections.flatMap((section) => section.items).slice(0, 4);
  }, [relevantSystemPanels, structuredSections]);

  const rawText = useMemo(() => {
    if (!payload) return '';
    const obj = payload as DebugPayload;
    const aiExtraction = obj.aiExtraction ?? obj.ai_extraction ?? null;
    const extractedText = obj.extractedText ?? obj.extracted_text ?? '';
    const compact = {
      fields: obj.fields ?? null,
      aiExtraction,
      extractedText:
        typeof extractedText === 'string' ? extractedText.slice(0, 4000) : extractedText,
    };
    try {
      return JSON.stringify(compact, null, 2);
    } catch {
      return String(compact);
    }
  }, [payload]);

  const onGenerateSummary = async () => {
    if (!documentId) return;
    try {
      setSummaryLoading(true);
      setSummaryNotice(null);
      const res = await generatePatientDocumentSummary(documentId);
      setSummary(res.summary);
      setPayload((prev) => {
        if (!prev) return prev;
        const nextFields = { ...(prev.fields ?? {}), aiSummary: res.summary };
        return { ...prev, fields: nextFields };
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '生成 AI 总结失败';
      setSummaryNotice(message);
    } finally {
      setSummaryLoading(false);
    }
  };

  // Interpretation automation: once the parse settles and AI consent
  // is granted, the summary generates itself — upload → recognize →
  // interpret with zero manual steps. The DECISION lives in
  // shouldAutoSummarize (pure, unit-tested — this path spends LLM
  // calls unattended, so every guard is load-bearing); the effect
  // only owns the timing. A failure degrades to the manual button
  // (summaryNotice already carries the retry).
  useEffect(() => {
    if (!documentId) return;
    const fire = shouldAutoSummarize({
      aiConsent,
      docStatus,
      hasPayload: payload !== null,
      isProcessing: isDocumentProcessing(docStatus, payload),
      hasSummary: Boolean(summary),
      summaryLoading,
      alreadyTriggered: autoSummaryTriggeredRef.current,
    });
    if (!fire) return;
    autoSummaryTriggeredRef.current = true;
    void onGenerateSummary();
    // onGenerateSummary is recreated per render but idempotent; the
    // decision function holds the real dependency story (this config
    // has no react-hooks lint plugin to appease).
  }, [aiConsent, payload, docStatus, summary, summaryLoading, documentId]);

  /** Unlock card: grant both required flags in one tap, then let the
   *  auto-trigger effect above take over and generate the summary. */
  const handleGrantAndSummarize = async () => {
    if (isGrantingConsent) return;
    setIsGrantingConsent(true);
    setSummaryNotice(null);
    try {
      await updateMyConsent({ personal: true, thirdParty: true });
      // Same rule as every consent surface: a change starts a new QnA
      // history epoch (see lib/consent-epoch.ts).
      await bumpConsentEpoch();
      setAiConsent('granted');
    } catch (error) {
      const detail =
        error instanceof ApiError && error.status === 404
          ? '请先在「我的 → 编辑档案」完成基础档案，再开启 AI 授权。'
          : error instanceof ApiError
            ? error.message
            : '授权失败，请稍后重试';
      setSummaryNotice(detail);
    } finally {
      setIsGrantingConsent(false);
    }
  };

  const runDelete = async () => {
    if (!documentId) return;

    try {
      setDeleteLoading(true);
      await deletePatientDocument(documentId);
      Alert.alert('已删除', '这份报告已移除，相关汇总会在返回后按最新数据重新计算。', [
        {
          text: '知道了',
          onPress: () => {
            router.replace('/p-report_management');
          },
        },
      ]);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '删除报告失败';
      setDeleteNotice(`删除失败：${message}`);
    } finally {
      setDeleteLoading(false);
    }
  };

  const onDelete = () => {
    Alert.alert('删除报告', '删除后将从病程、临床护照和汇总视图中移除，且无法恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: deleteLoading ? '删除中...' : '删除',
        style: 'destructive',
        onPress: () => {
          runDelete().catch(() => undefined);
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <ScreenBackButton />
          <View>
            <Text style={styles.eyebrow}>REPORT READER</Text>
            <Text style={styles.headerTitle}>报告详情</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <LinearGradient colors={CLINICAL_GRADIENTS.surface} style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.kindPill}>
              <Text style={styles.kindPillText}>{formatKindLabel(reportKind)}</Text>
            </View>
            <Text style={styles.statusText}>{status}</Text>
          </View>
          <Text style={styles.heroTitle}>
            {pickField(fields, ['reportName', 'report_name']) || '报告关键指标视图'}
          </Text>
          <Text style={styles.heroDescription}>
            documentId: {documentId ?? '--'}
            {isDocumentProcessing(docStatus, payload) && !pollTimedOut ? ' · 识别进行中' : ''}
          </Text>

          {isDocumentProcessing(docStatus, payload) && !pollTimedOut ? (
            <View style={styles.processingRow}>
              <ActivityIndicator size="small" color={CLINICAL_COLORS.accentStrong} />
              <Text style={styles.processingText}>
                正在识别这份报告，通常需要 1-2 分钟。可以先离开本页，识别完成后这里会自动更新。
              </Text>
            </View>
          ) : null}

          {docStatus === 'parse_failed' || pollTimedOut ? (
            <View style={{ marginTop: 12 }}>
              <InlineNotice
                message={
                  pollTimedOut
                    ? '识别时间超出预期，任务可能已中断。'
                    : '这份报告识别失败了，可以重新识别一次。'
                }
                onRetry={() => void handleReparse()}
                retryLabel="重新识别"
                retryDisabled={isReparsing}
              />
            </View>
          ) : null}
          {reparseNotice ? (
            <View style={{ marginTop: 8 }}>
              <InlineNotice message={reparseNotice} />
            </View>
          ) : null}

          <View style={styles.highlightGrid}>
            {highlightItems.length > 0 ? (
              highlightItems.map((item) => (
                <View key={item.label} style={styles.highlightItem}>
                  <Text style={styles.highlightLabel}>{item.label}</Text>
                  <Text style={styles.highlightValue}>{item.value}</Text>
                </View>
              ))
            ) : (
              <View style={styles.highlightItem}>
                <Text style={styles.highlightLabel}>提示</Text>
                <Text style={styles.highlightValue}>暂无识别出的关键指标</Text>
              </View>
            )}
          </View>
        </LinearGradient>

        {reportKind === 'mri' &&
          (Object.keys(activeRegions).length > 0 || activeSummary.length > 0) && (
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Text style={styles.cardTitle}>MRI 受累示意图</Text>
                <View style={styles.toggleRow}>
                  <TouchableOpacity
                    style={[styles.toggleChip, bodyView === 'front' && styles.toggleChipActive]}
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
                regions={activeRegions}
                mode="mri"
                subtitle="根据 MRI 报告正文和识别出的关键指标推断受累区域，重点突出分布与侧别信息。"
              />

              <View style={styles.tagWrap}>
                {activeSummary.length > 0 ? (
                  activeSummary.map((item) => (
                    <View key={item} style={styles.summaryTag}>
                      <Text style={styles.summaryTagText}>{item}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.smallText}>当前报告尚无可直接映射的人体区域。</Text>
                )}
              </View>
            </View>
          )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>识别出的关键信息</Text>
          {structuredSections.length === 0 ? (
            <Text style={styles.smallText}>暂无识别出的关键指标（或仍在识别中）。</Text>
          ) : (
            structuredSections.map((section) => (
              <View key={section.title} style={styles.structuredSection}>
                <Text style={styles.structuredSectionTitle}>{section.title}</Text>
                <View style={styles.structuredGrid}>
                  {section.items.map((item) => (
                    <View key={`${section.title}-${item.label}`} style={styles.structuredItem}>
                      <Text style={styles.structuredLabel}>{item.label}</Text>
                      <Text style={styles.structuredValue}>{item.value}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>检查结果</Text>
          <SystemMonitoringPanels
            panels={relevantSystemPanels}
            emptyText="这份报告暂无可归入检查结果的识别指标。"
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>AI 总结</Text>
          {summary ? (
            <>
              <Text style={styles.summaryText}>{summary}</Text>
              <Text style={[styles.smallText, { marginTop: 10 }]}>
                仅供参考，仍需结合医生判断。
              </Text>
              {/* Contextual AI entry: multi-turn chat is live, so the
                  natural next step after reading the summary is asking
                  about it — prefilled, user reviews and sends. */}
              <TouchableOpacity
                style={styles.toggleLink}
                onPress={() => {
                  const reportName = pickField(fields, ['reportName', 'report_name']);
                  router.push({
                    pathname: '/p-qna',
                    params: {
                      prefill: `请结合我最近上传的${
                        reportName ? `《${reportName}》` : '这份检查报告'
                      }，用通俗的话讲讲结果说明了什么、需要注意什么？`,
                      prefillNonce: String(Date.now()),
                    },
                  });
                }}
              >
                <Text style={styles.toggleLinkText}>继续问 AI 这份报告 →</Text>
              </TouchableOpacity>
            </>
          ) : aiConsent === 'none' && !isDocumentProcessing(docStatus, payload) ? (
            <>
              <Text style={styles.smallText}>
                开启 AI 授权后，每份识别完成的报告都会自动生成通俗解读，无需手动操作。AI
                会引用你档案与报告中已脱敏的内容，可随时在「隐私设置」撤回。
              </Text>
              {summaryNotice ? (
                <View style={{ marginTop: 12 }}>
                  <InlineNotice message={summaryNotice} />
                </View>
              ) : null}
              <View style={{ marginTop: 12 }}>
                <TouchableOpacity
                  style={[styles.button, isGrantingConsent && { opacity: 0.7 }]}
                  disabled={isGrantingConsent}
                  onPress={() => void handleGrantAndSummarize()}
                >
                  {isGrantingConsent ? (
                    <ActivityIndicator color={CLINICAL_COLORS.text} />
                  ) : (
                    <Text style={styles.buttonText}>开启 AI 授权，自动解读这份报告</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.smallText}>
                {aiConsent === 'granted' && !isDocumentProcessing(docStatus, payload)
                  ? '识别完成后会自动生成解读；也可以手动重新生成。'
                  : '当前报告暂无 AI 总结，可在识别完成后按需生成并缓存。'}
              </Text>
              {summaryNotice ? (
                <View style={{ marginTop: 12 }}>
                  <InlineNotice
                    message={summaryNotice}
                    onRetry={() => void onGenerateSummary()}
                    retryLabel="重新生成"
                    retryDisabled={summaryLoading}
                  />
                </View>
              ) : null}
              <View style={{ marginTop: 12 }}>
                <TouchableOpacity
                  style={[styles.button, summaryLoading && { opacity: 0.7 }]}
                  disabled={summaryLoading || isDocumentProcessing(docStatus, payload)}
                  onPress={onGenerateSummary}
                >
                  {summaryLoading ? (
                    <ActivityIndicator color={CLINICAL_COLORS.text} />
                  ) : (
                    <Text style={styles.buttonText}>
                      {isDocumentProcessing(docStatus, payload)
                        ? '识别完成后可生成'
                        : '生成 AI 总结'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>来源追溯</Text>
          <Text style={styles.smallText}>
            保留原始字段、AI 抽取结果和 OCR 文本，便于设计稿之外的临床核对。
          </Text>
          <TouchableOpacity style={styles.toggleLink} onPress={() => setShowRaw((value) => !value)}>
            <Text style={styles.toggleLinkText}>{showRaw ? '收起原始结果' : '展开原始结果'}</Text>
          </TouchableOpacity>
          {showRaw && (
            <View style={styles.codeBlock}>
              <Text style={styles.codeText}>{rawText}</Text>
            </View>
          )}
        </View>

        <View style={[styles.card, styles.dangerCard]}>
          <Text style={styles.cardTitle}>删除报告</Text>
          <Text style={styles.smallText}>
            如果这份报告传错了、识别错了，或只是重复上传，可以直接删除。删除后护照和病程摘要会按剩余数据重新计算。
          </Text>
          {deleteNotice ? (
            <View style={{ marginTop: 12 }}>
              <InlineNotice message={deleteNotice} />
            </View>
          ) : null}
          <TouchableOpacity
            style={[styles.button, styles.dangerButton, deleteLoading && styles.buttonDisabled]}
            disabled={deleteLoading}
            onPress={onDelete}
          >
            {deleteLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.dangerButtonText}>删除这份报告</Text>
            )}
          </TouchableOpacity>
        </View>

        {isLoading && (
          <View style={styles.inlineState}>
            <ActivityIndicator color={CLINICAL_COLORS.accent} />
            <Text style={styles.smallText}>正在加载报告内容...</Text>
          </View>
        )}

        {errorMessage && (
          <View style={styles.inlineState}>
            <Text style={styles.smallText}>{errorMessage}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
