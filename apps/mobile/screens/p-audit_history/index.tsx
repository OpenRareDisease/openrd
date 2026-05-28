import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FontAwesome6 } from '@expo/vector-icons';
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
import { CLINICAL_COLORS } from '../../lib/clinical-visuals';
import ScreenBackButton from '../common/ScreenBackButton';
import styles from './styles';

const PAGE_SIZE = 50;
const CONSENT_HISTORY_LIMIT = 200;

type Tab = 'ai' | 'consent';

const STATUS_LABEL: Record<AiAuditStatus, string> = {
  success: '成功',
  error: '失败',
  consent_denied: '拒绝（未同意）',
};

const STATUS_COLOR: Record<AiAuditStatus, string> = {
  success: CLINICAL_COLORS.success,
  error: CLINICAL_COLORS.warning,
  consent_denied: CLINICAL_COLORS.textMuted,
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
  user: CLINICAL_COLORS.accent,
  admin: CLINICAL_COLORS.warning,
  system: CLINICAL_COLORS.textMuted,
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

const Chip = ({
  label,
  color = CLINICAL_COLORS.textMuted,
  bg = CLINICAL_COLORS.panel,
}: {
  label: string;
  color?: string;
  bg?: string;
}) => (
  <View
    style={{
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 10,
      backgroundColor: bg,
      borderWidth: 1,
      borderColor: CLINICAL_COLORS.border,
    }}
  >
    <Text style={{ color, fontSize: 11, fontWeight: '600' }}>{label}</Text>
  </View>
);

const AuditCard = ({ entry }: { entry: AiAuditEntry }) => {
  const statusColor = STATUS_COLOR[entry.status];
  const consentLabel = CONSENT_LABEL[entry.consentLevel] ?? entry.consentLevel;
  const modeLabel = entry.redactionMode === 'precise' ? '精确模式' : '严格模式';

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 10,
        padding: 14,
        borderRadius: 14,
        backgroundColor: CLINICAL_COLORS.backgroundRaised,
        borderWidth: 1,
        borderColor: CLINICAL_COLORS.border,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: CLINICAL_COLORS.text, fontSize: 13, fontWeight: '700' }}>
          {formatRelative(entry.createdAt)}
        </Text>
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 10,
            backgroundColor: CLINICAL_COLORS.panel,
            borderWidth: 1,
            borderColor: statusColor,
          }}
        >
          <Text style={{ color: statusColor, fontSize: 11, fontWeight: '700' }}>
            {STATUS_LABEL[entry.status]}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Chip label={`同意 · ${consentLabel}`} />
        <Chip label={modeLabel} />
        {entry.usedPersonalData ? (
          <Chip label="用到个人数据" color={CLINICAL_COLORS.accentStrong} />
        ) : null}
      </View>

      {entry.toolsCalled.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: CLINICAL_COLORS.textMuted, fontSize: 11 }}>调用工具</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {entry.toolsCalled.map((tool) => (
              <Chip key={tool} label={tool} />
            ))}
          </View>
        </View>
      ) : null}

      {entry.fieldsUsed.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: CLINICAL_COLORS.textMuted, fontSize: 11 }}>使用字段</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {entry.fieldsUsed.map((field) => (
              <Chip key={field} label={field} />
            ))}
          </View>
        </View>
      ) : null}

      {entry.errorDetail ? (
        <View
          style={{
            backgroundColor: CLINICAL_COLORS.panel,
            padding: 8,
            borderRadius: 8,
            borderLeftWidth: 3,
            borderLeftColor: CLINICAL_COLORS.warning,
          }}
        >
          <Text
            style={{ color: CLINICAL_COLORS.textSoft, fontSize: 11, lineHeight: 16 }}
            numberOfLines={3}
          >
            {entry.errorDetail}
          </Text>
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingTop: 6,
          borderTopWidth: 1,
          borderTopColor: CLINICAL_COLORS.border,
        }}
      >
        <Text style={{ color: CLINICAL_COLORS.textMuted, fontSize: 10 }}>
          {entry.llmProvider} · {entry.llmModel}
        </Text>
        {entry.latencyMs != null ? (
          <Text style={{ color: CLINICAL_COLORS.textMuted, fontSize: 10 }}>
            耗时 {(entry.latencyMs / 1000).toFixed(1)}s
          </Text>
        ) : null}
      </View>
    </View>
  );
};

/** Render one row from `ai_consent_events`. The from→to arrow is the
 *  whole point of this view: per-flag `_at` timestamps on
 *  patient_profiles only retain the latest transition, so this card
 *  is where re-toggles become visible. */
