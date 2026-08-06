import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../common/ScreenHeader';
import styles from './styles';
import { REFERRAL_QUESTIONS, composeQuestionSheet } from './question-sheet';
import {
  DISEASE_IDENTITY_AS_OF,
  DISEASE_IDENTITY_CODES,
  DISEASE_IDENTITY_DISCLAIMER,
  DISEASE_IDENTITY_HOW_TO_USE,
  DISEASE_IDENTITY_INTRO,
  DISEASE_IDENTITY_UNVERIFIED,
  scopeLabel,
} from '../../lib/disease-identity-content';
import {
  fetchMyReferralPack,
  isGeneticallyConfirmed,
  type ReferralMonitoringState,
  type ReferralPack,
} from '../../lib/referral-pack-api';

/**
 * 转诊准备 — the disease's identity codes, and the questions to bring.
 *
 * WHY THE CODES ARE THE TOP OF THE PAGE
 * -------------------------------------
 * The FSHD diagnostic odyssey in this cohort runs close to a decade,
 * mostly at hospitals that have never seen the disease. The single most
 * useful thing a patient can carry into that room is not a summary of
 * their symptoms — it is 「这个病在目录上是第 25 项，文号国卫医政发
 * 〔2023〕26号」 and a code the hospital's own system can find. So the
 * codes are set at heading weight, `selectable` so a long press gets
 * them off the phone, and every one of them is rendered as
 * *system + code* — never the code alone, because the code alone is how
 * a patient ends up quoting a US-only ICD-10-CM number at a Chinese
 * 医保 window.
 *
 * WHY NOTHING ON THIS SCREEN IS SAVED
 * -----------------------------------
 * The question sheet lives in component state and is deliberately not
 * persisted. `lib/draft-keys.ts` states the rule this app runs on —
 * every patient-scoped draft key must be registered there so logout can
 * clear it — and it explains why: FSHD is autosomal dominant, so
 * several affected members of one family sharing one device is the
 * ordinary case, and a leftover draft is the next person finding
 * someone else's medical notes. This screen cannot register a key (the
 * file is outside this change), so it does not write one, and it says
 * so on screen rather than silently losing what someone typed.
 *
 * The generated 转诊资料 below is held the same way and for a second
 * reason: it is a snapshot of a medical record, and a cached copy on a
 * shared handset is the next family member opening someone else's.
 *
 * WHY THE 转诊资料 IS NOT FETCHED ON MOUNT
 * ---------------------------------------
 * Everything above the button works with no account, no profile and no
 * network — the codes and the question sheet are why most people open
 * this page, and they still work on a hospital's dead wifi. Fetching on
 * mount would put a spinner, and then for anyone who has not registered
 * an error, on top of a page that was already doing its job. So the
 * request happens when someone asks for it.
 */

const ScopeChip = ({ scope }: { scope: (typeof DISEASE_IDENTITY_CODES)[number]['scope'] }) => {
  const warning = scope === 'us_only';
  return (
    <View style={[styles.scopeChip, warning ? styles.scopeChipWarning : null]}>
      <Text style={warning ? styles.scopeChipTextWarning : styles.scopeChipText}>
        {scopeLabel(scope)}
      </Text>
    </View>
  );
};

/**
 * One label per monitoring state. Written out here rather than reused
 * from the server's `statement` because the chip and the sentence do
 * different jobs: the sentence is the clinical wording the pack was
 * built with, the chip is what a reader sees before they read.
 *
 * 「本平台没有记录」 for `absent`, never 「未做」. The pack goes to
 * someone who will act on it, and the difference between 「我们这里没有
 * 这份报告」 and 「这项检查没做过」 is the whole reason the three states
 * exist — see profile.passport.ts.
 */
const MONITORING_STATE_LABELS: Record<ReferralMonitoringState, string> = {
  present: '已读到数值',
  unreadable: '有报告，读不出',
  absent: '本平台没有记录',
};

const MonitoringSlotRow = ({ slot }: { slot: ReferralPack['monitoring'][number] }) => {
  const unreadable = slot.state === 'unreadable';
  return (
    <View style={styles.packSlot}>
      <View style={styles.packSlotTopRow}>
        <Text style={styles.packSlotTitle}>{slot.title}</Text>
        <View style={[styles.packStateChip, unreadable ? styles.packStateChipUnreadable : null]}>
          <Text style={unreadable ? styles.packStateChipTextUnreadable : styles.packStateChipText}>
            {MONITORING_STATE_LABELS[slot.state]}
          </Text>
        </View>
      </View>
      <Text style={styles.packSlotStatement}>{slot.statement}</Text>
      {slot.note ? <Text style={styles.packSlotNote}>{slot.note}</Text> : null}
    </View>
  );
};

