import { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import {
  ApiError,
  AiAskProgressStage,
  type AiCitation,
  type AiStreamEvent,
  QNA_CHAT_STORAGE_KEY,
  type StreamAiQuestionHandle,
  isConsentRequiredError,
} from '../../lib/api';
import { streamAiQuestion } from '../../lib/ai-streaming';
import { CLINICAL_COLORS } from '../../lib/clinical-visuals';
import { normalizeCitationIndexes, parseCitationSegments } from './citations';
import {
  normalizeStoredMetadata,
  synthesizeLegacyToolCalls,
  type AssistantMetadata,
} from './metadata';
import { pickCurrentMode } from './mode';
import styles from './styles';

type ChatRole = 'assistant' | 'user';
type ChatMessageStatus = 'sent' | 'loading' | 'error';

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  status: ChatMessageStatus;
  metadata?: AssistantMetadata;
};

// Backed by `QNA_CHAT_STORAGE_KEY` in lib/api so the AuthContext's
// logout sweep + the 401 handler can purge it without import cycles.
const CHAT_STORAGE_KEY = QNA_CHAT_STORAGE_KEY;
const MAX_STORED_MESSAGES = 24;

const defaultProgressStages: AiAskProgressStage[] = [
  { id: 'received', label: '接收问题', status: 'pending' },
  { id: 'query_gen', label: '生成检索问题', status: 'pending' },
  { id: 'kb_search', label: '检索知识库', status: 'pending' },
  { id: 'final_answer', label: '生成回答', status: 'pending' },
  { id: 'done', label: '整理结果', status: 'pending' },
];

