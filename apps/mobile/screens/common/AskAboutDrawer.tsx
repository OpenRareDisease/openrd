import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './Icon';
import { MIN_TOUCH_TARGET, expandHitSlop } from '../../lib/a11y';
import { formatCitationLabel } from '../../lib/citation-label';

import { COLOR, HAIRLINE, INTERACTION, RADIUS, SPACE, TYPE } from '../../lib/design';
import Button from './Button';
import AnswerText from './AnswerText';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { QNA_CHAT_STORAGE_KEY } from '../../lib/api';
import { appendTurnsToStoredChat } from '../p-qna/chat-storage';
import { streamAiQuestion } from '../../lib/ai-streaming';
import {
  ApiError,
  isConsentRequiredError,
  type AiAskContext,
  type AiCitation,
} from '../../lib/api';

/**
 * 「这什么意思」— asking from where you already are.
 *
 * Before this, a question about a number meant leaving the number
 * behind, opening 问答, and describing from memory the thing you were
 * just looking at. That asks the patient to do the one part of the job
 * they're worst placed to do: knowing what to ask.
 *
 * The drawer carries the object with it. The client sends only a
 * reference — a document id, or an allowlisted metric key — and the
 * server resolves it, checks ownership, and steers the planner at the
 * right retriever. Nothing about the object's *content* travels in the
 * prompt from here; it still comes back through the redacted tool path.
 */

