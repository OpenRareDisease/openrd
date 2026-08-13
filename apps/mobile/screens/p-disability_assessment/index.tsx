import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../common/ScreenHeader';
import styles from './styles';
import {
  ADL_ANSWER_LABEL,
  ADL_ANSWER_ORDER,
  ADL_INTRO,
  ADL_ITEMS,
  ADL_SCORE_DISCLAIMER,
  ADL_SOURCE,
  ASSESSMENT_MATERIALS,
  DISABILITY_CONTENT_AS_OF,
  DISABILITY_DISCLAIMER,
  DISABILITY_INTRO,
  DISABILITY_LOCALITY_NOTE,
  DISABILITY_SECTIONS,
  GRADE_CRITERIA_SOURCE,
  LIMB_GRADE_CRITERIA,
  MATERIALS_SOURCE,
  buildAdlNarrative,
  tallyAdl,
  type AdlAnswer,
  type AdlAnswers,
} from '../../lib/disability-assessment-content';

/**
 * 残疾评定准备包.
 *
 * A reading page with one interactive block, not a calculator. The
 * interactive block asks the eight activities and hands back a sentence
 * the patient can read out at the assessment; it never converts that
 * into a grade, because no such conversion exists — see
 * ADL_SCORE_DISCLAIMER and the 'no-degree-definition' section in
 * lib/disability-assessment-content.ts.
 *
 * The answers live in component state and are never persisted or sent.
 * Nothing here goes near the API: this is a page someone may want to
 * fill in honestly, including the parts they have not told their family,
 * and it should cost them nothing to do so.
 */