const createProgressId = () =>
  `qna_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const createMessageId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const createWelcomeMessage = (): ChatMessage => ({
  id: 'welcome',
  role: 'assistant',
  content:
    '可以直接问我 FSHD 相关问题（机制、症状、治疗、康复、心理）。我会从医学知识库检索，并在需要时（你授权后）参考你的档案/报告。每条回答下方会标明引用来源。',
  createdAt: new Date().toISOString(),
  status: 'sent',
});

const parseStoredMessages = (raw: string | null): ChatMessage[] | null => {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;

    const messages = parsed
      .filter((item): item is ChatMessage => {
        if (!item || typeof item !== 'object') return false;
        const candidate = item as Partial<ChatMessage>;
        return (
          typeof candidate.id === 'string' &&
          (candidate.role === 'assistant' || candidate.role === 'user') &&
          typeof candidate.content === 'string' &&
          typeof candidate.createdAt === 'string' &&
          (candidate.status === 'sent' ||
            candidate.status === 'loading' ||
            candidate.status === 'error')
        );
      })
      .map((item) => ({
        ...item,
        metadata: normalizeStoredMetadata(item.metadata),
      }));

    return messages.length ? messages : null;
  } catch {
    return null;
  }
};

//: Defence-in-depth cap on chunk snippets the server includes in
//: citations. The KB chunk wrap + redactor make this very unlikely to
//: be huge, but a misconfigured ingest could surface a multi-KB blob
//: and the citation popover renders inside a ScrollView — a giant
//: snippet freezes the bridge thread on Android. Cap is generous
//: enough for legit clinical chunks (~800 chars) and surfaces an
//: ellipsis so the user knows more exists upstream.
const CITATION_SNIPPET_MAX_CHARS = 800;

const capCitationSnippet = (raw: string): string => {
  if (raw.length <= CITATION_SNIPPET_MAX_CHARS) return raw;
  return `${raw.slice(0, CITATION_SNIPPET_MAX_CHARS)}…`;
};

const formatMessageTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** At-a-glance "this conversation is currently in X mode" chip.
 *  Renders nothing until the first successful answer comes back —
 *  before that, the user hasn't committed to a mode (the orchestrator
 *  picks it per-call based on consent), so claiming "严格" or "精确"
 *  pre-emptively would be a lie. */
const ModeBadge = ({ mode }: { mode: 'strict' | 'precise' | null }) => {
  if (!mode) return null;
  const isPrecise = mode === 'precise';
  const label = isPrecise ? '精确模式' : '严格模式';
  // Precise mode is the sensitive one ("AI can see raw values") so it
  // earns the accent colour. Strict mode is the safe default and uses
  // a muted shield treatment to read as "normal".
  const color = isPrecise ? CLINICAL_COLORS.accentStrong : CLINICAL_COLORS.textMuted;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: color,
        backgroundColor: CLINICAL_COLORS.panel,
      }}
      accessibilityRole="text"
      accessibilityLabel={`当前隐私模式：${label}`}
    >
      <FontAwesome6
        name={isPrecise ? 'wand-magic-sparkles' : 'shield-halved'}
        size={10}
        color={color}
      />
      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
};

/** Per-message footer that lists patient fields used + an expandable
 *  citation list. Lives as its own component (not a pure helper) so
 *  each assistant bubble owns its own collapsed/expanded state without
 *  the parent having to bookkeep a Set of message ids.
 *
 *  Returns null for user messages, non-success assistant messages,
 *  or assistant messages with no metadata (placeholders, legacy
 *  stored messages). */
const AssistantMetadataBlock = ({ message }: { message: ChatMessage }) => {
  const [expanded, setExpanded] = useState(false);
  const [traceExpanded, setTraceExpanded] = useState(false);

  if (message.role !== 'assistant') return null;
  if (message.status !== 'sent') return null;
  const meta = message.metadata;
  if (!meta) return null;

  const showFields = meta.usedPersonalData && (meta.fieldsUsed?.length ?? 0) > 0;
  const citations = meta.citations ?? [];
  const showCitations = citations.length > 0;

  // Tool-call trace. We prefer the rich `toolCalls` shape; fall
  // back to `legacyToolNames` for chats stored before
  // ToolCallTrace landed (those have no per-call status / timing,
  // so we synthesise minimal rows just for the names). The
  // synthesis helper handles duplicate names — see its docstring
  // for why that matters.
  const toolCalls = meta.toolCalls?.length
    ? meta.toolCalls
    : synthesizeLegacyToolCalls(meta.legacyToolNames);
  const showTrace = toolCalls.length > 0;

  if (!showFields && !showCitations && !showTrace) return null;

  const citationFiles = citations.map((c) => c.sourceFile).filter((f): f is string => Boolean(f));
  const citationFilesPreview = citationFiles.slice(0, 3).join('、');
  const citationOverflow = citationFiles.length > 3 ? '…' : '';

  return (
    <View
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: CLINICAL_COLORS.border,
        gap: 4,
      }}
    >
      {showFields ? (
        <Text style={{ color: CLINICAL_COLORS.textMuted, fontSize: 11, lineHeight: 16 }}>
          本回答用到了你的：{(meta.fieldsUsed ?? []).join('、')}
        </Text>
      ) : null}
      {showTrace ? (
        <>
          <TouchableOpacity
            onPress={() => setTraceExpanded((prev) => !prev)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={
              traceExpanded ? '收起 AI 思考过程' : `展开 AI 思考过程（${toolCalls.length} 步）`
            }
          >
            <Text style={{ color: CLINICAL_COLORS.textMuted, fontSize: 11, lineHeight: 16 }}>
              🔧 AI 思考过程 ({toolCalls.length} 步)
              {'  '}
              {traceExpanded ? '▲ 收起' : '▼ 展开'}
            </Text>
          </TouchableOpacity>
          {traceExpanded ? (
            <View style={{ marginTop: 4, gap: 6 }}>
              {toolCalls.map((call) => {
                const isError = call.status === 'error';
                const statusColor = isError ? CLINICAL_COLORS.warning : CLINICAL_COLORS.success;
                return (
                  <View
                    key={call.toolCallId}
                    style={{
                      paddingLeft: 8,
                      borderLeftWidth: 2,
                      borderLeftColor: statusColor,
                      gap: 2,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text
                        style={{
                          color: CLINICAL_COLORS.text,
                          fontSize: 11,
                          lineHeight: 16,
                          fontWeight: '600',
                        }}
                      >
                        {call.name}
                      </Text>
                      <Text style={{ color: statusColor, fontSize: 10, fontWeight: '700' }}>
                        {isError ? '失败' : '成功'}
                      </Text>
                    </View>
                    <Text
                      style={{ color: CLINICAL_COLORS.textMuted, fontSize: 10, lineHeight: 14 }}
                    >
                      返回 {call.chunkCount} 段
                      {call.latencyMs != null ? ` · ${call.latencyMs}ms` : ''}
                    </Text>
                    {isError && call.errorDetail ? (
                      <Text
                        style={{
                          color: CLINICAL_COLORS.warning,
                          fontSize: 10,
                          lineHeight: 14,
                          fontStyle: 'italic',
                        }}
                        numberOfLines={2}
                      >
                        {call.errorDetail}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}
        </>
      ) : null}
      {showCitations ? (
        <>
          <TouchableOpacity
            onPress={() => setExpanded((prev) => !prev)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={expanded ? '收起引用列表' : `展开 ${citations.length} 条引用详情`}
          >
            <Text
              style={{
                color: CLINICAL_COLORS.textMuted,
                fontSize: 11,
                lineHeight: 16,
              }}
            >
              📎 引用 {citations.length} 条
              {citationFilesPreview ? `：${citationFilesPreview}${citationOverflow}` : ''}
              {'  '}
              {expanded ? '▲ 收起' : '▼ 展开'}
            </Text>
          </TouchableOpacity>
          {expanded ? (
            <View style={{ marginTop: 4, gap: 8 }}>
              {citations.map((c, idx) => (
                <View
                  key={c.chunkId}
                  style={{
                    paddingLeft: 8,
                    borderLeftWidth: 2,
                    borderLeftColor: CLINICAL_COLORS.border,
                    gap: 2,
                  }}
                >
                  <Text
                    style={{
                      color: CLINICAL_COLORS.text,
                      fontSize: 11,
                      lineHeight: 16,
                      fontWeight: '600',
                    }}
                  >
                    {idx + 1}. {c.sourceFile ?? c.source}
                    {c.chunkIndex !== null && c.chunkIndex !== undefined
                      ? ` · 段 ${c.chunkIndex}`
                      : ''}
                  </Text>
                  {c.snippet ? (
                    <Text
                      style={{
                        color: CLINICAL_COLORS.textMuted,
                        fontSize: 11,
                        lineHeight: 16,
                      }}
                      numberOfLines={4}
                    >
                      {capCitationSnippet(c.snippet)}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
};

const getFriendlyErrorMessage = (error: unknown) => {
  const message =
    error instanceof ApiError
      ? (error.data as { message?: string; error?: string })?.message ||
        (error.data as { message?: string; error?: string })?.error ||
        error.message
      : error instanceof Error
        ? error.message
        : '暂时无法获取回答，请稍后再试。';

  return message.includes('知识库服务不可用')
    ? '知识库服务未启动，请联系管理员或稍后再试。'
    : message;
};

/** Render the message body, with inline citation tokens turned into
 *  pressable spans for assistant messages that have citations. Falls
 *  back to a plain `<Text>` for user messages, error/loading bubbles,
 *  and assistant messages with no citation list — segmenting those
 *  would be pure overhead with no tap target to offer. */
const renderMessageContent = (
  message: ChatMessage,
  isUser: boolean,
  onCitationPress: (indexes: number[], citations: AiCitation[]) => void,
) => {
  const citations = !isUser && message.status === 'sent' ? (message.metadata?.citations ?? []) : [];

  const baseStyle = [
    styles.messageText,
    isUser ? styles.messageTextUser : styles.messageTextAssistant,
  ];

  if (citations.length === 0) {
    return <Text style={baseStyle}>{message.content}</Text>;
  }

  const segments = parseCitationSegments(message.content, citations.length);

  return (
    <Text style={baseStyle}>
      {segments.map((seg, idx) => {
        if (seg.type === 'text') {
          // eslint-disable-next-line react/no-array-index-key
          return <Text key={`t-${idx}`}>{seg.value}</Text>;
        }
        return (
          <Text
            // eslint-disable-next-line react/no-array-index-key
            key={`c-${idx}`}
            onPress={() => onCitationPress(seg.indexes, citations)}
            accessibilityRole="link"
            accessibilityLabel={`查看引用 ${seg.indexes.join('、')}`}
            style={{
              color: CLINICAL_COLORS.accentStrong,
              fontWeight: '700',
              // Underline via textDecorationLine is the cross-platform
              // way to render a link affordance inline. Background
              // tint would force a different lineHeight on Android.
              textDecorationLine: 'underline',
            }}
          >
            {seg.raw}
          </Text>
        );
      })}
    </Text>
  );
};

/** Modal-bottom-sheet that shows the citation card(s) the user tapped
 *  on inside an answer. Tapping the dimmed backdrop or the close
 *  button dismisses; the modal is fully controlled by the parent. */
const CitationPopoverModal = ({
  popover,
  onClose,
}: {
  popover: { indexes: number[]; citations: AiCitation[] } | null;
  onClose: () => void;
}) => {
  // Deduped+sorted index list, capped to the valid citation count
  // just in case a stale popover hangs on through a re-render.
  const visibleIndexes = useMemo(() => {
    if (!popover) return [];
    return normalizeCitationIndexes(popover.indexes).filter(
      (i) => i >= 1 && i <= popover.citations.length,
    );
  }, [popover]);

  if (!popover) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="关闭引用详情"
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          justifyContent: 'flex-end',
        }}
      >
        {/* The inner card stops bubble-up so taps INSIDE the sheet
         *  don't close it. Pressable + onPress=undefined would still
         *  capture but not respond, which is what we want. */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: CLINICAL_COLORS.backgroundRaised,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            paddingHorizontal: 18,
            paddingTop: 14,
            paddingBottom: 24,
            gap: 12,
            maxHeight: '70%',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ color: CLINICAL_COLORS.text, fontSize: 14, fontWeight: '700' }}>
              引用详情 · {visibleIndexes.length} 条
            </Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="关闭"
              hitSlop={10}
            >
              <FontAwesome6 name="xmark" size={16} color={CLINICAL_COLORS.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {visibleIndexes.map((i) => {
              const c = popover.citations[i - 1];
              return (
                <View
                  key={c.chunkId}
                  style={{
                    paddingLeft: 10,
                    borderLeftWidth: 3,
                    borderLeftColor: CLINICAL_COLORS.accent,
                    gap: 4,
                  }}
                >
                  <Text
                    style={{
                      color: CLINICAL_COLORS.text,
                      fontSize: 12,
                      fontWeight: '700',
                      lineHeight: 17,
                    }}
                  >
                    [{i}] {c.sourceFile ?? c.source}
                    {c.chunkIndex !== null && c.chunkIndex !== undefined
                      ? ` · 段 ${c.chunkIndex}`
                      : ''}
                  </Text>
                  {c.snippet ? (
                    <Text
                      style={{
                        color: CLINICAL_COLORS.textSoft,
                        fontSize: 12,
                        lineHeight: 18,
                      }}
                    >
                      {capCitationSnippet(c.snippet)}
                    </Text>
                  ) : (
                    <Text
                      style={{
                        color: CLINICAL_COLORS.textMuted,
                        fontSize: 12,
                        fontStyle: 'italic',
                      }}
                    >
                      （无可显示的片段）
                    </Text>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const P_QNA = () => {
  const { token } = useAuth();
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Active SSE stream handle. We keep it in a ref so the cleanup
  // effect can close it on unmount + a new question can abort any
  // still-running prior one (rare race, but possible if the user
  // mashes send fast).
  const streamHandleRef = useRef<StreamAiQuestionHandle | null>(null);

  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([createWelcomeMessage()]);
  const [askProgress, setAskProgress] = useState<{
    progressId: string;
    status: 'running' | 'done' | 'error';
    percent: number;
    stageId: string;
    stages: AiAskProgressStage[];
    error?: string;
  } | null>(null);

  // Recomputed on every messages update; cheap (one pass over the
  // bounded conversation, capped at MAX_STORED_MESSAGES) and avoids
  // an extra state field that could drift from `messages`.
  const currentMode = useMemo(() => pickCurrentMode(messages), [messages]);

  // Active citation popover. `null` = closed. Holds both the cite
  // indexes the user tapped AND a snapshot of the source message's
  // citation list, so the modal keeps showing the right data even
  // after the user navigates or new messages arrive.
  const [citationPopover, setCitationPopover] = useState<{
    indexes: number[];
    citations: AiCitation[];
  } | null>(null);

  useEffect(() => {
    const hydrate = async () => {
      try {
        const stored = await AsyncStorage.getItem(CHAT_STORAGE_KEY);
        const parsed = parseStoredMessages(stored);
        if (parsed?.length) {
          setMessages(parsed);
        }
      } finally {
        setIsHydrated(true);
      }
    };

    hydrate();

    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      // Hard-cancel any in-flight SSE on unmount so the orchestrator
      // sees the disconnect and stops billing tokens. The audit row
      // still lands as 'error' (handled server-side).
      if (streamHandleRef.current) {
        streamHandleRef.current.close();
        streamHandleRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    AsyncStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)),
    ).catch(() => {
      // Persistence should never block chatting.
    });
  }, [isHydrated, messages]);

  // AppState-tied stream cancellation. The unmount cleanup above
  // only fires when the screen leaves the navigation stack; when the
  // user backgrounds the app or locks the device the screen stays
  // mounted, the SSE socket stays open, the backend keepalive keeps
  // resetting the watchdog, and the orchestrator keeps burning
  // SiliconFlow tokens for a user who isn't watching. Closing the
  // handle on AppState != 'active' triggers the server-side
  // res.on('close') hook (already wired in PR-Sec-1) and the
  // orchestrator's AbortController stops the upstream LLM request.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && streamHandleRef.current) {
        streamHandleRef.current.close();
        streamHandleRef.current = null;
        // Flip the composer state back to "idle" too. Without this
        // the user returns to a `isSending=true` UI with the send
        // button greyed out until they manually clear the chat,
        // because the stream's onComplete fires after `close()` but
        // the screen has already stopped listening to it.
        setIsSending(false);
        setAskProgress(null);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 60);

    return () => clearTimeout(timer);
  }, [messages, askProgress]);

  const handleClearConversation = () => {
    Alert.alert('清空对话', '将删除本地聊天记录并重新开始一个新会话。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: () => {
          if (progressTimerRef.current) {
            clearInterval(progressTimerRef.current);
            progressTimerRef.current = null;
          }
          // Abort any in-flight SSE so the orchestrator sees the
          // disconnect and stops billing tokens. Without this, the
          // server-side stream keeps running, `onComplete` fires
          // later against a now-empty conversation, and the user's
          // `isSending` stays true so they can't ask a new question.
          if (streamHandleRef.current) {
            streamHandleRef.current.close();
            streamHandleRef.current = null;
          }
          setIsSending(false);
          setAskProgress(null);
          setDraft('');
          setMessages([createWelcomeMessage()]);
          AsyncStorage.removeItem(CHAT_STORAGE_KEY).catch(() => {
            // Ignore storage cleanup failures.
          });
        },
      },
    ]);
  };

  const handleSendPress = async () => {
    const question = draft.trim();
    if (!question || isSending) return;

    if (!token) {
      Alert.alert('请先登录', '登录后才能使用智能问答功能。');
      return;
    }

    const progressId = createProgressId();
    const userMessage: ChatMessage = {
      id: createMessageId('user'),
      role: 'user',
      content: question,
      createdAt: new Date().toISOString(),
      status: 'sent',
    };
    const assistantMessageId = createMessageId('assistant');
    const assistantPlaceholder: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '正在整理回答...',
      createdAt: new Date().toISOString(),
      status: 'loading',
    };
    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    setDraft('');
    setIsSending(true);
    setAskProgress({
      progressId,
      status: 'running',
      percent: 5,
      stageId: 'received',
      stages: defaultProgressStages.map((stage) =>
        stage.id === 'received' ? { ...stage, status: 'active' } : stage,
      ),
    });

    // Map an OrchestratorEvent.type to the legacy progress stage id
    // the bottom card still consumes. Returning null means "don't
    // advance the stage on this event" — the orchestrator emits a
    // bunch of fine-grained events (plan_complete, tool_complete,
    // context_built, answer_delta) that don't move the visible
    // progress bar.
    const stageForEvent = (eventType: AiStreamEvent['type']): string | null => {
      switch (eventType) {
        case 'planning':
          return 'query_gen';
        case 'tool_start':
          return 'kb_search';
        case 'answering':
          return 'final_answer';
        case 'done':
          return 'done';
        default:
          return null;
      }
    };

    // Cancel any in-flight prior stream before opening a new one.
    if (streamHandleRef.current) {
      streamHandleRef.current.close();
      streamHandleRef.current = null;
    }

    // Track whether any answer_delta has landed yet. Until the first
    // one, the bubble shows the "正在整理回答..." placeholder; once
    // tokens start flowing we replace the placeholder with the
    // accumulating answer text. Without this guard, an instant
    // answer (planner answered directly, no streaming) would briefly
    // show empty content before the done frame populated it.
    let receivedAnyDelta = false;
    let accumulatedAnswer = '';

    const handleStreamEvent = (event: AiStreamEvent) => {
      const targetStage = stageForEvent(event.type);
      if (targetStage) {
        setAskProgress((prev) => {
          if (!prev) return prev;
          const stageIdx = prev.stages.findIndex((s) => s.id === targetStage);
          if (stageIdx === -1) return prev;
          // Mark every prior stage done; the target stage active
          // (or done, for the terminal stage); leave later stages
          // pending.
          const stages = prev.stages.map((stage, idx): AiAskProgressStage => {
            if (idx < stageIdx) return { ...stage, status: 'done' };
            if (idx === stageIdx) {
              return {
                ...stage,
                status: targetStage === 'done' ? 'done' : 'active',
                startedAt: stage.startedAt ?? new Date().toISOString(),
                ...(targetStage === 'done' ? { endedAt: new Date().toISOString() } : {}),
              };
            }
            return stage;
          });
          const STAGE_PERCENTS: Record<string, number> = {
            received: 5,
            query_gen: 25,
            kb_search: 60,
            final_answer: 90,
            done: 100,
          };
          return {
            ...prev,
            stages,
            stageId: targetStage,
            percent: Math.max(prev.percent, STAGE_PERCENTS[targetStage] ?? prev.percent),
            status: targetStage === 'done' ? 'done' : 'running',
          };
        });
      }

      if (event.type === 'answer_delta') {
        accumulatedAnswer += event.text;
        setMessages((prev) =>
          prev.map((item) => {
            if (item.id !== assistantMessageId) return item;
            // First delta: drop the placeholder text, keep status
            // 'loading' so the bubble still shows the "thinking"
            // affordance until done.
            if (!receivedAnyDelta) {
              receivedAnyDelta = true;
              return { ...item, content: event.text };
            }
            return { ...item, content: accumulatedAnswer };
          }),
        );
      }
    };

    streamHandleRef.current = streamAiQuestion(question, progressId, {
      onEvent: handleStreamEvent,
      onComplete: (data) => {
        streamHandleRef.current = null;
        setIsSending(false);
        if (!data) {
          // Stream ended without a `done` frame (server-side error
          // or transport blip mid-stream). Mark the bubble errored
          // unless we already started accumulating an answer — in
          // that case keep what we have and just flag the status.
          setMessages((prev) =>
            prev.map((item) =>
              item.id === assistantMessageId
                ? {
                    ...item,
                    status: 'error',
                    content: receivedAnyDelta ? accumulatedAnswer : 'AI 回答中断，请稍后重试。',
                  }
                : item,
            ),
          );
          setAskProgress((prev) =>
            prev
              ? {
                  ...prev,
                  status: 'error',
                  error: 'stream aborted',
                  stages: prev.stages.map((s) =>
                    s.id === prev.stageId ? { ...s, status: 'error' } : s,
                  ),
                }
              : prev,
          );
          return;
        }

        // Happy path: `done` frame arrived, `data` is the
        // narrowed AiAskResponse['data']. Lock in the final
        // content + metadata.
        const finalAnswer = data.answer?.trim() || accumulatedAnswer || '暂时没有生成有效回答。';
        const metadata: AssistantMetadata = {
          toolCalls: data.toolCalls,
          fieldsUsed: data.fieldsUsed,
          usedPersonalData: data.usedPersonalData,
          citations: data.citations,
          redactionMode: data.redactionMode,
          consentLevel: data.consentLevel,
        };
        setMessages((prev) =>
          prev.map((item) =>
            item.id === assistantMessageId
              ? {
                  ...item,
                  content: finalAnswer,
                  createdAt: data.timestamp || new Date().toISOString(),
                  status: 'sent',
                  metadata,
                }
              : item,
          ),
        );
      },
      onError: (error) => {
        streamHandleRef.current = null;
        setIsSending(false);
        // Consent gate comes back as an ApiError on the initial
        // POST (before SSE headers commit), so it surfaces here,
        // not via an `error` SSE frame. Reuse the existing
        // consent-required branch verbatim.
        if (isConsentRequiredError(error)) {
          const consentMessage = '需要先在隐私设置中开启 AI 同意，才能使用智能问答。';
          setMessages((prev) =>
            prev.map((item) =>
              item.id === assistantMessageId
                ? { ...item, content: consentMessage, status: 'error' }
                : item,
            ),
          );
          setAskProgress((prev) =>
            prev
              ? {
                  ...prev,
                  status: 'error',
                  stages: prev.stages.map((stage) =>
                    stage.id === prev.stageId ? { ...stage, status: 'error' } : stage,
                  ),
                  error: consentMessage,
                }
              : prev,
          );
          Alert.alert(
            '需要授权 AI',
            '在使用智能问答前，请到「隐私设置」开启 AI 同意（个人数据 + 第三方 LLM 处理）。',
            [
              { text: '取消', style: 'cancel' },
              { text: '去设置', onPress: () => router.push('/p-privacy_settings') },
            ],
          );
        } else {
          const friendlyMessage = getFriendlyErrorMessage(error);
          setMessages((prev) =>
            prev.map((item) =>
              item.id === assistantMessageId
                ? { ...item, content: friendlyMessage, status: 'error' }
                : item,
            ),
          );
          setAskProgress((prev) =>
            prev
              ? {
                  ...prev,
                  status: 'error',
                  stages: prev.stages.map((stage) =>
                    stage.id === prev.stageId ? { ...stage, status: 'error' } : stage,
                  ),
                  error: friendlyMessage,
                }
              : prev,
          );
        }
      },
    });
  };

  const renderProgressCard = () => {
    if (!askProgress) return null;

    const stages = askProgress.stages.length ? askProgress.stages : defaultProgressStages;
    const percent = Math.min(100, Math.max(0, askProgress.percent));
    const statusText =
      askProgress.status === 'error'
        ? '连接中断'
        : askProgress.status === 'done'
          ? '已完成'
          : '处理中';

    return (
      <View style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressTitle}>本轮回答进度</Text>
          <Text style={styles.progressStatus}>{statusText}</Text>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${percent}%` }]} />
        </View>
        <View style={styles.progressStages}>
          {stages.map((stage) => (
            <View key={stage.id} style={styles.progressStageItem}>
              <View
                style={[
                  styles.progressStageDot,
                  stage.status === 'done' && styles.progressStageDotDone,
                  stage.status === 'active' && styles.progressStageDotActive,
                  stage.status === 'error' && styles.progressStageDotError,
                ]}
              />
              <Text
                style={[
                  styles.progressStageText,
                  stage.status === 'done' && styles.progressStageTextDone,
                  stage.status === 'active' && styles.progressStageTextActive,
                  stage.status === 'error' && styles.progressStageTextError,
                ]}
              >
                {stage.label}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>SMART CHAT</Text>
            <Text style={styles.pageTitle}>智能问答</Text>
            <Text style={styles.pageSubtitle}>
              每条问题独立检索；回答下方会标明引用来源和是否用到你的资料。
            </Text>
          </View>
          <TouchableOpacity
            style={styles.headerAction}
            activeOpacity={0.82}
            onPress={handleClearConversation}
          >
            <FontAwesome6 name="trash-can" size={12} color={CLINICAL_COLORS.text} />
            <Text style={styles.headerActionText}>清空</Text>
          </TouchableOpacity>
        </View>

        <View
          style={{
            marginHorizontal: 20,
            marginBottom: 12,
            padding: 12,
            paddingHorizontal: 14,
            borderRadius: 14,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: CLINICAL_COLORS.backgroundRaised,
            borderWidth: 1,
            borderColor: CLINICAL_COLORS.border,
          }}
        >
          <FontAwesome6 name="circle-info" size={11} color={CLINICAL_COLORS.textMuted} />
          <Text
            style={{
              flex: 1,
              color: CLINICAL_COLORS.textMuted,
              fontSize: 11,
              lineHeight: 16,
            }}
          >
            AI 回答仅供参考，不能替代医生诊断；用到你本人数据时下方会标明。
          </Text>
          <ModeBadge mode={currentMode} />
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map((message) => {
            const isUser = message.role === 'user';
            const isError = message.status === 'error';
            const isLoading = message.status === 'loading';

            return (
              <View
                key={message.id}
                style={[
                  styles.messageRow,
                  isUser ? styles.messageRowUser : styles.messageRowAssistant,
                ]}
              >
                {!isUser ? (
                  <View
                    style={[styles.avatar, isError ? styles.avatarError : styles.avatarAssistant]}
                  >
                    <FontAwesome6
                      name={isError ? 'triangle-exclamation' : 'robot'}
                      size={12}
                      color={isError ? CLINICAL_COLORS.warning : CLINICAL_COLORS.accentStrong}
                    />
                  </View>
                ) : null}

                <View
                  style={[
                    styles.messageBubble,
                    isUser ? styles.messageBubbleUser : styles.messageBubbleAssistant,
                    isError && styles.messageBubbleError,
                  ]}
                >
                  {!isUser ? (
                    <Text style={styles.messageAuthor}>{isError ? '系统提示' : 'OpenRD 助手'}</Text>
                  ) : null}
                  {renderMessageContent(message, isUser, (indexes, citations) =>
                    setCitationPopover({ indexes, citations }),
                  )}
                  <AssistantMetadataBlock message={message} />
                  <View style={styles.messageMetaRow}>
                    <Text style={styles.messageTime}>{formatMessageTime(message.createdAt)}</Text>
                    {isLoading ? <Text style={styles.messageStateText}>处理中</Text> : null}
                  </View>
                </View>
              </View>
            );
          })}

          {renderProgressCard()}
        </ScrollView>

        <View style={styles.composerShell}>
          <View style={styles.composerCard}>
            <TextInput
              ref={inputRef}
              style={styles.composerInput}
              placeholder="输入你想问的 FSHD 问题..."
              placeholderTextColor={CLINICAL_COLORS.textMuted}
              value={draft}
              onChangeText={setDraft}
              multiline
              textAlignVertical="top"
              returnKeyType="send"
              onSubmitEditing={handleSendPress}
            />
            <TouchableOpacity
              style={[styles.sendButton, (!draft.trim() || isSending) && styles.sendButtonDisabled]}
              activeOpacity={0.85}
              onPress={handleSendPress}
              disabled={!draft.trim() || isSending}
            >
              <FontAwesome6
                name={isSending ? 'spinner' : 'paper-plane'}
                size={14}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          </View>
          <Text style={styles.composerHint}>
            每条问题独立处理；如需引用你本人数据，请确认隐私设置已开启 AI 同意。
          </Text>
        </View>
      </KeyboardAvoidingView>

      <CitationPopoverModal popover={citationPopover} onClose={() => setCitationPopover(null)} />
    </SafeAreaView>
  );
};

export default P_QNA;