const ConsentEventCard = ({ event }: { event: ConsentEvent }) => {
  const flagLabel = CONSENT_FLAG_LABEL[event.flagName] ?? event.flagName;
  const sourceLabel = CONSENT_SOURCE_LABEL[event.source] ?? event.source;
  const sourceColor = CONSENT_SOURCE_COLOR[event.source] ?? CLINICAL_COLORS.textMuted;
  const fromLabel = event.fromValue ? '开' : '关';
  const toLabel = event.toValue ? '开' : '关';
  const directionColor = event.toValue ? CLINICAL_COLORS.success : CLINICAL_COLORS.warning;

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 10,
        padding: 14,
        borderRadius: 14,
        backgroundColor: CLINICAL_COLORS.backgroundRaised,
        borderWidth: 1,
        borderColor: CLINICAL_COLORS.border,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: CLINICAL_COLORS.text, fontSize: 13, fontWeight: '700' }}>
          {flagLabel}
        </Text>
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 10,
            backgroundColor: CLINICAL_COLORS.panel,
            borderWidth: 1,
            borderColor: sourceColor,
          }}
        >
          <Text style={{ color: sourceColor, fontSize: 11, fontWeight: '700' }}>{sourceLabel}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Chip label={fromLabel} />
        <FontAwesome6 name="arrow-right" size={11} color={CLINICAL_COLORS.textMuted} />
        <Chip label={toLabel} color={directionColor} bg={CLINICAL_COLORS.panel} />
      </View>

      {event.note ? (
        <View
          style={{
            backgroundColor: CLINICAL_COLORS.panel,
            padding: 8,
            borderRadius: 8,
            borderLeftWidth: 3,
            borderLeftColor: CLINICAL_COLORS.textMuted,
          }}
        >
          <Text
            style={{ color: CLINICAL_COLORS.textSoft, fontSize: 11, lineHeight: 16 }}
            numberOfLines={3}
          >
            {event.note}
          </Text>
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingTop: 6,
          borderTopWidth: 1,
          borderTopColor: CLINICAL_COLORS.border,
        }}
      >
        <Text style={{ color: CLINICAL_COLORS.textMuted, fontSize: 10 }}>
          {formatRelative(event.changedAt)}
        </Text>
        <Text style={{ color: CLINICAL_COLORS.textMuted, fontSize: 10 }}>
          {formatAbsolute(event.changedAt)}
        </Text>
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
    onPress={onPress}
    style={{
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      borderBottomWidth: 2,
      borderBottomColor: active ? CLINICAL_COLORS.accent : 'transparent',
    }}
    activeOpacity={0.7}
  >
    <Text
      style={{
        color: active ? CLINICAL_COLORS.text : CLINICAL_COLORS.textMuted,
        fontSize: 13,
        fontWeight: active ? '700' : '500',
      }}
    >
      {label}
    </Text>
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

  const fetchAiPage = useCallback(
    async (mode: 'initial' | 'refresh' | 'more') => {
      if (mode === 'initial') setAiLoading(true);
      if (mode === 'refresh') setAiRefreshing(true);
      if (mode === 'more') setAiLoadingMore(true);
      try {
        const offset = mode === 'more' ? aiItems.length : 0;
        const r = await getMyAuditHistory({ limit: PAGE_SIZE, offset });
        setAiItems((prev) => (mode === 'more' ? [...prev, ...r.data.items] : r.data.items));
        setAiHasMore(r.data.hasMore);
        setAiError(null);
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? (err.data as { message?: string })?.message || err.message
            : err instanceof Error
              ? err.message
              : '加载失败';
        setAiError(msg);
      } finally {
        setAiLoading(false);
        setAiRefreshing(false);
        setAiLoadingMore(false);
      }
    },
    [aiItems.length],
  );

  const fetchConsent = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') setConsentLoading(true);
    if (mode === 'refresh') setConsentRefreshing(true);
    try {
      const r = await getMyConsentHistory({ limit: CONSENT_HISTORY_LIMIT });
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
  }, []);

  useEffect(() => {
    void fetchAiPage('initial');
    // intentionally only on first mount; refresh / loadMore handle later updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const renderAiBody = () => {
    if (aiLoading) {
      return (
        <View style={{ paddingVertical: 60, alignItems: 'center' }}>
          <ActivityIndicator color={CLINICAL_COLORS.accent} />
          <Text style={{ marginTop: 10, color: CLINICAL_COLORS.textMuted, fontSize: 12 }}>
            加载中...
          </Text>
        </View>
      );
    }
    if (aiError) {
      return (
        <View style={{ paddingVertical: 40, paddingHorizontal: 24, alignItems: 'center' }}>
          <FontAwesome6 name="triangle-exclamation" size={20} color={CLINICAL_COLORS.warning} />
          <Text
            style={{
              marginTop: 10,
              color: CLINICAL_COLORS.textSoft,
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            {aiError}
          </Text>
          <TouchableOpacity
            onPress={() => fetchAiPage('initial')}
            style={{
              marginTop: 12,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 18,
              backgroundColor: CLINICAL_COLORS.accent,
            }}
          >
            <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>重试</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (aiItems.length === 0) {
      return (
        <View style={{ paddingVertical: 60, paddingHorizontal: 32, alignItems: 'center' }}>
          <FontAwesome6 name="file-shield" size={20} color={CLINICAL_COLORS.textMuted} />
          <Text
            style={{
              marginTop: 10,
              color: CLINICAL_COLORS.textMuted,
              fontSize: 13,
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            还没有任何 AI 调用记录。在「智能问答」里问一次问题，这里就会出现一条记录。
          </Text>
        </View>
      );
    }
    return (
      <>
        {aiItems.map((entry) => (
          <AuditCard key={entry.id} entry={entry} />
        ))}
        {aiHasMore ? (
          <TouchableOpacity
            disabled={aiLoadingMore}
            onPress={() => fetchAiPage('more')}
            style={{
              marginHorizontal: 16,
              marginBottom: 24,
              paddingVertical: 10,
              borderRadius: 14,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: CLINICAL_COLORS.border,
              backgroundColor: CLINICAL_COLORS.panel,
              opacity: aiLoadingMore ? 0.6 : 1,
            }}
          >
            <Text style={{ color: CLINICAL_COLORS.text, fontSize: 12, fontWeight: '600' }}>
              {aiLoadingMore ? '加载中...' : '加载更多'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </>
    );
  };

  const renderConsentBody = () => {
    if (consentLoading) {
      return (
        <View style={{ paddingVertical: 60, alignItems: 'center' }}>
          <ActivityIndicator color={CLINICAL_COLORS.accent} />
          <Text style={{ marginTop: 10, color: CLINICAL_COLORS.textMuted, fontSize: 12 }}>
            加载中...
          </Text>
        </View>
      );
    }
    if (consentError) {
      return (
        <View style={{ paddingVertical: 40, paddingHorizontal: 24, alignItems: 'center' }}>
          <FontAwesome6 name="triangle-exclamation" size={20} color={CLINICAL_COLORS.warning} />
          <Text
            style={{
              marginTop: 10,
              color: CLINICAL_COLORS.textSoft,
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            {consentError}
          </Text>
          <TouchableOpacity
            onPress={() => fetchConsent('initial')}
            style={{
              marginTop: 12,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 18,
              backgroundColor: CLINICAL_COLORS.accent,
            }}
          >
            <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>重试</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (consentItems.length === 0) {
      return (
        <View style={{ paddingVertical: 60, paddingHorizontal: 32, alignItems: 'center' }}>
          <FontAwesome6 name="clock-rotate-left" size={20} color={CLINICAL_COLORS.textMuted} />
          <Text
            style={{
              marginTop: 10,
              color: CLINICAL_COLORS.textMuted,
              fontSize: 13,
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            还没有同意变更记录。在「隐私设置」开启或关闭任一 AI 数据授权后，这里会保留每一次变更。
          </Text>
        </View>
      );
    }
    return consentItems.map((event) => <ConsentEventCard key={event.id} event={event} />);
  };

  const helpText =
    activeTab === 'ai'
      ? '每条记录对应一次「智能问答」请求。我们只保存调用的元数据（模型、工具、字段、状态），从不保存提示词原文或回答内容。'
      : '每条记录对应一次 AI 数据授权开关的开/关。系统自动触发的连锁变更（例如关闭基础授权时自动收回精确数值授权）会标记为「系统自动」。';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <ScreenBackButton />
        <Text style={styles.headerTitle}>隐私 / 审计记录</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <View
        style={{
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: CLINICAL_COLORS.border,
        }}
      >
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

      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 8,
        }}
      >
        <Text style={{ color: CLINICAL_COLORS.textMuted, fontSize: 12, lineHeight: 18 }}>
          {helpText}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}
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
        {activeTab === 'ai' ? renderAiBody() : renderConsentBody()}
      </ScrollView>
    </SafeAreaView>
  );
};

export default AuditHistoryScreen;