const DisabilityAssessmentScreen = () => {
  const [answers, setAnswers] = useState<AdlAnswers>({});

  const tally = useMemo(() => tallyAdl(answers), [answers]);
  const narrative = useMemo(() => buildAdlNarrative(answers), [answers]);

  const setAnswer = (itemId: string, answer: AdlAnswer) => {
    setAnswers((current) => ({ ...current, [itemId]: answer }));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.safeArea}>
        <ScreenHeader title="残疾评定准备" />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>{DISABILITY_INTRO}</Text>

          <View style={styles.provenance}>
            <Text style={styles.provenanceDate}>资料截至 {DISABILITY_CONTENT_AS_OF}</Text>
            <Text style={styles.provenanceNote}>{DISABILITY_LOCALITY_NOTE}</Text>
          </View>

          {/* The functional clauses, lifted out of the grade lists.
              Every one of them is the LAST or second-to-last item of its
              grade, behind five to nine items about missing limbs — which
              is how a patient who cannot wash their own hair reads the
              standard and decides it is not about them. */}
          <View style={styles.highlightCard}>
            <Text style={styles.highlightTitle} accessibilityRole="header">
              先读这几条
            </Text>
            <Text style={styles.highlightLede}>
              标准里每一级都有一条讲「功能障碍」的条款，它们都排在缺失类条款的后面，很容易读不到。原文如下，一个字没改。
            </Text>
            {LIMB_GRADE_CRITERIA.map((grade) =>
              grade.items
                .filter((item) => item.functional)
                .map((item) => (
                  <View key={`${grade.id}-${item.marker}`} style={styles.highlightRow}>
                    <Text style={styles.highlightGrade}>
                      {grade.grade} · 第 {item.marker.replace(')', '')} 项
                    </Text>
                    <Text style={styles.highlightClause}>{item.text}</Text>
                  </View>
                )),
            )}
            <View style={styles.sourceRow}>
              <Text style={styles.sourceText}>出处：{GRADE_CRITERIA_SOURCE}</Text>
            </View>
          </View>

          {/* The full grades, verbatim and in the standard's own order.
              Pulling the functional clauses out above does not mean
              hiding the rest — a patient reading only the flattering
              subset is being handed a different lie. */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              肢体残疾分级原文（四级全文）
            </Text>
            <Text style={styles.sectionLede}>
              评定当天用的就是这一份。标着竖线的是上面那几条功能障碍条款，在原文里的位置。
            </Text>
            {LIMB_GRADE_CRITERIA.map((grade) => (
              <View key={grade.id} style={styles.gradeBlock}>
                <Text style={styles.gradeHeading} accessibilityRole="header">
                  {grade.grade}
                </Text>
                <Text style={styles.gradeClause}>{grade.clause}</Text>
                <Text style={styles.gradeHeadline}>{grade.headline}</Text>
                {grade.items.map((item) => (
                  <View
                    key={item.marker}
                    style={[
                      styles.gradeItem,
                      item.functional ? styles.gradeItemFunctionalWrap : null,
                    ]}
                  >
                    <Text style={styles.gradeMarker}>{item.marker}</Text>
                    <Text
                      style={item.functional ? styles.gradeItemFunctional : styles.gradeItemText}
                    >
                      {item.text}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
            <View style={styles.sourceRow}>
              <Text style={styles.sourceText}>出处：{GRADE_CRITERIA_SOURCE}</Text>
            </View>
          </View>

          {DISABILITY_SECTIONS.map((section) => (
            <View key={section.id} style={styles.section}>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                {section.title}
              </Text>
              {section.lede ? <Text style={styles.sectionLede}>{section.lede}</Text> : null}
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

          {/* 八项自述. */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              把自己的功能说清楚
            </Text>
            <Text style={styles.adlIntro}>{ADL_INTRO}</Text>

            {ADL_ITEMS.map((item) => {
              const selected = answers[item.id];
              return (
                <View key={item.id} style={styles.adlItem}>
                  <Text style={styles.adlLabel} accessibilityRole="header">
                    {item.label}
                  </Text>
                  {item.prompts.map((prompt) => (
                    <Text key={prompt} style={styles.adlPrompt}>
                      · {prompt}
                    </Text>
                  ))}
                  <View style={styles.adlChoices}>
                    {ADL_ANSWER_ORDER.map((answer) => {
                      const isSelected = selected === answer;
                      return (
                        <Pressable
                          key={answer}
                          style={[styles.adlChoice, isSelected ? styles.adlChoiceSelected : null]}
                          onPress={() => setAnswer(item.id, answer)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: isSelected, checked: isSelected }}
                          // react-native-web 0.20 drops accessibilityState
                          // on Pressable; aria-checked is what actually
                          // reaches the DOM, and the whole point of this
                          // control is that a screen-reader user can hear
                          // which answer they gave.
                          aria-checked={isSelected}
                          accessibilityLabel={`${item.label}：${ADL_ANSWER_LABEL[answer]}`}
                        >
                          <Text
                            style={[
                              styles.adlChoiceText,
                              isSelected ? styles.adlChoiceTextSelected : null,
                            ]}
                          >
                            {ADL_ANSWER_LABEL[answer]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}

            <View style={styles.tallyBlock}>
              <View style={styles.tallyRow}>
                <Text style={styles.tallyValue}>
                  {tally.total === null ? '—' : tally.total.toFixed(1)}
                </Text>
                <Text style={styles.tallyLabel}>
                  {tally.total === null
                    ? `八项里已填 ${tally.answeredCount} 项，全部填完才会显示合计`
                    : `八项合计（满分 ${tally.itemCount}）`}
                </Text>
              </View>
              <Text style={styles.tallyDisclaimer}>{ADL_SCORE_DISCLAIMER}</Text>

              {/* `selectable` throughout: the useful artefact is text a
                  patient can copy into a message to a family member who
                  is coming with them, or read off the phone at the desk.
                  A screenshot of a score card would serve neither. */}
              <View style={styles.narrativeBlock}>
                <Text style={styles.narrativeHint}>
                  下面这段可以长按选中复制，或者到了现场照着说。每一项后面最好再补一句你自己的话
                  ——「洗漱：实现困难，我抬手过不了肩，洗头要人帮」比只说「实现困难」有用得多。
                </Text>
                {narrative.map((line, index) => (
                  <Text key={`${index}-${line}`} style={styles.narrativeLine} selectable>
                    {line}
                  </Text>
                ))}
              </View>

              <View style={styles.sourceRow}>
                <Text style={styles.sourceText}>出处：{ADL_SOURCE}</Text>
              </View>
            </View>
          </View>

          {/* 材料清单. */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              去评定那天带什么
            </Text>
            <Text style={styles.sectionLede}>
              标「办法要求」的是规定里写明的；标「本页建议」的是我们的建议，窗口不会因为缺了它拒收，但带上能省事。
            </Text>
            {ASSESSMENT_MATERIALS.map((material) => (
              <View key={material.id} style={styles.materialItem}>
                <View style={styles.materialHead}>
                  <Text style={styles.materialLabel}>{material.label}</Text>
                  <Text
                    style={[
                      styles.materialTag,
                      material.required ? styles.materialTagRequired : styles.materialTagSuggested,
                    ]}
                  >
                    {material.required ? '办法要求' : '本页建议'}
                  </Text>
                </View>
                <Text style={styles.materialDetail}>{material.detail}</Text>
              </View>
            ))}
            <View style={styles.sourceRow}>
              <Text style={styles.sourceText}>出处：{MATERIALS_SOURCE}</Text>
            </View>
          </View>

          <Text style={styles.disclaimer}>{DISABILITY_DISCLAIMER}</Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

export default DisabilityAssessmentScreen;
