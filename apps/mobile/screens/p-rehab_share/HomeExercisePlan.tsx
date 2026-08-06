import { Text, View, type StyleProp, type TextStyle } from 'react-native';
import styles from './styles';
import {
  BEFORE_YOU_START,
  DUTCH_EVIDENCE_NOTE,
  DUTCH_EXPERT_OPINION_NOTE,
  EXERCISE_EVIDENCE_LABEL,
  EXERCISE_GUIDANCE,
  EXERCISE_PHASES,
  EXERTION_BANDS,
  EXERTION_SCALE_NOTE,
  EXERCISE_SUBSTITUTION_NOTE,
  HOME_EXERCISE_AS_OF,
  HOME_EXERCISE_DISCLAIMER,
  HOME_EXERCISE_INTRO,
  LOG_NOTE,
  LOG_PROMPTS,
  MINUTES_PER_SESSION,
  REMEASURE_ITEMS,
  REMEASURE_NOTE,
  SESSIONS_PER_WEEK,
  SESSION_TYPES,
  TOTAL_SESSIONS,
  TOTAL_WEEKS,
  TRIAL_CONDITIONS,
  TRIAL_FACTS,
  TRIAL_SOURCE,
  TRIAL_UNKNOWNS,
  type ExerciseEvidence,
} from '../../lib/home-exercise-content';

/**
 * 六个月居家运动方案.
 *
 * The whole design of this tab is one rule: a reader must never be
 * able to mistake this page's RPE-based substitute for the protocol
 * that produced Bankolé's numbers. Two mechanisms enforce it:
 *
 *  1. EXERCISE_SUBSTITUTION_NOTE renders as the accented block at the
 *     top, above the results — not as a footnote under them. Someone
 *     who reads「+19% VO2peak」and then a plan they can follow has
 *     already drawn the conclusion the note exists to prevent.
 *  2. Every block that contains substitute content carries the
 *     evidence tag, in warn colour, next to the block — including the
 *     substitute halves of SESSION_TYPES and TRIAL_CONDITIONS, which
 *     sit inches from trial-sourced text.
 *
 * There is a screen test asserting the substitution note is above the
 * first trial number in document order, and one asserting the RPE
 * section carries the substitute tag.
 */

const EVIDENCE_TAG_STYLE: Record<ExerciseEvidence, StyleProp<TextStyle>> = {
  trial: styles.evidenceTagTrial,
  guideline: styles.evidenceTagGuideline,
  substitute: styles.evidenceTagSubstitute,
};

const EvidenceTag = ({ evidence }: { evidence: ExerciseEvidence }) => (
  <Text style={[styles.evidenceTag, EVIDENCE_TAG_STYLE[evidence]]}>
    {EXERCISE_EVIDENCE_LABEL[evidence]}
  </Text>
);

