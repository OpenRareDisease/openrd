import { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Icon from '../common/Icon';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Button from '../common/Button';
import AnswerText from '../common/AnswerText';
import { useAuth } from '../../contexts/AuthContext';
import {
  ApiError,
  AiAskProgressStage,
  type AiCitation,
  type AiStreamEvent,
  QNA_CHAT_STORAGE_KEY,
  type StreamAiQuestionHandle,
  isConsentRequiredError,
  updateMyConsent,
} from '../../lib/api';
import { streamAiQuestion } from '../../lib/ai-streaming';
import { formatCitationLabel } from '../../lib/citation-label';
import { COLOR, INTERACTION, MOTION } from '../../lib/design';
import { bumpConsentEpoch, getConsentEpoch } from '../../lib/consent-epoch';
import { useProfileContext } from '../../contexts/ProfileContext';
import { collectProfileGaps } from '../../lib/data-asset';
import { type ChatMessage, buildHistoryPayload, parseStoredMessages } from './chat-storage';
import { normalizeCitationIndexes, parseCitationSegments } from './citations';
import { buildCitationSummary, humanizeToolName } from './humanize';
import { synthesizeLegacyToolCalls, type AssistantMetadata } from './metadata';
import { pickCurrentMode } from './mode';
import { useAppDialog } from '../common/feedback/AppDialog';
import styles from './styles';

// Backed by `QNA_CHAT_STORAGE_KEY` in lib/api so the AuthContext's
// logout sweep + the 401 handler can purge it without import cycles.
const CHAT_STORAGE_KEY = QNA_CHAT_STORAGE_KEY;
const MAX_STORED_MESSAGES = 100;

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
  const color = isPrecise ? COLOR.accent : COLOR.inkMuted;
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
        backgroundColor: COLOR.surface,
      }}
      accessibilityRole="text"
      accessibilityLabel={`当前隐私模式：${label}`}
    >
      <Icon name={isPrecise ? 'wand-magic-sparkles' : 'shield-halved'} size={10} color={color} />
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
  const router = useRouter();
  const { profile } = useProfileContext();

  if (message.role !== 'assistant') return null;
  if (message.status !== 'sent') return null;
  const meta = message.metadata;
  if (!meta) return null;

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

  // Plain-language headline:「本次引用了你的：健康档案（…）、检查
  // 报告（…）」— or the explicit negative for KB-only answers.
  const citationLine = buildCitationSummary({
    usedPersonalData: meta.usedPersonalData,
    fieldsUsed: meta.fieldsUsed,
    toolCalls,
  });

  // "Feed the flywheel" hint: when this answer touched (or tried to
  // touch) personal data and the profile still has gaps, point at
  // the first one. Shares collectProfileGaps with the archive
  // overview / home cards so all three surfaces name the same gaps.
  const firstGap = citationLine && profile ? (collectProfileGaps(profile)[0] ?? null) : null;

  if (!citationLine && !showCitations && !showTrace) return null;

  // Raw ingest filenames — 「gkaf643.pdf」、「…_副本.pdf」— defeat the
  // point of naming a source. See lib/citation-label.ts.
  const citationFiles = citations.map((c) => formatCitationLabel(c.sourceFile));
  const citationFilesPreview = citationFiles.slice(0, 3).join('、');
  const citationOverflow = citationFiles.length > 3 ? '…' : '';

  return (
    <View
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: COLOR.line,
        gap: 4,
      }}
    >
      {citationLine ? (
        <Text style={{ color: COLOR.inkMuted, fontSize: 11, lineHeight: 16 }}>{citationLine}</Text>
      ) : null}
      {showTrace ? (
        <>
          <Button
            label={`AI 思考过程 (${toolCalls.length} 步)`}
            icon="wand-magic-sparkles"
            trailingIcon={traceExpanded ? 'chevron-up' : 'chevron-down'}
            variant="plain"
            compact
            accessibilityLabel={
              traceExpanded ? '收起 AI 思考过程' : `展开 AI 思考过程（${toolCalls.length} 步）`
            }
            onPress={() => setTraceExpanded((prev) => !prev)}
          />
          {traceExpanded ? (
            <View style={{ marginTop: 4, gap: 6 }}>
              {toolCalls.map((call) => {
                const isError = call.status === 'error';
                const statusColor = isError ? COLOR.warn : COLOR.good;
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
                          color: COLOR.ink,
                          fontSize: 11,
                          lineHeight: 16,
                          fontWeight: '600',
                        }}
                      >
                        {humanizeToolName(call.name)}
                      </Text>
                      <Text style={{ color: statusColor, fontSize: 10, fontWeight: '700' }}>
                        {isError ? '失败' : '成功'}
                      </Text>
                    </View>
                    <Text style={{ color: COLOR.inkMuted, fontSize: 10, lineHeight: 14 }}>
                      返回 {call.chunkCount} 段
                      {call.latencyMs != null ? ` · ${call.latencyMs}ms` : ''}
                    </Text>
                    {isError && call.errorDetail ? (
                      <Text
                        style={{
                          color: COLOR.warn,
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
          <Button
            label={
              citationFilesPreview
                ? `引用 ${citations.length} 条：${citationFilesPreview}${citationOverflow}`
                : `引用 ${citations.length} 条`
            }
            icon="link"
            trailingIcon={expanded ? 'chevron-up' : 'chevron-down'}
            variant="plain"
            compact
            accessibilityLabel={expanded ? '收起引用列表' : `展开 ${citations.length} 条引用详情`}
            onPress={() => setExpanded((prev) => !prev)}
          />
          {expanded ? (
            <View style={{ marginTop: 4, gap: 8 }}>
              {citations.map((c, idx) => (
                <View
                  key={c.chunkId}
                  style={{
                    paddingLeft: 8,
                    borderLeftWidth: 2,
                    borderLeftColor: COLOR.line,
                    gap: 2,
                  }}
                >
                  <Text
                    style={{
                      color: COLOR.ink,
                      fontSize: 11,
                      lineHeight: 16,
                      fontWeight: '600',
                    }}
                  >
                    {idx + 1}. {formatCitationLabel(c.sourceFile, c.source)}
                    {c.chunkIndex !== null && c.chunkIndex !== undefined
                      ? ` · 段 ${c.chunkIndex}`
                      : ''}
                  </Text>
                  {c.snippet ? (
                    <Text
                      style={{
                        color: COLOR.inkMuted,
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
      {firstGap ? (
        <Button
          label={`补上「${firstGap.label}」，AI 的回答会更贴合你的情况`}
          trailingIcon="arrow-right"
          variant="plain"
          compact
          accessibilityLabel={`补充${firstGap.label}，获得更贴合的回答`}
          onPress={() => router.push(firstGap.route)}
        />
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

  // The user's own message is never Markdown, and running it through
  // the answer formatter would reflow whatever they typed — a question
  // like「- 是什么意思」would come back as a bullet.
  if (isUser) {
    return <Text style={baseStyle}>{message.content}</Text>;
  }

  if (citations.length === 0) {
    return <AnswerText style={StyleSheet.flatten(baseStyle)}>{message.content}</AnswerText>;
  }

  return (
    <AnswerText
      style={StyleSheet.flatten(baseStyle)}
      renderText={(text) => renderCitationSegments(text, citations, onCitationPress)}
    >
      {message.content}
    </AnswerText>
  );
};

/** `[1]` → a tappable marker, applied inside whatever block the
 *  formatter produced. */
const renderCitationSegments = (
  text: string,
  citations: AiCitation[],
  onCitationPress: (indexes: number[], citations: AiCitation[]) => void,
) => {
  const segments = parseCitationSegments(text, citations.length);
  return (
    <>
      {segments.map((seg, idx) => {
        if (seg.type === 'text') {
          return <Text key={`t-${idx}`}>{seg.value}</Text>;
        }
        return (
          <Text
            key={`c-${idx}`}
            onPress={() => onCitationPress(seg.indexes, citations)}
            accessibilityRole="link"
            accessibilityLabel={`查看引用 ${seg.indexes.join('、')}`}
            style={{
              color: COLOR.accent,
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
    </>
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
          backgroundColor: COLOR.scrim,
          justifyContent: 'flex-end',
        }}
      >
        {/* The inner card stops bubble-up so taps INSIDE the sheet
         *  don't close it. Pressable + onPress=undefined would still
         *  capture but not respond, which is what we want. */}
        {/* Structural bubble-stopper, never a control — without
            accessible={false} it swallows the whole citation sheet
            into one element, the same defect the 3 modals had. */}
        <Pressable
          accessible={false}
          onPress={() => {}}
          style={{
            backgroundColor: COLOR.well,
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
            <Text style={{ color: COLOR.ink, fontSize: 14, fontWeight: '700' }}>
              引用详情 · {visibleIndexes.length} 条
            </Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="关闭引用详情"
              // 16pt glyph + 10 was 36pt. 16 clears MIN_TOUCH_TARGET.
              hitSlop={16}
            >
              <Icon name="xmark" size={16} color={COLOR.inkMuted} />
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
                    borderLeftColor: COLOR.accent,
                    gap: 4,
                  }}
                >
                  <Text
                    style={{
                      color: COLOR.ink,
                      fontSize: 12,
                      fontWeight: '700',
                      lineHeight: 17,
                    }}
                  >
                    [{i}] {formatCitationLabel(c.sourceFile, c.source)}
                    {c.chunkIndex !== null && c.chunkIndex !== undefined
                      ? ` · 段 ${c.chunkIndex}`
                      : ''}
                  </Text>
                  {c.snippet ? (
                    <Text
                      style={{
                        color: COLOR.inkSoft,
                        fontSize: 12,
                        lineHeight: 18,
                      }}
                    >
                      {capCitationSnippet(c.snippet)}
                    </Text>
                  ) : (
                    <Text
                      style={{
                        color: COLOR.inkMuted,
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
  const { confirm, notify } = useAppDialog();
  const params = useLocalSearchParams();
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

  // Contextual entries (report detail's「问 AI 这份报告」, manage's
  //「问我的趋势」) land here with a prefilled question. Prefill only —
  // the user reviews and taps send themselves. `prefillNonce` changes
  // per tap so pressing the same entry twice re-applies even though
  // the prefill text is identical.
  const prefillParam = Array.isArray(params.prefill) ? params.prefill[0] : params.prefill;
  const prefillNonce = Array.isArray(params.prefillNonce)
    ? params.prefillNonce[0]
    : params.prefillNonce;
  useEffect(() => {
    if (typeof prefillParam === 'string' && prefillParam.trim()) {
      setDraft(prefillParam);
      inputRef.current?.focus();
    }
    // Deps are the params pair only — the effect re-runs per tap
    // (nonce), never per keystroke.
  }, [prefillParam, prefillNonce]);
  const [isGrantingConsent, setIsGrantingConsent] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([createWelcomeMessage()]);
  // Live mirror of `messages` for async flows (sendQuestion awaits
  // the epoch read before snapshotting history — the closure value
  // could be stale by then).
  const messagesRef = useRef<ChatMessage[]>(messages);

  /** Newest message still blocked on consent, if any. */
  const latestConsentPromptId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.status === 'error' && m.failedQuestion && m.consentRequired) return m.id;
    }
    return null;
  }, [messages]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  // Last epoch this screen has acknowledged with a divider bubble.
  const lastKnownEpochRef = useRef<number | null>(null);
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

  // NOTE: an earlier iteration force-closed the SSE stream whenever
  // AppState left 'active' (to stop LLM token spend for a user who
  // isn't watching). In practice that meant glancing at another app
  // mid-answer destroyed the whole response. The cost ceiling of NOT
  // closing is one already-in-flight answer (~seconds of streaming),
  // and if the OS does kill the socket in the background, the 15s
  // idle watchdog in lib/ai-streaming surfaces an errored bubble
  // whose「重试」button recovers with one tap — so the answer's
  // survival wins.

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 60);

    return () => clearTimeout(timer);
  }, [messages, askProgress]);

  /** Destroys the local transcript, and on web the confirmation step
   *  never ran: `Alert.alert` is an empty function there, so 清空 wiped
   *  the conversation on the first press. */
  const handleClearConversation = async () => {
    const confirmed = await confirm({
      title: '清空对话',
      message: '将删除本地聊天记录并重新开始一个新会话。',
      confirmLabel: '清空',
      destructive: true,
    });
    if (!confirmed) return;

    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    // Abort any in-flight SSE so the orchestrator sees the disconnect
    // and stops billing tokens. Without this, the server-side stream
    // keeps running, `onComplete` fires later against a now-empty
    // conversation, and the user's `isSending` stays true so they
    // can't ask a new question.
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
  };

  const handleSendPress = () => {
    const question = draft.trim();
    if (!question || isSending) return;

    if (!token) {
      notify({
        title: '请先登录',
        message: '登录后才能使用智能问答功能。',
        tone: 'info',
        // The old Alert only named the problem. The route is one tap
        // away, so offer it rather than making the patient find it.
        action: { label: '去登录', onPress: () => router.push('/p-login_register') },
      });
      return;
    }

    // Clearing the draft here is fine because every failure path
    // below hands the question back: consent/network errors restore
    // it into the composer, and stream aborts pin it to the errored
    // bubble's「重试」button. The user never has to retype.
    setDraft('');
    void sendQuestion(question);
  };

  /** One-tap consent grant + resend, from the inline card on a
   *  consent-gated bubble. Grants BOTH flags QnA requires (backend:
   *  personal && thirdParty, else 403) in a single call, then reuses
   *  the retry path so the pinned question resends automatically. */
  const handleGrantConsentAndRetry = async (message: ChatMessage) => {
    if (isSending || isGrantingConsent || !message.failedQuestion) return;
    setIsGrantingConsent(true);
    try {
      await updateMyConsent({ personal: true, thirdParty: true });
      // Any consent change starts a new history epoch (same rule as
      // the privacy screen's switches). Sync the local ref so the
      // retry below doesn't announce a divider for a change the user
      // just made right here.
      lastKnownEpochRef.current = await bumpConsentEpoch();
      handleRetry(message);
    } catch (error) {
      const detail =
        error instanceof ApiError && error.status === 404
          ? '请先在「我的 → 编辑档案」完成基础档案，再开启 AI 授权。'
          : getFriendlyErrorMessage(error);
      notify({ title: '授权失败', message: detail, tone: 'error' });
    } finally {
      setIsGrantingConsent(false);
    }
  };

  /** One-tap recovery on an errored bubble: drop the error bubble
   *  (its user question stays in the transcript) and resend the
   *  pinned question without making the user retype it. */
  const handleRetry = (message: ChatMessage) => {
    if (isSending || !message.failedQuestion) return;
    const question = message.failedQuestion;
    // The consent-403 path also restores the question into the
    // composer. When the user recovers via THIS button instead,
    // clear that copy — otherwise one accidental send fires a
    // duplicate. Leave the composer alone if they typed something
    // new meanwhile.
    setDraft((prev) => (prev.trim() === question.trim() ? '' : prev));
    setMessages((prev) => prev.filter((item) => item.id !== message.id));
    void sendQuestion(question, { reuseUserBubble: true });
  };

  /** Open a stream for `question`. `reuseUserBubble` is set by the
   *  retry path, where the original user message is already in the
   *  transcript and only the assistant placeholder must be added. */
  const sendQuestion = async (question: string, opts?: { reuseUserBubble?: boolean }) => {
    const progressId = createProgressId();
    const assistantMessageId = createMessageId('assistant');

    // Multi-turn: read the consent epoch FIRST. If it moved since the
    // last send (privacy switches changed), announce the boundary —
    // older messages stop replaying as history from here on. A null
    // prevEpoch means this is the first send since mount: nothing to
    // announce (the epoch FILTER below still applies regardless —
    // the divider is a courtesy, the filter is the guarantee).
    const epoch = await getConsentEpoch();
    const prevEpoch = lastKnownEpochRef.current;
    lastKnownEpochRef.current = epoch;
    if (prevEpoch !== null && epoch !== prevEpoch) {
      setMessages((prev) => {
        const hasReplayableHistory = prev.some(
          (item) => item.status === 'sent' && item.id !== 'welcome' && !item.systemDivider,
        );
        if (!hasReplayableHistory) return prev;
        return [
          ...prev,
          {
            id: createMessageId('divider'),
            role: 'assistant',
            content: '隐私设置已变更，新的对话不再引用之前的回答。',
            createdAt: new Date().toISOString(),
            status: 'sent',
            systemDivider: true,
            epoch,
          },
        ];
      });
    }

    // Snapshot BEFORE appending the new question, so the question
    // can't duplicate itself into its own history.
    let historyPayload = buildHistoryPayload(messagesRef.current, epoch);
    // Retry reuses the existing user bubble — the question is already
    // the LAST history entry there. Sending it in both places would
    // make the model see the user ask twice in a row.
    if (opts?.reuseUserBubble) {
      const last = historyPayload[historyPayload.length - 1];
      if (last?.role === 'user' && last.content === question) {
        historyPayload = historyPayload.slice(0, -1);
      }
    }

    const assistantPlaceholder: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '正在整理回答...',
      createdAt: new Date().toISOString(),
      status: 'loading',
      epoch,
    };
    if (opts?.reuseUserBubble) {
      setMessages((prev) => [...prev, assistantPlaceholder]);
    } else {
      const userMessage: ChatMessage = {
        id: createMessageId('user'),
        role: 'user',
        content: question,
        createdAt: new Date().toISOString(),
        status: 'sent',
        epoch,
      };
      setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    }
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
          // Retrieval can now run more than once — the orchestrator
          // loops when the model needs a second lookup — so the event
          // stream legitimately revisits `tool_start` after `answering`.
          // `percent` was already guarded with Math.max, but the stage
          // list was not: the earlier stage went back to 'active' while
          // 生成回答 stayed active too, lighting two rows at once and
          // walking the current-stage label backwards. Progress that
          // retreats reads as a failure and a restart.
          const currentIdx = prev.stages.findIndex((s) => s.id === prev.stageId);
          if (currentIdx > stageIdx) {
            return {
              ...prev,
              // Say what is actually happening instead of pretending
              // nothing did.
              stages: prev.stages.map((stage, idx) =>
                idx === currentIdx ? { ...stage, label: '再检索一次并整理回答' } : stage,
              ),
            };
          }
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

      // Assign, including when `text` is empty — an empty reset means
      // "clear the bubble, more is still coming" (a gather round's note
      // about fetching more, or the instant before a streamed retry).
      // Treating that as a no-op would leave the abandoned text on
      // screen, which is what the frame exists to remove.
      if (event.type === 'answer_reset') {
        accumulatedAnswer = event.text;
        receivedAnyDelta = true;
        setMessages((prev) =>
          prev.map((item) =>
            item.id === assistantMessageId ? { ...item, content: event.text } : item,
          ),
        );
      }
    };

    streamHandleRef.current = streamAiQuestion(
      question,
      progressId,
      {
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
                      failedQuestion: question,
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
            const consentMessage = '需要你的授权，AI 才能回答这个问题。';
            // No Alert, no detour to the settings screen: the errored
            // bubble itself renders a consent card with a one-tap
            // "允许并继续" that grants both required flags and resends
            // the pinned question. The old flow (Alert → privacy screen
            // → two switches × two dialogs → come back → retype) lost
            // the question and most users.
            setMessages((prev) =>
              prev.map((item) =>
                item.id === assistantMessageId
                  ? {
                      ...item,
                      content: consentMessage,
                      status: 'error',
                      failedQuestion: question,
                      consentRequired: true,
                    }
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
          } else {
            const friendlyMessage = getFriendlyErrorMessage(error);
            setMessages((prev) =>
              prev.map((item) =>
                item.id === assistantMessageId
                  ? { ...item, content: friendlyMessage, status: 'error', failedQuestion: question }
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
      },
      { history: historyPayload },
    );
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
        {/* 问答 is a tab now, so the back control this header used to
            carry is gone — the bar is the way out, and an arrow above
            it would point nowhere the bar doesn't already go. What it
            needs instead is the same title treatment 今天 and 我的
            have, or the screen opens on a paragraph of small grey
            text with no name on it. */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.pageTitle}>问答</Text>
            <Text style={styles.pageSubtitle}>
              每条问题独立检索；回答下方会标明引用来源和是否用到你的资料。
            </Text>
          </View>
          <Button
            label="清空"
            icon="trash-can"
            variant="destructive"
            compact
            accessibilityLabel="清空对话"
            onPress={() => {
              void handleClearConversation();
            }}
          />
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
            backgroundColor: COLOR.well,
            borderWidth: 1,
            borderColor: COLOR.line,
          }}
        >
          <Icon name="circle-info" size={11} color={COLOR.inkMuted} />
          <Text
            style={{
              flex: 1,
              color: COLOR.inkMuted,
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
            // Only the newest consent-blocked bubble offers the grant
            // action. Consent is global, so an older bubble's button
            // does the same thing — but each one rendered a filled
            // accent 「允许并继续」, and asking three times before
            // granting stacked three primaries down the transcript.
            const isLatestConsentPrompt = message.id === latestConsentPromptId;
            const isError = message.status === 'error';
            const isLoading = message.status === 'loading';

            if (message.systemDivider) {
              return (
                <View key={message.id} style={styles.systemDividerRow}>
                  <View style={styles.systemDividerLine} />
                  <Text style={styles.systemDividerText}>{message.content}</Text>
                  <View style={styles.systemDividerLine} />
                </View>
              );
            }

            return (
              <Animated.View
                key={message.id}
                // A message that simply appears reads as the whole list
                // re-rendering. Entering from below is what marks it as
                // the new one.
                entering={FadeInDown.springify().damping(MOTION.present.damping)}
                style={[
                  styles.messageRow,
                  isUser ? styles.messageRowUser : styles.messageRowAssistant,
                ]}
              >
                {!isUser ? (
                  <View
                    style={[styles.avatar, isError ? styles.avatarError : styles.avatarAssistant]}
                  >
                    <Icon
                      name={isError ? 'triangle-exclamation' : 'robot'}
                      size={12}
                      color={isError ? COLOR.warn : COLOR.accent}
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
                  {isError &&
                  message.failedQuestion &&
                  message.consentRequired &&
                  isLatestConsentPrompt ? (
                    <View style={styles.consentCard}>
                      <Text style={styles.consentCardText}>
                        允许后，AI
                        会引用你档案与报告中已脱敏的内容回答，问题将发送到云端大模型处理。你可以随时在「隐私设置」撤回授权。
                      </Text>
                      <Button
                        label="允许并继续"
                        icon="check"
                        variant="prominent"
                        busy={isGrantingConsent}
                        disabled={isSending}
                        onPress={() => void handleGrantConsentAndRetry(message)}
                      />
                      <Button
                        label="查看详细设置"
                        variant="plain"
                        compact
                        onPress={() => router.push('/p-privacy_settings')}
                      />
                    </View>
                  ) : isError && message.failedQuestion ? (
                    <Button
                      label="重试这个问题"
                      icon="rotate-right"
                      variant="tinted"
                      compact
                      disabled={isSending}
                      onPress={() => handleRetry(message)}
                    />
                  ) : null}
                  <View style={styles.messageMetaRow}>
                    <Text style={styles.messageTime}>{formatMessageTime(message.createdAt)}</Text>
                    {isLoading ? <Text style={styles.messageStateText}>处理中</Text> : null}
                  </View>
                </View>
              </Animated.View>
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
              placeholderTextColor={COLOR.inkMuted}
              value={draft}
              onChangeText={setDraft}
              multiline
              textAlignVertical="top"
              returnKeyType="send"
              onSubmitEditing={handleSendPress}
            />
            <TouchableOpacity
              style={[styles.sendButton, (!draft.trim() || isSending) && styles.sendButtonDisabled]}
              activeOpacity={INTERACTION.pressOpacity}
              accessibilityRole="button"
              accessibilityLabel={isSending ? '正在发送' : '发送问题'}
              onPress={handleSendPress}
              disabled={!draft.trim() || isSending}
            >
              {/* A spinner glyph that does not spin is worse than no
                  spinner: it reads as a stuck button. */}
              {isSending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Icon name="paper-plane" size={16} color="#FFFFFF" />
              )}
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