/**
 * `YYYY-MM-DD` from an ISO timestamp, or null.
 *
 * Hand-rolled instead of `toLocaleDateString`: the web export runs in
 * WeChat's in-app browser, whose ICU data is not something this app
 * gets to assume, and a 生成时间 that renders as 「Invalid Date」 on the
 * one document a patient is about to hand over is worse than no date.
 * Returns null on anything unparseable so the caller can omit the line
 * rather than print a wrong day.
 */
const packDateLabel = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

/**
 * The sentence shown when the request fails.
 *
 * Reads `status` off the thrown value structurally rather than
 * importing `ApiError` from lib/api: that module pulls in AsyncStorage
 * at import time, which jest-expo has no native module for, and a
 * screen that cannot be rendered in a test is a screen whose wiring
 * nothing checks. `ApiError` carries `status` — see lib/api.ts.
 *
 * 401 and 404 are the two a patient can actually do something about,
 * and neither of them is 「出错了」: not signed in, and no profile yet.
 */
const describePackError = (error: unknown): string => {
  const status =
    error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : undefined;

  if (status === 401) return '需要先登录，转诊资料里是你自己的记录。';
  if (status === 404) {
    return '还没有你的健康档案，所以生成不了资料。先在「我的」里把注册资料填完，再回来生成。';
  }

  const message = error instanceof Error ? error.message.trim() : '';
  return message || '生成失败，请稍后重试。';
};