const HomeExercisePlan = () => (
  <View>
    <Text style={styles.intro}>{HOME_EXERCISE_INTRO}</Text>

    <View style={styles.provenance}>
      <Text style={styles.provenanceDate}>资料截至 {HOME_EXERCISE_AS_OF}</Text>
      <Text style={styles.provenanceNote}>{TRIAL_SOURCE}</Text>
    </View>

    {/* Above the numbers, deliberately. */}
    <View style={styles.caveatCard}>
      <Text style={styles.caveatTitle} accessibilityRole="header">
        这个方案和原研究的差别
      </Text>
      <Text style={styles.caveatBody}>{EXERCISE_SUBSTITUTION_NOTE}</Text>
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        原研究做了什么，结果是什么
      </Text>
      <EvidenceTag evidence="trial" />
      {TRIAL_FACTS.map((fact) => (
        <View key={fact.id} style={styles.fact}>
          <View style={styles.factHead}>
            <Text style={styles.factValue}>{fact.value}</Text>
            <Text style={styles.factLabel}>{fact.label}</Text>
          </View>
          <Text style={styles.factDetail}>{fact.detail}</Text>
        </View>
      ))}
      <View style={styles.sourceRow}>
        <Text style={styles.sourceText}>出处：{TRIAL_SOURCE}</Text>
      </View>
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        它是在什么条件下做出来的
      </Text>
      <Text style={styles.sectionLede}>
        这一节是上面那些数字的价签。每一条后面跟着这一页能给的替代，以及给不出替代的那一条。
      </Text>
      {TRIAL_CONDITIONS.map((condition) => (
        <View key={condition.id} style={styles.item}>
          <Text style={styles.itemTitle} accessibilityRole="header">
            {condition.title}
          </Text>
          <EvidenceTag evidence="trial" />
          <Text style={styles.itemBody}>{condition.body}</Text>
          {condition.substitute ? (
            <>
              <EvidenceTag evidence="substitute" />
              <Text style={styles.itemBody}>{condition.substitute}</Text>
            </>
          ) : null}
        </View>
      ))}
      <View style={styles.sourceRow}>
        <Text style={styles.sourceText}>出处：{TRIAL_SOURCE}</Text>
      </View>
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        论文里查不到的部分
      </Text>
      <Text style={styles.sectionLede}>
        这一节不是谦虚，是边界。下面这些数字这一页没有，所以不给。
      </Text>
      {TRIAL_UNKNOWNS.map((line) => (
        <View key={line} style={styles.point}>
          <View style={styles.pointRule} />
          <Text style={styles.pointText}>{line}</Text>
        </View>
      ))}
      <View style={styles.sourceRow}>
        <Text style={styles.sourceText}>出处：{TRIAL_SOURCE}</Text>
      </View>
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        强度怎么定（自觉用力程度）
      </Text>
      <EvidenceTag evidence="substitute" />
      <Text style={styles.sectionLede}>{EXERTION_SCALE_NOTE}</Text>
      {EXERTION_BANDS.map((band) => (
        <View key={band.id} style={styles.band}>
          <View style={styles.bandHead}>
            <Text style={styles.bandRange}>{band.range}</Text>
            <Text style={styles.bandLabel}>{band.label}</Text>
          </View>
          <Text style={styles.bandLine}>{band.feel}</Text>
          <Text style={styles.bandLine}>说话测试：{band.talkTest}</Text>
          <Text style={styles.bandLine}>用在：{band.useFor}</Text>
        </View>
      ))}
      <View style={styles.sourceRow}>
        <Text style={styles.sourceText}>出处：本页自拟的替代口径，不是 Bankolé 2016 的方法</Text>
      </View>
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        一周三次，一次 {MINUTES_PER_SESSION} 分钟
      </Text>
      <Text style={styles.sessionMeta}>
        {TOTAL_WEEKS} 周 × 每周 {SESSIONS_PER_WEEK} 次 = {TOTAL_SESSIONS}{' '}
        次，这就是原研究算完成率的分母。
      </Text>
      {SESSION_TYPES.map((session) => (
        <View key={session.id} style={styles.item}>
          <Text style={styles.itemTitle} accessibilityRole="header">
            {session.name}
          </Text>
          <Text style={styles.sessionMeta}>
            每周 {session.perWeek} 次 · 每次 {session.minutes} 分钟
          </Text>
          <EvidenceTag evidence="trial" />
          {session.fromTrial.map((line) => (
            <View key={line} style={styles.point}>
              <View style={styles.pointRule} />
              <Text style={styles.pointText}>{line}</Text>
            </View>
          ))}
          <Text style={styles.subHeading}>没有功率车的话</Text>
          <EvidenceTag evidence="substitute" />
          {session.substitute.map((line) => (
            <View key={line} style={styles.point}>
              <View style={styles.pointRule} />
              <Text style={styles.pointText}>{line}</Text>
            </View>
          ))}
          <View style={styles.sourceRow}>
            <Text style={styles.sourceText}>出处：{session.source}</Text>
          </View>
        </View>
      ))}
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        24 周分成四段
      </Text>
      <Text style={styles.sectionLede}>
        分段的位置不是随手切的：原研究在第 0、6、12、18、24
        周各测一次，并按测出来的结果重新给每个人定强度。进步来自复测，不是来自每周固定加量——这一点即使复测手段粗糙也值得照搬。
      </Text>
      {EXERCISE_PHASES.map((phase) => (
        <View key={phase.id} style={styles.phase}>
          <Text style={styles.phaseTitle} accessibilityRole="header">
            {phase.title}
          </Text>
          <Text style={styles.phaseFocus}>{phase.focus}</Text>
          <Text style={styles.phaseTrialNote}>原研究：{phase.trialNote}</Text>
        </View>
      ))}
      <View style={styles.sourceRow}>
        <Text style={styles.sourceText}>出处：{TRIAL_SOURCE}</Text>
      </View>
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        每 6 周量什么
      </Text>
      <Text style={styles.sectionLede}>{REMEASURE_NOTE}</Text>
      {REMEASURE_ITEMS.map((item) => (
        <View key={item.id} style={styles.remeasure}>
          <View style={styles.remeasureHead}>
            <Text style={styles.remeasureLabel} accessibilityRole="header">
              {item.label}
            </Text>
            <Text style={styles.remeasureEvery}>{item.every}</Text>
          </View>
          <Text style={styles.remeasureWhy}>{item.why}</Text>
          <View style={styles.sourceRow}>
            <Text style={styles.sourceText}>出处：{item.source}</Text>
          </View>
        </View>
      ))}
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        训练日志
      </Text>
      <EvidenceTag evidence="guideline" />
      <Text style={styles.sectionLede}>{LOG_NOTE}</Text>
      {LOG_PROMPTS.map((line) => (
        <View key={line} style={styles.point}>
          <View style={styles.pointRule} />
          <Text style={styles.pointText}>{line}</Text>
        </View>
      ))}
    </View>

    {EXERCISE_GUIDANCE.map((section) => (
      <View key={section.id} style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {section.title}
        </Text>
        <EvidenceTag evidence={section.evidence} />
        {section.points.map((point) => (
          <View key={point} style={styles.point}>
            <View style={styles.pointRule} />
            <Text style={styles.pointText}>{point}</Text>
          </View>
        ))}
        <View style={styles.sourceRow}>
          <Text style={styles.sourceText}>出处：{section.source}</Text>
        </View>
      </View>
    ))}

    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        指南自己对这些证据的评价
      </Text>
      <Text style={styles.sectionLede}>{DUTCH_EVIDENCE_NOTE}</Text>
      <Text style={styles.sectionLede}>{DUTCH_EXPERT_OPINION_NOTE}</Text>
      <View style={styles.sourceRow}>
        <Text style={styles.sourceText}>出处：荷兰 FSHD 指南（2019-01-24，中译全文）5.2</Text>
      </View>
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        开始之前
      </Text>
      {BEFORE_YOU_START.map((line) => (
        <View key={line} style={styles.point}>
          <View style={styles.pointRule} />
          <Text style={styles.pointText}>{line}</Text>
        </View>
      ))}
    </View>

    <Text style={styles.disclaimer}>{HOME_EXERCISE_DISCLAIMER}</Text>
  </View>
);

export default HomeExercisePlan;
