import { Fragment } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import ScreenHeader from '../common/ScreenHeader';
import Button from '../common/Button';
import styles from './styles';
import {
  GENETICS_DISCLAIMER,
  GENETICS_INTRO,
  GENETICS_SECTIONS,
} from '../../lib/genetics-family-content';

/**
 * Where 孕期时间线 is offered, and after which section.
 *
 * Not at the foot of the page. 「怀孕本身会怎么样」 is the section a
 * reader who is already pregnant — or has already decided — stops at,
 * and it is the one that ends without saying what to actually arrange.
 * The timeline is the answer to the question that section provokes, so
 * it sits directly under it rather than below three more sections
 * about testing options that reader has passed.
 */
const PREGNANCY_TIMELINE_AFTER_SECTION = 'pregnancy';
const PREGNANCY_TIMELINE_HREF = '/p-pregnancy';

/**
 * 遗传与生育.
 *
 * A reading page, not a card. The anesthesia card is an image because
 * it gets handed to a clinician in a pre-op room; this is the opposite
 * kind of artefact — read over weeks, argued about with a partner,
 * come back to. An image of it could not be searched, copied into a
 * message to a spouse, read by a screen reader, or corrected after it
 * had been saved to someone's photo roll.
 *
 * The content lives in lib/genetics-family-content.ts so the claims
 * are testable and each section keeps its citation. Nothing here
 * recommends a course of action; see that file for why.
 */
const GeneticsFamilyScreen = () => {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.safeArea}>
        <ScreenHeader title="遗传与生育" />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>{GENETICS_INTRO}</Text>

          {GENETICS_SECTIONS.map((section) => (
            <Fragment key={section.id}>
              {/* accessibilityRole="summary" would flatten the whole
                  card into one announcement; the points are separately
                  readable on purpose, because several of them are the
                  answer to a different question. */}
              <View style={styles.section}>
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

                {section.source ? (
                  <View style={styles.sourceRow}>
                    <Text style={styles.sourceText}>出处：{section.source}</Text>
                  </View>
                ) : null}
              </View>

              {section.id === PREGNANCY_TIMELINE_AFTER_SECTION ? (
                <View style={styles.crossLink}>
                  {/* Phrased as 「如果」, not 「你的」. This page's whole
                      stance is that it does not know and does not ask
                      whether the reader is pregnant, and a button
                      reading 「查看你的孕期计划」 would assume it. The
                      timeline itself infers nothing either — see
                      screens/p-pregnancy/pregnancy-tracker.ts. */}
                  <Button
                    label="打开「孕期时间线」"
                    variant="tinted"
                    trailingIcon="chevron-right"
                    accessibilityHint="孕前、孕早中晚期、分娩和产后各要安排什么，每条都写了出处。"
                    onPress={() => router.push(PREGNANCY_TIMELINE_HREF as Href)}
                  />
                  <Text style={styles.crossLinkHint}>
                    如果已经在准备或已经怀孕：那一页把上面这些按时间排开了 ——
                    什么时候查坐位和仰卧位肺活量、孕晚期该把哪几个科室凑到一起、分娩和产后各有哪些要提前说的事。
                  </Text>
                </View>
              ) : null}
            </Fragment>
          ))}

          <Text style={styles.disclaimer}>{GENETICS_DISCLAIMER}</Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

export default GeneticsFamilyScreen;
