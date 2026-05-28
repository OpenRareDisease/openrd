import { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
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
  type ConsentLevel,
  askAiQuestion,
  getAiAskProgress,
  initAiAskProgress,
  isConsentRequiredError,
} from '../../lib/api';
import { CLINICAL_COLORS } from '../../lib/clinical-visuals';
import { pickCurrentMode } from './mode';
import styles from './styles';

type ChatRole = 'assistant' | 'user';
type ChatMessageStatus = 'sent' | 'loading' | 'error';

/** Metadata the orchestrator returns alongside an assistant answer.
 *  Persisted with the message so revisiting an old chat still shows
 *  citations + "本回答用到了你的..." hint. */
type AssistantMetadata = {
  toolsCalled?: string[];
  fieldsUsed?: string[];
  usedPersonalData?: boolean;
  citations?: AiCitation[];
  /** Per-message snapshot of the redaction mode the orchestrator
   *  picked for this call. Drives the at-a-glance mode chip in the
   *  page header (see `pickCurrentMode`). Persisted so revisiting an
   *  old chat keeps showing the mode the answer was generated under
   *  — even if the user has since toggled their consent. */
  redactionMode?: 'strict' | 'precise';
  /** Companion to `redactionMode`. Captured for future use by the
   *  audit / debug overlays; the mode chip itself only reads
   *  `redactionMode`. */
  consentLevel?: ConsentLevel;
};

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  status: ChatMessageStatus;
  metadata?: AssistantMetadata;
};

const CHAT_STORAGE_KEY = 'openrd.qna.chatMessages.v1';
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

    const messages = parsed.filter((item): item is ChatMessage => {
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
    });

    return messages.length ? messages : null;
  } catch {
    return null;
  }
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
const AssistantMetadata = ({ message }: { message: ChatMessage }) => {
  const [expanded, setExpanded] = useState(false);

  if (message.role !== 'assistant') return null;
  if (message.status !== 'sent') return null;
  const meta = message.metadata;
  if (!meta) return null;

  const showFields = meta.usedPersonalData && (meta.fieldsUsed?.length ?? 0) > 0;
  const citations = meta.citations ?? [];
  const showCitations = citations.length > 0;
  if (!showFields && !showCitations) return null;

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
                      {c.snippet}
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

const P_QNA = () => {
  const { token } = useAuth();
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    const pollProgress = async () => {
      try {
        const response = await getAiAskProgress(progressId);
        setAskProgress(response.data);
      } catch {
        // Ignore polling failures and let the main request decide the result.
      }
    };

    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
    }

    await initAiAskProgress(progressId);
    progressTimerRef.current = setInterval(pollProgress, 1200);
    pollProgress();

    try {
      const response = await askAiQuestion(question, progressId);
      const answer = response.data.answer?.trim() || '暂时没有生成有效回答。';
      const metadata: AssistantMetadata = {
        toolsCalled: response.data.toolsCalled,
        fieldsUsed: response.data.fieldsUsed,
        usedPersonalData: response.data.usedPersonalData,
        citations: response.data.citations,
        redactionMode: response.data.redactionMode,
        consentLevel: response.data.consentLevel,
      };

      setMessages((prev) =>
        prev.map((item) =>
          item.id === assistantMessageId
            ? {
                ...item,
                content: answer,
                createdAt: response.data.timestamp || new Date().toISOString(),
                status: 'sent',
                metadata,
              }
            : item,
        ),
      );
      setAskProgress((prev) =>
        prev
          ? {
              ...prev,
              status: 'done',
              percent: 100,
              stageId: 'done',
              stages: prev.stages.map((stage) => ({
                ...stage,
                status: 'done',
              })),
            }
          : prev,
      );
    } catch (error) {
      // Special-case the consent gate: instead of showing a raw error
      // text in the bubble, point the user at the privacy settings
      // page where they can grant consent. Without this, a 403 looks
      // like a generic failure and the user has no actionable path
      // out of it.
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
              ? {
                  ...item,
                  content: friendlyMessage,
                  status: 'error',
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
                error: friendlyMessage,
              }
            : prev,
        );
      }
    } finally {
      setIsSending(false);
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    }
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
                  <Text
                    style={[
                      styles.messageText,
                      isUser ? styles.messageTextUser : styles.messageTextAssistant,
                    ]}
                  >
                    {message.content}
                  </Text>
                  <AssistantMetadata message={message} />
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
    </SafeAreaView>
  );
};

export default P_QNA;
