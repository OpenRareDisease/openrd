import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
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

const ReferralScreen = () => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [ownNote, setOwnNote] = useState('');

  const toggle = (id: string) => {
    setSelectedIds((previous) =>
      previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id],
    );
  };

  const sheet = useMemo(() => composeQuestionSheet(selectedIds, ownNote), [selectedIds, ownNote]);

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
