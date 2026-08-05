import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../common/ScreenHeader';
import styles from './styles';
import {
  GENETICS_DISCLAIMER,
  GENETICS_INTRO,
  GENETICS_SECTIONS,
} from '../../lib/genetics-family-content';

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
const GeneticsFamilyScreen = () => (
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
          // accessibilityRole="summary" would flatten the whole card
          // into one announcement; the points are separately readable
          // on purpose, because several of them are the answer to a
          // different question.
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

            {section.source ? (
              <View style={styles.sourceRow}>
                <Text style={styles.sourceText}>出处：{section.source}</Text>
              </View>
            ) : null}
          </View>
        ))}

        <Text style={styles.disclaimer}>{GENETICS_DISCLAIMER}</Text>
      </ScrollView>
    </View>
  </SafeAreaView>
);

export default GeneticsFamilyScreen;