const createProgressId = () =>
  `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * The one failure class retrying cannot fix.
 *
 * `/ai/ask/stream` answers 404 `context_not_found` when the referenced
 * report or follow-up event is gone — deleted, or never this user's —
 * and 400 `invalid_context` when the reference no longer parses. Both
 * are properties of the *reference*, not of the attempt: the same
 * retry button will land on the same status forever. A patient who
 * deleted a report last week and taps「重试」on yesterday's drawer is
 * being asked to keep pressing a key that is wired to nothing, so the
 * caller has to be able to tell this apart and offer dropping the
 * context instead.
 */
const isDeadContextError = (error: unknown): boolean => {
  if (!(error instanceof ApiError)) return false;
  const code = (error.data as { code?: string } | null)?.code ?? null;
  if (code === 'context_not_found' || code === 'invalid_context') return true;
  // react-native-sse only hands back a parseable body when the error
  // arrives as a JSON string, so `code` can be missing on a genuine
  // 404. Status alone is enough there: the route exists, and the only
  // thing on it that can be "not found" is the context reference.
  // 400 is deliberately NOT included — it also covers a malformed
  // question, where dropping the context would be wrong advice.
  return error.status === 404;
};

export interface AskAboutDrawerProps {
  visible: boolean;
  onClose: () => void;
  /** What the question is about. Omit for a genuinely open question
   *  (the daily brief spans everything and pins to no single object);
   *  the drawer then behaves like 问答 with no context pill. */
  context?: AiAskContext;
  /** Human label for the context pill. Ignored when `context` is
   *  absent — an empty pill would promise a link that isn't there. */
  contextLabel?: string;
  /** Tap-to-ask starters. Keep them short and genuinely different —
   *  they exist so the patient never faces an empty input. */
  suggestions?: string[];
}

const DEFAULT_SUGGESTIONS = ['这什么意思', '这个变化要紧吗', '下次门诊我该问什么'];

const AskAboutDrawer = ({
  visible,
  onClose,
  context,
  contextLabel,
  suggestions = DEFAULT_SUGGESTIONS,
}: AskAboutDrawerProps) => {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [draft, setDraft] = useState('');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<AiCitation[]>([]);
  const [status, setStatus] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle');
  /** Completed turns, oldest first. The drawer advertises「再问一句」,
   *  so the follow-up has to carry what was already said — otherwise
   *  「那我该怎么办」reaches the model as an orphan sentence with no
   *  referent. Mirrors what p-qna already passes. */
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>(
    [],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** Which recovery the error deserves. 'dead_context' means the retry
   *  key is a dead end and the only forward move is dropping the
   *  context; everything else is a plain retry. */
  const [errorKind, setErrorKind] = useState<'generic' | 'dead_context'>('generic');
  /** Sticky once the patient escapes a dead reference: the object is
   *  gone for the rest of this drawer, so follow-ups must not re-attach
   *  it and walk back into the same 404. */
  const [contextDropped, setContextDropped] = useState(false);
  /** The answer on screen was cut short by the patient, not by the
   *  model. Worth saying — a paragraph that stops mid-sentence
   *  otherwise reads as the model losing its train of thought. */
  const [stopped, setStopped] = useState(false);
  const handleRef = useRef<{ close: () => void } | null>(null);
  /** What the patient can actually see. `stopGeneration` keeps exactly
   *  that, and an effect-synced mirror is the honest source: it commits
   *  after the render that painted the text, whereas the `answer`
   *  closure captured when the handler was created can be several
   *  deltas stale. */
  const answerRef = useRef('');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    answerRef.current = answer;
  }, [answer]);

  // Close the stream when the drawer goes away — a backgrounded
  // answer nobody will read is still burning tokens upstream.
  useEffect(() => {
    if (visible) return;
    handleRef.current?.close();
    handleRef.current = null;
    setQuestion('');
    setDraft('');
    setAnswer('');
    setCitations([]);
    setStatus('idle');
    setErrorMessage(null);
    setErrorKind('generic');
    setContextDropped(false);
    setStopped(false);
    setHistory([]);
  }, [visible]);

  useEffect(() => () => handleRef.current?.close(), []);

  const ask = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || status === 'streaming') return;

    handleRef.current?.close();
    setQuestion(trimmed);
    setAnswer('');
    setCitations([]);
    setErrorMessage(null);
    setErrorKind('generic');
    setStopped(false);
    setStatus('streaming');

    const priorTurns = history;
    const attachedContext = context && !contextDropped ? context : undefined;

    handleRef.current = streamAiQuestion(
      trimmed,
      createProgressId(),
      {
        onEvent: (event) => {
          if (event.type === 'answer_delta') {
            setAnswer((prev) => prev + event.text);
          } else if (event.type === 'answer_reset') {
            // The server discarded what it had already streamed and
            // re-asked — round 2 answered with nothing but a lead-in to
            // a lookup. Replace rather than append: the retry is a
            // fresh reply, not a continuation of the abandoned one.
            // p-qna handles this too; this drawer is the other consumer
            // and was missed when the frame was added.
            setAnswer(event.text);
          } else if (event.type === 'done') {
            setCitations(event.data?.citations ?? []);
            // The done frame carries the complete answer. Deltas can be
            // dropped by a flaky connection, so prefer the authoritative
            // copy when it differs from what we accumulated.
            const finalAnswer = event.data?.answer?.trim();
            if (finalAnswer) setAnswer(finalAnswer);
          } else if (event.type === 'error') {
            setErrorMessage(event.message);
          }
        },
        onComplete: (data) => {
          handleRef.current = null;
          if (data) {
            setCitations(data.citations ?? []);
            const settled = data.answer?.trim();
            if (settled) setAnswer(settled);
            setAnswer((prev) => {
              const text = settled || prev;
              // An answer that arrived as neither deltas nor a payload
              // is a failure wearing a success costume — a bordered
              // empty box with no retry affordance.
              if (!text.trim()) {
                setStatus('error');
                setErrorMessage('这次没有收到回答，请重试。');
                return prev;
              }
              setStatus('done');
              setHistory((prevTurns) => [
                ...prevTurns,
                { role: 'user' as const, content: trimmed },
                { role: 'assistant' as const, content: text },
              ]);
              return text;
            });
            return;
          }
          // A null payload means the stream ended without `done` —
          // truncated rather than answered. Say so instead of leaving
          // a half sentence looking finished.
          setStatus((prev) => (prev === 'streaming' ? 'error' : prev));
          setErrorMessage((prev) => prev ?? '回答没有传完，请重试。');
        },
        onError: (error) => {
          handleRef.current = null;
          setStatus('error');
          // Only blame the context when this attempt actually carried
          // one — a 404 on a context-free ask is a different bug, and
          //「记录可能已被删除」would send the patient hunting for a
          // deletion that never happened.
          if (attachedContext && isDeadContextError(error)) {
            setErrorKind('dead_context');
            setErrorMessage('这条记录可能已被删除，AI 现在读不到它了。');
            // Retire the reference here rather than inside the recovery
            // button: a 404 is definitive, so *every* later ask in this
            // drawer — including one typed into the composer — would
            // otherwise re-attach it and fail the same way.
            setContextDropped(true);
            return;
          }
          setErrorKind('generic');
          setErrorMessage(
            isConsentRequiredError(error)
              ? '需要先在「我的 › 隐私设置」里同意 AI 使用你的数据。'
              : error.message || 'AI 暂时不可用，请稍后重试。',
          );
        },
      },
      {
        ...(attachedContext ? { context: attachedContext } : {}),
        ...(priorTurns.length > 0 ? { history: priorTurns } : {}),
      },
    );
  };

  /** Persist this exchange into the 问答 thread, then open it. */
  const handleHandoff = async () => {
    handleRef.current?.close();
    await appendTurnsToStoredChat(
      AsyncStorage,
      QNA_CHAT_STORAGE_KEY,
      history,
      (index) => `drawer-${Date.now()}-${index}`,
      new Date().toISOString(),
    );
    onClose();
    router.push('/p-qna');
  };

  /**
   * Stop generating without throwing away what arrived.
   *
   * The drawer disables the composer while streaming, so before this
   * the only way out of a long answer was closing the sheet — which
   * silently destroyed every word of it. Stopping keeps the partial
   * text, settles the turn, and hands the composer back.
   */
  const stopGeneration = () => {
    if (status !== 'streaming') return;
    handleRef.current?.close();
    handleRef.current = null;

    const kept = answerRef.current.trim();
    if (!kept) {
      // Nothing had arrived yet. A 'done' turn with an empty bubble
      // would read as the model having nothing to say, so keep the
      // retry affordance instead.
      setStatus('error');
      setErrorKind('generic');
      setErrorMessage('已停止，这次还没收到内容。');
      return;
    }

    setAnswer(kept);
    setStopped(true);
    setStatus('done');
    // The truncated text still goes into history: a follow-up like
    //「那我该怎么办」refers to what is on the screen, and the screen
    // has exactly this much.
    setHistory((prevTurns) => [
      ...prevTurns,
      { role: 'user' as const, content: question },
      { role: 'assistant' as const, content: kept },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* RN mounts a Modal in its own controller on iOS, so the system
          keyboard does not reflow it. Without this the composer — the
          last child of a flex-end sheet — sits underneath the keyboard
          along with most of the answer being read. p-qna and
          p-login_register wrap their bottom composers the same way. */}
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Half the screen is a dismiss target, and it is the easiest
            thing in the drawer to hit by accident with an arm that
            drifts. While an answer is streaming that tap means "stop",
            not "throw it away" — the answer survives, and a second tap
            still closes. */}
        <TouchableOpacity
          style={styles.overlayDismiss}
          activeOpacity={1}
          accessibilityRole="button"
          accessibilityLabel={status === 'streaming' ? '停止生成' : '关闭'}
          onPress={status === 'streaming' ? stopGeneration : onClose}
        />

        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Text style={styles.title}>继续问</Text>
            <TouchableOpacity
              hitSlop={expandHitSlop(30)}
              onPress={onClose}
              activeOpacity={INTERACTION.pressOpacity}
              accessibilityRole="button"
              accessibilityLabel="关闭"
              style={styles.closeButton}
            >
              <Icon name="xmark" size={16} color={COLOR.inkMuted} />
            </TouchableOpacity>
          </View>

          {context && contextLabel ? (
            contextDropped ? (
              // Keeping the original pill up would promise a link that
              // the server just told us is broken.
              <View style={[styles.contextPill, styles.contextPillDropped]}>
                <Icon name="link-slash" size={11} color={COLOR.inkMuted} />
                <Text style={styles.contextPillText} numberOfLines={2}>
                  已去掉上下文（{contextLabel}），现在只按你的问题回答
                </Text>
              </View>
            ) : (
              <View style={styles.contextPill}>
                <Icon name="link" size={11} color={COLOR.accent} />
                <Text style={styles.contextPillText} numberOfLines={2}>
                  上下文已带入：{contextLabel}
                </Text>
              </View>
            )
          ) : null}

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {status === 'idle' ? (
              <View style={styles.suggestionStack}>
                {suggestions.map((item) => (
                  <Button
                    key={item}
                    label={item}
                    variant="tinted"
                    fullWidth
                    trailingIcon="arrow-right"
                    onPress={() => ask(item)}
                  />
                ))}
              </View>
            ) : (
              <>
                <View style={styles.questionBubble}>
                  <Text style={styles.questionText}>{question}</Text>
                </View>

                <View style={styles.answerBubble}>
                  {answer ? (
                    <AnswerText style={styles.answerText}>{answer}</AnswerText>
                  ) : status === 'streaming' ? (
                    <View style={styles.thinkingRow}>
                      <ActivityIndicator size="small" color={COLOR.accent} />
                      <Text style={styles.thinkingText}>正在读你的资料…</Text>
                    </View>
                  ) : null}

                  {stopped ? (
                    <Text style={styles.stoppedNote}>已停止生成，上面是收到的部分。</Text>
                  ) : null}

                  {status === 'error' && errorMessage ? (
                    <Text style={styles.errorText}>{errorMessage}</Text>
                  ) : null}
                </View>

                {status === 'streaming' ? (
                  <Button
                    label="停止生成"
                    icon="stop"
                    variant="tinted"
                    compact
                    accessibilityLabel="停止生成，保留已经收到的部分"
                    onPress={stopGeneration}
                  />
                ) : null}

                {citations.length > 0 ? (
                  <View style={styles.citationRow}>
                    <Text style={styles.citationLabel}>依据</Text>
                    {citations.slice(0, 4).map((citation, index) => (
                      <View key={`${citation.chunkId}-${index}`} style={styles.citationChip}>
                        <Text style={styles.citationChipText} numberOfLines={1}>
                          {formatCitationLabel(citation.sourceFile, citation.source)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {/* One button, two meanings. After a dead context the
                    reference has already been retired, so this same tap
                    is a genuinely different request — and it has to say
                    so, or it reads as「重试」on a key that just failed. */}
                {status === 'error' ? (
                  <Button
                    label={errorKind === 'dead_context' ? '不带这条记录再问一次' : '重试'}
                    icon="rotate-right"
                    variant="prominent"
                    accessibilityLabel={
                      errorKind === 'dead_context' ? '不带这条记录，重新问一次' : '重试'
                    }
                    onPress={() => ask(question)}
                  />
                ) : null}
              </>
            )}
          </ScrollView>

          {/* The way out that keeps the answer.
              Closing the sheet destroys the exchange, and until now
              that was the only exit — so a patient who read something
              worth keeping had no way to get back to it. This moves the
              turns into the 问答 thread and opens it. */}
          {history.length > 0 ? (
            <Button
              label="转到完整对话，保留这段问答"
              variant="plain"
              trailingIcon="arrow-right"
              accessibilityHint="把这次对话存进问答页，之后还能翻回来"
              onPress={() => void handleHandoff()}
            />
          ) : null}

          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="再问一句…"
              placeholderTextColor={COLOR.inkMuted}
              editable={status !== 'streaming'}
              onSubmitEditing={() => {
                ask(draft);
                setDraft('');
              }}
              returnKeyType="send"
            />
            {/* The composer button is where the thumb already is. A
                greyed-out send there during streaming was a dead
                control in the one moment the patient most wants out;
                it stops the stream instead. */}
            {status === 'streaming' ? (
              <TouchableOpacity
                style={[styles.sendButton, styles.stopIconButton]}
                activeOpacity={INTERACTION.pressOpacity}
                accessibilityRole="button"
                accessibilityLabel="停止生成"
                onPress={stopGeneration}
              >
                <Icon name="stop" size={13} color={COLOR.paper} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.sendButton}
                activeOpacity={INTERACTION.pressOpacity}
                accessibilityRole="button"
                accessibilityLabel="发送"
                onPress={() => {
                  ask(draft);
                  setDraft('');
                }}
              >
                <Icon name="arrow-up" size={14} color={COLOR.paper} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

/**
 * Visual pass on lib/design.ts. Logic and JSX untouched — every key
 * below still exists under the same name.
 *
 * What changed and why: the drawer was four nested containers deep
 * before a word of the answer appeared — a sand sheet, holding a
 * dashed-bordered context card, holding a bordered answer bubble
 * inside a bordered scroll body, with three bordered suggestion cards
 * above it and a pill-shaped bordered composer below. Every one of
 * those boxes was drawn in the same low-contrast sand-on-sand, so the
 * borders separated nothing; they just filled the sheet with edges.
 *
 * Now: the sheet is one white surface above the paper page (same
 * rationale as AppTabBar), and inside it the only filled thing is the
 * patient's own question. The answer — the payload — is set directly
 * on the sheet at full reading size. Suggestions are hairline-ruled
 * rows. The context reference and the alerts speak through a 2pt
 * semantic bar instead of a card.
 */
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    // Ink-based scrim to match COLOR.ink, and a shade heavier than the
    // old 0.28: the sheet is white now, so the page behind it has to
    // recede further for the edge to read without a border.
    backgroundColor: 'rgba(23, 39, 46, 0.34)',
  },
  overlayDismiss: {
    flex: 1,
  },
  sheet: {
    maxHeight: '82%',
    // White, not sand. A sheet the same colour as the page it covers
    // relies entirely on its shadow to exist.
    backgroundColor: COLOR.surface,
    // 24 → RADIUS.surface. At 24 the corner ate the first line of the
    // title row and read as a consumer bottom-sheet rather than a
    // record.
    borderTopLeftRadius: RADIUS.surface,
    borderTopRightRadius: RADIUS.surface,
    paddingHorizontal: SPACE.gutter,
    // Overridden inline by max(insets.bottom, 18); kept as the floor.
    paddingBottom: SPACE.lg,
    gap: SPACE.md,
  },
  grabber: {
    alignSelf: 'center',
    marginTop: SPACE.md,
    width: 36,
    height: 4,
    // A grabber is one of the few shapes whose roundness means
    // something — it is the handle. Kept.
    borderRadius: 2,
    backgroundColor: COLOR.lineStrong,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...TYPE.title,
  },
  closeButton: {
    // Kept visually small, grown to MIN_TOUCH_TARGET via hitSlop at
    // the call site — this is exactly what lib/a11y.ts's
    // expandHitSlop exists for.
    width: 30,
    height: 30,
    // The tinted disc behind the ✕ is gone: an icon parked in a filled
    // circle. Radius stays only for the Android press ripple.
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    // Was a dashed-bordered, accent-washed card. Dashes are decoration
    // — they were not marking anything editable or provisional. The
    // reference now speaks through a solid accent bar, which is the
    // same device p-home uses for a row's semantics and costs no
    // horizontal room.
    borderLeftWidth: 2,
    borderLeftColor: COLOR.accent,
    paddingLeft: SPACE.md,
    paddingVertical: SPACE.sm,
  },
  contextPillDropped: {
    // Dropped context keeps the bar so the layout does not jump, but
    // loses the accent: nothing is attached any more.
    borderLeftColor: COLOR.lineStrong,
  },
  contextPillText: {
    flex: 1,
    ...TYPE.caption,
  },
  body: {
    maxHeight: 380,
  },
  bodyContent: {
    gap: SPACE.md,
    paddingVertical: SPACE.xs,
  },
  suggestionStack: {
    // Rows now carry their own top rule, so the stack itself no longer
    // needs to space three separate cards apart.
    gap: 0,
  },
  suggestion: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.md,
    paddingVertical: SPACE.md,
    // Three identical bordered cards inside a bordered sheet was the
    // clearest case of card-in-card here. A hairline separates them
    // just as well and lets the text sit on the sheet's own margin.
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  questionBubble: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm + 2,
    borderRadius: RADIUS.control,
    // The clipped corner is the one bit of bubble shape worth keeping:
    // it points at the speaker, which is real information now that the
    // answer no longer wears a bubble of its own.
    borderBottomRightRadius: 4,
    backgroundColor: COLOR.accent,
  },
  questionText: {
    ...TYPE.body,
    color: COLOR.onAccent,
    fontSize: 14,
    lineHeight: 21,
  },
  answerBubble: {
    alignSelf: 'flex-start',
    // Was a bordered, tinted, 14pt-radius bubble sitting inside the
    // sheet. The answer is what the drawer exists to deliver, so it is
    // set on the sheet itself — the right-aligned accent question above
    // it already establishes who is speaking, and losing the box buys
    // the text most of a line back per paragraph.
    maxWidth: '100%',
    paddingVertical: SPACE.xs,
    gap: SPACE.sm,
  },
  answerText: {
    // Up from 13.5/22 to full body size in full ink. This is the
    // longest thing a patient reads in the app and it was set two
    // steps below the reading size used everywhere else.
    ...TYPE.bodyStrong,
    lineHeight: 24,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  thinkingText: {
    ...TYPE.caption,
  },
  errorText: {
    ...TYPE.caption,
    color: COLOR.alert,
  },
  stoppedNote: {
    ...TYPE.caption,
    fontSize: 12,
    lineHeight: 17,
  },
  citationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  citationLabel: {
    // A genuine eyebrow —「依据」names what the chips beside it are,
    // and nothing else on screen says it.
    ...TYPE.micro,
  },
  citationChip: {
    maxWidth: 150,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 5,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    // Sunken rather than tinted: a citation is a quoted source, and
    // the well is what this system uses for quoted/inert content.
    backgroundColor: COLOR.well,
  },
  citationChipText: {
    ...TYPE.caption,
    fontSize: 11,
    lineHeight: 15,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingLeft: SPACE.md,
    paddingRight: SPACE.xs + 2,
    paddingVertical: SPACE.xs + 2,
    // Was a full pill. Squared to RADIUS.control and given the well
    // fill, which is what lib/design.ts reserves for inputs — the
    // composer now looks like something you type into rather than
    // another floating capsule.
    borderRadius: RADIUS.control,
    backgroundColor: COLOR.well,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    flex: 1,
    color: COLOR.ink,
    fontSize: 15,
    paddingVertical: SPACE.xs + 2,
  },
  sendButton: {
    // lib/a11y.ts names「the entry composer's send」as a control that
    // earns the comfortable tier; 32 was well under even the floor.
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLOR.accent,
  },
  stopIconButton: {
    backgroundColor: COLOR.inkSoft,
  },
  /** A text action, not a row and not a button: it leaves this sheet,
   *  so it must not compete with 发送, which is the thing to press
   *  while you are still here. */
});

export default AskAboutDrawer;
