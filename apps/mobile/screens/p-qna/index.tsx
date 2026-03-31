import { useEffect, useRef, useState } from 'react';
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
import { FontAwesome6 } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import {
  ApiError,
  AiAskProgressStage,
  askAiQuestion,
  getAiAskProgress,
  initAiAskProgress,
} from '../../lib/api';
import { CLINICAL_COLORS } from '../../lib/clinical-visuals';
import styles from './styles';

type ChatRole = 'assistant' | 'user';
type ChatMessageStatus = 'sent' | 'loading' | 'error';

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  status: ChatMessageStatus;
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
    '可以直接问我 FSHD 相关问题，也可以连续追问。最近几轮对话会保留在本地，并一并提供给问答接口，方便上下文延续。',
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
    const recentConversation = [
      ...messages
        .filter((item) => item.status !== 'error' && item.content.trim())
        .slice(-6)
        .map((item) => ({
          role: item.role,
          content: item.content,
        })),
      { role: 'user' as const, content: question },
    ];

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
      const response = await askAiQuestion(
        question,
        {
          language: 'zh',
          memoryMode: 'recent_messages',
          conversationHistory: recentConversation.slice(-8),
        },
        progressId,
      );
      const answer = response.data.answer?.trim() || '暂时没有生成有效回答。';

      setMessages((prev) =>
        prev.map((item) =>
          item.id === assistantMessageId
            ? {
                ...item,
                content: answer,
                createdAt: response.data.timestamp || new Date().toISOString(),
                status: 'sent',
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
            <Text style={styles.pageSubtitle}>保留最近对话，方便连续追问和补充上下文。</Text>
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

        <View style={styles.memoryBanner}>
          <View style={styles.memoryIconWrap}>
            <FontAwesome6 name="brain" size={14} color={CLINICAL_COLORS.accentStrong} />
          </View>
          <View style={styles.memoryContent}>
            <Text style={styles.memoryTitle}>连续对话已开启</Text>
            <Text style={styles.memoryText}>
              页面会保留最近聊天内容；下一次提问时，会把最近几轮对话一起发给问答接口。
            </Text>
          </View>
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
              placeholder="输入你的问题，支持连续追问..."
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
          <Text style={styles.composerHint}>适合连续追问，例如“结合我上一条再解释一下”。</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default P_QNA;
