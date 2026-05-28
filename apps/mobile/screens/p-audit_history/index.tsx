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
import { ApiError, type AiAuditEntry, type AiAuditStatus, getMyAuditHistory } from '../../lib/api';
import { CLINICAL_COLORS } from '../../lib/clinical-visuals';
import ScreenBackButton from '../common/ScreenBackButton';
import styles from './styles';

const PAGE_SIZE = 50;

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

const AuditHistoryScreen = () => {
  const [items, setItems] = useState<AiAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const fetchPage = useCallback(
    async (mode: 'initial' | 'refresh' | 'more') => {
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      if (mode === 'more') setLoadingMore(true);
      try {
        const offset = mode === 'more' ? items.length : 0;
        const r = await getMyAuditHistory({ limit: PAGE_SIZE, offset });
        setItems((prev) => (mode === 'more' ? [...prev, ...r.data.items] : r.data.items));
        setHasMore(r.data.hasMore);
        setError(null);
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? (err.data as { message?: string })?.message || err.message
            : err instanceof Error
              ? err.message
              : '加载失败';
        setError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [items.length],
  );

  useEffect(() => {
    void fetchPage('initial');
    // intentionally only on first mount; refresh / loadMore handle later updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderBody = () => {
    if (loading) {
      return (
        <View style={{ paddingVertical: 60, alignItems: 'center' }}>
          <ActivityIndicator color={CLINICAL_COLORS.accent} />
          <Text style={{ marginTop: 10, color: CLINICAL_COLORS.textMuted, fontSize: 12 }}>
            加载中...
          </Text>
        </View>
      );
    }
    if (error) {
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
            {error}
          </Text>
          <TouchableOpacity
            onPress={() => fetchPage('initial')}
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
    if (items.length === 0) {
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
        {items.map((entry) => (
          <AuditCard key={entry.id} entry={entry} />
        ))}
        {hasMore ? (
          <TouchableOpacity
            disabled={loadingMore}
            onPress={() => fetchPage('more')}
            style={{
              marginHorizontal: 16,
              marginBottom: 24,
              paddingVertical: 10,
              borderRadius: 14,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: CLINICAL_COLORS.border,
              backgroundColor: CLINICAL_COLORS.panel,
              opacity: loadingMore ? 0.6 : 1,
            }}
          >
            <Text style={{ color: CLINICAL_COLORS.text, fontSize: 12, fontWeight: '600' }}>
              {loadingMore ? '加载中...' : '加载更多'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <ScreenBackButton />
        <Text style={styles.headerTitle}>AI 调用记录</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 8,
        }}
      >
        <Text style={{ color: CLINICAL_COLORS.textMuted, fontSize: 12, lineHeight: 18 }}>
          每条记录对应一次「智能问答」请求。我们只保存调用的元数据（模型、工具、字段、状态），从不保存提示词原文或回答内容。
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => fetchPage('refresh')} />
        }
      >
        {renderBody()}
      </ScrollView>
    </SafeAreaView>
  );
};

export default AuditHistoryScreen;
