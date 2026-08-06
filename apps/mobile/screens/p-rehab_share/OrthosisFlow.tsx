import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import styles from './styles';
import {
  ORTHOSIS_CONTENT_AS_OF,
  ORTHOSIS_DISCLAIMER,
  ORTHOSIS_EVIDENCE_NOTE,
  ORTHOSIS_INTRO,
  ORTHOSIS_SYSTEM_CAVEAT,
  buildOrthosisNarrative,
  buildOrthosisPlan,
  orthosisQuestion,
  visibleOrthosisQuestions,
  type OrthosisAnswers,
  type OrthosisItem,
  type OrthosisItemKind,
  type OrthosisQuestionId,
  type OrthosisTrack,
} from '../../lib/orthosis-decision-content';

/**
 * 辅具选择决策流.
 *
 * Three things this component must not do:
 *
 *  1. Show the plan as finished while questions are unanswered. A short
 *     list reads as a small problem. `plan.unanswered` drives a line of
 *     copy that is rendered whether or not any item matched.
 *  2. Drop the two standing rules when nothing matched. They are the
 *     part of 5.4 that is not about which device to buy, and the
 *     all-「还好」 path is exactly the one where someone would otherwise
 *     never read them. They render from `plan.standingRules`, which
 *     `buildOrthosisPlan` populates unconditionally.
 *  3. Render 「指南这一档没写」 and 「指南说不需要」 in the same weight.
 *     `kind` is a three-value state (device / not-yet / no-guidance)
 *     and each gets its own tag, because an empty section reads as
 *     reassurance.
 *
 * Answers live in component state. Nothing is persisted or sent: this
 * is a page someone may want to answer honestly about how badly they
 * walk, and it should cost them nothing to do so.
 */

const TRACK_HEADING: Record<OrthosisTrack, string> = {
  orthosis: '矫形器（AFO / KAFO / 胸腰支具）',
  'walking-aid': '助行器具',
  other: '其他辅具',
};

const TRACK_ORDER: OrthosisTrack[] = ['orthosis', 'walking-aid', 'other'];

const KIND_TAG: Record<OrthosisItemKind, { label: string; style: 'device' | 'neutral' | 'warn' }> =
  {
    device: { label: '指南有对应条目', style: 'device' },
    'not-yet': { label: '这一档现在对不上', style: 'neutral' },
    'no-guidance': { label: '指南没写这一档', style: 'warn' },
  };

const ItemCard = ({ item }: { item: OrthosisItem }) => {
  const tag = KIND_TAG[item.kind];
  return (
    <View style={styles.item}>
      <View style={styles.itemHead}>
        <Text style={styles.itemTitle} accessibilityRole="header">
          {item.title}
        </Text>
        <Text
          style={[
            styles.kindTag,
            tag.style === 'device'
              ? styles.kindTagDevice
              : tag.style === 'warn'
                ? styles.kindTagWarn
                : styles.kindTagNeutral,
          ]}
        >
          {tag.label}
        </Text>
      </View>
      <Text style={styles.itemBecause}>{item.because}</Text>
      <Text style={styles.itemBody}>{item.body}</Text>
      {item.cautions.map((caution) => (
        <View key={caution} style={styles.caution}>
          <View style={styles.cautionRule} />
          <Text style={styles.cautionText}>{caution}</Text>
        </View>
      ))}
      <View style={styles.sourceRow}>
        <Text style={styles.sourceText}>出处：{item.source}</Text>
      </View>
    </View>
  );
};

