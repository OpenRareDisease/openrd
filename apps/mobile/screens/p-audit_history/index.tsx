import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../common/Button';
import SegmentedControl from '../common/SegmentedControl';
import Icon from '../common/Icon';
import {
  ApiError,
  type AiAuditEntry,
  type AiAuditStatus,
  type ConsentEvent,
  type ConsentEventFlag,
  type ConsentEventSource,
  getMyAuditHistory,
  getMyConsentHistory,
} from '../../lib/api';
import { COLOR, INTERACTION } from '../../lib/design';
import ScreenBackButton from '../common/ScreenBackButton';
import styles from './styles';

const PAGE_SIZE = 50;
const CONSENT_HISTORY_LIMIT = 200;

type Tab = 'ai' | 'consent';

/**
 * The server-side scrubber (`scrubErrorDetail` in
 * ai-chat.routes.ts) covers pg parameter values, phone numbers, CN
 * ID cards, and email addresses — but it's pattern-based and not
 * intended to be an exhaustive catalogue of every future error shape
 * that might land in `errorDetail`. Renderering the raw string would
 * silently expand the user-visible surface as new error types reach
 * the audit row.
 *
 * Apply an allowlist on the client side: if the detail matches one
 * of a handful of known buckets, render the friendly Chinese label
 * the user can act on. Anything else collapses to a generic message
 * — the user can still see the timestamp + status, and the operator
 * has full server logs.
 */
const humanizeAiErrorDetail = (raw: string): string => {
  const value = (raw || '').toLowerCase();
  if (!value.trim()) return '';
  if (value.includes('consent') || value.includes('未同意') || value.includes('同意')) {
    return '需要先同意 AI 使用数据';
  }
  if (value.includes('rate') || value.includes('too many') || value.includes('过于频繁')) {
    return '请求过于频繁，请稍后再试';
  }
  if (value.includes('timeout') || value.includes('超时')) {
    return '服务响应超时，请稍后再试';
  }
  if (value.includes('ai 服务暂时不可用') || value.includes('ai_error') || value.includes('llm')) {
    return 'AI 服务暂时不可用';
  }
  if (value.includes('unauth') || value.includes('401')) {
    return '会话已过期，请重新登录';
  }
  if (value.includes('forbidden') || value.includes('403')) {
    return '没有访问权限';
  }
  return 'AI 服务异常，请重试或联系支持';
};

const STATUS_LABEL: Record<AiAuditStatus, string> = {
  success: '成功',
  error: '失败',
  consent_denied: '拒绝（未同意）',
};

/** Status is the only thing on this screen allowed to carry colour, so
 *  the three states stay clearly apart: green / red / grey, each with
 *  its matching wash for the chip behind it. */
const STATUS_COLOR: Record<AiAuditStatus, string> = {
  success: COLOR.good,
  error: COLOR.alert,
  consent_denied: COLOR.inkMuted,
};

const STATUS_WASH: Record<AiAuditStatus, string> = {
  success: COLOR.goodWash,
  error: COLOR.alertWash,
  consent_denied: 'transparent',
};

const CONSENT_LABEL: Record<string, string> = {
  none: '未同意',
  basic: '基础',
  precise: '精确',
};

const CONSENT_FLAG_LABEL: Record<ConsentEventFlag, string> = {
  personal: '个人数据用于 AI',
  third_party: '第三方 LLM 处理',
  precise_values: '精确数值授权',
};

const CONSENT_SOURCE_LABEL: Record<ConsentEventSource, string> = {
  user: '用户',
  admin: '运营',
  // "system" only appears today for auto-coerced precise→false when
  // the base pair drops; the longer label makes that obvious in the
  // UI without the user having to read the docs.
  system: '系统自动',
};

const CONSENT_SOURCE_COLOR: Record<ConsentEventSource, string> = {
  user: COLOR.accent,
  admin: COLOR.warn,
  system: COLOR.inkMuted,
};

const CONSENT_SOURCE_WASH: Record<ConsentEventSource, string> = {
  user: COLOR.accentWash,
  admin: COLOR.warnWash,
  system: 'transparent',
};