const ReferralScreen = () => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [ownNote, setOwnNote] = useState('');
  const [pack, setPack] = useState<ReferralPack | null>(null);
  const [packLoading, setPackLoading] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);

  const loadPack = useCallback(async () => {
    setPackLoading(true);
    setPackError(null);
    try {
      setPack(await fetchMyReferralPack());
    } catch (error) {
      // The stale pack is dropped, not kept. A failed refresh that
      // leaves the previous document on screen under its old 生成时间
      // is exactly the stale-snapshot problem the server refuses to
      // cache for.
      setPack(null);
      setPackError(describePackError(error));
    } finally {
      setPackLoading(false);
    }
  }, []);

  const toggle = (id: string) => {
    setSelectedIds((previous) =>
      previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id],
    );
  };

  const sheet = useMemo(() => composeQuestionSheet(selectedIds, ownNote), [selectedIds, ownNote]);
  const packDate = pack ? packDateLabel(pack.generatedAt) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.safeArea}>
        <ScreenHeader title="转诊准备" />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>{DISEASE_IDENTITY_INTRO}</Text>

          <View style={styles.provenance}>
            <Text style={styles.provenanceDate}>编码核对于 {DISEASE_IDENTITY_AS_OF}</Text>
            <Text style={styles.provenanceNote}>{DISEASE_IDENTITY_HOW_TO_USE}</Text>
          </View>

          <Text style={styles.sectionHeading} accessibilityRole="header">
            病种身份码
          </Text>

          {DISEASE_IDENTITY_CODES.map((entry) => (
            <View key={entry.id} style={styles.code}>
              <View style={styles.codeTopRow}>
                <Text style={styles.codeSystem}>{entry.system}</Text>
                <ScopeChip scope={entry.scope} />
              </View>

              {/* The whole point of the screen. `selectable` because
                  there is no clipboard API in this app and WeChat's
                  in-app browser has no print dialog — a long press on
                  the text is the export path that actually exists. */}
              <Text style={styles.codeQuotable} selectable accessibilityRole="header">
                {entry.quotable}
              </Text>
              <Text style={styles.codeNames} selectable>
                {entry.labelZh} · {entry.labelEn}
              </Text>

              <Text style={styles.codeUse}>{entry.useZh}</Text>
              {entry.caveatZh ? <Text style={styles.codeCaveat}>{entry.caveatZh}</Text> : null}

              <View style={styles.codeSourceRow}>
                <Text style={styles.codeSource}>出处：{entry.source}</Text>
              </View>
            </View>
          ))}

          <View style={styles.gapBlock}>
            <Text style={styles.gapTitle} accessibilityRole="header">
              本页没有写的那个码
            </Text>
            <Text style={styles.gapText}>{DISEASE_IDENTITY_UNVERIFIED}</Text>
          </View>

          <Text style={styles.sectionHeading} accessibilityRole="header">
            带给医生的转诊资料
          </Text>

          <View style={styles.packBlock}>
            <Text style={styles.packLede}>
              从你已经填过、传过的记录里，整理出一份给神经内科医生看的资料：诊断依据、功能测试的变化、目前的辅具和行走状态、系统监测三项的记录状态，最后附一份提问清单，每条后面留了手写的空行。
              这份资料不是病历，内容都来自你自己，医生会当作你的自述来看。
            </Text>

            <Pressable
              style={[styles.packButton, packLoading ? styles.packButtonDisabled : null]}
              onPress={() => {
                void loadPack();
              }}
              disabled={packLoading}
              accessibilityRole="button"
              accessibilityState={{ disabled: packLoading, busy: packLoading }}
              accessibilityLabel={pack ? '重新生成转诊资料' : '生成我的转诊资料'}
              accessibilityHint="会从服务器读取你自己的记录，生成后不会保存在这台设备上"
            >
              {packLoading ? (
                <ActivityIndicator color="#FFFFFF" accessibilityLabel="正在生成" />
              ) : (
                <Text style={styles.packButtonText}>
                  {pack ? '按最新记录重新生成' : '生成我的转诊资料'}
                </Text>
              )}
            </Pressable>

            {packError ? <Text style={styles.packError}>{packError}</Text> : null}

            {pack ? (
              <>
                <Text style={styles.packTitle} accessibilityRole="header">
                  {pack.documentTitle}
                </Text>
                {packDate ? (
                  <Text style={styles.packMeta}>
                    生成于 {packDate} · 内容取自生成那一刻的记录，之后新传的报告不在里面
                  </Text>
                ) : null}

                <Text
                  style={[
                    styles.packDiagnosis,
                    isGeneticallyConfirmed(pack) ? null : styles.packDiagnosisUnconfirmed,
                  ]}
                  selectable
                >
                  {pack.diagnosisStatement}
                </Text>

                {pack.monitoring.map((slot) => (
                  <MonitoringSlotRow key={slot.key} slot={slot} />
                ))}

                {/* The document itself, rendered as one selectable block.
                    Same export path as the identity codes above: no
                    clipboard API in this app, no print dialog in WeChat's
                    in-app browser, so a long press or a screenshot is what
                    a patient actually has. */}
                <Text style={styles.sheetHint}>
                  下面就是完整的资料。长按可以选中复制，或者直接截图带去诊室。这份资料不会保存在这台设备上，离开页面就没有了。
                </Text>
                <Text style={styles.packDocument} selectable>
                  {pack.markdown}
                </Text>
              </>
            ) : null}
          </View>

          <Text style={styles.sectionHeading} accessibilityRole="header">
            我想问的问题
          </Text>
          <Text style={styles.sectionLede}>
            就诊前先勾几条，到了诊室照着问。这一页写的内容不会保存 ——
            这台设备可能是家里几个人一起用的，所以离开页面就清空，写完请长按下面的文字复制或者截图。
          </Text>

          <View style={styles.questionBlock}>
            {REFERRAL_QUESTIONS.map((question) => {
              const selected = selectedIds.includes(question.id);
              return (
                <Pressable
                  key={question.id}
                  style={[styles.questionRow, selected ? styles.questionRowSelected : null]}
                  onPress={() => toggle(question.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={question.prompt}
                  accessibilityHint="选中后会加进下面可复制的清单"
                >
                  <View
                    style={[styles.questionMark, selected ? styles.questionMarkSelected : null]}
                  >
                    {selected ? <Text style={styles.questionMarkGlyph}>✓</Text> : null}
                  </View>
                  <View style={styles.questionBody}>
                    <Text style={styles.questionPrompt}>{question.prompt}</Text>
                    <Text style={styles.questionHint}>{question.hint}</Text>
                    <Text style={styles.questionSource}>出处：{question.source}</Text>
                  </View>
                </Pressable>
              );
            })}

            <View>
              <Text style={styles.noteLabel}>我自己想问的</Text>
              <TextInput
                style={styles.noteInput}
                value={ownNote}
                onChangeText={setOwnNote}
                multiline
                placeholder="写下你自己最想问的那一句"
                accessibilityLabel="我自己想问的"
              />
            </View>

            {sheet ? (
              <View style={styles.sheetBlock}>
                <Text style={styles.sheetHint}>
                  下面是整理好的清单，长按可以选中复制，或者直接截图带去诊室。
                </Text>
                <Text style={styles.sheetText} selectable>
                  {sheet}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.disclaimer}>{DISEASE_IDENTITY_DISCLAIMER}</Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

export default ReferralScreen;