const OrthosisFlow = () => {
  const [answers, setAnswers] = useState<OrthosisAnswers>({});

  const questions = useMemo(() => visibleOrthosisQuestions(answers), [answers]);
  const plan = useMemo(() => buildOrthosisPlan(answers), [answers]);
  const narrative = useMemo(() => buildOrthosisNarrative(answers), [answers]);

  const choose = (questionId: OrthosisQuestionId, choiceId: string) => {
    setAnswers((current) => ({ ...current, [questionId]: choiceId }));
  };

  return (
    <View>
      <Text style={styles.intro}>{ORTHOSIS_INTRO}</Text>

      <View style={styles.provenance}>
        <Text style={styles.provenanceDate}>资料截至 {ORTHOSIS_CONTENT_AS_OF}</Text>
        <Text style={styles.provenanceNote}>{ORTHOSIS_EVIDENCE_NOTE}</Text>
      </View>

      {/* The caveat is the one accented block on this tab and it is
          above the questions, not under the answers: someone who reads
          the ladder first and the caveat last has already been told
          that a fitted device is one appointment away. */}
      <View style={styles.caveatCard}>
        <Text style={styles.caveatTitle} accessibilityRole="header">
          先说清楚这份指南默认的条件
        </Text>
        <Text style={styles.caveatBody}>{ORTHOSIS_SYSTEM_CAVEAT}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          关于你走路的几个问题
        </Text>
        <Text style={styles.sectionLede}>
          每一题下面写了指南为什么在这里分岔。答案只留在这台设备上，不上传。
        </Text>
        {questions.map((question) => (
          <View key={question.id} style={styles.question}>
            <Text style={styles.questionTitle} accessibilityRole="header">
              {question.title}
            </Text>
            <Text style={styles.questionPrompt}>{question.prompt}</Text>
            <Text style={styles.questionWhy}>指南为什么问这个：{question.why}</Text>
            {question.selfTestHint ? (
              <Text style={styles.questionHint}>{question.selfTestHint}</Text>
            ) : null}
            <View style={styles.choices}>
              {question.choices.map((choice) => {
                const selected = answers[question.id] === choice.id;
                return (
                  <Pressable
                    key={choice.id}
                    style={[styles.choice, selected ? styles.choiceSelected : null]}
                    onPress={() => choose(question.id, choice.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${question.title}：${choice.label}`}
                  >
                    <Text
                      style={[styles.choiceLabel, selected ? styles.choiceLabelSelected : null]}
                    >
                      {choice.label}
                    </Text>
                    {choice.detail ? (
                      <Text style={styles.choiceDetail}>{choice.detail}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.sourceRow}>
              <Text style={styles.sourceText}>出处：{question.source}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          对上的条目
        </Text>
        {/* Never silent about what is missing. A four-item list built
            from two answers is not a shorter version of the same list —
            it is a different list, and it must not look finished. */}
        <Text style={styles.planProgress}>
          {plan.complete
            ? `已经答完 ${questions.length} 题，下面是对上的条目。`
            : `还有 ${plan.unanswered.length} 题没答（${plan.unanswered
                .map((id) => orthosisQuestion(id).title)
                .join('、')}），下面这份是不完整的。`}
        </Text>

        {plan.items.length === 0 ? (
          <Text style={styles.sectionLede}>
            还没有对上任何一条。这不代表「不需要辅具」——只代表上面的问题还没答，或者答案还没落到指南写过的档位上。无论如何，下面那两条通则和那份就诊清单都照样适用。
          </Text>
        ) : null}

        {TRACK_ORDER.map((track) => {
          const items = plan.items.filter((item) => item.track === track);
          if (items.length === 0) return null;
          return (
            <View key={track}>
              <Text style={styles.trackHeading}>{TRACK_HEADING[track]}</Text>
              {items.map((item) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </View>
          );
        })}
      </View>

      {/* The two rules. Rendered from plan.standingRules rather than
          from the module constant directly, so that a future change
          which made them conditional would show up here as a missing
          block rather than silently keeping the copy on screen while
          the plan stopped carrying it. */}
      <View style={styles.caveatCard}>
        <Text style={styles.caveatTitle} accessibilityRole="header">
          不管最后选哪一件，这两条都适用
        </Text>
        {plan.standingRules.map((rule) => (
          <View key={rule.id} style={styles.ruleBlock}>
            <Text style={styles.ruleTitle}>{rule.title}</Text>
            <Text style={styles.ruleBody}>{rule.body}</Text>
          </View>
        ))}
        <View style={styles.sourceRow}>
          <Text style={styles.sourceText}>
            出处：{plan.standingRules.map((rule) => rule.source).join('；')}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {plan.referral.title}
        </Text>
        <Text style={styles.sectionLede}>{plan.referral.lede}</Text>

        <Text style={styles.trackHeading}>带上这些</Text>
        {plan.referral.bring.map((line) => (
          <View key={line} style={styles.point}>
            <View style={styles.pointRule} />
            <Text style={styles.pointText}>{line}</Text>
          </View>
        ))}

        <Text style={styles.trackHeading}>知识库里记录的康复医师</Text>
        {plan.referral.clinicians.map((clinician) => (
          <View key={`${clinician.institution}-${clinician.name}`} style={styles.clinician}>
            <Text style={styles.clinicianName}>
              {clinician.name} · {clinician.title}
            </Text>
            <Text style={styles.clinicianWhere}>
              {clinician.institution} {clinician.department}
            </Text>
          </View>
        ))}

        <View style={styles.narrativeBlock}>
          <Text style={styles.narrativeHint}>
            下面这段可以长按选中复制，发给康复师或者照着念。两条通则也在里面——只留在这一页的规则，是过不了微信的。
          </Text>
          {narrative.map((line, index) => (
            <Text key={`${index}-${line}`} style={styles.narrativeLine} selectable>
              {line}
            </Text>
          ))}
        </View>

        <View style={styles.sourceRow}>
          <Text style={styles.sourceText}>出处：{plan.referral.source}</Text>
        </View>
      </View>

      <Text style={styles.disclaimer}>{ORTHOSIS_DISCLAIMER}</Text>
    </View>
  );
};

export default OrthosisFlow;