const formatRelative = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} 小时前`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD} 天前`;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const formatAbsolute = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}`;
};

/** Status / provenance badge. The only pill left on the screen — here
 *  the shape carries meaning, which is the bar this system sets. */
const StatusChip = ({ label, color, wash }: { label: string; color: string; wash: string }) => (
  <View style={[styles.statusChip, { borderColor: color, backgroundColor: wash }]}>
    <Text style={[styles.statusChipText, { color }]}>{label}</Text>
  </View>
);

/** One line of the AI call log.
 *
 *  Was a rounded card holding a grid of bordered mini-chips. Chips
 *  bought nothing here — every one of them is a plain value, and a
 *  dozen outlined boxes per entry is what made ten records fill three
 *  screens. Metadata is now a dot-separated line; tool calls and
 *  fields sit in a label/value column pair that aligns down the list. */
const AuditRow = ({ entry }: { entry: AiAuditEntry }) => {
  const statusColor = STATUS_COLOR[entry.status];
  const consentLabel = CONSENT_LABEL[entry.consentLevel] ?? entry.consentLevel;
  const modeLabel = entry.redactionMode === 'precise' ? '精确模式' : '严格模式';
  const footRight = [
    (entry.historyMessageCount ?? 0) > 0 ? `携带上下文 ${entry.historyMessageCount} 条` : null,
    entry.latencyMs != null ? `耗时 ${(entry.latencyMs / 1000).toFixed(1)}s` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.entry}>
      <View style={styles.entryHead}>
        <Text style={styles.entryTime}>{formatRelative(entry.createdAt)}</Text>
        <StatusChip
          label={STATUS_LABEL[entry.status]}
          color={statusColor}
          wash={STATUS_WASH[entry.status]}
        />
      </View>

      <Text style={styles.metaText}>
        {`同意 ${consentLabel} · ${modeLabel}`}
        {entry.usedPersonalData ? <Text style={styles.metaAccent}>{' · 用到个人数据'}</Text> : null}
      </Text>

      {entry.toolsCalled.length > 0 ? (
        <View style={styles.defRow}>
          <Text style={styles.defLabel}>调用工具</Text>
          <Text style={styles.defValue}>
            {entry.toolsCalled.map((tool, index) => {
              const isError = tool.status === 'error';
              // Show "name · chunks · ms" inline; failures take the
              // alert colour so they jump out in a long list.
              const detail = [
                tool.chunkCount > 0 ? `${tool.chunkCount} 段` : null,
                tool.latencyMs != null ? `${tool.latencyMs}ms` : null,
              ]
                .filter(Boolean)
                .join(' · ');
              const label = detail ? `${tool.name} · ${detail}` : tool.name;
              return (
                <Text key={tool.toolCallId} style={isError ? styles.defValueAlert : undefined}>
                  {index > 0 ? '\n' : ''}
                  {label}
                </Text>
              );
            })}
          </Text>
        </View>
      ) : null}

      {entry.fieldsUsed.length > 0 ? (
        <View style={styles.defRow}>
          <Text style={styles.defLabel}>使用字段</Text>
          <Text style={styles.defValue}>{entry.fieldsUsed.join('、')}</Text>
        </View>
      ) : null}

      {entry.errorDetail ? (
        <View style={styles.noteRow}>
          <View style={[styles.noteStripe, styles.noteStripeAlert]} />
          <Text style={styles.noteText} numberOfLines={3}>
            {humanizeAiErrorDetail(entry.errorDetail)}
          </Text>
        </View>
      ) : null}

      <View style={styles.footRow}>
        <Text style={styles.footText} numberOfLines={1}>
          {entry.llmProvider} · {entry.llmModel}
        </Text>
        {footRight ? <Text style={styles.footTextRight}>{footRight}</Text> : null}
      </View>
    </View>
  );
};

/** Render one row from `ai_consent_events`. The from→to arrow is the
 *  whole point of this view: per-flag `_at` timestamps on
 *  patient_profiles only retain the latest transition, so this row
 *  is where re-toggles become visible. */
const ConsentEventRow = ({ event }: { event: ConsentEvent }) => {
  const flagLabel = CONSENT_FLAG_LABEL[event.flagName] ?? event.flagName;
  const sourceLabel = CONSENT_SOURCE_LABEL[event.source] ?? event.source;
  const sourceColor = CONSENT_SOURCE_COLOR[event.source] ?? COLOR.inkMuted;
  const sourceWash = CONSENT_SOURCE_WASH[event.source] ?? 'transparent';
  const fromLabel = event.fromValue ? '开' : '关';
  const toLabel = event.toValue ? '开' : '关';
  const directionColor = event.toValue ? COLOR.good : COLOR.warn;

  return (
    <View style={styles.entry}>
      <View style={styles.entryHead}>
        <Text style={styles.entryTitle} numberOfLines={1}>
          {flagLabel}
        </Text>
        <StatusChip label={sourceLabel} color={sourceColor} wash={sourceWash} />
      </View>

      {/* The transition is the record. Both halves get value weight,
          and only the new state is coloured — the old one has already
          stopped being true. */}
      <View style={styles.transitionRow}>
        <Text style={styles.transitionFrom}>{fromLabel}</Text>
        <Icon name="arrow-right" size={11} color={COLOR.inkFaint} />
        <Text style={[styles.transitionTo, { color: directionColor }]}>{toLabel}</Text>
      </View>

      {event.note ? (
        <View style={styles.noteRow}>
          <View style={styles.noteStripe} />
          <Text style={styles.noteText} numberOfLines={3}>
            {event.note}
          </Text>
        </View>
      ) : null}

      <View style={styles.footRow}>
        <Text style={styles.footText}>{formatRelative(event.changedAt)}</Text>
        <Text style={styles.footTextRight}>{formatAbsolute(event.changedAt)}</Text>
      </View>
    </View>
  );
};

const TabButton = ({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) => (
  <TouchableOpacity
    accessibilityRole="tab"
    accessibilityState={{ selected: active }}
    aria-selected={active}
    onPress={onPress}
    style={[styles.tabButton, active && styles.tabButtonActive]}
    activeOpacity={INTERACTION.pressOpacity}
  >
    <Text style={[styles.tabButtonText, active && styles.tabButtonTextActive]}>{label}</Text>
  </TouchableOpacity>
);

const AuditHistoryScreen = () => {
  const [activeTab, setActiveTab] = useState<Tab>('ai');

  // ----- AI 调用记录 state
  const [aiItems, setAiItems] = useState<AiAuditEntry[]>([]);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiLoadingMore, setAiLoadingMore] = useState(false);
  const [aiRefreshing, setAiRefreshing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiHasMore, setAiHasMore] = useState(false);

  // ----- 同意时间线 state (lazy: don't fetch until the tab is opened
  // so the default landing screen never pays a second round trip).
  const [consentItems, setConsentItems] = useState<ConsentEvent[]>([]);
  const [consentLoaded, setConsentLoaded] = useState(false);
  const [consentLoading, setConsentLoading] = useState(false);
  const [consentRefreshing, setConsentRefreshing] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  // Track a per-call sequence number so a stale 'more' result can't
  // overwrite the state set by a later 'refresh'. Without this, a
  // user pulling-to-refresh while a 'more' page is in flight could
  // see duplicate `key={entry.id}` rows or — worse — gaps where the
  // pre-refresh offset skipped entries the refresh just pulled.
  const aiFetchSeqRef = useRef(0);
  // Status filter chips (server-side filter — the /ai/audit endpoint
  // already supports it). Changing the filter resets pagination.
  const [aiStatusFilter, setAiStatusFilter] = useState<AiAuditStatus | 'all'>('all');

  const fetchAiPage = useCallback(
    async (mode: 'initial' | 'refresh' | 'more') => {
      const seq = ++aiFetchSeqRef.current;
      if (mode === 'initial') setAiLoading(true);
      if (mode === 'refresh') setAiRefreshing(true);
      if (mode === 'more') setAiLoadingMore(true);
      try {
        const offset = mode === 'more' ? aiItems.length : 0;
        const r = await getMyAuditHistory({
          limit: PAGE_SIZE,
          offset,
          ...(aiStatusFilter !== 'all' ? { status: aiStatusFilter } : {}),
        });
        // Drop the result if a newer fetch started after this one.
        // The newer fetch will set the canonical state; this one's
        // payload would only cause duplicates or skips.
        if (seq !== aiFetchSeqRef.current) return;
        setAiItems((prev) => (mode === 'more' ? [...prev, ...r.data.items] : r.data.items));
        setAiHasMore(r.data.hasMore);
        setAiError(null);
      } catch (err) {
        if (seq !== aiFetchSeqRef.current) return;
        const msg =
          err instanceof ApiError
            ? (err.data as { message?: string })?.message || err.message
            : err instanceof Error
              ? err.message
              : '加载失败';
        setAiError(msg);
      } finally {
        if (seq === aiFetchSeqRef.current) {
          setAiLoading(false);
          setAiRefreshing(false);
          setAiLoadingMore(false);
        }
      }
    },
    [aiItems.length, aiStatusFilter],
  );

  const [consentFlagFilter, setConsentFlagFilter] = useState<ConsentEventFlag | 'all'>('all');

  const fetchConsent = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'initial') setConsentLoading(true);
      if (mode === 'refresh') setConsentRefreshing(true);
      try {
        const r = await getMyConsentHistory({
          limit: CONSENT_HISTORY_LIMIT,
          ...(consentFlagFilter !== 'all' ? { flagName: consentFlagFilter } : {}),
        });
        setConsentItems(r.events);
        setConsentError(null);
        setConsentLoaded(true);
      } catch (err) {
        // 404 here means the user has no patient_profiles row yet —
        // distinct from "no events yet", which the server returns as
        // an empty array. Distinguish so the UI can prompt for
        // onboarding instead of an unhelpful generic error.
        if (err instanceof ApiError && err.status === 404) {
          setConsentError('请先完成基础档案后再查看同意历史。');
        } else {
          const msg =
            err instanceof ApiError
              ? (err.data as { message?: string })?.message || err.message
              : err instanceof Error
                ? err.message
                : '加载失败';
          setConsentError(msg);
        }
      } finally {
        setConsentLoading(false);
        setConsentRefreshing(false);
      }
      // Deps close over the flag filter by design — a filter change
      // rebuilds the fetcher, and the invalidation effect below reopens
      // the lazy-load gate.
    },
    [consentFlagFilter],
  );

  // A flag-filter change invalidates the loaded page; the lazy-load
  // effect below re-fetches (consentLoaded gate reopens). Clearing
  // the error matters too: the anti-retry-storm guard blocks the
  // lazy load while an error is set, and switching filters is an
  // explicit user action that should always attempt a fresh fetch.
  useEffect(() => {
    setConsentLoaded(false);
    setConsentError(null);
  }, [consentFlagFilter]);

  useEffect(() => {
    void fetchAiPage('initial');
    // Re-fires when the status filter changes (fetchAiPage closes
    // over it); refresh / loadMore handle later updates. Deliberately
    // NOT keyed on fetchAiPage itself — its identity also shifts with
    // aiItems.length, which must not re-trigger an initial fetch.
  }, [aiStatusFilter]);

  // Lazy-load consent history the first time the user opens that tab.
  //
  // The `!consentError` guard is load-bearing: without it, a failed
  // fetch sets consentError + flips consentLoading back to false, the
  // effect re-runs, the original guard still passes (consentLoaded is
  // only true on success), and we retry-storm the server until either
  // the user navigates away or the network comes back. The 404 path
  // (no profile row) is the worst case — it never recovers, so the
  // loop is unbounded. The retry button onPress already calls
  // fetchConsent directly, and fetchConsent itself clears
  // consentError on the success path; so adding the guard keeps
  // manual retry as a one-shot user action and the effect as a
  // one-shot first-mount fetch per tab open.
  useEffect(() => {
    if (activeTab === 'consent' && !consentLoaded && !consentLoading && !consentError) {
      void fetchConsent('initial');
    }
  }, [activeTab, consentLoaded, consentLoading, consentError, fetchConsent]);

  const AI_STATUS_CHIPS: Array<{ value: AiAuditStatus | 'all'; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'success', label: '成功' },
    { value: 'error', label: '失败' },
    { value: 'consent_denied', label: '授权未通过' },
  ];

  const CONSENT_FLAG_CHIPS: Array<{ value: ConsentEventFlag | 'all'; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'personal', label: '个人数据' },
    { value: 'third_party', label: '第三方' },
    { value: 'precise_values', label: '精确数值' },
  ];

  /**
   * One exclusive filter, drawn as one track.
   *
   * These were independent pills — the shape iOS uses for multi-select
   * tags — so nothing said that picking 「成功」 replaces 「全部」 rather
   * than adding to it. They also carried no accessibilityRole and no
   * selected state, so a screen reader could not say which filter was
   * on.
   */
  const renderFilterChips = <T extends string>(
    chips: Array<{ value: T; label: string }>,
    active: T,
    onSelect: (value: T) => void,
    accessibilityLabel: string,
  ) => (
    <SegmentedControl
      segments={chips.map((chip) => ({ key: chip.value, label: chip.label }))}
      value={active}
      onChange={(key) => onSelect(key as T)}
      accessibilityLabel={accessibilityLabel}
      style={styles.filterControl}
    />
  );

  const renderAiBody = () => {
    if (aiLoading) {
      return (
        <View style={styles.stateBlock}>
          <ActivityIndicator color={COLOR.accent} />
          <Text style={styles.stateText}>加载中...</Text>
        </View>
      );
    }
    if (aiError) {
      return (
        <View style={styles.stateBlock}>
          <Icon name="triangle-exclamation" size={20} color={COLOR.alert} />
          <Text style={styles.stateText}>{aiError}</Text>
          <Button
            label="重试"
            icon="rotate-right"
            variant="tinted"
            compact
            onPress={() => fetchAiPage('initial')}
          />
        </View>
      );
    }
    if (aiItems.length === 0) {
      return (
        <View style={styles.stateBlock}>
          <Icon name="file-shield" size={20} color={COLOR.inkMuted} />
          {/* Naming only 问答 sent people looking for a tab that no
              longer exists, and it understated the log: the in-page
              「这什么意思」drawer is now the main way questions get
              asked, and every one of those lands here too. */}
          {/* An active filter changes what "empty" means. Telling a
              patient「还没有任何 AI 调用记录」while a 状态 filter is
              narrowing the list says their audit trail is gone — on the
              one screen whose whole purpose is showing them it is not.
              The route back is the filter, not the ask flow. */}
          <Text style={styles.stateText}>
            {aiStatusFilter === 'all'
              ? '还没有任何 AI 调用记录。在页面里点「这什么意思」问一次，或去「问答」提问，这里就会出现一条记录。'
              : '当前筛选条件下没有记录。把状态切回「全部」就能看到其余记录。'}
          </Text>
        </View>
      );
    }
    return (
      <>
        {aiItems.map((entry) => (
          <AuditRow key={entry.id} entry={entry} />
        ))}
        {aiHasMore ? (
          <Button
            label="加载更多"
            variant="tinted"
            fullWidth
            busy={aiLoadingMore}
            onPress={() => fetchAiPage('more')}
          />
        ) : null}
      </>
    );
  };

  const renderConsentBody = () => {
    if (consentLoading) {
      return (
        <View style={styles.stateBlock}>
          <ActivityIndicator color={COLOR.accent} />
          <Text style={styles.stateText}>加载中...</Text>
        </View>
      );
    }
    if (consentError) {
      return (
        <View style={styles.stateBlock}>
          <Icon name="triangle-exclamation" size={20} color={COLOR.alert} />
          <Text style={styles.stateText}>{consentError}</Text>
          <Button
            label="重试"
            icon="rotate-right"
            variant="tinted"
            compact
            onPress={() => fetchConsent('initial')}
          />
        </View>
      );
    }
    if (consentItems.length === 0) {
      return (
        <View style={styles.stateBlock}>
          <Icon name="clock-rotate-left" size={20} color={COLOR.inkMuted} />
          {/* Same fix as the AI tab's empty state twelve lines up, which
              this one was left out of: with a flag filter active,
             「还没有同意变更记录」 tells the patient their consent
              history is gone, on the screen that exists to prove it
              isn't. */}
          <Text style={styles.stateText}>
            {consentFlagFilter === 'all'
              ? '还没有同意变更记录。在「隐私设置」开启或关闭任一 AI 数据授权后，这里会保留每一次变更。'
              : '当前筛选条件下没有记录。把授权类型切回「全部」就能看到其余变更。'}
          </Text>
        </View>
      );
    }
    return consentItems.map((event) => <ConsentEventRow key={event.id} event={event} />);
  };

  const helpText =
    activeTab === 'ai'
      ? '每条记录对应一次 AI 提问：页面里的「这什么意思」和「智能问答」都会记在这里。我们只保存调用的元数据（模型、工具、字段、状态），从不保存提示词原文或回答内容。'
      : '每条记录对应一次 AI 数据授权开关的开/关。系统自动触发的连锁变更（例如关闭基础授权时自动收回精确数值授权）会标记为「系统自动」。';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <ScreenBackButton />
        <Text style={styles.headerTitle}>隐私 / 审计记录</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <View style={styles.tabRow}>
        <TabButton
          label="AI 调用记录"
          active={activeTab === 'ai'}
          onPress={() => setActiveTab('ai')}
        />
        <TabButton
          label="同意变更历史"
          active={activeTab === 'consent'}
          onPress={() => setActiveTab('consent')}
        />
      </View>

      <View style={styles.helpBlock}>
        <Text style={styles.helpText}>{helpText}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          activeTab === 'ai' ? (
            <RefreshControl refreshing={aiRefreshing} onRefresh={() => fetchAiPage('refresh')} />
          ) : (
            <RefreshControl
              refreshing={consentRefreshing}
              onRefresh={() => fetchConsent('refresh')}
            />
          )
        }
      >
        {activeTab === 'ai'
          ? renderFilterChips(AI_STATUS_CHIPS, aiStatusFilter, setAiStatusFilter, 'AI 调用状态筛选')
          : renderFilterChips(
              CONSENT_FLAG_CHIPS,
              consentFlagFilter,
              setConsentFlagFilter,
              '授权类型筛选',
            )}
        {activeTab === 'ai' ? renderAiBody() : renderConsentBody()}
      </ScrollView>
    </SafeAreaView>
  );
};

export default AuditHistoryScreen;
